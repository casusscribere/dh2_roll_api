/**
 * Engagement resolution — attack → evasion/field → soak → apply → on-hit.
 * resolveEngagement (POST /api/resolve). node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEngagement } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const semiAuto = {
    characteristics: { bs: 70, s: 30, t: 30 },
    weapon: { name: 'Autogun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 2, full: 0 }, qualities: [] },
    action: 'Semi-Auto Burst', rangeBand: 'Normal Range',
};

// --- Dodge -------------------------------------------------------------------
test('Dodge evasion negates hits (more by DoS); surviving hits soak normally', () => {
    // BS70 roll 11 → DoS 7 → semi extra ⌊6/2⌋=3 capped to RoF-1=1 → 2 hits.
    const r = resolveEngagement({
        attacker: semiAuto,
        defender: { characteristics: { ag: 30, t: 30 }, armour: 0, toughnessBonus: 3, evasion: { mode: 'dodge' } },
        options: {},
    }, riggedDice([d100(11), die(5, 10), die(5, 10), d100(25)]), buildRegistry());
    // Dodge Ag30 vs 25 → DoS = 1+(3-2)=2 → evade 1+⌊2/2⌋ = 2 (both hits).
    assert.equal(r.reaction.mode, 'dodge');
    assert.equal(r.reaction.test.success, true);
    assert.equal(r.defender.evaded, 2);
    assert.ok(r.attack.hits.every((h) => h.evaded));
    assert.equal(r.attack.totalWounds, 0);
});

// --- Parry -------------------------------------------------------------------
test('Parry evasion (with Balanced) negates one hit', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 60, s: 30, t: 30 }, weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack' },
        defender: { characteristics: { ws: 40, t: 30 }, armour: 0, toughnessBonus: 3, weapon: { qualities: ['Balanced'] }, evasion: { mode: 'parry' } },
        options: {},
    }, riggedDice([d100(20), die(5, 10), d100(45)]), buildRegistry());
    assert.equal(r.reaction.mode, 'parry');
    assert.equal(r.reaction.test.modifiers.balanced, 10);     // WS40 + 10 = 50, roll 45 → success
    assert.equal(r.defender.evaded, 1);
    assert.equal(r.attack.totalWounds, 0);
});

// --- Force Field -------------------------------------------------------------
test('a Force Field absorbs a hit on roll <= rating', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { bs: 70, s: 30, t: 30 }, weapon: { name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack', rangeBand: 'Normal Range' },
        defender: { characteristics: { t: 30 }, armour: 2, toughnessBonus: 3, field: { rating: 40, overloadMax: 5 } },
        options: {},
    }, riggedDice([d100(20), die(8, 10), d100(30)]), buildRegistry());
    assert.equal(r.attack.hits[0].field.absorbed, true);
    assert.equal(r.attack.hits[0].fieldAbsorbed, true);
    assert.equal(r.attack.totalWounds, 0);
});

test('a Force Field overloads on a low roll and stays down for later hits', () => {
    const r = resolveEngagement({
        attacker: semiAuto,    // 2 hits
        defender: { characteristics: { t: 30 }, armour: 0, toughnessBonus: 3, field: { rating: 40, overloadMax: 5 } },
        options: {},
    }, riggedDice([d100(11), die(5, 10), die(5, 10), d100(3)]), buildRegistry());
    assert.equal(r.attack.hits[0].field.overloaded, true);    // roll 3 <= 5
    assert.equal(r.attack.hits[0].fieldAbsorbed, true);
    assert.equal(r.defender.fieldDown, true);
    assert.equal(r.attack.hits[1].field, undefined);          // field is down → no check
    assert.equal(r.attack.hits[1].soak.woundsInflicted, 2);   // 5 dmg − 3 TB
});

// --- Righteous Fury surfaces on a landed hit ---------------------------------
test('a landed hit carries Righteous Fury (natural 10 → crit lookup)', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 70, s: 30, t: 30 }, weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack' },
        defender: { characteristics: { ag: 1, t: 30 }, armour: 0, toughnessBonus: 0, evasion: { mode: 'none' } },
        options: {},
    }, riggedDice([d100(20), die(10, 10), die(3, 5)]), buildRegistry());
    const rf = r.attack.hits[0].damage.righteousFury;
    assert.equal(rf.length, 1);
    assert.equal(rf[0].naturalRoll, 10);
    assert.equal(rf[0].rfRoll, 3);
    assert.ok(rf[0].effect.length > 0);                       // crit-table effect text
});

// --- target-test threshold is reported even in manual mode -------------------
test('a triggered defender test records its threshold even without auto-resolve', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 70, s: 40, t: 30 }, weapon: { name: 'Maul', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Concussive (2)'] }, action: 'Standard Attack' },
        defender: { characteristics: { ag: 1, t: 35, s: 30 }, armour: 0, toughnessBonus: 3, evasion: { mode: 'none' } },
        options: { autoResolveTests: false },
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    const te = r.attack.hits[0].targetEffects.tests[0];
    assert.equal(te.characteristic, 'Toughness');
    assert.equal(te.characteristicValue, 35);
    assert.equal(te.threshold, 15);          // T35 − 20 — the defender rolls ≤ 15
    assert.equal(te.resolved, undefined);    // not rolled in manual mode
});

// --- landed hits resolve on-hit target effects -------------------------------
test('on-hit target effects auto-resolve only for landed hits', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 60, s: 40, t: 30 }, weapon: { name: 'Maul', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Concussive (2)'] }, action: 'Standard Attack' },
        defender: { characteristics: { ws: 30, t: 35, s: 30 }, armour: 0, toughnessBonus: 3, evasion: { mode: 'none' } },
        options: { autoResolveTests: true },
    }, riggedDice([d100(20), die(5, 10), d100(80)]), buildRegistry());
    const te = r.attack.hits[0].targetEffects;
    assert.equal(te.tests[0].resolved.modifiedTarget, 15);    // T35 − 20
    assert.equal(te.tests[0].resolved.success, false);        // roll 80 > 15
    assert.match(te.tests[0].resolved.outcome, /Stunned/);
});