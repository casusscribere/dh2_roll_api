/**
 * Item-granted rules + the is_test() skill-modifier pattern, and the schema-v3
 * additions behind the character-sheet input mode (size, movementModifier,
 * item description/dsl).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTest } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100 } from './helpers.mjs';
import { emptyCharacter, validateCharacter, movement } from '../lib/character-schema.mjs';

test('is_test(): spelling-blind "+X to <skill>" rules in the test pipeline', () => {
    const reg = buildRegistry(`
        quality "Good Auspex" {
          on test.MODIFIERS
          when is_test("Tech-Use")
          then add modifier "auspex" = 20
        }
    `);
    const hit = resolveTest({ target: 50, testName: 'Tech-Use' }, riggedDice([d100(30)]), reg);
    assert.equal(hit.modifiers.auspex, 20);
    // spelling-blind on the incoming test name
    const snake = resolveTest({ target: 50, testName: 'tech_use' }, riggedDice([d100(30)]), reg);
    assert.equal(snake.modifiers.auspex, 20);
    // other tests untouched
    const other = resolveTest({ target: 50, testName: 'Awareness' }, riggedDice([d100(30)]), reg);
    assert.equal(other.modifiers.auspex, undefined);
});

test('conditional "+X to <skill> when <condition>" works the same way', () => {
    const reg = buildRegistry(`
        quality "Prey-Sense Goggles" {
          on test.MODIFIERS
          when is_test("Awareness") and has_condition("Darkness Nearby")
          then add modifier "goggles" = 10
        }
    `);
    const dark = resolveTest({ target: 40, testName: 'Awareness', conditions: ['Darkness Nearby'] }, riggedDice([d100(30)]), reg);
    assert.equal(dark.modifiers.goggles, 10);
    const lit = resolveTest({ target: 40, testName: 'Awareness' }, riggedDice([d100(30)]), reg);
    assert.equal(lit.modifiers.goggles, undefined);
});

test('schema: item dsl/description validate; bad shapes rejected', () => {
    const doc = emptyCharacter();
    doc.gear = [{ name: 'Auspex', dsl: 'quality "A" { on test.MODIFIERS when is_test("Tech-Use") then add modifier "a" = 20 }', description: 'scanner' }];
    assert.ok(validateCharacter(doc).ok);
    doc.gear[0].dsl = 42;
    const r = validateCharacter(doc);
    assert.ok(r.errors.some((e) => e.path === 'gear[0].dsl'));
});

test('schema: size bounds and the movement modifier (AgB-delta for brackets only)', () => {
    const doc = emptyCharacter();
    doc.characteristics.ag = { base: 50, advances: 0, modifiers: [] };
    doc.size = 4;
    doc.movementModifier = 2;
    assert.ok(validateCharacter(doc).ok);
    assert.deepEqual(movement(doc), { half: 7, full: 14, charge: 21, run: 42 });
    // the modifier does NOT touch the characteristic or its bonus elsewhere
    assert.equal(doc.characteristics.ag.base, 50);
    doc.size = 0;
    doc.movementModifier = 99;
    const r = validateCharacter(doc);
    assert.ok(r.errors.some((e) => e.path === 'size'));
    assert.ok(r.errors.some((e) => e.path === 'movementModifier'));
});
