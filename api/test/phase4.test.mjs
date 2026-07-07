/**
 * Phase 4 (ROADMAP.md): EncounterState + the upkeep.* pipeline — Corrosive AP
 * persistence across engagements, On Fire's per-round burn, Toxified's
 * end-of-turn test, Recharge cooldown, Haywire decay, duration expiry.
 * node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyEncounter, encounterActor, tickEncounter, harvestEngagement, mergeActorState } from '../lib/encounter.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { dispatch } from '../lib/api-router.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const gun = (qualities) => ({ name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities });

// --- upkeep ticks ---------------------------------------------------------------
test('On Fire burns 1d10 at TURN_START (declare damage through the upkeep pipeline)', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'a', 'Burning Man').conditions.push({ name: 'On Fire', duration: null });
    const { encounter, events } = tickEncounter(enc, 'TURN_START', buildRegistry(), riggedDice([die(7, 10)]));
    const burn = events.find((e) => e.type === 'damage' && e.source === 'On Fire');
    assert.equal(burn.amount, 7);
    assert.equal(encounter.actors.a.wounds.taken, 7);
    assert.equal(enc.actors.a.wounds.taken, 0);            // input untouched (pure)
});

test('Toxified: end-of-turn Toughness test vs stored stats; 1d10 only on failure', () => {
    const enc = emptyEncounter();
    const actor = encounterActor(enc, 'v', 'Victim');
    actor.stats.characteristics.t = 40;
    actor.conditions.push({ name: 'Toxified', severity: 2 });
    // T 40 − 20 = 20 threshold. Fail (roll 80) → 1d10 = 6 damage
    const fail = tickEncounter(enc, 'TURN_END', buildRegistry(), riggedDice([d100(80), die(6, 10)]));
    const ev = fail.events.find((e) => e.type === 'test');
    assert.equal(ev.threshold, 20);
    assert.equal(ev.success, false);
    assert.equal(ev.damage, 6);
    assert.equal(fail.encounter.actors.v.wounds.taken, 6);
    // Pass (roll 10) → no damage roll at all (lazy on-fail dice)
    const pass = tickEncounter(enc, 'TURN_END', buildRegistry(), riggedDice([d100(10)]));
    assert.equal(pass.events.find((e) => e.type === 'test').success, true);
    assert.equal(pass.encounter.actors.v.wounds.taken, 0);
});

test('ROUND_END mechanism: durations expire, Haywire-style severities decay', () => {
    const enc = emptyEncounter();
    const a = encounterActor(enc, 'a');
    a.conditions.push({ name: 'Stunned', duration: 1 });
    a.conditions.push({ name: 'Haywire Field', severity: 3, decay: 1 });
    const r1 = tickEncounter(enc, 'ROUND_END', buildRegistry(), riggedDice([]));
    assert.ok(r1.events.some((e) => e.type === 'expired' && e.source === 'Stunned'));
    assert.ok(r1.events.some((e) => e.type === 'decay' && /severity → 2/.test(e.reason)));
    assert.deepEqual(r1.encounter.actors.a.conditions.map((c) => `${c.name}:${c.severity ?? ''}`), ['Haywire Field:2']);
    assert.equal(r1.encounter.round, 2);
    // two more rounds → the field decays away entirely
    const r2 = tickEncounter(r1.encounter, 'ROUND_END', buildRegistry(), riggedDice([]));
    const r3 = tickEncounter(r2.encounter, 'ROUND_END', buildRegistry(), riggedDice([]));
    assert.deepEqual(r3.encounter.actors.a.conditions, []);
});

test('Recharge cooldown: set by a Maximal shot, blocks with a warning, clears at TURN_END', () => {
    // 1. fire on Maximal → Recharge effect → cooldown recorded in the encounter
    const shot = dispatch('POST', '/api/resolve', {
        attacker: { characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun(['Maximal']), configs: ['Maximal'], action: 'Standard Attack' },
        defender: { characteristics: { t: 30 }, armour: 0, toughnessBonus: 3 },
        attackerKey: 'shooter', defenderKey: 'victim',
        forcedRolls: [20, 5, 5],
    }).body;
    assert.ok(shot.attack.effects.some((e) => e.name === 'Recharge'));
    assert.equal(shot.encounter.actors.shooter.cooldowns.recharge, true);
    // 2. firing again while recharging → advisory warning effect
    const again = dispatch('POST', '/api/resolve', {
        attacker: { characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun(['Maximal']), action: 'Standard Attack' },
        defender: { characteristics: { t: 30 }, armour: 0, toughnessBonus: 3 },
        encounter: shot.encounter, attackerKey: 'shooter', defenderKey: 'victim',
        forcedRolls: [20, 5],
    }).body;
    assert.ok(again.attack.effects.some((e) => e.name === 'Recharging'));
    // 3. TURN_END tick clears the cooldown
    const { encounter, events } = tickEncounter(shot.encounter, 'TURN_END', buildRegistry(), riggedDice([]), 'shooter');
    assert.equal(encounter.actors.shooter.cooldowns.recharge, false);
    assert.ok(events.some((e) => e.type === 'cooldown'));
});

// --- persistence across engagements ----------------------------------------------
test('Corrosive AP loss persists: the second engagement soaks against the corroded armour', () => {
    // Engagement 1: Corrosive corrodes 4 AP at the struck location (Body via forced 20 → location roll maps)
    const first = dispatch('POST', '/api/resolve', {
        attacker: { characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun(['Corrosive']), action: 'Standard Attack' },
        defender: { characteristics: { t: 30 }, armour: 5, toughnessBonus: 3 },
        attackerKey: 'a', defenderKey: 'd',
        forcedRolls: [20, 2, 4],                    // hit, dmg 2, corrode 4
    }).body;
    const loc = first.attack.hits[0].location;
    assert.equal(first.encounter.actors.d.armourDamage[loc], 4);
    // Engagement 2 (same location via same to-hit roll): soak uses armour 5−4 = 1
    const second = dispatch('POST', '/api/resolve', {
        attacker: { characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun([]), action: 'Standard Attack' },
        defender: { characteristics: { t: 30 }, armour: 5, toughnessBonus: 3 },
        encounter: first.encounter, attackerKey: 'a', defenderKey: 'd',
        forcedRolls: [20, 9],
    }).body;
    assert.equal(second.attack.hits[0].soak.armour, 1);     // 5 base − 4 persistent corrosion
    assert.equal(second.attack.hits[0].soak.woundsInflicted, 5);   // 9 − (1 + 3)
});

test('conditions persist: the defender set On Fire attacks at −10 next engagement', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'x', 'Torch').conditions.push({ name: 'On Fire', duration: null });
    const r = dispatch('POST', '/api/resolve', {
        attacker: { characteristics: { bs: 50, s: 30, t: 30 }, weapon: gun([]), action: 'Standard Attack' },
        defender: { characteristics: { t: 30 }, armour: 0, toughnessBonus: 3 },
        encounter: enc, attackerKey: 'x', defenderKey: 'y',
        forcedRolls: [20, 5],
    }).body;
    assert.equal(r.attack.test.modifiers.on_fire, -10);     // merged from the encounter state
});

test('mergeActorState does not duplicate conditions the input already carries', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'k').conditions.push({ name: 'On Fire' });
    const merged = mergeActorState({ conditions: ['On Fire'] }, enc, 'k');
    assert.equal(merged.conditions.length, 1);
});

// --- /api/encounter/tick ----------------------------------------------------------
test('/api/encounter/tick runs a phase and returns encounter + events + rollTrace', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'a').conditions.push({ name: 'On Fire' });
    const { status, body } = dispatch('POST', '/api/encounter/tick', { encounter: enc, phase: 'TURN_START', forcedRolls: [3] });
    assert.equal(status, 200);
    assert.equal(body.events[0].amount, 3);
    assert.equal(body.encounter.actors.a.wounds.taken, 3);
    assert.ok(Array.isArray(body.rollTrace));
});
