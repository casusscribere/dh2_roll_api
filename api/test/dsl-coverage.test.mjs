/**
 * DSL residual-branch coverage — node --test.
 *
 * The rules DSL is the language ALL game content is written in, so its failure
 * paths are load-bearing: a parse error that reports the wrong line, or a
 * silently-swallowed bad rule, corrupts game behaviour invisibly. The existing
 * DSL suites (dsl / dsl-compiler / dsl-actions / dsl-docs) cover the happy
 * paths and a handful of errors; this file drives the *residual* branches —
 * malformed input, every rejection message, every scope getter, every slot and
 * flag — and asserts the error MESSAGE plus the reported line/column, never
 * merely "it threw".
 *
 * Sections:
 *   1. tokenizer   — lexical errors + position bookkeeping
 *   2. parser      — declaration bodies, rule clauses, action arity/shape
 *   3. interpreter — whitelist rejections, node dispatch, every action verb
 *   4. compiler    — semantic validation, provenance, table/name extraction
 *   5. vocabulary  — every scoped fact/function getter, every slot and flag
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, DslError } from '../lib/dsl/tokenizer.mjs';
import { parse, parseRule, CURRENT_DSL_VERSION } from '../lib/dsl/parser.mjs';
import {
    compile, compileRule, compileTable, compileTables, compileActions,
    programInfo, referencedNames, valuedNames,
} from '../lib/dsl/compiler.mjs';
import { evalNode, applyAction, collectNames, FACTS, FUNCTIONS } from '../lib/dsl/interpreter.mjs';
import {
    FACT_DEFS, FUNCTION_DEFS, FACT_ALIASES, FUNCTION_ALIASES, SCOPE_NAMES,
    SCOPED_FACTS, SCOPED_FUNCTIONS, FLAT_FACTS, FLAT_FUNCTIONS,
    SLOT_DEFS, FLAG_DEFS, SLOT_DOCS, FLAG_DOCS, FACT_DOCS, FUNCTION_DOCS, SCOPED_ONLY_DOCS,
    nameOf,
} from '../lib/dsl/vocabulary.mjs';
import { riggedDice, die } from './helpers.mjs';

/**
 * Assert a DslError with the expected raw message AND source position. The
 * position assertions are the point: a parse error pointing at the wrong line
 * is a real defect that a bare `assert.throws` would never catch.
 */
const throwsDsl = (fn, { message, line, col } = {}) => {
    assert.throws(fn, (e) => {
        assert.ok(e instanceof DslError, `expected a DslError, got ${e && e.name}: ${e && e.message}`);
        if (message) assert.match(e.rawMessage, message);
        if (line !== undefined) assert.equal(e.line, line, `wrong LINE reported for: ${e.message}`);
        if (col !== undefined) assert.equal(e.col, col, `wrong COL reported for: ${e.message}`);
        // the composed message always carries the position for the UI
        assert.equal(e.message, `${e.rawMessage} (line ${e.line}, col ${e.col})`);
        return true;
    });
};

// =============================================================================
// 1. TOKENIZER
// =============================================================================

test('tokenizer: an unexpected character reports its exact line and column', () => {
    //          line 1                line 2            line 3 ("  then flag ok @" → '@' is col 16)
    const src = 'quality "X" {\n  on MODIFIERS\n  then flag ok @\n}';
    throwsDsl(() => tokenize(src), { message: /^Unexpected character '@'$/, line: 3, col: 16 });
});

test('tokenizer: an unterminated string points at its OPENING quote, not the EOF', () => {
    // The opening quote is on line 2 col 8; the run-away string swallows the
    // rest of the file. Reporting the EOF position here would be useless.
    throwsDsl(() => tokenize('quality "X" {\n  emit "oops\n}'), {
        message: /^Unterminated string$/, line: 2, col: 8,
    });
});

test('tokenizer: an unterminated single-quoted string is caught the same way', () => {
    throwsDsl(() => tokenize("emit 'oops"), { message: /^Unterminated string$/, line: 1, col: 6 });
});

test('tokenizer: backslash escapes survive into the string value', () => {
    assert.equal(tokenize('"a\\"b"')[0].value, 'a"b');
    assert.equal(tokenize("'it\\'s'")[0].value, "it's");
    // a trailing backslash at EOF must not read past the buffer
    throwsDsl(() => tokenize('"tail\\'), { message: /^Unterminated string$/, line: 1, col: 1 });
});

test('tokenizer: dice need a digit after d; an uppercase D counts', () => {
    const upper = tokenize('2D6');
    assert.equal(upper[0].type, 'dice');
    assert.deepEqual([upper[0].count, upper[0].sides], [2, 6]);
    // "5d" is NOT dice — it lexes as the number 5 followed by the identifier d
    const bare = tokenize('5d');
    assert.deepEqual(bare.map((t) => t.type), ['number', 'ident', 'eof']);
    assert.equal(bare[0].value, 5);
    assert.equal(bare[1].value, 'd');
});

test('tokenizer: both comment forms run to end-of-line and may end the file', () => {
    assert.deepEqual(tokenize('# hash\n// slash\nsb').map((t) => t.type), ['ident', 'eof']);
    assert.deepEqual(tokenize('sb // trailing, no newline').map((t) => t.type), ['ident', 'eof']);
    assert.deepEqual(tokenize('sb # trailing, no newline').map((t) => t.type), ['ident', 'eof']);
});

test('tokenizer: tabs and CRLF keep the line/col counter honest', () => {
    // \r is horizontal whitespace (col++), \n starts a new line (col := 1).
    const toks = tokenize('a\r\n\tb');
    assert.equal(toks[0].line, 1);
    assert.equal(toks[0].col, 1);
    assert.equal(toks[1].line, 2);
    assert.equal(toks[1].col, 2);          // one tab counts as one column
    assert.equal(toks[2].type, 'eof');
    assert.equal(toks[2].line, 2);
    assert.equal(toks[2].col, 3);
});

test('tokenizer: two-char operators win over their one-char prefixes', () => {
    const two = tokenize('== != >= <= += =>').filter((t) => t.type === 'op').map((t) => t.value);
    assert.deepEqual(two, ['==', '!=', '>=', '<=', '+=', '=>']);
    const one = tokenize('> < = + - * /').filter((t) => t.type === 'op').map((t) => t.value);
    assert.deepEqual(one, ['>', '<', '=', '+', '-', '*', '/']);
    // punctuation, including the '.' that joins scoped fact paths
    assert.deepEqual(tokenize('{ } ( ) , ; : .').map((t) => t.value).slice(0, 8),
        ['{', '}', '(', ')', ',', ';', ':', '.']);
});

// =============================================================================
// 2. PARSER
// =============================================================================

// --- the dsl version pragma --------------------------------------------------

test('parser: a legacy `dsl 2` pragma is rejected at the pragma keyword', () => {
    throwsDsl(() => parse('# header\ndsl 2\nquality "X" { on MODIFIERS then flag no_parry }'), {
        message: /^dsl 2 is no longer supported \(current: dsl 3\).*migrate-dsl\.mjs/,
        line: 2, col: 1,
    });
    assert.equal(CURRENT_DSL_VERSION, 3);
});

test('parser: a future dsl version is accepted; the FIRST pragma wins', () => {
    assert.equal(parse('dsl 4\nquality "X" { on MODIFIERS then flag no_parry }').dslVersion, 4);
    // several sources are routinely concatenated for cross-file scans
    const joined = parse('dsl 3\nquality "A" { on MODIFIERS then flag no_parry }\ndsl 4\nquality "B" { on MODIFIERS then flag no_parry }');
    assert.equal(joined.dslVersion, 3);
    assert.equal(joined.rules.length, 2);
    // pragma-less text is treated as current
    assert.equal(parse('quality "X" { on MODIFIERS then flag no_parry }').dslVersion, CURRENT_DSL_VERSION);
});

test('parser: a bare `dsl` with no number is not a pragma (falls through to rule parsing)', () => {
    throwsDsl(() => parse('dsl\nquality "X" { on MODIFIERS then flag no_parry }'), {
        message: /^Expected a rule kind/, line: 1, col: 1,
    });
});

// --- package declarations ----------------------------------------------------

test('parser: a package header captures system, source and requires', () => {
    const prog = parse(`package "dh2.test.pkg" {
      system "dh2"
      source "Test Book"
      requires "dh2.core.mechanics"
      requires "dh2.core.weapon-qualities"
    }
    quality "X" { on MODIFIERS then flag no_parry }`);
    assert.deepEqual(prog.package, {
        type: 'Package', name: 'dh2.test.pkg', system: 'dh2', source: 'Test Book',
        requires: ['dh2.core.mechanics', 'dh2.core.weapon-qualities'], line: 1, col: 1,
    });
    assert.equal(prog.packages.length, 1);
});

test('parser: package body rejects unknown clauses and unterminated bodies', () => {
    throwsDsl(() => parse('package "p" {\n  system "dh2"\n  wibble "x"\n}'), {
        message: /^Unexpected clause in package body \(expected 'system', 'source' or 'requires'\)$/,
        line: 3, col: 3,
    });
    throwsDsl(() => parse('package "p" {\n  system "dh2"\n'), {
        message: /^Unterminated package \(expected '}'\)$/, line: 3, col: 1,
    });
    throwsDsl(() => parse('package unquoted { system "dh2" }'), {
        message: /^Expected a quoted package name$/, line: 1, col: 9,
    });
});

// --- action declarations -----------------------------------------------------

test('parser: action body rejects an unknown clause with position', () => {
    throwsDsl(() => parse('action "Suppress" {\n  type Full\n  wibble\n}'), {
        message: /^Unexpected clause in action body \(expected 'type', 'attack' or 'subtype'\)$/,
        line: 3, col: 3,
    });
});

test('parser: action `type` must be one of the four action types', () => {
    throwsDsl(() => parse('action "X" { type Instant }'), {
        message: /^Expected an action type \(Half \| Full \| Reaction \| Free\)$/, line: 1, col: 19,
    });
    throwsDsl(() => parse('action "X" { type "Half" }'), {
        message: /^Expected an action type/, line: 1, col: 19,
    });
});

