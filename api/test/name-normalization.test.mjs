/**
 * Spelling-blind entry matching: "Razor Sharp", "RazorSharp", and "razor_sharp"
 * (and "Two-Weapon Wielder" ↔ "TwoWeaponWielder") all key identically, on both
 * sides of every matcher — DSL text (has_quality("razor_sharp")) and API input
 * lists (qualities: ["RazorSharp"]). normName in rules/_util.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { normName, hasQuality, qualityLevel } from '../lib/rules/_util.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

test('normName folds spaces, underscores, hyphens, and case', () => {
    for (const s of ['Razor Sharp', 'RazorSharp', 'razor_sharp', 'razor-sharp', 'RAZOR SHARP']) {
        assert.equal(normName(s), 'razorsharp');
    }
    assert.equal(normName('Two-Weapon Wielder'), normName('TwoWeaponWielder'));
    assert.equal(normName('two_weapon_wielder'), normName('Two-Weapon Wielder'));
});

test('hasQuality / qualityLevel match across spellings (both entry and query side)', () => {
    assert.ok(hasQuality(['RazorSharp'], 'Razor Sharp'));
    assert.ok(hasQuality(['Razor Sharp'], 'razor_sharp'));
    assert.ok(hasQuality([{ name: 'razor_sharp', level: null }], 'RazorSharp'));
    assert.equal(qualityLevel(['brutal_charge (3)'], 'Brutal Charge', 0), 3);
    assert.equal(qualityLevel(['BrutalCharge 3'], 'brutal_charge', 0), 3);
    assert.ok(!hasQuality(['Razor Sharp'], 'Tearing'));
});

test('weapon quality in camelCase drives its rule: RazorSharp doubles pen on 2+ DoS', () => {
    const gun = { name: 'Gun', isMelee: false, damage: '1d10', pen: 4, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['RazorSharp'] };
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun, action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(10), die(5, 10)]), buildRegistry());
    // 60 + 10 = 70 vs 10 → dos 7 ≥ 2 → Razor Sharp doubles the pen
    assert.equal(r.hits[0].totalPenetration, 8);
});

test('snake_case talent satisfies has_talent: swift_attack silences the talent gate', () => {
    const sword = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const r = resolveAttack({
        characteristics: { ws: 30, s: 30, t: 30 }, weapon: sword, action: 'Swift Attack',
        talents: ['swift_attack'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(1), die(5, 10), die(5, 10)]), buildRegistry());
    assert.ok(!r.effects.some((e) => e.name === 'Swift Attack'), 'gate satisfied by snake_case spelling');
});

test('snake_case condition fires its rule: on_fire applies the -10', () => {
    const gun = { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 }, weapon: gun, action: 'Standard Attack',
        conditions: ['on_fire'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(10), die(5, 10)]), buildRegistry());
    assert.equal(r.test.modifiers.on_fire, -10);
});

test('action names canonicalise too: swift_attack resolves as Swift Attack', () => {
    const sword = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const r = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 }, weapon: sword, action: 'swift_attack',
        talents: ['Swift Attack'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(5), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    assert.equal(r.action, 'Swift Attack');
    assert.equal(r.hits.length, 3);        // dos 5 → per-2-DoS accrual, WS-bonus cap
});

test('custom DSL written in snake_case matches standard-spelled input', () => {
    const reg = buildRegistry(`
        quality "House Rule" {
          on MODIFIERS
          when has_quality("razor_sharp") and has_talent("two_weapon_wielder")
          then add modifier "house" = 5
        }
    `);
    const gun = { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Razor Sharp'] };
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 }, weapon: gun, action: 'Standard Attack',
        talents: ['Two-Weapon Wielder'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(10), die(5, 10)]), reg);
    assert.equal(r.test.modifiers.house, 5);
});
