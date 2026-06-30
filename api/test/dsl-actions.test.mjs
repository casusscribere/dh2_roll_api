/**
 * Action-aware predicates — `action` / `action_type` facts and is_action() /
 * is_reaction() functions, usable in `when` blocks across every flow (notably
 * the Parry reaction). node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParry, resolveAttack } from '../lib/engine.mjs';
import { buildRegistry, availableActionNames, availableQualities } from '../lib/rules/index.mjs';
import { compileActions } from '../lib/dsl/compiler.mjs';
import { registerActions, actionType, isReaction } from '../lib/actions.mjs';
import { FACTS, FUNCTIONS } from '../lib/dsl/interpreter.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

// --- action subtypes (the `attack` subtype) ----------------------------------
test('is_attack / action_subtype read the action\'s subtype designations', () => {
    assert.equal(FACTS.is_attack({ action: 'Standard Attack' }), true);
    assert.equal(FACTS.is_attack({ action: 'Charge' }), true);
    assert.equal(FACTS.is_attack({ action: 'Parry' }), false);
    assert.equal(FACTS.is_attack({ action: 'Aim' }), false);
    assert.equal(FUNCTIONS.action_subtype({ action: 'Standard Attack' }, ['attack']), true);
    assert.equal(FUNCTIONS.action_subtype({ action: 'Standard Attack' }, ['ranged']), false);
});

test('Defensive applies its -10 only to attack-subtype actions', () => {
    const shield = (action) => resolveAttack({
        characteristics: { ws: 50, s: 30, t: 30 },
        weapon: { name: 'Shield', isMelee: true, damage: '1d5', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Defensive'] },
        action,
    }, riggedDice([d100(20), die(3, 10)]), buildRegistry());
    assert.equal(shield('Standard Attack').test.modifiers.defensive, -10);   // attack subtype → penalty
    assert.equal(FACTS.is_attack({ action: 'Defensive Stance' }), false);     // non-attack action: no penalty
});

// --- the `action` DSL construct ----------------------------------------------
test('an `action` declaration compiles (with subtypes) and registers into the taxonomy', () => {
    const compiled = compileActions('action "Suppressing Fire" { type Full attack subtype area }\naction "Brace" { type Reaction }');
    assert.deepEqual(compiled, [
        { name: 'Suppressing Fire', type: 'Full', subtypes: ['attack', 'area'] },
        { name: 'Brace', type: 'Reaction', subtypes: [] },
    ]);
    registerActions(compiled);
    assert.equal(actionType('Suppressing Fire'), 'Full');
    assert.equal(isReaction('Brace'), true);
});

test('the built-in actions.dsl is registered at load (Parry is a Reaction)', () => {
    assert.ok(availableActionNames.includes('Parry'));
    assert.ok(availableActionNames.includes('Standard Attack'));
    assert.equal(actionType('Parry'), 'Reaction');
    assert.equal(actionType('All Out Attack'), 'Full');
});

const sword = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] };

test('is_action / is_reaction gate a rule on the Parry reaction', () => {
    const reg = buildRegistry('quality "Riposte" { on PARRY when is_action("Parry") and is_reaction() then add modifier "riposte" = 5 }');
    const r = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Sword', qualities: [] } }, riggedDice([d100(30)]), reg);
    assert.equal(r.test.modifiers.riposte, 5);
});

test('an action-gated rule does not fire on a different action', () => {
    const reg = buildRegistry('quality "Riposte" { on MODIFIERS when is_action("Parry") then add modifier "riposte" = 5 }');
    const r = resolveAttack({ characteristics: { ws: 50, s: 30, t: 30 }, weapon: sword, action: 'Standard Attack' },
        riggedDice([d100(20), die(5, 10)]), reg);
    assert.equal(r.test.modifiers.riposte, undefined);
});

test('action_type fact reflects the taxonomy (Parry → Reaction)', () => {
    const reg = buildRegistry('quality "ReactBonus" { on PARRY when action_type == "Reaction" then add modifier "react" = 3 }');
    const r = resolveParry({ characteristics: { ws: 40 }, weapon: { qualities: [] } }, riggedDice([d100(30)]), reg);
    assert.equal(r.test.modifiers.react, 3);
});