test('parser: an action with no `type` clause errors at the declaration keyword', () => {
    throwsDsl(() => parse('# lead-in\naction "Brace" {\n  attack\n}'), {
        message: /^Action "Brace" is missing a 'type' clause$/, line: 2, col: 1,
    });
});

test('parser: `attack` is sugar for `subtype attack` and duplicates collapse', () => {
    const [decl] = parse('action "X" { type Full attack subtype attack subtype "ranged" }').actions;
    assert.deepEqual(decl.subtypes, ['attack', 'ranged']);
    throwsDsl(() => parse('action "X" { type Full subtype 3 }'), {
        message: /^Expected a subtype name after subtype$/, line: 1, col: 32,
    });
    throwsDsl(() => parse('action "X" {\n  type Full\n'), {
        message: /^Unterminated action \(expected '}'\)$/, line: 3, col: 1,
    });
});

// --- roll_table declarations -------------------------------------------------

test('parser: a roll_table parses ranges, statuses and optional separators', () => {
    const [tbl] = parse(`roll_table "Test Table" {
      die 1d10
      1-3: "low"  => "Stunned", "Prone";
      4: "mid"
      5-10: "high";
    }`).tables;
    assert.deepEqual(tbl.die, { count: 1, sides: 10 });
    assert.deepEqual(tbl.rows, [
        { lo: 1, hi: 3, text: 'low', statuses: ['Stunned', 'Prone'] },
        { lo: 4, hi: 4, text: 'mid', statuses: [] },
        { lo: 5, hi: 10, text: 'high', statuses: [] },
    ]);
});

test('parser: roll_table malformed headers and rows report position', () => {
    throwsDsl(() => parse('roll_table "T" {\n  die 10\n  1: "x"\n}'), {
        message: /^Expected a dice literal \(e\.g\. 1d10\) after die$/, line: 2, col: 7,
    });
    throwsDsl(() => parse('roll_table "T" {\n  die 1d10\n'), {
        message: /^Unterminated roll_table \(expected '}'\)$/, line: 3, col: 1,
    });
    throwsDsl(() => parse('roll_table "T" { die 1d10\n  "x": "y"\n}'), {
        message: /^Expected a roll value \(e\.g\. 1 or 1-2\) for a table row$/, line: 2, col: 3,
    });
    throwsDsl(() => parse('roll_table "T" { die 1d10\n  1-: "y"\n}'), {
        message: /^Expected the end of a roll range after -$/, line: 2, col: 5,
    });
    throwsDsl(() => parse('roll_table "T" { die 1d10\n  1 "y"\n}'), {
        message: /^Expected ':'$/, line: 2, col: 5,
    });
    throwsDsl(() => parse('roll_table "T" { die 1d10\n  1: "y" => 3\n}'), {
        message: /^Expected a status name$/, line: 2, col: 13,
    });
});

// --- rule headers and clauses ------------------------------------------------

test('parser: an unknown rule kind is rejected with the full kind list', () => {
    throwsDsl(() => parse('\n\nspell "Fireball" { on MODIFIERS then flag no_parry }'), {
        message: /^Expected a rule kind \(quality \| talent \| trait \| circumstance \| condition \| configuration \| mechanic \| miscellaneous\)$/,
        line: 3, col: 1,
    });
    // a stray punctuation token at top level is the same failure
    throwsDsl(() => parse('}'), { message: /^Expected a rule kind/, line: 1, col: 1 });
});

test('parser: numeric clauses require integers', () => {
    throwsDsl(() => parse('quality "X" tier "1" { on MODIFIERS then flag no_parry }'), {
        message: /^Expected an integer after tier$/, line: 1, col: 18,
    });
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  priority high\n  then flag no_parry\n}'), {
        message: /^Expected an integer after priority$/, line: 3, col: 12,
    });
    throwsDsl(() => parse('quality "X" { on 3 then flag no_parry }'), {
        message: /^Expected a checkpoint name after on$/, line: 1, col: 18,
    });
    throwsDsl(() => parse('quality unquoted { on MODIFIERS then flag no_parry }'), {
        message: /^Expected a quoted rule name$/, line: 1, col: 9,
    });
});

test('parser: `meta` captures page/ref/source and rejects junk clauses', () => {
    const rule = parseRule(`quality "X" {
      meta { page 150  ref "Table 5-2"  source "Enemies Within" }
      on MODIFIERS
      then flag no_parry
    }`);
    assert.deepEqual(rule.meta, { page: 150, ref: 'Table 5-2', source: 'Enemies Within' });
    throwsDsl(() => parse('quality "X" {\n  meta { page "150" }\n  on MODIFIERS then flag no_parry\n}'), {
        message: /^Expected a page number after page$/, line: 2, col: 15,
    });
    throwsDsl(() => parse('quality "X" {\n  meta { author "me" }\n  on MODIFIERS then flag no_parry\n}'), {
        message: /^Unexpected clause in meta body \(expected 'page', 'ref' or 'source'\)$/, line: 2, col: 10,
    });
    throwsDsl(() => parse('quality "X" {\n  meta { page 1\n'), {
        message: /^Unterminated meta \(expected '}'\)$/, line: 3, col: 1,
    });
});

test('parser: `replaces` accumulates qualified rule ids', () => {
    const rule = parseRule(`mechanic "New Jam" {
      replaces "dh2.core.mechanics/jam"
      replaces "dh2.core.mechanics/overheats"
      on POST_ROLL
      then flag attack_failed
    }`);
    assert.deepEqual(rule.replaces, ['dh2.core.mechanics/jam', 'dh2.core.mechanics/overheats']);
    throwsDsl(() => parse('mechanic "X" { replaces jam on POST_ROLL then flag attack_failed }'), {
        message: /^Expected a qualified rule id/, line: 1, col: 25,
    });
});

test('parser: namespaced checkpoints keep their pipeline prefix in the AST', () => {
    assert.equal(parseRule('talent "X" { on test.MODIFIERS then add modifier "m" = 1 }').on, 'test.MODIFIERS');
    assert.equal(parseRule('talent "X" { on upkeep.TURN_START then declare damage 1 }').on, 'upkeep.TURN_START');
    // an explicit `attack.` prefix survives parsing (the compiler normalises it)
    assert.equal(parseRule('talent "X" { on attack.MODIFIERS then add modifier "m" = 1 }').on, 'attack.MODIFIERS');
    // a trailing '.' with no ident is NOT consumed as a namespace
    assert.equal(parseRule('talent "X" { on MODIFIERS\n then add modifier "m" = 1 }').on, 'MODIFIERS');
});

test('parser: an unexpected token in a rule body lists the legal clauses', () => {
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  unless dos > 2 then flag no_parry\n}'), {
        message: /^Unexpected 'unless' in rule body \(expected on \| priority \| meta \| replaces \| when \| then\)$/,
        line: 3, col: 3,
    });
    // a non-ident token names its TYPE in the message
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  1d10\n}'), {
        message: /^Unexpected 'dice' in rule body/, line: 3, col: 3,
    });
});

test('parser: parseRule() demands exactly one rule', () => {
    throwsDsl(() => parseRule('dsl 3'), { message: /^Expected exactly one rule, found 0$/, line: 1, col: 1 });
    throwsDsl(() => parseRule('quality "A" { on MODIFIERS then flag no_parry }\nquality "B" { on MODIFIERS then flag no_parry }'),
        { message: /^Expected exactly one rule, found 2$/, line: 1, col: 1 });
});

// --- predicates and expressions ---------------------------------------------

test('parser: a mismatched paren reports the token that should have closed it', () => {
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  when (is_melee and dos > 1\n  then flag no_parry\n}'), {
        message: /^Expected '\)'$/, line: 4, col: 3,
    });
    // the arithmetic side has its own paren handling
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  then add modifier "m" = (1 + 2\n}'), {
        message: /^Expected '\)'$/, line: 4, col: 1,
    });
    // an unclosed call argument list
    throwsDsl(() => parse('quality "X" { on MODIFIERS when has_quality("A" then flag no_parry }'), {
        message: /^Expected '\)'$/, line: 1, col: 49,
    });
});

test('parser: a value slot fed a non-value reports what it saw', () => {
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  then add modifier "m" = ;\n}'), {
        message: /^Expected a value, got ';'$/, line: 3, col: 27,
    });
    throwsDsl(() => parse('quality "X" { on MODIFIERS when dos >= ; then flag no_parry }'), {
        message: /^Expected a value, got ';'$/, line: 1, col: 40,
    });
});

test('parser: true/false literals, unary minus and a zero-arg call parse as values', () => {
    const rule = parseRule('quality "X" { on MODIFIERS when true and not false and is_reaction() then add modifier "m" = -sb }');
    assert.equal(rule.when.left.left.type, 'Boolean');
    assert.equal(rule.when.left.left.value, true);
    assert.equal(rule.when.left.right.operand.value, false);
    assert.deepEqual(rule.actions[0].value, { type: 'Unary', op: 'neg', operand: { type: 'Identifier', name: 'sb' } });
    // a scoped zero-arg call keeps its scope
    const scoped = parseRule('quality "X" { on PARRY when opposing_weapon.has_quality("Force") then add modifier "m" = target.tb }');
    assert.deepEqual(scoped.when, { type: 'Call', scope: 'opposing_weapon', name: 'has_quality', args: [{ type: 'String', value: 'Force' }] });
    assert.deepEqual(scoped.actions[0].value, { type: 'Identifier', scope: 'target', name: 'tb' });
});

test('parser: a trailing semicolon may precede `}` or the next branch', () => {
    const before = parseRule('quality "X" { on MODIFIERS then add modifier "a" = 1; }');
    assert.equal(before.actions.length, 1);
    const between = parseRule(`quality "X" {
      on MODIFIERS
      when dos > 1 then add modifier "a" = 1;
      when dos > 3 then add modifier "b" = 2;
    }`);
    assert.equal(between.branches.length, 2);
    assert.equal(between.branches[0].actions.length, 1);
});

// --- action verbs ------------------------------------------------------------

