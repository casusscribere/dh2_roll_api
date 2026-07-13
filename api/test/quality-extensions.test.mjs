/**
 * Overheats-overrides-Jam (suppress), Flexible (prevent_parry), Graviton, the
 * Darkness + Haywire Field circumstances, and Off-Hand as a Configuration. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, resolveEngagement } from '../lib/engine.mjs';
import { buildRegistry, builtinRules } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const ranged = (qualities, damage = '1d10') => ({ name: 'Gun', isMelee: false, damage, pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities });

// --- (1) Overheats overrides Jam --------------------------------------------
test('Overheats overrides Jam: a high roll overheats instead of jamming', () => {
    const r = resolveAttack({ characteristics: { bs: 50 }, weapon: { ...ranged(['Overheats']), damageType: 'Energy' }, action: 'Standard Attack' },
        riggedDice([d100(98)]), buildRegistry());
    assert.ok(r.effects.some((e) => e.name === 'Overheats'));
    assert.ok(!r.effects.some((e) => e.name === 'Jam'));
});

test('a non-Overheats ranged weapon still jams on a high roll', () => {
    const r = resolveAttack({ characteristics: { bs: 50 }, weapon: ranged([]), action: 'Standard Attack' },
        riggedDice([d100(98)]), buildRegistry());
    assert.ok(r.effects.some((e) => e.name === 'Jam'));
});

// --- (3) Graviton -----------------------------------------------------------
test('Graviton adds damage equal to the target armour (negating armour)', () => {
    const r = resolveAttack({ characteristics: { bs: 60, s: 30, t: 30 }, weapon: ranged(['Graviton']), action: 'Standard Attack', target: { armour: 5, toughnessBonus: 3 } },
        riggedDice([d100(20), die(6, 10)]), buildRegistry());
    assert.equal(r.hits[0].damage.modifiers.graviton, 5);     // = target armour
    assert.equal(r.hits[0].damage.total, 11);                 // 6 + 5
    assert.equal(r.hits[0].soak.woundsInflicted, 3);          // 11 − (5 armour + 3 TB) — armour negated
});

// --- (7) Darkness circumstance (DH2 p.229) ----------------------------------
test('Darkness: WS -20 melee, BS -30 ranged', () => {
    const melee = resolveAttack({ characteristics: { ws: 50, s: 30, t: 30 }, weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack', circumstances: ['Darkness'] },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(melee.test.modifiers.darkness, -20);
    const shot = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged([]), action: 'Standard Attack', circumstances: ['Darkness'] },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(shot.test.modifiers.darkness, -30);
});

// --- (6) Haywire Field circumstance, by severity ----------------------------
test('Haywire Field circumstance penalises powered ranged attacks by severity', () => {
    const fld = (severity, qualities = []) => resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(qualities), action: 'Standard Attack',
        circumstances: [{ name: 'Haywire Field', severity }],
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(fld(1).test.modifiers['haywire field'], undefined);  // Insignificant
    assert.equal(fld(2).test.modifiers['haywire field'], -10);        // Minor Disruption
    assert.equal(fld(3).test.modifiers['haywire field'], -20);        // Major Disruption
    assert.equal(fld(4).test.modifiers['haywire field'], -60);        // Dead Zone
    assert.equal(fld(4, ['Primitive (7)']).test.modifiers['haywire field'], undefined);  // Primitive exempt
});

// --- (7) the off-hand -20 lives on the DualWield (off-hand) Configuration ----
test('DualWield (off-hand) is a Configuration and applies the -20 off-hand penalty', () => {
    assert.equal(builtinRules.find((b) => b.id === 'dualwield-off-hand')?.category, 'Configurations');
    // the legacy combat flag still drives it (facts read flag OR config)
    const r = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged([]), action: 'Standard Attack', combat: { firingOffhand: true } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(r.test.modifiers.off_hand, -20);
});

// --- (2) Flexible prevents a Parry reaction (the safeguard) ------------------
test('Flexible overrides any attempt to Parry and notes it', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 60, s: 30, t: 30 }, weapon: { name: 'Whip', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Flexible'] }, action: 'Standard Attack' },
        defender: { characteristics: { ws: 50, t: 30 }, armour: 0, toughnessBonus: 3, weapon: { qualities: [] }, evasion: { mode: 'parry' } },
        options: {},
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(r.attack.preventsParry, true);
    assert.equal(r.reaction.prevented, true);
    assert.match(r.reaction.note, /Flexible/);
    assert.equal(r.defender.evaded, 0);   // the parry is refused → nothing evaded
});
