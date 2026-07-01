/**
 * Unnatural Characteristic (DH2 core p.139): a successful test using a
 * characteristic with an Unnatural value gains ⌈X/2⌉ bonus degrees of success
 * (p.18 round-up); the value also adds to the characteristic bonus (Strength →
 * melee Strength Bonus). node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollTest, resolveAttack, engageEvasion } from '../lib/engine.mjs';
import { buildRegistry, builtinRules } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

// --- rollTest: bonus DoS on success, rounded up; nothing on a failure --------
test('rollTest: Unnatural adds ceil(X/2) DoS on a success', () => {
    const r = rollTest({ target: 40, unnatural: 3 }, riggedDice([d100(20)]));   // success
    assert.equal(r.success, true);
    assert.equal(r.bonusDos, 2);                 // ceil(3/2) = 2
    assert.equal(r.dos, 1 + 4 - 2 + 2);          // base (1 + tens40 − tens20) + bonus = 5
});

test('rollTest: Unnatural (4) → +2 DoS; Unnatural (1) → +1 (round up)', () => {
    assert.equal(rollTest({ target: 50, unnatural: 4 }, riggedDice([d100(10)])).bonusDos, 2);
    assert.equal(rollTest({ target: 50, unnatural: 1 }, riggedDice([d100(10)])).bonusDos, 1);
});

test('rollTest: a FAILED test gains no Unnatural bonus', () => {
    const r = rollTest({ target: 30, unnatural: 6 }, riggedDice([d100(80)]));   // 80 > 30 → fail
    assert.equal(r.success, false);
    assert.equal(r.bonusDos, 0);
    assert.equal(r.dos, 0);
});

test('rollTest with no Unnatural is unchanged (bonusDos 0)', () => {
    const r = rollTest({ target: 40 }, riggedDice([d100(20)]));
    assert.equal(r.bonusDos, 0);
    assert.equal(r.dos, 3);                       // 1 + 4 − 2
});

// --- to-hit: attacker Unnatural WS/BS feed the hit's DoS ---------------------
test('Unnatural WS adds bonus DoS to a melee to-hit', () => {
    const w = { name: 'Axe', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const base = resolveAttack({ characteristics: { ws: 50, s: 30, t: 30 }, weapon: w, action: 'Standard Attack' },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    const unnat = resolveAttack({ characteristics: { ws: 50, s: 30, t: 30 }, weapon: w, action: 'Standard Attack', unnatural: { ws: 3 } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(unnat.test.bonusDos, 2);                       // ceil(3/2)
    assert.equal(unnat.test.dos, base.test.dos + 2);            // +2 DoS over the same roll
});

// --- damage: attacker Unnatural Strength folds into the Strength Bonus -------
test('Unnatural Strength raises the melee damage Strength Bonus by X', () => {
    const axe = (unnatural) => resolveAttack({
        characteristics: { ws: 50, s: 35, t: 30 },                  // SB 3
        weapon: { name: 'Axe', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, sbMultiplier: 1, qualities: [] },
        action: 'Standard Attack', unnatural,
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(axe({}).hits[0].damage.modifiers['strength bonus'], 3);          // base SB 3
    assert.equal(axe({ s: 2 }).hits[0].damage.modifiers['strength bonus'], 5);    // 3 + Unnatural 2
});

// --- dodge: defender Unnatural Agility evades more hits ----------------------
test('Unnatural Agility adds DoS to a Dodge, so it evades more hits', () => {
    const dodge = (unnatural) => engageEvasion(
        { characteristics: { ag: 40 }, evasion: { mode: 'dodge' }, unnatural },
        1, buildRegistry(), riggedDice([d100(20)]));
    const plain = dodge({});
    assert.equal(plain.reaction.test.dos, 3);          // 1 + tens40 − tens20
    assert.equal(plain.evaded, 2);                     // 1 + floor(3/2)
    const fast = dodge({ ag: 4 });
    assert.equal(fast.reaction.test.bonusDos, 2);      // ceil(4/2)
    assert.equal(fast.reaction.test.dos, 5);           // 3 + 2
    assert.equal(fast.evaded, 3);                      // 1 + floor(5/2)
});

// --- taxonomy: Talents and Traits are now distinct categories ---------------
test('builtinRules: talents are categorised "Talents", traits "Traits"', () => {
    const talent = builtinRules.find((b) => b.kind === 'talent');
    const trait = builtinRules.find((b) => b.kind === 'trait');
    assert.equal(talent.category, 'Talents');
    assert.equal(trait.category, 'Traits');
    // and they are no longer merged under one label
    assert.ok(!builtinRules.some((b) => b.category === 'Talents and traits'));
});
