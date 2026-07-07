/**
 * DSL compiler + interpreter tests — node --test.
 *
 * Covers the AST → Effect half: compiled effect shape, predicate evaluation,
 * action mutation against a context, dice expressions (via injected RNG), and
 * the semantic validation that rejects unknown checkpoints / facts / functions
 * (the safety boundary for user-supplied rules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../lib/dsl/compiler.mjs';
import { evalNode } from '../lib/dsl/interpreter.mjs';
import { parseRule } from '../lib/dsl/parser.mjs';
import { DslError } from '../lib/dsl/tokenizer.mjs';
import { CHECKPOINTS } from '../lib/pipeline.mjs';
import { riggedDice, die } from './helpers.mjs';

// --- compiled effect shape ---------------------------------------------------
test('compile produces an Effect with id/source/checkpoint/priority', () => {
    const [eff] = compile(`quality "Razor Sharp" { on PENETRATION priority 10 when is_melee then set pen += pen }`);
    assert.equal(eff.id, 'razor-sharp');
    assert.equal(eff.source, 'quality');
    assert.equal(eff.checkpoint, CHECKPOINTS.PENETRATION);
    assert.equal(eff.priority, 10);
    assert.equal(typeof eff.when, 'function');
    assert.equal(typeof eff.apply, 'function');
});

// --- activation predicate ----------------------------------------------------
test('compiled when() reads facts/functions off the context', () => {
    const [eff] = compile(`quality "Melta" { on PENETRATION
        when is_ranged and has_quality("Melta") and (range == "Short Range" or range == "Point Blank")
        then set pen += pen }`);

    assert.equal(eff.when({ isMelee: false, qualities: ['Melta'], rangeBand: 'Short Range' }), true);
    assert.equal(eff.when({ isMelee: false, qualities: ['Melta'], rangeBand: 'Long Range' }), false);
    assert.equal(eff.when({ isMelee: false, qualities: [], rangeBand: 'Short Range' }), false);
});

// --- action mutation ---------------------------------------------------------
test('compiled apply() mutates the context (Tearing: pool + keep-highest)', () => {
    const [eff] = compile(`quality "Tearing" { on DAMAGE_POOL when has_quality("Tearing") then set extra_dice += 1; flag keep_highest }`);
    const ctx = { qualities: ['Tearing'], parsed: { count: 2 }, extraDice: 0, keepHighest: null, tearing: false };
    eff.apply(ctx);
    assert.equal(ctx.extraDice, 1);
    assert.equal(ctx.keepHighest, 2);
    assert.equal(ctx.tearing, true);
});

test('set pen += pen writes to the rule-named penetration slot', () => {
    const [eff] = compile(`quality "Razor Sharp" { on PENETRATION when is_melee then set pen += pen }`);
    const ctx = { isMelee: true, pen: 4, penModifiers: {} };
    eff.apply(ctx);
    assert.equal(ctx.penModifiers['razor sharp'], 4);
});

// --- dice expressions use the injected RNG -----------------------------------
test('a Dice expression rolls via ctx.rng', () => {
    const node = parseRule(`miscellaneous "x" { on DAMAGE_MODS then add modifier "m" = 2d10 }`).actions[0].value;
    const value = evalNode(node, { rng: riggedDice([die(7, 10), die(3, 10)]) });
    assert.equal(value, 10); // 7 + 3
});

// --- multi-branch rules ------------------------------------------------------
test('a multi-branch rule compiles to one effect per branch, sharing ruleId', () => {
    const effects = compile(`quality "Accurate" {
      on DAMAGE_MODS
      priority 10
      when has_quality("Accurate") and dos >= 3 then add modifier "accurate" = 1d10
      when has_quality("Accurate") and dos >= 5 then add modifier "accurate x 2" = 1d10
    }`);
    assert.equal(effects.length, 2);
    assert.deepEqual(effects.map(e => e.id), ['accurate#1', 'accurate#2']);
    assert.ok(effects.every(e => e.ruleId === 'accurate'));
    assert.ok(effects.every(e => e.checkpoint === CHECKPOINTS.DAMAGE_MODS && e.priority === 10));
    // each branch carries its own activation predicate
    assert.equal(effects[0].when({ qualities: ['Accurate'], dos: 3 }), true);
    assert.equal(effects[1].when({ qualities: ['Accurate'], dos: 3 }), false);
    assert.equal(effects[1].when({ qualities: ['Accurate'], dos: 5 }), true);
});

test('a single-branch rule keeps its plain id and ruleId', () => {
    const [eff] = compile(`quality "Tearing" { on DAMAGE_POOL when has_quality("Tearing") then flag keep_highest }`);
    assert.equal(eff.id, 'tearing');
    assert.equal(eff.ruleId, 'tearing');
});

// --- semantic validation (safety boundary) -----------------------------------
test('compile rejects an unknown checkpoint', () => {
    assert.throws(() => compile(`miscellaneous "x" { on TELEPORT then flag attack_failed }`), (e) => {
        assert.ok(e instanceof DslError);
        assert.match(e.rawMessage, /Unknown checkpoint 'TELEPORT'/);
        return true;
    });
});

test('compile rejects an unknown fact', () => {
    assert.throws(() => compile(`miscellaneous "x" { on MODIFIERS when secret_backdoor then flag attack_failed }`), /Unknown fact 'secret_backdoor'/);
});

test('compile rejects an unknown function', () => {
    assert.throws(() => compile(`miscellaneous "x" { on MODIFIERS when exec("rm -rf") then flag attack_failed }`), /Unknown function 'exec\(\)'/);
});
