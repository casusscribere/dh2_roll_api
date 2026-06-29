/**
 * Engine unit tests — Node built-in runner.  Run: npm test  (node --test)
 *
 * Migrated from the original hand-rolled harness; every prior assertion is
 * preserved, plus added coverage for previously-untested engine branches
 * (aim cancelled on All Out, Storm, Twin-Linked, Accurate, Razor Sharp, Melta,
 * Overheats, Vengeful RF threshold, modifier floor, soak floor).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    rollTest, rollDamage, resolveAttack, applySoak,
    getHitLocationForRoll, parseDamageFormula, getDegree,
} from '../lib/engine.mjs';
import { riggedDice, die } from './helpers.mjs';

// --- degrees (DH2 core p.24: 1 + tens-digit difference) ----------------------
test('getDegree: 55 vs 23 → 4 degrees', () => {
    assert.equal(1 + getDegree(55, 23), 4);
});
test('getDegree: equal tens → 1 degree', () => {
    assert.equal(1 + getDegree(30, 30), 1);
});

// --- rollTest ----------------------------------------------------------------
test('rollTest: success computes DoS and modified target', () => {
    const t = rollTest({ target: 40, modifiers: { difficulty: 10 } }, null, 23);
    assert.deepEqual([t.success, t.dos, t.modifiedTarget], [true, 4, 50]);
});
test('rollTest: failure computes DoF', () => {
    const t = rollTest({ target: 40, modifiers: {} }, null, 95);
    assert.deepEqual([t.success, t.dof], [false, 6]);
});
test('rollTest: modifier total capped at +60', () => {
    const t = rollTest({ target: 200, modifiers: { x: 100 } }, null, 99);
    assert.equal(t.modifierTotal, 60);
});
test('rollTest: modifier total floored at -60', () => {
    const t = rollTest({ target: 50, modifiers: { x: -100 } }, null, 99);
    assert.equal(t.modifierTotal, -60);
});
test('rollTest: natural 1 always succeeds', () => {
    const t = rollTest({ target: 5, modifiers: {} }, null, 1);
    assert.equal(t.success, true);
    assert.equal(t.autoSuccess, true);
});
test('rollTest: natural 100 always fails', () => {
    const t = rollTest({ target: 300, modifiers: {} }, null, 100);
    assert.equal(t.success, false);
    assert.equal(t.autoFailure, true);
});

// --- hit locations (reversed digits, DH2 core p.228) -------------------------
test('getHitLocationForRoll: reversed-digit lookups', () => {
    assert.equal(getHitLocationForRoll(30), 'Head');       // 03
    assert.equal(getHitLocationForRoll(55), 'Body');       // 55
    assert.equal(getHitLocationForRoll(19), 'Left Leg');   // 91
    assert.equal(getHitLocationForRoll(48), 'Right Leg');  // 84
    assert.equal(getHitLocationForRoll(70), 'Head');       // 07
});

// --- damage formula parsing --------------------------------------------------
test('parseDamageFormula: valid and invalid forms', () => {
    assert.deepEqual(parseDamageFormula('1d10+5'), { count: 1, sides: 10, flat: 5 });
    assert.deepEqual(parseDamageFormula('2d10'), { count: 2, sides: 10, flat: 0 });
    assert.deepEqual(parseDamageFormula('1d10-2'), { count: 1, sides: 10, flat: -2 });
    assert.equal(parseDamageFormula('Special'), null);
});

// --- rollDamage: tearing keeps highest, RF on natural 10 ---------------------
test('rollDamage: Tearing keeps highest die, RF triggers on 10', () => {
    // 2 dice rolled (tearing), then 1d5 for the RF crit lookup
    const q = [die(3, 10), die(10, 10), die(4, 5)];
    const r = rollDamage(
        { formula: '1d10+5', qualities: ['Tearing'], damageType: 'Explosive', location: 'Body' },
        riggedDice(q),
    );
    assert.deepEqual(r.dice.kept, [10]);
    assert.deepEqual(r.dice.discarded, [3]);
    assert.equal(r.righteousFury.length, 1);
    assert.equal(r.righteousFury[0].rfRoll, 4);
    assert.ok(r.righteousFury[0].effect.length > 0);
    assert.equal(r.total, 15);
});

// --- rollDamage: Proven raises low dice --------------------------------------
test('rollDamage: Proven(3) raises a 1 to 3', () => {
    const r = rollDamage({ formula: '1d10+4', qualities: ['Proven (3)'] }, riggedDice([die(1, 10)]));
    assert.deepEqual(r.dice.adjusted, [3]);
    assert.equal(r.total, 7);
});

// --- rollDamage: Primitive caps high dice ------------------------------------
test('rollDamage: Primitive(7) caps a 9 at 7', () => {
    const r = rollDamage({ formula: '1d10', qualities: ['Primitive (7)'] }, riggedDice([die(9, 10)]));
    assert.deepEqual(r.dice.adjusted, [7]);
});

// --- rollDamage: melee Strength Bonus ----------------------------------------
test('rollDamage: melee adds Strength Bonus', () => {
    const r = rollDamage({ formula: '1d10', sbTimes: 1, strengthBonus: 4 }, riggedDice([die(5, 10)]));
    assert.equal(r.total, 9);
});

// --- rollDamage: Vengeful lowers the RF threshold ----------------------------
test('rollDamage: Vengeful(9) triggers RF on a natural 9', () => {
    const r = rollDamage(
        { formula: '1d10', qualities: ['Vengeful (9)'], damageType: 'Impact', location: 'Head' },
        riggedDice([die(9, 10), die(2, 5)]),
    );
    assert.equal(r.righteousFury.length, 1);
    assert.equal(r.righteousFury[0].naturalRoll, 9);
});

// --- rollDamage: Accurate adds dice by DoS (aimed Standard Attack) ------------
test('rollDamage: Accurate adds +1d10 at DoS3 and +1d10 more at DoS5 when aiming', () => {
    // base die, then accurate die (DoS>=3), then accurate-x2 die (DoS>=5)
    const r = rollDamage(
        { formula: '1d10', qualities: ['Accurate'], dos: 5, action: 'Standard Attack', aimValue: 20 },
        riggedDice([die(4, 10), die(6, 10), die(7, 10)]),
    );
    assert.equal(r.modifiers['accurate'], 6);
    assert.equal(r.modifiers['accurate x 2'], 7);
    assert.equal(r.total, 4 + 6 + 7);
});
test('rollDamage: Accurate requires the Aim action — no bonus dice without it', () => {
    const r = rollDamage(
        { formula: '1d10', qualities: ['Accurate'], dos: 5, action: 'Standard Attack', aimValue: 0 },
        riggedDice([die(4, 10)]),
    );
    assert.equal(r.modifiers['accurate'], undefined);
    assert.equal(r.total, 4);
});
test('rollDamage: Accurate ignored on non-aimed actions even when aiming', () => {
    const r = rollDamage(
        { formula: '1d10', qualities: ['Accurate'], dos: 5, action: 'Semi-Auto Burst', aimValue: 20 },
        riggedDice([die(4, 10)]),
    );
    assert.equal(r.modifiers['accurate'], undefined);
    assert.equal(r.total, 4);
});

// --- rollDamage: unparseable formula returns an error ------------------------
test('rollDamage: unparseable formula returns error object', () => {
    const r = rollDamage({ formula: 'Special' });
    assert.match(r.error, /Cannot parse/);
});

// --- soak --------------------------------------------------------------------
test('applySoak: armour − pen + TB reduction', () => {
    assert.equal(applySoak({ damage: 12, penetration: 4, armour: 6, toughnessBonus: 3 }).woundsInflicted, 7);
});
test('applySoak: penetration cannot exceed armour (no negative armour)', () => {
    assert.equal(applySoak({ damage: 10, penetration: 9, armour: 4, toughnessBonus: 3 }).woundsInflicted, 7);
});
test('applySoak: wounds floored at zero', () => {
    assert.equal(applySoak({ damage: 5, penetration: 0, armour: 4, toughnessBonus: 3 }).woundsInflicted, 0);
});

// --- resolveAttack: semi-auto hit count --------------------------------------
test('resolveAttack: semi-auto extra hits from DoS, location chain', () => {
    const q = [die(11, 100), die(6, 10), die(7, 10)];
    const r = resolveAttack({
        characteristics: { ws: 30, bs: 40, s: 30, t: 30 },
        weapon: { name: 'Autogun', isMelee: false, damage: '1d10+3', pen: 0, damageType: 'Impact', rof: { single: true, burst: 3, full: 10 }, qualities: [] },
        action: 'Semi-Auto Burst', rangeBand: 'Normal Range',
    }, riggedDice(q));
    assert.equal(r.test.dos, 4);
    assert.equal(r.hits.length, 2);
    assert.equal(r.hits[0].location, 'Right Arm');  // 11 → 11
    assert.equal(r.hits[1].location, 'Right Arm');  // chain
});

// --- resolveAttack: full-auto capped by RoF ----------------------------------
test('resolveAttack: full-auto hits capped at weapon RoF', () => {
    const q = [die(1, 100), ...Array(10).fill(0).map(() => die(5, 10))];
    const r = resolveAttack({
        characteristics: { bs: 80, s: 30, t: 30 },
        weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 4 }, qualities: [] },
        action: 'Full Auto Burst', rangeBand: 'Normal Range',
    }, riggedDice(q));
    assert.equal(r.hits.length, 4);
});

// --- resolveAttack: Storm doubles extra hits ---------------------------------
test('resolveAttack: Storm doubles additional hits (within RoF cap)', () => {
    // full-auto, DoS large → base extra hits = DoS-1; Storm ×2, capped at full-1
    const q = [die(1, 100), ...Array(12).fill(0).map(() => die(5, 10))];
    const r = resolveAttack({
        characteristics: { bs: 80, s: 30, t: 30 },
        weapon: { name: 'Storm Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 10 }, qualities: ['Storm'] },
        action: 'Full Auto Burst', rangeBand: 'Normal Range',
    }, riggedDice(q));
    // BS80 vs roll 1 → DoS = 1 + (8 - 0) = 9; base extra = 8; Storm → 16; cap full-1 = 9 → 10 hits
    assert.equal(r.hits.length, 10);
});

// --- resolveAttack: Twin-Linked adds a hit at DoS>=2 --------------------------
test('resolveAttack: Twin-Linked adds one extra hit on a single-shot success', () => {
    const q = [die(11, 100), die(5, 10), die(5, 10)];
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 },
        weapon: { name: 'TL Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Twin-Linked'] },
        action: 'Standard Attack', rangeBand: 'Normal Range',
    }, riggedDice(q));
    assert.equal(r.hits.length, 2);
});

// --- resolveAttack: jam on 99 ------------------------------------------------
test('resolveAttack: jam on 99 cancels hits', () => {
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 },
        weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Standard Attack', rangeBand: 'Normal Range',
    }, riggedDice([die(99, 100)]));
    assert.ok(r.effects.some((e) => e.name === 'Jam'));
    assert.equal(r.hits.length, 0);
});

// --- resolveAttack: Reliable suppresses the jam below 100 --------------------
test('resolveAttack: Reliable weapon does not jam on 99', () => {
    const q = [die(99, 100)];
    const r = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 },
        weapon: { name: 'Reliable Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Reliable'] },
        action: 'Standard Attack', rangeBand: 'Normal Range',
    }, riggedDice([die(99, 100), die(5, 10)]));
    assert.ok(!r.effects.some((e) => e.name === 'Jam'));
});

// --- resolveAttack: Overheats on 92+ -----------------------------------------
test('resolveAttack: Overheats effect added on a 92+ roll', () => {
    const r = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 },
        weapon: { name: 'Plasma', isMelee: false, damage: '1d10', pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Overheats'] },
        action: 'Standard Attack', rangeBand: 'Normal Range',
    }, riggedDice([die(95, 100), die(5, 10)]));
    assert.ok(r.effects.some((e) => e.name === 'Overheats'));
});

// --- resolveAttack: melee SB + called-shot location + soak --------------------
test('resolveAttack: melee adds SB, honours called-shot location, reports soak', () => {
    const q = [die(10, 100), die(6, 10)];
    const r = resolveAttack({
        characteristics: { ws: 50, s: 40, t: 30 },
        weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Called Shot', calledShotLocation: 'Head',
        target: { armour: 2, toughnessBonus: 3 },
    }, riggedDice(q));
    assert.equal(r.hits[0].location, 'Head');
    assert.equal(r.hits[0].damage.total, 10);          // 6 + SB(40/10=4)
    assert.equal(r.hits[0].soak.woundsInflicted, 5);   // 10 - (2 + 3)
    assert.equal(r.totalWounds, 5);
});

// --- resolveAttack: aim bonus cancelled by All Out Attack --------------------
test('resolveAttack: aim modifier is dropped on an All Out Attack', () => {
    const q = [die(50, 100), die(5, 10)];
    const r = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 },
        weapon: { name: 'Club', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'All Out Attack', aim: 'Full',
    }, riggedDice(q));
    assert.equal(r.test.modifiers.aim, undefined);
    assert.equal(r.test.modifiers.attack, 30);
    assert.ok(r.effects.some((e) => e.name === 'All Out Attack'));
});

// --- resolveAttack: Razor Sharp doubles pen at DoS>2 (melee) -----------------
test('resolveAttack: Razor Sharp doubles penetration at DoS>2', () => {
    const q = [die(10, 100), die(5, 10)];  // WS50 vs 10 → DoS = 1 + (5-1) = 5 (>2)
    const r = resolveAttack({
        characteristics: { ws: 50, s: 30, t: 30 },
        weapon: { name: 'Mono Blade', isMelee: true, damage: '1d10', pen: 3, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Razor Sharp'] },
        action: 'Standard Attack',
    }, riggedDice(q));
    assert.equal(r.hits[0].penetrationModifiers['razor sharp'], 3);
    assert.equal(r.hits[0].totalPenetration, 6);
});

// --- resolveAttack: Melta doubles pen at short range (ranged) ----------------
test('resolveAttack: Melta doubles penetration at Short Range', () => {
    const q = [die(20, 100), die(5, 10)];
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 },
        weapon: { name: 'Inferno Pistol', isMelee: false, damage: '1d10', pen: 8, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Melta'] },
        action: 'Standard Attack', rangeBand: 'Short Range',
    }, riggedDice(q));
    assert.equal(r.hits[0].penetrationModifiers['melta'], 8);
    assert.equal(r.hits[0].totalPenetration, 16);
});