test('parser: modifier verbs demand their keyword, name and `=`', () => {
    throwsDsl(() => parse('quality "X" { on MODIFIERS then add bonus "m" = 1 }'), {
        message: /^Expected 'modifier'$/, line: 1, col: 37,
    });
    throwsDsl(() => parse('quality "X" { on MODIFIERS then add modifier m = 1 }'), {
        message: /^Expected a modifier name$/, line: 1, col: 46,
    });
    throwsDsl(() => parse('quality "X" { on MODIFIERS then add modifier "m" 1 }'), {
        message: /^Expected '=' after modifier name$/, line: 1, col: 50,
    });
    throwsDsl(() => parse('quality "X" { on MODIFIERS then set modifier "m" 1 }'), {
        message: /^Expected '=' after modifier name$/, line: 1, col: 50,
    });
    throwsDsl(() => parse('quality "X" { on MODIFIERS then cancel bonus "m" }'), {
        message: /^Expected 'modifier'$/, line: 1, col: 40,
    });
});

test('parser: `set <slot>` demands a slot name and a legal operator', () => {
    throwsDsl(() => parse('quality "X" { on PENETRATION then set "pen" += 1 }'), {
        message: /^Expected 'modifier' or a slot name after 'set'$/, line: 1, col: 39,
    });
    throwsDsl(() => parse('quality "X" { on PENETRATION then set pen -= 1 }'), {
        message: /^Expected '=' or '\+=' after slot 'pen'$/, line: 1, col: 43,
    });
    const eq = parseRule('quality "X" { on POST_ROLL then set jam_threshold = 100 }');
    assert.deepEqual(eq.actions[0], { type: 'Action', action: 'set_slot', slot: 'jam_threshold', op: '=', value: { type: 'Number', value: 100 } });
});

test('parser: `flag` demands a bare flag name', () => {
    throwsDsl(() => parse('quality "X" { on POST_ROLL then flag "no_parry" }'), {
        message: /^Expected a flag name after flag$/, line: 1, col: 38,
    });
});

test('parser: the `declare …` namespace covers every record-producing verb', () => {
    const acts = (body) => parseRule(`quality "X" { on ON_HIT then ${body} }`).actions[0];
    assert.equal(acts('declare test "Toughness" 0 "knocked down"').action, 'require_test');
    assert.equal(acts('declare status "Stunned" duration 2').action, 'apply_status');
    assert.equal(acts('declare table_roll "Haywire"').action, 'roll_on');
    assert.equal(acts('declare armour_damage 1d5').action, 'corrode');
    assert.equal(acts('declare scatter_hit 2d10').action, 'declare_scatter_hit');
    assert.deepEqual(acts('declare damage 1d10, "burning"'), {
        type: 'Action', action: 'declare_damage', value: { type: 'Dice', count: 1, sides: 10 }, reason: 'burning',
    });
    assert.equal(acts('declare damage 3').reason, null);
    assert.deepEqual(acts('declare smoke 3 duration 4'), {
        type: 'Action', action: 'declare_smoke', radius: { type: 'Number', value: 3 }, duration: { type: 'Number', value: 4 },
    });
    assert.equal(acts('declare smoke 3').duration, null);
    assert.deepEqual(acts('declare event "Boom", "it went off"'), {
        type: 'Action', action: 'emit', name: 'Boom', text: 'it went off',
    });
    assert.equal(acts('declare event "Boom"').text, null);
    throwsDsl(() => parse('quality "X" {\n  on ON_HIT\n  then declare victory\n}'), {
        message: /^Expected 'test', 'status', 'table_roll', 'armour_damage', 'damage', 'smoke', 'scatter_hit' or 'event' after declare$/,
        line: 3, col: 16,
    });
});

test('parser: require_test parses avoids_hit and every `=>` follow-up', () => {
    const act = (body) => parseRule(`quality "X" { on ON_HIT then ${body} }`).actions[0];
    const spray = act('require_test "Agility" 0 "dodges the spray" avoids_hit');
    assert.equal(spray.avoidsHit, true);
    assert.equal(spray.onFailRollTable, null);
    assert.equal(act('require_test "T" 0 "x" => damage 1d10').onFailDamage.type, 'Dice');
    assert.equal(act('require_test "T" 0 "x" => roll_on "Haywire"').onFailRollTable, 'Haywire');
    assert.equal(act('require_test "T" 0 "x" => table_roll "Haywire"').onFailRollTable, 'Haywire');
    assert.equal(act('require_test "T" 0 "x" => status "On Fire"').onFailApply.name, 'On Fire');
    // the full structured-condition form — value / duration / LOCATION
    assert.deepEqual(act('require_test "T" 0 "x" => apply_status "Crippled" value 1 duration 2 location "Head"').onFailApply, {
        name: 'Crippled',
        value: { type: 'Number', value: 1 },
        duration: { type: 'Number', value: 2 },
        location: { type: 'String', value: 'Head' },
    });
    throwsDsl(() => parse('quality "X" {\n  on ON_HIT\n  then require_test "T" 0 "x" => explode 3\n}'), {
        message: /^Expected 'roll_on', 'apply_status' or 'damage' after =>$/, line: 3, col: 34,
    });
    throwsDsl(() => parse('quality "X" { on ON_HIT then require_test Toughness 0 "x" }'), {
        message: /^Expected a characteristic name \(e\.g\. "Toughness"\)$/, line: 1, col: 43,
    });
    throwsDsl(() => parse('quality "X" { on ON_HIT then require_test "T" 0 nope }'), {
        message: /^Expected the on-fail consequence text$/, line: 1, col: 49,
    });
});

test('parser: roll_on / apply_status / bump_quality optional tails', () => {
    const act = (body) => parseRule(`quality "X" { on ON_HIT then ${body} }`).actions[0];
    assert.deepEqual(act('roll_on "Haywire" + 2 area 5'), {
        type: 'Action', action: 'roll_on', table: 'Haywire',
        value: { type: 'Number', value: 2 }, area: { type: 'Number', value: 5 },
    });
    const bare = act('roll_on "Haywire"');
    assert.equal(bare.value, null);
    assert.equal(bare.area, null);
    assert.deepEqual(act('apply_status "Crippled" value 1 duration 2 location "Head", "shot in the leg"'), {
        type: 'Action', action: 'apply_status', name: 'Crippled',
        value: { type: 'Number', value: 1 }, duration: { type: 'Number', value: 2 },
        location: { type: 'String', value: 'Head' }, reason: 'shot in the leg',
    });
    const plain = act('apply_status "Stunned"');
    assert.deepEqual([plain.value, plain.duration, plain.location, plain.reason], [null, null, null, null]);
    assert.deepEqual(act('bump_quality "Blast" by 2'), {
        type: 'Action', action: 'bump_quality', name: 'Blast', value: { type: 'Number', value: 2 },
    });
    throwsDsl(() => parse('quality "X" { on ON_HIT then bump_quality "Blast" 2 }'), {
        message: /^Expected 'by'$/, line: 1, col: 51,
    });
    assert.deepEqual(act('add_quality "Recharge"'), { type: 'Action', action: 'add_quality', name: 'Recharge' });
    assert.deepEqual(act('suppress "Jam"'), { type: 'Action', action: 'suppress', name: 'Jam' });
    assert.deepEqual(act('emit "Boom"'), { type: 'Action', action: 'emit', name: 'Boom', text: null });
});

test('parser: an action slot fed a non-identifier reports "Expected an action"', () => {
    throwsDsl(() => parse('quality "X" {\n  on MODIFIERS\n  then "add modifier"\n}'), {
        message: /^Expected an action$/, line: 3, col: 8,
    });
});

// =============================================================================
// 3. INTERPRETER
// =============================================================================

test('interpreter: an unknown unscoped fact/function is refused by name', () => {
    throwsDsl(() => evalNode({ type: 'Identifier', name: 'secret_backdoor' }, {}), {
        message: /^Unknown fact 'secret_backdoor'$/, line: 0, col: 0,
    });
    throwsDsl(() => evalNode({ type: 'Call', name: 'exec', args: [] }, {}), {
        message: /^Unknown function 'exec\(\)'$/, line: 0, col: 0,
    });
});

test('interpreter: a KNOWN scope with an unavailable fact/function says so precisely', () => {
    // jam_threshold exists, but only in the attacker/weapon scopes
    throwsDsl(() => evalNode({ type: 'Identifier', scope: 'target', name: 'jam_threshold' }, {}), {
        message: /^Unknown fact 'target\.jam_threshold'$/,
    });
    // has_quality exists, but not in the `target` scope
    throwsDsl(() => evalNode({ type: 'Call', scope: 'target', name: 'has_quality', args: [] }, {}), {
        message: /^Unknown function 'target\.has_quality\(\)'$/,
    });
    // …and neither message claims the SCOPE is unknown, because it isn't
    assert.throws(() => evalNode({ type: 'Identifier', scope: 'target', name: 'jam_threshold' }, {}),
        (e) => !/unknown scope/.test(e.rawMessage));
});

test('interpreter: an unknown scope is named in the rejection', () => {
    throwsDsl(() => evalNode({ type: 'Identifier', scope: 'wielder', name: 'tb' }, {}), {
        message: /^Unknown fact 'wielder\.tb' \(unknown scope 'wielder'\)$/,
    });
    throwsDsl(() => evalNode({ type: 'Call', scope: 'wielder', name: 'has_trait', args: ['X'] }, {}), {
        message: /^Unknown function 'wielder\.has_trait\(\)' \(unknown scope 'wielder'\)$/,
    });
});

test('interpreter: an unrecognised operator or node type cannot silently evaluate', () => {
    // A Comparison/Binary with an operator outside the switch must NOT fall out
    // as `undefined` — a silently-undefined predicate would disable a rule.
    throwsDsl(() => evalNode({ type: 'Comparison', op: '~=', left: { type: 'Number', value: 1 }, right: { type: 'Number', value: 1 } }, {}),
        { message: /^Cannot evaluate node 'Comparison'$/, line: 0, col: 0 });
    throwsDsl(() => evalNode({ type: 'Binary', op: '%', left: { type: 'Number', value: 5 }, right: { type: 'Number', value: 2 } }, {}),
        { message: /^Cannot evaluate node 'Binary'$/ });
    throwsDsl(() => evalNode({ type: 'Frobnicate' }, {}), { message: /^Cannot evaluate node 'Frobnicate'$/ });
});

