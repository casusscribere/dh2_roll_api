/**
 * DSL tokenizer + parser tests — node --test.
 *
 * Covers the text → AST half of the trait DSL: token shapes, rule structure,
 * predicate precedence/grouping, the action vocabulary, arithmetic + dice
 * expressions, and line/col error reporting. No execution here (that is the
 * compiler/interpreter step).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, DslError } from '../lib/dsl/tokenizer.mjs';
import { parse, parseRule } from '../lib/dsl/parser.mjs';

// --- tokenizer ---------------------------------------------------------------
test('tokenizer: classifies idents, numbers, dice, strings, ops, comments', () => {
    const toks = tokenize(`when dos >= 3 // note\n add_die 1d10 = "hi"`);
    const kinds = toks.map((t) => t.type);
    assert.deepEqual(kinds, ['ident', 'ident', 'op', 'number', 'ident', 'dice', 'op', 'string', 'eof']);
    const dice = toks.find((t) => t.type === 'dice');
    assert.deepEqual([dice.count, dice.sides], [1, 10]);
});

test('tokenizer: 1d10 is a dice token, 10 alone is a number', () => {
    assert.equal(tokenize('1d10')[0].type, 'dice');
    const t = tokenize('10');
    assert.equal(t[0].type, 'number');
    assert.equal(t[0].value, 10);
});

test('tokenizer: unterminated string reports line/col', () => {
    try { tokenize('quality "oops {'); assert.fail('should throw'); }
    catch (e) { assert.ok(e instanceof DslError); assert.equal(e.line, 1); assert.equal(e.col, 9); }
});

// --- rule structure ----------------------------------------------------------
test('parser: full talent rule with tier, when, priority, actions', () => {
    const rule = parseRule(`
        talent "Ambidextrous" tier 1 {
          on MODIFIERS
          priority 100
          when dual_wielding or firing_offhand
          then cancel modifier "off_hand";
               set modifier "two_weapon" = -10
        }`);
    assert.equal(rule.kind, 'talent');
    assert.equal(rule.name, 'Ambidextrous');
    assert.equal(rule.tier, 1);
    assert.equal(rule.on, 'MODIFIERS');
    assert.equal(rule.priority, 100);
    assert.equal(rule.when.type, 'Logical');
    assert.equal(rule.when.op, 'or');
    assert.equal(rule.actions.length, 2);
    assert.deepEqual(rule.actions[0], { type: 'Action', action: 'cancel_modifier', name: 'off_hand' });
    assert.equal(rule.actions[1].action, 'set_modifier');
    assert.equal(rule.actions[1].name, 'two_weapon');
    // -10 parses as unary negation of 10
    assert.deepEqual(rule.actions[1].value, { type: 'Unary', op: 'neg', operand: { type: 'Number', value: 10 } });
});

test('parser: program with multiple rules', () => {
    const prog = parse(`
        quality "Tearing" { on DAMAGE_POOL when has_quality("Tearing") then add_die 1; keep_highest }
        quality "Storm"   { on HIT_COUNT_MULT when has_quality("Storm") then multiply_hits 2 }
    `);
    assert.equal(prog.rules.length, 2);
    assert.deepEqual(prog.rules.map((r) => r.name), ['Tearing', 'Storm']);
    assert.equal(prog.rules[0].actions[0].action, 'add_die');
    assert.equal(prog.rules[0].actions[1].action, 'keep_highest');
});

// --- predicate precedence + grouping ----------------------------------------
test('parser: and binds tighter than or', () => {
    // a or b and c  ==>  a or (b and c)
    const { when } = parseRule(`rule "x" { on MODIFIERS when a or b and c then fail }`);
    assert.equal(when.op, 'or');
    assert.equal(when.left.type, 'Identifier');
    assert.equal(when.right.type, 'Logical');
    assert.equal(when.right.op, 'and');
});

test('parser: parentheses override precedence; not + comparison + call', () => {
    const { when } = parseRule(
        `quality "Jam" { on POST_ROLL
           when is_ranged and ((not has_quality("Reliable") and roll > 96) or roll == 100)
           then emit "Jam", "The weapon jams!"; fail }`);
    assert.equal(when.op, 'and');
    assert.equal(when.left.type, 'Identifier');        // left is the is_ranged fact
    assert.equal(when.right.op, 'or');                 // grouped sub-predicate
    const refute = when.right.left;                    // (not has_quality(...) and roll>96)
    assert.equal(refute.op, 'and');
    assert.equal(refute.left.type, 'Unary');
    assert.equal(refute.left.op, 'not');
    assert.equal(refute.left.operand.type, 'Call');
    assert.equal(refute.left.operand.name, 'has_quality');
    assert.equal(refute.right.type, 'Comparison');
    assert.equal(refute.right.op, '>');
});

test('parser: comparison RHS and emit/fail actions', () => {
    const rule = parseRule(`quality "Overheats" { on POST_ROLL when is_ranged and roll > 91 then emit "Overheats", "drop it" }`);
    assert.equal(rule.actions[0].action, 'emit');
    assert.equal(rule.actions[0].name, 'Overheats');
    assert.equal(rule.actions[0].text, 'drop it');
});

// --- expression forms --------------------------------------------------------
test('parser: arithmetic precedence and dice/call operands in action values', () => {
    const rule = parseRule(`rule "x" { on DAMAGE_MODS then add modifier "m" = 1d10 + sb * 2 }`);
    const v = rule.actions[0].value;
    assert.equal(v.type, 'Binary');
    assert.equal(v.op, '+');
    assert.deepEqual(v.left, { type: 'Dice', count: 1, sides: 10 });
    assert.equal(v.right.type, 'Binary');      // sb * 2 grouped under the +
    assert.equal(v.right.op, '*');
});

test('parser: set pen += pen and quality_level call', () => {
    const rule = parseRule(`quality "Vengeful" { on DIE_ADJUST when has_quality("Vengeful") then set rf_threshold = quality_level("Vengeful", 9) }`);
    assert.equal(rule.actions[0].action, 'set_rf_threshold');
    assert.equal(rule.actions[0].value.type, 'Call');
    assert.equal(rule.actions[0].value.name, 'quality_level');
    assert.equal(rule.actions[0].value.args.length, 2);

    const razor = parseRule(`quality "Razor Sharp" { on PENETRATION when is_melee then set pen += pen }`);
    assert.equal(razor.actions[0].action, 'set_pen');
    assert.equal(razor.actions[0].op, '+=');
    assert.deepEqual(razor.actions[0].value, { type: 'Identifier', name: 'pen' });
});

// --- error reporting ---------------------------------------------------------
test('parser: a when without a then errors', () => {
    assert.throws(() => parseRule(`talent "X" { on MODIFIERS when a }`), (e) => {
        assert.ok(e instanceof DslError);
        assert.match(e.rawMessage, /Expected 'then' after a 'when'/);
        return true;
    });
});

test('parser: a rule with no branch errors as missing then', () => {
    assert.throws(() => parseRule(`talent "X" { on MODIFIERS }`), /missing a 'then/);
});

// --- multi-branch rules ------------------------------------------------------
test('parser: multiple when…then branches in one rule', () => {
    const rule = parseRule(`quality "Accurate" {
      on DAMAGE_MODS
      priority 10
      when has_quality("Accurate") and dos >= 3 then add modifier "accurate" = 1d10
      when has_quality("Accurate") and dos >= 5 then add modifier "accurate x 2" = 1d10
    }`);
    assert.equal(rule.on, 'DAMAGE_MODS');
    assert.equal(rule.priority, 10);
    assert.equal(rule.branches.length, 2);
    assert.equal(rule.branches[0].when.type, 'Logical');
    assert.equal(rule.branches[0].actions[0].name, 'accurate');
    assert.equal(rule.branches[1].actions[0].name, 'accurate x 2');
    assert.equal(rule.when, undefined);  // no single-branch alias for multi-branch
});

test('parser: an unconditional branch mixes with conditional ones', () => {
    const rule = parseRule(`generic "Mix" {
      on MODIFIERS
      then add modifier "base" = 5
      when dos >= 2 then add modifier "bonus" = 5
    }`);
    assert.equal(rule.branches.length, 2);
    assert.equal(rule.branches[0].when, null);
    assert.equal(rule.branches[1].when.type, 'Comparison');
});

test('parser: missing on clause errors', () => {
    assert.throws(() => parseRule(`talent "X" { then fail }`), /missing an 'on/);
});

test('parser: unknown action errors with position', () => {
    assert.throws(() => parseRule(`rule "x" { on MODIFIERS then teleport 3 }`), (e) => {
        assert.match(e.rawMessage, /Unknown action 'teleport'/);
        return true;
    });
});

test('parser: unterminated rule body errors', () => {
    assert.throws(() => parse(`talent "X" { on MODIFIERS then fail`), /Unterminated rule body/);
});

test('parser: duplicate clause errors', () => {
    assert.throws(() => parseRule(`rule "x" { on MODIFIERS on POST_ROLL then fail }`), /Duplicate 'on'/);
});
