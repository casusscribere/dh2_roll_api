/**
 * Talent activation tests — node --test.
 *
 * Exercises the DSL-authored talents (data/rules/talents.dsl) end-to-end through
 * resolveAttack, focusing on Ambidextrous: the talent must check it is *active*
 * (dual-wielding, or firing off-hand) before touching any penalty.
 *
 * All assertions are on the resolved to-hit modifier set; the d100 is rigged so
 * the roll itself is irrelevant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const PISTOL = {
    name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact',
    rof: { single: true, burst: 0, full: 0 }, qualities: [],
};
const attack = (extra) => resolveAttack({
    characteristics: { bs: 50, s: 30, t: 30 },
    weapon: PISTOL,
    action: 'Standard Attack',
    ...extra,
}, riggedDice([d100(50), die(5, 10)]));

// --- dual-wielding -----------------------------------------------------------
test('Two-Weapon Wielder alone applies the full -20 dual-wield penalty', () => {
    const r = attack({ combat: { dualWielding: true }, talents: ['Two-Weapon Wielder'] });
    assert.equal(r.test.modifiers.two_weapon, -20);
});

test('Ambidextrous + Two-Weapon Wielder reduces the dual-wield penalty to -10', () => {
    const r = attack({ combat: { dualWielding: true }, talents: ['Two-Weapon Wielder', 'Ambidextrous'] });
    assert.equal(r.test.modifiers.two_weapon, -10);     // -20 injected, then reduced
    assert.equal(r.test.modifiers.off_hand, undefined); // off-hand rule never fires when dual-wielding
});

// --- single off-hand weapon --------------------------------------------------
test('Off-hand weapon without Ambidextrous suffers -20', () => {
    const r = attack({ combat: { firingOffhand: true }, talents: [] });
    assert.equal(r.test.modifiers.off_hand, -20);
});

test('Ambidextrous cancels the off-hand penalty', () => {
    const r = attack({ combat: { firingOffhand: true }, talents: ['Ambidextrous'] });
    assert.equal(r.test.modifiers.off_hand, undefined); // injected at p10, cancelled at p100
});

// --- activation gating (the core requirement) --------------------------------
test('Ambidextrous is INACTIVE when not dual-wielding and not firing off-hand', () => {
    // Talent present, but the situation does not call for it: no penalty touched.
    const r = attack({ combat: {}, talents: ['Ambidextrous', 'Two-Weapon Wielder'] });
    assert.equal(r.test.modifiers.off_hand, undefined);
    assert.equal(r.test.modifiers.two_weapon, undefined);
    assert.equal(r.test.modifiers.attack, 10);          // only the normal Standard Attack modifier
});

test('having Ambidextrous but lacking Two-Weapon Wielder does not reduce a dual-wield penalty', () => {
    // No Two-Weapon Wielder ⇒ no two_weapon penalty is injected, and the reducer
    // does not fire (it requires the talent), so nothing spurious appears.
    const r = attack({ combat: { dualWielding: true }, talents: ['Ambidextrous'] });
    assert.equal(r.test.modifiers.two_weapon, undefined);
});

test('baseline single-weapon attack has no off-hand/dual modifiers', () => {
    const r = attack({});
    assert.equal(r.test.modifiers.off_hand, undefined);
    assert.equal(r.test.modifiers.two_weapon, undefined);
});