test('interpreter: every comparison and arithmetic operator, incl. round-UP division', () => {
    const n = (value) => ({ type: 'Number', value });
    const cmp = (op, l, r) => evalNode({ type: 'Comparison', op, left: n(l), right: n(r) }, {});
    assert.deepEqual([cmp('==', 1, 1), cmp('!=', 1, 2), cmp('>', 2, 1), cmp('<', 1, 2), cmp('>=', 2, 2), cmp('<=', 2, 2)],
        [true, true, true, true, true, true]);
    assert.deepEqual([cmp('==', 1, 2), cmp('!=', 1, 1), cmp('>', 1, 2), cmp('<', 2, 1), cmp('>=', 1, 2), cmp('<=', 2, 1)],
        [false, false, false, false, false, false]);
    const bin = (op, l, r) => evalNode({ type: 'Binary', op, left: n(l), right: n(r) }, {});
    assert.equal(bin('+', 2, 3), 5);
    assert.equal(bin('-', 2, 3), -1);
    assert.equal(bin('*', 2, 3), 6);
    assert.equal(bin('/', 7, 2), 4);          // DH2 p.18: fractions round UP
    assert.equal(bin('/', 6, 2), 3);
    // Logical short-circuit, both directions
    const b = (value) => ({ type: 'Boolean', value });
    assert.equal(evalNode({ type: 'Logical', op: 'and', left: b(false), right: b(true) }, {}), false);
    assert.equal(evalNode({ type: 'Logical', op: 'and', left: b(true), right: b(true) }, {}), true);
    assert.equal(evalNode({ type: 'Logical', op: 'or', left: b(false), right: b(false) }, {}), false);
    assert.equal(evalNode({ type: 'Logical', op: 'or', left: b(true), right: b(false) }, {}), true);
    // Unary
    assert.equal(evalNode({ type: 'Unary', op: 'not', operand: b(false) }, {}), true);
    assert.equal(evalNode({ type: 'Unary', op: 'neg', operand: n(4) }, {}), -4);
    // literals
    assert.equal(evalNode({ type: 'String', value: 'Head' }, {}), 'Head');
});

test('interpreter: Dice nodes label their rolls for the debug trace', () => {
    const labels = [];
    const rng = riggedDice([die(4, 6), die(2, 6)]);
    const ctx = { rng, rollLabel: 'Smoke' };
    assert.equal(evalNode({ type: 'Dice', count: 2, sides: 6 }, ctx), 6);
    // 0d10 rolls nothing at all
    assert.equal(evalNode({ type: 'Dice', count: 0, sides: 10 }, { rng: () => { labels.push('!'); return 0; } }), 0);
    assert.equal(labels.length, 0);
});

test('interpreter: applyAction refuses unknown actions, slots and flags', () => {
    throwsDsl(() => applyAction({ action: 'teleport' }, {}), { message: /^Unknown action 'teleport'$/, line: 0, col: 0 });
    // The compiler validates slots/flags, but applyAction is the last line of
    // defence for hand-built ASTs (e.g. a future rule-authoring UI).
    throwsDsl(() => applyAction({ action: 'set_slot', slot: 'wibble', op: '=', value: { type: 'Number', value: 1 } }, {}),
        { message: /^Unknown slot 'wibble'$/ });
    throwsDsl(() => applyAction({ action: 'set_flag', flag: 'wibble' }, {}), { message: /^Unknown flag 'wibble'$/ });
});

test('interpreter: bump_quality bumps in place, never mutating the caller\'s array', () => {
    const original = [{ name: 'Blast', level: 3 }, 'Tearing'];
    const ctx = { qualities: original, effects: [] };
    applyAction({ action: 'bump_quality', name: 'Blast', value: { type: 'Number', value: 2 } }, ctx, { ruleName: 'Maximal' });
    assert.deepEqual(ctx.qualities, [{ name: 'Blast', level: 5 }, 'Tearing']);
    assert.deepEqual(original, [{ name: 'Blast', level: 3 }, 'Tearing'], 'caller array must be untouched');
    assert.deepEqual(ctx.effects, [{ name: 'Blast ↑', effect: 'Blast (3) → (5)' }]);

    // no-op when the weapon lacks the quality (and when there is no list at all)
    const miss = { qualities: ['Tearing'], effects: [] };
    applyAction({ action: 'bump_quality', name: 'Blast', value: { type: 'Number', value: 2 } }, miss);
    assert.deepEqual(miss.qualities, ['Tearing']);
    assert.equal(miss.effects.length, 0);
    const none = {};
    applyAction({ action: 'bump_quality', name: 'Blast', value: { type: 'Number', value: 2 } }, none);
    assert.equal(none.qualities, undefined);
});

test('interpreter: add_quality appends once and never mutates the caller\'s array', () => {
    const original = ['Tearing'];
    const ctx = { qualities: original };
    applyAction({ action: 'add_quality', name: 'Recharge' }, ctx);
    assert.deepEqual(ctx.qualities, ['Tearing', { name: 'Recharge', level: null }]);
    assert.deepEqual(original, ['Tearing']);
    applyAction({ action: 'add_quality', name: 'Recharge' }, ctx);
    assert.equal(ctx.qualities.length, 2, 'a duplicate add is a no-op');
    // no list at all → one is created
    const bare = {};
    applyAction({ action: 'add_quality', name: 'Recharge' }, bare);
    assert.deepEqual(bare.qualities, [{ name: 'Recharge', level: null }]);
});

test('interpreter: the declaration verbs record source, and lazily roll on-fail damage', () => {
    const n = (value) => ({ type: 'Number', value });
    const ctx = {
        targetEffects: { tests: [], statuses: [] }, effects: [], modifiers: {},
        rng: riggedDice([die(7, 10)]),
    };
    // FULL require_test: every optional tail populated
    applyAction({
        action: 'require_test', characteristic: 'Toughness', value: n(-10), onFail: 'knocked down',
        onFailRollTable: 'Haywire', avoidsHit: true,
        onFailApply: { name: 'On Fire', value: n(1), duration: n(3), location: { type: 'String', value: 'Head' } },
        onFailDamage: { type: 'Dice', count: 1, sides: 10 },
    }, ctx, { ruleName: 'Concussive' });
    const t = ctx.targetEffects.tests[0];
    assert.equal(t.source, 'Concussive');
    assert.equal(t.modifier, -10);
    assert.equal(t.avoidsHit, true);
    assert.deepEqual(t.onFailApply, { name: 'On Fire', value: 1, duration: 3, location: 'Head' });
    assert.equal(typeof t.onFailDamage, 'function', 'on-fail damage must stay LAZY');
    assert.equal(t.onFailDamage(), 7, 'the die is only rolled when the test actually fails');

    // MINIMAL require_test: falls back to meta.penKey for the source
    applyAction({ action: 'require_test', characteristic: 'Strength', value: n(0), onFail: 'x' }, ctx, { penKey: 'shocking' });
    const min = ctx.targetEffects.tests[1];
    assert.equal(min.source, 'shocking');
    assert.equal(min.onFailRollTable, null);
    assert.equal(min.onFailApply, null);
    assert.equal(min.onFailDamage, null);
    assert.equal(min.avoidsHit, false);
});

test('interpreter: declare_damage / declare_smoke / declare_scatter_hit / roll_on / corrode', () => {
    const n = (value) => ({ type: 'Number', value });
    const ctx = { targetEffects: {}, rng: riggedDice([]) };
    applyAction({ action: 'declare_damage', value: n(5), reason: 'burning' }, ctx, { ruleName: 'On Fire' });
    applyAction({ action: 'declare_damage', value: n(2) }, ctx, { penKey: 'toxic' });
    assert.deepEqual(ctx.declaredDamage, [
        { source: 'On Fire', amount: 5, reason: 'burning' },
        { source: 'toxic', amount: 2, reason: null },
    ]);

    applyAction({ action: 'declare_smoke', radius: n(3), duration: n(4) }, ctx, { ruleName: 'Smoke' });
    applyAction({ action: 'declare_smoke', radius: n(3) }, ctx, { ruleName: 'Smoke' });
    assert.deepEqual(ctx.smokeScreens.map((s) => s.duration), [4, null]);

    applyAction({ action: 'declare_scatter_hit', value: n(4) }, ctx);
    assert.equal(ctx.hitScatterDistance, 4);
    applyAction({ action: 'declare_scatter_hit', value: n(-6) }, ctx);
    assert.equal(ctx.hitScatterDistance, 0, 'scatter distance clamps at 0');

    applyAction({ action: 'roll_on', table: 'Haywire', value: n(2), area: n(5) }, ctx, { ruleName: 'Haywire' });
    applyAction({ action: 'roll_on', table: 'Haywire', value: null, area: null }, ctx, { ruleName: 'Haywire' });
    assert.deepEqual(ctx.tableRolls.map((r) => [r.modifier, r.area]), [[2, 5], [0, null]]);

    applyAction({ action: 'corrode', value: n(3) }, ctx, { ruleName: 'Corrosive' });
    assert.deepEqual(ctx.targetEffects.armour, [{ source: 'Corrosive', amount: 3 }]);
});

test('interpreter: apply_status, suppress, emit, modifiers and die transforms', () => {
    const n = (value) => ({ type: 'Number', value });
    const ctx = { targetEffects: { statuses: [] }, effects: [], modifiers: {}, dieTransforms: [], additionalHits: 3 };
    applyAction({ action: 'apply_status', name: 'Crippled', value: n(2), duration: n(3), location: { type: 'String', value: 'Head' }, reason: 'leg shot' }, ctx, { ruleName: 'Crippling' });
    applyAction({ action: 'apply_status', name: 'Stunned', value: null, duration: null, location: null }, ctx, { penKey: 'concussive' });
    assert.deepEqual(ctx.targetEffects.statuses, [
        { source: 'Crippling', status: 'Crippled', value: 2, duration: 3, location: 'Head', reason: 'leg shot' },
        { source: 'concussive', status: 'Stunned', value: null, duration: null, location: null, reason: null },
    ]);

    applyAction({ action: 'suppress', name: 'Jam' }, ctx);
    applyAction({ action: 'suppress', name: 'Overheats' }, ctx);
    assert.deepEqual([...ctx.suppressed].sort(), ['Jam', 'Overheats']);

    applyAction({ action: 'emit', name: 'Boom', text: 'it detonates' }, ctx);
    applyAction({ action: 'emit', name: 'Quiet' }, ctx);
    assert.deepEqual(ctx.effects, [{ name: 'Boom', effect: 'it detonates' }, { name: 'Quiet', effect: '' }]);

    applyAction({ action: 'set_modifier', name: 'aim', value: n(20) }, ctx);
    applyAction({ action: 'add_modifier', name: 'gone', value: n(5) }, ctx);
    applyAction({ action: 'cancel_modifier', name: 'gone' }, ctx);
    assert.deepEqual(ctx.modifiers, { aim: 20 });

    applyAction({ action: 'multiply_hits', value: n(2) }, ctx);
    assert.equal(ctx.additionalHits, 6);

    applyAction({ action: 'floor_die', value: n(3) }, ctx);
    applyAction({ action: 'cap_die', value: n(8) }, ctx);
    assert.equal(ctx.proven, 3);
    assert.equal(ctx.primitive, 8);
    assert.deepEqual([1, 5, 10].map((v) => ctx.dieTransforms.reduce((acc, f) => f(acc), v)), [3, 5, 8]);
});

