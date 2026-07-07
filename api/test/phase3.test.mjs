/**
 * Phase 3 (ROADMAP.md): namespaced pipelines (test.* + the attack. default
 * namespace) and the layered registry's static `replaces` override. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTest, resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { compile } from '../lib/dsl/compiler.mjs';
import { dispatch } from '../lib/api-router.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

// --- test.* pipeline ----------------------------------------------------------
const RESISTANCE = `
talent "Resistance (Fear)" {
  on test.MODIFIERS
  when has_talent("Resistance (Fear)") and test_name == "Fear"
  then add modifier "resistance" = 10
}`;

test('a test.MODIFIERS rule fires only for its test_name and talent', () => {
    const reg = buildRegistry(RESISTANCE);
    const fear = resolveTest({ target: 30, testName: 'Fear', talents: ['Resistance (Fear)'] }, riggedDice([d100(35)]), reg);
    assert.equal(fear.modifiers.resistance, 10);
    assert.equal(fear.modifiedTarget, 40);
    assert.equal(fear.success, true);                       // 35 ≤ 40 only WITH the talent
    const other = resolveTest({ target: 30, testName: 'Athletics', talents: ['Resistance (Fear)'] }, riggedDice([d100(35)]), reg);
    assert.equal(other.modifiers.resistance, undefined);    // wrong test_name
    const untalented = resolveTest({ target: 30, testName: 'Fear' }, riggedDice([d100(35)]), reg);
    assert.equal(untalented.success, false);
});

test('resolveTest carries Unnatural bonus DoS and test.POST_ROLL effects', () => {
    const reg = buildRegistry(`
        condition "Shaken" { on test.POST_ROLL when has_condition("Shaken") and success then emit "Shaken", "success, but rattled" }
    `);
    const r = resolveTest({ target: 50, unnatural: 4, conditions: ['Shaken'] }, riggedDice([d100(10)]), reg);
    assert.equal(r.bonusDos, 2);                            // ceil(4/2)
    assert.ok(r.effects.some((e) => e.name === 'Shaken'));
});

test('/api/test runs the test.* pipeline (dispatch) and keeps the flat v1 shape', () => {
    const { status, body } = dispatch('POST', '/api/test', {
        target: 30, testName: 'Fear', talents: ['Resistance (Fear)'],
        modifiers: { difficulty: 0 }, customRules: RESISTANCE,
    });
    assert.equal(status, 200);
    assert.ok(body.roll >= 1 && body.roll <= 100);          // flat shape preserved
    assert.equal(body.modifiers.resistance, 10);
    assert.ok(Array.isArray(body.effects));
});

// --- attack. default namespace -------------------------------------------------
test('`on attack.MODIFIERS` normalises to the unqualified attack checkpoint', () => {
    const effects = compile('miscellaneous "Blessing" { on attack.MODIFIERS then add modifier "blessing" = 5 }');
    assert.equal(effects[0].checkpoint, 'MODIFIERS');
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack' },
        riggedDice([d100(20), die(5, 10)]), buildRegistry('miscellaneous "Blessing" { on attack.MODIFIERS then add modifier "blessing" = 5 }'));
    assert.equal(r.test.modifiers.blessing, 5);
});

test('unknown pipeline names are compile errors', () => {
    assert.throws(() => compile('quality "X" { on warp.MODIFIERS when has_quality("X") then add modifier "x" = 1 }'), /Unknown checkpoint 'warp.MODIFIERS'/);
});

// --- layered replaces -----------------------------------------------------------
const HOUSE_JAM = `
mechanic "House Jam" {
  replaces "dh2.core.mechanics/jam"
  on POST_ROLL
  priority 50
  when is_ranged and roll > 98
  then emit "House Jam", "jams only on 99+ in this campaign"; flag attack_failed
}`;

test('replaces drops the named core rule and substitutes the layer rule', () => {
    const gun = { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    // roll 97: core Jam would fire; the house layer replaced it (jams 99+ only)
    const replaced = resolveAttack({ characteristics: { bs: 99, s: 30, t: 30 }, weapon: gun, action: 'Standard Attack' },
        riggedDice([d100(97), die(5, 10)]), buildRegistry(HOUSE_JAM));
    assert.ok(!replaced.effects.some((e) => e.name === 'Jam'), 'core Jam must be replaced');
    assert.ok(!replaced.effects.some((e) => e.name === 'House Jam'), '97 ≤ 98 → no house jam either');
    // roll 99: the house rule fires
    const house = resolveAttack({ characteristics: { bs: 99, s: 30, t: 30 }, weapon: gun, action: 'Standard Attack' },
        riggedDice([d100(99)]), buildRegistry(HOUSE_JAM));
    assert.ok(house.effects.some((e) => e.name === 'House Jam'));
    assert.equal(house.test.success, false);
    // without the layer, the core Jam still fires at 97
    const core = resolveAttack({ characteristics: { bs: 99, s: 30, t: 30 }, weapon: gun, action: 'Standard Attack' },
        riggedDice([d100(97)]), buildRegistry());
    assert.ok(core.effects.some((e) => e.name === 'Jam'));
});

test('replaces also accepts a bare rule id and surfaces in validate', () => {
    const src = 'mechanic "No Jam" { replaces "jam" on POST_ROLL when is_ranged then emit "NoJam" }';
    const effects = compile(src);
    assert.deepEqual(effects[0].replaces, ['jam']);
    const { body } = dispatch('POST', '/api/rules/validate', { rules: src });
    assert.equal(body.ok, true);
    assert.deepEqual(body.effects[0].replaces, ['jam']);
});
