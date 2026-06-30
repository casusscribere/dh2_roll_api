/**
 * roll_table category + roll_on action — Scatter Diagram, Haywire, and
 * Hallucinogenic tables invoked from rules. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const ranged = (qualities, damage = '1d10') => ({ name: 'Device', isMelee: false, damage, pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities });

test('Haywire rolls on the Haywire Field Effects table on a hit', () => {
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Haywire (3)']),
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10), die(7, 10)]), buildRegistry());   // hit, dmg, table 1d10 = 7
    const tr = r.hits[0].targetEffects.tableRolls[0];
    assert.equal(tr.table, 'Haywire Field Effects');
    assert.equal(tr.roll, 7);
    assert.match(tr.text, /Dead Zone/);
});

test('Hallucinogenic rolls the table only when the Toughness test FAILS, and applies its conditions', () => {
    // T 30, −10×2 = −20 → threshold 10; test roll 50 fails → roll Hallucinogenic (1d10 = 1 → Prone, Stunned)
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Hallucinogenic (2)']),
        action: 'Standard Attack', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, toughness: 30 },
    }, riggedDice([d100(20), die(5, 10), d100(50), die(1, 10)]), buildRegistry());
    const t = r.hits[0].targetEffects.tests[0];
    assert.equal(t.resolved.success, false);
    assert.equal(t.resolved.tableRoll.table, 'Hallucinogenic Effects');
    assert.equal(t.resolved.tableRoll.roll, 1);
    assert.match(t.resolved.tableRoll.text, /Bugs/);
    // the delusion's conditions land on the target
    assert.deepEqual(r.hits[0].targetEffects.statuses.map((s) => s.status), ['Prone', 'Stunned']);
});

test('Hallucinogenic does NOT roll the table when the test passes', () => {
    // threshold 10; test roll 5 passes → no table roll
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Hallucinogenic (2)']),
        action: 'Standard Attack', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, toughness: 30 },
    }, riggedDice([d100(20), die(5, 10), d100(5)]), buildRegistry());
    const t = r.hits[0].targetEffects.tests[0];
    assert.equal(t.resolved.success, true);
    assert.equal(t.resolved.tableRoll, undefined);
});

test('Blast scatter direction comes from the Scatter Diagram table', () => {
    const FRAG = { name: 'Frag', isMelee: false, damage: '2d10', pen: 0, damageType: 'Explosive', rof: { single: true, burst: 0, full: 0 }, qualities: ['Blast (3)'] };
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack', rangeBand: 'Normal Range' },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(4, 10), die(6, 10)]), buildRegistry());
    assert.equal(r.scatter.direction, 7);             // the Scatter Diagram 1d10
    assert.match(r.scatter.directionText, /left/);    // row 7 = "to the left"
});

test('roll_on an unknown table records an error rather than crashing', () => {
    const reg = buildRegistry('quality "Bogus" { on ON_HIT when has_quality("Bogus") then roll_on "Nonexistent" }');
    const r = resolveAttack({ characteristics: { ws: 50, s: 30, t: 30 }, weapon: { name: 'X', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Bogus'] }, action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 } },
        riggedDice([d100(20), die(5, 10)]), reg);
    assert.equal(r.hits[0].targetEffects.tableRolls[0].error, 'unknown roll_table');
});

test('Haywire surfaces the field area (radius = Haywire X) with the table roll', () => {
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Haywire (3)']),
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10), die(7, 10)]), buildRegistry());
    const tr = r.hits[0].targetEffects.tableRolls[0];
    assert.equal(tr.table, 'Haywire Field Effects');
    assert.equal(tr.area, 3);   // Haywire (3) → 3 m radius
});