test('interpreter: collectNames walks the whole tree and ignores non-nodes', () => {
    const rule = parseRule(`quality "X" {
      on ON_HIT
      when (target.has_trait("Daemonic") and not has_quality("Sanctified")) or tens(roll) > 5
      then add modifier "m" = target.tb + quality_level("Proven", 2) - -weapon.pen
    }`);
    const acc = collectNames(rule.when);
    for (const a of rule.actions) collectNames(a.value, acc);
    assert.deepEqual([...acc.facts].sort(), ['roll']);
    assert.deepEqual([...acc.calls].sort(), ['has_quality', 'quality_level', 'tens']);
    assert.deepEqual([...acc.scopedFacts].sort(), ['target.tb', 'weapon.pen']);
    assert.deepEqual([...acc.scopedCalls].sort(), ['target.has_trait']);
    // non-node inputs are inert
    assert.deepEqual(collectNames(null).facts.size, 0);
    assert.deepEqual(collectNames('a string').calls.size, 0);
    assert.deepEqual(collectNames(undefined, acc), acc);
});

// =============================================================================
// 4. COMPILER
// =============================================================================

test('compiler: an unknown SCOPE is rejected with the legal scope list', () => {
    throwsDsl(() => compile('quality "Bad Scope" {\n  on MODIFIERS\n  when wielder.tb > 3\n  then flag no_parry\n}'), {
        message: /^Unknown scope 'wielder' in rule "Bad Scope" \(scopes: attacker, target, weapon, opposing_weapon\)$/,
        line: 1, col: 1,
    });
    throwsDsl(() => compile('quality "Bad Scope" { on MODIFIERS when wielder.has_trait("X") then flag no_parry }'), {
        message: /^Unknown scope 'wielder' in rule "Bad Scope"/,
    });
});

test('compiler: a real fact/function in the WRONG scope is rejected', () => {
    throwsDsl(() => compile('quality "X" { on POST_ROLL when target.jam_threshold > 90 then flag no_parry }'), {
        message: /^Fact 'jam_threshold' is not available in scope 'target' in rule "X"$/,
    });
    throwsDsl(() => compile('quality "X" { on MODIFIERS when target.has_quality("Force") then flag no_parry }'), {
        message: /^Function 'has_quality\(\)' is not available in scope 'target' in rule "X"$/,
    });
    // the legitimate scoped forms compile
    assert.equal(compile('quality "X" { on PARRY when opposing_weapon.has_quality("Force") and target.tb > 3 then flag no_parry }').length, 1);
});

test('compiler: slot and flag registries are enforced, modes included', () => {
    throwsDsl(() => compile('quality "X" {\n  on MODIFIERS\n  then set wibble = 1\n}'), {
        message: /^Unknown slot 'wibble' in rule "X" \(slots: .*jam_threshold.*\)$/, line: 1, col: 1,
    });
    // jam_threshold is '=' only — '+=' must not silently accumulate
    throwsDsl(() => compile('quality "X" { on POST_ROLL then set jam_threshold += 1 }'), {
        message: /^Slot 'jam_threshold' does not support '\+=' in rule "X" \(modes: =\)$/,
    });
    // extra_dice is '+=' only
    throwsDsl(() => compile('quality "X" { on DAMAGE_POOL then set extra_dice = 1 }'), {
        message: /^Slot 'extra_dice' does not support '=' in rule "X" \(modes: \+=\)$/,
    });
    throwsDsl(() => compile('quality "X" { on POST_ROLL then flag explode }'), {
        message: /^Unknown flag 'explode' in rule "X" \(flags: .*attack_failed.*\)$/,
    });
    // slot validation reaches every branch, not just the first
    throwsDsl(() => compile(`quality "X" {
      on MODIFIERS
      when dos > 1 then add modifier "a" = 1
      when dos > 3 then set wibble = 1
    }`), { message: /^Unknown slot 'wibble'/ });
});

test('compiler: fact/function validation reaches later branches and action values', () => {
    throwsDsl(() => compile(`quality "X" {
      on MODIFIERS
      when dos > 1 then add modifier "a" = 1
      when secret_backdoor then add modifier "b" = 2
    }`), { message: /^Unknown fact 'secret_backdoor' in rule "X"$/ });
    // a bad name hiding in an ACTION VALUE, not the predicate
    throwsDsl(() => compile('quality "X" { on MODIFIERS then add modifier "a" = exec("rm") }'), {
        message: /^Unknown function 'exec\(\)' in rule "X"$/,
    });
});

test('compiler: the `attack.` pipeline prefix normalises away; other prefixes must be real', () => {
    assert.equal(compile('quality "X" { on attack.MODIFIERS then add modifier "m" = 1 }')[0].checkpoint, 'MODIFIERS');
    assert.equal(compile('quality "X" { on test.MODIFIERS then add modifier "m" = 1 }')[0].checkpoint, 'test.MODIFIERS');
    throwsDsl(() => compile('quality "X" {\n  on combat.MODIFIERS\n  then add modifier "m" = 1\n}'), {
        message: /^Unknown checkpoint 'combat\.MODIFIERS' in rule "X"$/, line: 1, col: 1,
    });
});

test('compiler: provenance flows from the package header and rule meta', () => {
    const src = `dsl 3
    package "dh2.test.pkg" { system "dh2" source "Core Rulebook" requires "dh2.core.mechanics" }
    quality "Razor Sharp" tier 2 {
      meta { page 149  ref "Table 5-1" }
      on PENETRATION
      priority 40
      when is_melee then set pen += pen
    }
    trait "Overridden" {
      meta { page 12  source "Enemies Beyond" }
      on MODIFIERS
      then add modifier "m" = 1
    }`;
    const [razor, overridden] = compile(src);
    assert.equal(razor.qualifiedId, 'dh2.test.pkg/razor-sharp');
    assert.equal(razor.package, 'dh2.test.pkg');
    assert.equal(razor.system, 'dh2');
    assert.equal(razor.sourceBook, 'Core Rulebook', 'falls back to the package source');
    assert.equal(razor.page, 149);
    assert.equal(razor.ref, 'Table 5-1');
    assert.equal(razor.tier, 2);
    assert.equal(razor.priority, 40);
    assert.equal(razor.replaces, null);
    assert.equal(overridden.sourceBook, 'Enemies Beyond', 'rule meta.source overrides the package');
    assert.equal(overridden.ref, null);

    // with no package header at all the qualified id degrades to the ruleId
    const [bare] = compile('quality "Razor Sharp" { on PENETRATION when is_melee then set pen += pen }');
    assert.equal(bare.qualifiedId, 'razor-sharp');
    assert.deepEqual([bare.package, bare.system, bare.sourceBook, bare.page, bare.ref, bare.tier], [null, null, null, null, null, null]);
    assert.equal(bare.priority, 0);
});

test('compiler: `replaces` is carried onto every compiled effect', () => {
    const [eff] = compile('mechanic "New Jam" { replaces "dh2.core.mechanics/jam" on POST_ROLL then flag attack_failed }');
    assert.deepEqual(eff.replaces, ['dh2.core.mechanics/jam']);
});

test('compiler: an unconditional branch compiles without a `when` predicate', () => {
    const [eff] = compile('quality "X" { on MODIFIERS then add modifier "m" = 1 }');
    assert.equal(eff.when, undefined, 'no predicate ⇒ always active');
    const ctx = { modifiers: {} };
    eff.apply(ctx);
    assert.deepEqual(ctx.modifiers, { m: 1 });
});

test('compiler: compileRule accepts a pre-parsed rule and an explicit package', () => {
    const rule = parseRule('quality "Force" { on PENETRATION when is_psyker then set pen += psy_rating }');
    const [eff] = compileRule(rule, { name: 'dh2.custom', system: 'dh2', source: 'Homebrew' });
    assert.equal(eff.qualifiedId, 'dh2.custom/force');
    assert.equal(eff.sourceBook, 'Homebrew');
    // and with no package argument at all (the default)
    assert.equal(compileRule(rule)[0].qualifiedId, 'force');
});

test('compiler: slug() flattens punctuation and trims the edges of a rule id', () => {
    assert.equal(compile('quality "  Razor-Sharp (Mk II)!  " { on MODIFIERS then add modifier "m" = 1 }')[0].id, 'razor-sharp-mk-ii');
});

test('compiler: compileTable sorts rows and rejects a reversed range', () => {
    const [tbl] = compileTables(`roll_table "Sorted" {
      die 1d5
      4-5: "high"
      1-3: "low"
    }`);
    assert.deepEqual(tbl.rows.map((r) => r.lo), [1, 4]);
    assert.deepEqual(tbl.die, { count: 1, sides: 5 });

    const [reversed] = parse('roll_table "Reversed" {\n  die 1d10\n  5-2: "backwards"\n}').tables;
    throwsDsl(() => compileTable(reversed), {
        message: /^Table "Reversed" has a reversed range 5-2$/, line: 1, col: 1,
    });
});

test('compiler: the table/action extractors tolerate a source with none', () => {
    const none = 'quality "X" { on MODIFIERS then add modifier "m" = 1 }';
    assert.deepEqual(compileTables(none), []);
    assert.deepEqual(compileActions(none), []);
    // and accept a pre-parsed Program, or one missing the arrays entirely
    assert.deepEqual(compileTables({ rules: [] }), []);
    assert.deepEqual(compileActions({ rules: [] }), []);
    assert.deepEqual(compileTables(parse(none)), []);
});

test('compiler: compile() accepts a pre-parsed Program as well as source text', () => {
    const program = parse('package "p" { system "s" } quality "X" { on MODIFIERS then add modifier "m" = 1 }');
    const [eff] = compile(program);
    assert.equal(eff.qualifiedId, 'p/x');
    assert.deepEqual(compile({ rules: [], package: null }), []);
});

test('compiler: programInfo reports the header, and defaults a header-less Program to dsl 1', () => {
    const full = programInfo('dsl 3\npackage "p" { system "dh2" source "Core" requires "q" }\nquality "X" { on MODIFIERS then add modifier "m" = 1 }');
    assert.deepEqual(full, { dslVersion: 3, package: { name: 'p', system: 'dh2', source: 'Core', requires: ['q'] } });
    // a package with no `requires` clause still reports an array
    assert.deepEqual(programInfo('package "p" { system "dh2" }').package.requires, []);
    // a hand-built Program with no dslVersion key falls back to 1
    assert.deepEqual(programInfo({ rules: [], tables: [], actions: [] }), { dslVersion: 1, package: null });
});

test('compiler: the defensive defaults hold for hand-built ASTs', () => {
    // A rule AST assembled by hand (a future rule-authoring UI, or a migration
    // script) may omit fields the parser always fills in. Those defaults are the
    // difference between a clear rejection and a corrupt effect.
    const rule = (over) => ({
        type: 'Rule', kind: 'quality', name: 'Handmade', on: 'MODIFIERS',
        tier: null, priority: null, meta: null, replaces: null,
        branches: [{ when: null, actions: [] }], line: 7, col: 3, ...over,
    });
    // no `on` at all → the checkpoint check must still reject, not crash
    throwsDsl(() => compileRule(rule({ on: null })), {
        message: /^Unknown checkpoint 'null' in rule "Handmade"$/, line: 7, col: 3,
    });
    // A set_slot with no `op` defaults to '=' for the mode CHECK.
    // DEFECT (compiler.mjs:65): the check defaults the op (`a.op ?? '='`) but the
    // error message interpolates the RAW `a.op`, so the operator the compiler
    // actually tested is not the one it names — an author reading
    // "does not support 'undefined'" cannot tell what was rejected. Pinned here
    // as-is; reported rather than fixed.
    throwsDsl(() => compileRule(rule({ branches: [{ when: null, actions: [{ action: 'set_slot', slot: 'extra_dice', value: { type: 'Number', value: 1 } }] }] })), {
        message: /^Slot 'extra_dice' does not support 'undefined' in rule "Handmade" \(modes: \+=\)$/,
    });
    // …and a slot that *does* allow '=' compiles through the same default
    const [eff] = compileRule(rule({ branches: [{ when: null, actions: [{ action: 'set_slot', slot: 'jam_threshold', value: { type: 'Number', value: 100 } }] }] }));
    const ctx = {};
    eff.apply(ctx);
    assert.equal(ctx.jamThreshold, 100);

    // programInfo / compileActions tolerate headers missing their optional arrays
    assert.deepEqual(programInfo({ dslVersion: 3, package: { name: 'p', system: 's', source: null } }).package.requires, []);
    assert.deepEqual(compileActions({ actions: [{ name: 'Brace', actionType: 'Reaction' }] }), [{ name: 'Brace', type: 'Reaction', subtypes: [] }]);
});

test('compiler: referencedNames buckets every player-facing accessor', () => {
    const names = referencedNames(`
      quality "A" { on MODIFIERS when has_quality("Melta") and has_talent("Mighty Shot") then add modifier "m" = 1 }
      trait "B" { on MODIFIERS when has_trait("Daemonic") or target.has_trait("Machine") then add modifier "m" = 1 }
      condition "C" { on MODIFIERS when has_condition("On Fire") or has_status("Stunned") then add modifier "m" = 1 }
      circumstance "D" { on MODIFIERS when has_circumstance("Darkness") then add modifier "m" = 1 }
      configuration "E" { on MODIFIERS when configuration("Maximal") or firing_mode("Suppressing") then add modifier "m" = 1 }
      quality "F" { on MODIFIERS then add modifier "m" = quality_level("Proven", 2) }
    `);
    // NOTE: quality_level("Proven", 2) is deliberately NOT bucketed here — the
    // level accessors belong to valuedNames(), not the has_* name harvest.
    assert.deepEqual(names.qualities, ['Melta']);
    assert.deepEqual(names.talents, ['Mighty Shot']);
    assert.deepEqual(names.traits, ['Daemonic', 'Machine'], 'scoped calls are bucketed by base name too');
    assert.deepEqual(names.conditions, ['On Fire', 'Stunned']);
    assert.deepEqual(names.circumstances, ['Darkness']);
    assert.deepEqual(names.configurations, ['Maximal', 'Suppressing']);
});

test('compiler: referencedNames skips non-literal args and unbucketed functions', () => {
    const names = referencedNames(`
      quality "A" { on MODIFIERS when has_quality(craftsmanship) then add modifier "m" = 1 }
      quality "B" { on MODIFIERS when is_action("Parry") then add modifier "m" = tens(roll) }
      quality "C" { on MODIFIERS when not (has_quality("Nested") and dos > 1) then add modifier "m" = 1 }
    `);
    assert.deepEqual(names.qualities, ['Nested'], 'a non-String first arg contributes nothing');
    assert.deepEqual(names.talents, []);
});

test('compiler: valuedNames finds level/severity accessors anywhere in the tree', () => {
    const valued = valuedNames(`
      quality "A" { on DAMAGE_MODS then add modifier "m" = 1 + quality_level("Proven", 2) }
      trait "B" { on DAMAGE_MODS when trait_level("Brutal Charge", 0) > 2 then add modifier "m" = 1 }
      circumstance "C" { on MODIFIERS then add modifier "m" = -circumstance_severity("Haywire Field", 1) }
      condition "D" { on MODIFIERS then add modifier "m" = -condition_severity("Crippled", 1) }
      quality "E" { on MODIFIERS then add modifier "m" = tens(quality_level("Nested Call", 1)) }
      quality "F" { on MODIFIERS when has_quality("Boolean Only") then add modifier "m" = 1 }
      quality "G" { on MODIFIERS then add modifier "m" = quality_level(craftsmanship, 1) }
    `);
    assert.deepEqual(valued, ['Brutal Charge', 'Crippled', 'Haywire Field', 'Nested Call', 'Proven']);
});

// =============================================================================
// 5. VOCABULARY
// =============================================================================

/** typeof for each declared vocabulary type. */
const TYPEOF = { bool: 'boolean', number: 'number', string: 'string' };

/**
 * Five contexts chosen to drive BOTH sides of every `??` / `||` fallback in the
 * getter table: direct engine fields, characteristic-derived fields, the
 * `actor.*` fallbacks, the legacy `firingModes`/`combat.*` shapes, and nothing
 * at all.
 */
const CONTEXTS = {
    empty: {},
    rich: {
        isMelee: true, pen: 5, strengthBonus: 4, toughnessBonus: 3,
        characteristics: { s: 45, t: 38, bs: 42, ws: 51 },
        test: { roll: 27, dos: 3, dof: 0, success: true },
        jamThreshold: 94, craftsmanship: 'Good',
        action: 'Standard Attack', testName: 'Tech-Use',
        rangeBand: 'Short Range', aimValue: 20,
        location: 'Head', damageType: 'Energy', hitIndex: 1,
        damageDealt: 12, woundsInflicted: 4, targetArmour: 6,
        statuses: [{ name: 'Crippled', severity: 2, duration: 3, location: 'Arm' }, 'Full Aim'],
        circumstances: [{ name: 'Haywire Field', severity: 4 }],
        qualities: ['Proven (3)', 'Tearing'], talents: ['Mighty Shot'], traits: ['Sturdy (2)'],
        configs: ['DualWield (main hand)', 'Maximal'],
        combat: { dualWielding: true, firingOffhand: true, firingBoth: true },
        target: {
            strength: 55, toughness: 62, strengthBonus: 5, toughnessBonus: 6,
            armour: 7, unnaturalToughness: 2, traits: ['Daemonic', 'Brutal Charge (3)'],
        },
        opposingProvided: true, opposingQualities: ['Force', 'Power Field (2)'],
        psyRating: 3,
    },
    // no *Bonus shortcuts and no test object — the derived/legacy read paths
    derived: {
        isMelee: false,
        characteristics: { s: 45, t: 38, bs: 42, ws: 51 },
        roll: 91, dos: 0, dof: 2, success: false,
        target: { strength: 55, toughness: 62, armour: 7 },
        aimValue: 10, psyRating: 0,
    },
    // the actor.* fallbacks for talents / traits / conditions / circumstances
    actorOnly: {
        actor: {
            talents: ['Ambidextrous'], traits: ['Daemonic'],
            statuses: [{ name: 'On Fire', severity: 1, duration: 2, location: 'Body' }],
            circumstances: ['Darkness'],
        },
        action: 'Parry',
    },
    // the legacy firingModes[] shape instead of configs[]
    legacy: {
        firingModes: ['DualWield (off-hand)'],
        combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
        statuses: ['Half Aim'],
    },
};

test('vocabulary: EVERY scoped fact getter returns its declared type in every context', () => {
    let calls = 0;
    for (const def of FACT_DEFS) {
        for (const [scope, get] of Object.entries(def.scopes)) {
            assert.ok(SCOPE_NAMES.includes(scope), `${def.name} declares an unknown scope '${scope}'`);
            assert.equal(SCOPED_FACTS[scope][def.name], get, `${scope}.${def.name} must be the derived getter`);
            for (const [label, ctx] of Object.entries(CONTEXTS)) {
                const v = get(ctx);
                assert.equal(typeof v, TYPEOF[def.type],
                    `${scope}.${def.name} returned ${typeof v} (${v}) for the "${label}" context; declared ${def.type}`);
                calls++;
            }
        }
    }
    assert.ok(calls >= 100, `expected a broad sweep, made ${calls} getter calls`);
    // the unscoped table is exactly the attacker scope
    for (const def of FACT_DEFS) {
        if (def.scopes.attacker) assert.equal(FLAT_FACTS[def.name], def.scopes.attacker);
        else assert.ok(!(def.name in FLAT_FACTS), `${def.name} is scope-only and must not leak unscoped`);
    }
    assert.equal(FACTS, FLAT_FACTS);
});

test('vocabulary: EVERY scoped function getter returns its declared type in every context', () => {
    // ('Proven', 1) is a name/default pair that every signature accepts: the
    // name-lookup functions match a real quality, the arithmetic helpers coerce.
    const args = ['Proven', 1];
    for (const def of FUNCTION_DEFS) {
        for (const [scope, fn] of Object.entries(def.scopes)) {
            assert.ok(SCOPE_NAMES.includes(scope), `${def.name}() declares an unknown scope '${scope}'`);
            assert.equal(SCOPED_FUNCTIONS[scope][def.name], fn);
            for (const [label, ctx] of Object.entries(CONTEXTS)) {
                const v = fn(ctx, args);
                assert.equal(typeof v, TYPEOF[def.returns],
                    `${scope}.${def.name}() returned ${typeof v} (${v}) for the "${label}" context; declared ${def.returns}`);
            }
        }
        if (def.scopes.attacker) assert.equal(FLAT_FUNCTIONS[def.name], def.scopes.attacker);
    }
    assert.equal(FUNCTIONS, FLAT_FUNCTIONS);
});

test('vocabulary: the fact getters compute the DH2 values they claim to', () => {
    const { rich, derived, empty, legacy } = CONTEXTS;
    // bonuses: the explicit field wins; otherwise the tens digit of the characteristic
    assert.equal(SCOPED_FACTS.attacker.sb(rich), 4);
    assert.equal(SCOPED_FACTS.attacker.sb(derived), 4);          // floor(45/10)
    assert.equal(SCOPED_FACTS.attacker.tb(derived), 3);          // floor(38/10)
    assert.equal(SCOPED_FACTS.target.sb(rich), 5);
    assert.equal(SCOPED_FACTS.target.sb(derived), 5);            // floor(55/10)
    assert.equal(SCOPED_FACTS.target.tb(derived), 6);            // floor(62/10)
    assert.equal(SCOPED_FACTS.attacker.bs_bonus(derived), 4);
    assert.equal(SCOPED_FACTS.attacker.ws_bonus(derived), 5);
    // melee/ranged: an ABSENT isMelee means ranged
    assert.deepEqual([SCOPED_FACTS.attacker.is_melee(rich), SCOPED_FACTS.attacker.is_ranged(rich)], [true, false]);
    assert.deepEqual([SCOPED_FACTS.weapon.is_melee(empty), SCOPED_FACTS.weapon.is_ranged(empty)], [false, true]);
    assert.deepEqual([SCOPED_FACTS.attacker.is_melee(derived), SCOPED_FACTS.attacker.is_ranged(derived)], [false, true]);
    // test outcome: the test object wins over the flat fields
    assert.equal(SCOPED_FACTS.attacker.roll(rich), 27);
    assert.equal(SCOPED_FACTS.attacker.roll(derived), 91);
    assert.equal(SCOPED_FACTS.attacker.dos(derived), 0);
    assert.equal(SCOPED_FACTS.attacker.dof(derived), 2);
    assert.equal(SCOPED_FACTS.attacker.success(derived), false);
    assert.equal(SCOPED_FACTS.attacker.success(empty), false);
    // defaults
    assert.equal(SCOPED_FACTS.weapon.jam_threshold(empty), 96);
    assert.equal(SCOPED_FACTS.weapon.jam_threshold(rich), 94);
    assert.equal(SCOPED_FACTS.weapon.craftsmanship(empty), 'Common');
    assert.equal(SCOPED_FACTS.weapon.craftsmanship(rich), 'Good');
    // aim: the dropdown value OR a status of the same name
    assert.deepEqual([SCOPED_FACTS.attacker.half_aim(rich), SCOPED_FACTS.attacker.full_aim(rich)], [false, true]);
    assert.deepEqual([SCOPED_FACTS.attacker.half_aim(derived), SCOPED_FACTS.attacker.full_aim(derived)], [true, false]);
    assert.deepEqual([SCOPED_FACTS.attacker.half_aim(legacy), SCOPED_FACTS.attacker.full_aim(legacy)], [true, false]);
    // target-only bases
    assert.equal(SCOPED_FACTS.target.armour(rich), 6);           // targetArmour (post-corrosion) wins
    assert.equal(SCOPED_FACTS.target.armour(derived), 7);        // else the base AP
    assert.equal(SCOPED_FACTS.target.unnatural_toughness(rich), 2);
    assert.equal(SCOPED_FACTS.target.unnatural_toughness(empty), 0);
    // psyker + opposing weapon
    assert.deepEqual([SCOPED_FACTS.attacker.psy_rating(rich), SCOPED_FACTS.attacker.is_psyker(rich)], [3, true]);
    assert.deepEqual([SCOPED_FACTS.attacker.psy_rating(derived), SCOPED_FACTS.attacker.is_psyker(derived)], [0, false]);
    assert.equal(SCOPED_FACTS.opposing_weapon.present(rich), true);
    assert.equal(SCOPED_FACTS.opposing_weapon.present(empty), false);
    // dual wield: the configuration entry OR the legacy combat flag
    assert.deepEqual([SCOPED_FACTS.attacker.dual_wielding(rich), SCOPED_FACTS.attacker.firing_offhand(rich)], [true, true]);
    assert.deepEqual([SCOPED_FACTS.attacker.dual_wielding(legacy), SCOPED_FACTS.attacker.firing_offhand(legacy)], [false, true]);
    assert.equal(SCOPED_FACTS.attacker.firing_both(rich), true);
    assert.equal(SCOPED_FACTS.attacker.firing_both(legacy), false);
});

test('vocabulary: the function getters resolve names spelling-blind and scope correctly', () => {
    const { rich, actorOnly, empty } = CONTEXTS;
    // has_quality is prefix + spelling blind: "Proven (3)" satisfies "Proven"
    assert.equal(SCOPED_FUNCTIONS.weapon.has_quality(rich, ['Proven']), true);
    assert.equal(SCOPED_FUNCTIONS.weapon.has_quality(rich, ['Melta']), false);
    assert.equal(SCOPED_FUNCTIONS.opposing_weapon.has_quality(rich, ['Power Field']), true);
    assert.equal(SCOPED_FUNCTIONS.opposing_weapon.has_quality(empty, ['Force']), false);
    assert.equal(SCOPED_FUNCTIONS.weapon.quality_level(rich, ['Proven', 2]), 3);
    assert.equal(SCOPED_FUNCTIONS.weapon.quality_level(rich, ['Melta', 2]), 2);
    assert.equal(SCOPED_FUNCTIONS.opposing_weapon.quality_level(rich, ['Power Field', 0]), 2);
    // talents / traits / conditions / circumstances, with the actor.* fallback
    assert.equal(FLAT_FUNCTIONS.has_talent(rich, ['Mighty Shot']), true);
    assert.equal(FLAT_FUNCTIONS.has_talent(actorOnly, ['Ambidextrous']), true);
    assert.equal(SCOPED_FUNCTIONS.target.has_trait(rich, ['Daemonic']), true);
    assert.equal(SCOPED_FUNCTIONS.attacker.has_trait(actorOnly, ['Daemonic']), true);
    assert.equal(SCOPED_FUNCTIONS.target.trait_level(rich, ['Brutal Charge', 0]), 3);
    assert.equal(SCOPED_FUNCTIONS.attacker.trait_level(rich, ['Sturdy', 0]), 2);
    assert.equal(FLAT_FUNCTIONS.has_condition(actorOnly, ['On Fire']), true);
    assert.equal(FLAT_FUNCTIONS.has_circumstance(actorOnly, ['Darkness']), true);
    assert.equal(FLAT_FUNCTIONS.circumstance_severity(rich, ['Haywire Field', 1]), 4);
    assert.equal(FLAT_FUNCTIONS.circumstance_severity(rich, ['Fog', 1]), 1, 'absent ⇒ the default');
    // structured condition variables
    assert.equal(FLAT_FUNCTIONS.condition_severity(rich, ['Crippled', 0]), 2);
    assert.equal(FLAT_FUNCTIONS.condition_duration(rich, ['Crippled', 0]), 3);
    assert.equal(FLAT_FUNCTIONS.condition_location(rich, ['Crippled']), 'Arm');
    assert.equal(FLAT_FUNCTIONS.condition_location(rich, ['Stunned']), '', 'absent ⇒ ""');
    assert.equal(FLAT_FUNCTIONS.condition_severity(actorOnly, ['On Fire', 0]), 1);
    // configuration reads configs[] or the legacy firingModes[]
    assert.equal(FLAT_FUNCTIONS.configuration(rich, ['Maximal']), true);
    assert.equal(FLAT_FUNCTIONS.configuration(CONTEXTS.legacy, ['DualWield (off-hand)']), true);
    // action predicates
    assert.equal(FLAT_FUNCTIONS.is_action(rich, ['standard_attack']), true, 'spelling-blind');
    assert.equal(FLAT_FUNCTIONS.is_reaction(actorOnly, []), true);
    assert.equal(FLAT_FUNCTIONS.is_reaction(rich, []), false);
    assert.equal(FLAT_FUNCTIONS.action_subtype(rich, ['attack']), true);
    // is_test is spelling-blind against testName
    assert.equal(FLAT_FUNCTIONS.is_test(rich, ['Tech-Use']), true);
    assert.equal(FLAT_FUNCTIONS.is_test(rich, ['tech_use']), true);
    assert.equal(FLAT_FUNCTIONS.is_test(rich, ['Athletics']), false);
    assert.equal(FLAT_FUNCTIONS.is_test(empty, ['Athletics']), false);
    // arithmetic helpers — DH2 p.18 rounds UP
    assert.equal(FLAT_FUNCTIONS.tens({}, [47]), 4);
    assert.equal(FLAT_FUNCTIONS.tens({}, ['nonsense']), 0);
    assert.equal(FLAT_FUNCTIONS.half({}, [3]), 2);
    assert.equal(FLAT_FUNCTIONS.half({}, [4]), 2);
    assert.equal(FLAT_FUNCTIONS.ceil({}, [1.2]), 2);
    assert.equal(FLAT_FUNCTIONS.floor({}, [1.8]), 1);
    assert.equal(FLAT_FUNCTIONS.ceil({}, ['x']), 0);
    // is_natural compares the raw d100
    assert.equal(FLAT_FUNCTIONS.is_natural(rich, [27]), true);
    assert.equal(FLAT_FUNCTIONS.is_natural(CONTEXTS.derived, [91]), true);
    assert.equal(FLAT_FUNCTIONS.is_natural(rich, [100]), false);
});

test('vocabulary: nameOf handles strings, named objects and nothing', () => {
    assert.equal(nameOf('Tearing'), 'Tearing');
    assert.equal(nameOf({ name: 'Proven', level: 3 }), 'Proven');
    assert.equal(nameOf({ level: 3 }), '', 'a nameless object is the empty name');
    assert.equal(nameOf(null), '');
    assert.equal(nameOf(undefined), '');
    assert.equal(nameOf(7), '7');
});

test('vocabulary: EVERY slot applies in EVERY declared mode', () => {
    const base = () => ({
        penModifiers: {}, scatterModifiers: {}, parsed: { count: 2 }, effects: [],
    });
    for (const [name, slot] of Object.entries(SLOT_DEFS)) {
        assert.ok(slot.modes.length && slot.at && slot.summary, `slot ${name} is under-declared`);
        for (const mode of slot.modes) {
            const ctx = base();
            assert.doesNotThrow(() => slot.apply(ctx, mode, 3, { penKey: 'test rule' }),
                `slot ${name} threw in mode ${mode}`);
        }
    }
    // and the specific semantics that matter
    const pen = base();
    SLOT_DEFS.pen.apply(pen, '+=', 4, { penKey: 'razor sharp' });
    SLOT_DEFS.pen.apply(pen, '+=', 2, { penKey: 'razor sharp' });
    assert.equal(pen.penModifiers['razor sharp'], 6, '+= accumulates under the rule-named slot');
    SLOT_DEFS.pen.apply(pen, '+=', 1, {});
    assert.equal(pen.penModifiers.penetration, 1, 'no penKey ⇒ the generic "penetration" slot');
    SLOT_DEFS.pen.apply(pen, '=', 9, { penKey: 'x' });
    assert.equal(pen.pen, 9, '= overwrites the base');

    const sc = base();
    SLOT_DEFS.scatter.apply(sc, '=', 5, {});
    assert.deepEqual(sc.scatter, { active: true, base: 5 });
    SLOT_DEFS.scatter.apply(sc, '+=', 2, { penKey: 'inaccurate' });
    SLOT_DEFS.scatter.apply(sc, '+=', 1, {});
    assert.deepEqual(sc.scatterModifiers, { inaccurate: 2, scatter: 1 });

    const misc = base();
    SLOT_DEFS.rf_threshold.apply(misc, '=', 9);
    SLOT_DEFS.jam_threshold.apply(misc, '=', 100);
    SLOT_DEFS.damage_type.apply(misc, '=', 'Holy');
    SLOT_DEFS.extra_dice.apply(misc, '+=', 1);
    SLOT_DEFS.extra_dice.apply(misc, '+=', 2);
    SLOT_DEFS.extra_hits.apply(misc, '+=', 3);
    SLOT_DEFS.unnatural_toughness_reduction.apply(misc, '+=', 2);
    SLOT_DEFS.unnatural_toughness_reduction.apply(misc, '+=', 1);
    assert.equal(misc.rfThreshold, 9);
    assert.equal(misc.jamThreshold, 100);
    assert.equal(misc.damageType, 'Holy');
    assert.equal(misc.extraDice, 3);
    assert.equal(misc.additionalHits, 3);
    assert.equal(misc.unnaturalToughnessReduction, 3);
});

test('vocabulary: EVERY flag applies to the engine knob it documents', () => {
    for (const [name, flag] of Object.entries(FLAG_DEFS)) {
        assert.ok(flag.at && flag.summary, `flag ${name} is under-declared`);
    }
    const ctx = { parsed: { count: 2 }, success: true };
    FLAG_DEFS.no_parry.apply(ctx);
    FLAG_DEFS.cannot_parry.apply(ctx);
    FLAG_DEFS.detonate.apply(ctx);
    FLAG_DEFS.attack_failed.apply(ctx);
    FLAG_DEFS.keep_highest.apply(ctx);
    assert.equal(ctx.preventParry, true);
    assert.equal(ctx.cannotParry, true);
    assert.equal(ctx.detonate, true);
    assert.equal(ctx.success, false, 'attack_failed cancels the attack');
    assert.equal(ctx.keepHighest, 2, 'keep_highest keeps the ORIGINAL die count');
    assert.equal(ctx.tearing, true);
});

test('vocabulary: the derived doc lists mirror the definitions exactly', () => {
    assert.deepEqual(SLOT_DOCS.map((s) => s.name), Object.keys(SLOT_DEFS));
    assert.deepEqual(FLAG_DOCS.map((f) => f.name), Object.keys(FLAG_DEFS));
    assert.deepEqual(FACT_DOCS.map((d) => d.name), FACT_DEFS.filter((d) => d.scopes.attacker).map((d) => d.name));
    assert.deepEqual(FUNCTION_DOCS.map((d) => d.name), FUNCTION_DEFS.filter((d) => d.scopes.attacker).map((d) => d.name));
    assert.deepEqual(SCOPED_ONLY_DOCS.map((d) => d.name).sort(), ['armour', 'present', 'unnatural_toughness']);
    for (const d of SCOPED_ONLY_DOCS) {
        assert.ok(!d.scopes.includes('attacker'), `${d.name} is listed as scope-only but has an attacker getter`);
    }
    // every scope named by a doc entry really backs that name
    for (const d of [...FACT_DOCS, ...SCOPED_ONLY_DOCS]) {
        for (const s of d.scopes) assert.equal(typeof SCOPED_FACTS[s][d.name], 'function', `${s}.${d.name}`);
    }
    for (const d of FUNCTION_DOCS) {
        for (const s of d.scopes) assert.equal(typeof SCOPED_FUNCTIONS[s][d.name], 'function', `${s}.${d.name}()`);
        assert.ok(d.signature.startsWith(`${d.name}(`), `signature/name mismatch for ${d.name}`);
    }
});

test('vocabulary: dsl 3 removed the legacy prefixed aliases entirely', () => {
    // The alias tables are the seam that used to expose target_sb / opposing_*.
    // They are empty by design in dsl 3 — the scoped paths are the only spelling.
    assert.deepEqual(FACT_ALIASES, {});
    assert.deepEqual(FUNCTION_ALIASES, {});
    assert.ok(!('target_sb' in FACTS), 'target_sb must be gone');
    assert.ok(!('opposing_has_quality' in FUNCTIONS), 'opposing_has_quality must be gone');
    // and the compiler rejects the old spellings outright
    throwsDsl(() => compile('quality "X" { on MODIFIERS when target_sb > 3 then flag no_parry }'), {
        message: /^Unknown fact 'target_sb' in rule "X"$/,
    });
});

// =============================================================================
// END-TO-END: a malformed rule never reaches the engine half-built
// =============================================================================

test('a rule that fails semantic validation contributes NO effects at all', () => {
    const good = 'quality "Good" { on MODIFIERS then add modifier "g" = 1 }';
    const bad = 'quality "Bad" { on MODIFIERS then set wibble = 1 }';
    // the good rule alone compiles
    assert.equal(compile(good).length, 1);
    // concatenated, the whole compile fails — no partial registry
    throwsDsl(() => compile(`${good}\n${bad}`), { message: /^Unknown slot 'wibble'/ });
    throwsDsl(() => compile(`${bad}\n${good}`), { message: /^Unknown slot 'wibble'/ });
});

test('CHARACTERIZATION: the DSL performs no call-arity checking', () => {
    // Neither the parser nor the compiler validates the number of arguments a
    // vocabulary function receives, so an under-supplied call compiles clean and
    // fails only at runtime — silently. See the coverage report notes: with a
    // missing `default` argument, `quality_level("Nope")` returns undefined and
    // `set pen += …` then writes NaN into penModifiers, which is invisible until
    // the damage total comes out wrong.
    //
    // This test pins the CURRENT behaviour (compiles without complaint) so the
    // gap is visible; it deliberately does not assert the NaN, so adding arity
    // validation later would fail here loudly rather than silently pass.
    assert.equal(compile('quality "X" { on MODIFIERS when has_quality() then add modifier "m" = 1 }').length, 1);
    assert.equal(compile('quality "Razor Sharp" { on PENETRATION then set pen += quality_level("Nope") }').length, 1);
    assert.equal(compile('quality "Y" { on MODIFIERS then add modifier "m" = tens(1, 2, 3, 4) }').length, 1);
});

test('error positions survive a realistic multi-rule file', () => {
    // The failure is on line 12 of a file whose earlier rules parse cleanly —
    // exactly the case a broken line counter would misreport.
    const src = [
        'dsl 3',                                                     // 1
        'package "dh2.test" { system "dh2" }',                       // 2
        '',                                                          // 3
        '# a perfectly good rule',                                   // 4
        'quality "Tearing" {',                                       // 5
        '  meta { page 150 }',                                       // 6
        '  on DAMAGE_POOL',                                          // 7
        '  when has_quality("Tearing")',                             // 8
        '  then set extra_dice += 1; flag keep_highest',             // 9
        '}',                                                         // 10
        '',                                                          // 11
        'quality "Broken" {',                                        // 12
        '  on DAMAGE_POOL',                                          // 13
        '  when has_quality("Broken")',                              // 14
        '  then set extra_dice += @',                                // 15
        '}',                                                         // 16
    ].join('\n');
    // the tokenizer catches the stray character at its true position
    throwsDsl(() => parse(src), { message: /^Unexpected character '@'$/, line: 15, col: 26 });

    // and a SEMANTIC failure is attributed to the offending rule's header line
    const semantic = src.replace('set extra_dice += @', 'set extra_dice += mystery_fact');
    throwsDsl(() => compile(semantic), { message: /^Unknown fact 'mystery_fact' in rule "Broken"$/, line: 12, col: 1 });
});
