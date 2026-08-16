/**
 * DSL call-arity validation — node --test.
 *
 * Finding D-2 (docs/DH2_ROLL_API_FINDINGS_2026-07-30.md): the DSL used to accept
 * ANY number of arguments to a vocabulary function. An under-supplied call
 * compiled clean and produced `undefined` at runtime, which `set pen += …` then
 * wrote into the context as `NaN` — silent corruption of the one language all
 * game content is written in.
 *
 * The contract these tests pin:
 *   - every call's argument count is checked at COMPILE time, against the
 *     `params` declared on the function's entry in vocabulary.mjs FUNCTION_DEFS;
 *   - the failure is a positioned DslError, like every other semantic error;
 *   - an argument is optional ONLY where the implementation defines a value for
 *     the omitted case, and those calls keep working;
 *   - all shipped `api/data/rules/*.dsl` content still compiles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { compile, compileRule, compileTables, compileActions } from '../lib/dsl/compiler.mjs';
import { DslError } from '../lib/dsl/tokenizer.mjs';
import { FUNCTION_DEFS, SCOPED_FUNCTIONS } from '../lib/dsl/vocabulary.mjs';
import { FUNCTIONS } from '../lib/dsl/interpreter.mjs';
import { ruleSources } from '../lib/rules/sources.mjs';
// Namespace import so a missing export is an assertion failure in one test
// rather than a link error that takes the whole file down.
import * as VOCAB from '../lib/dsl/vocabulary.mjs';

/** Same discipline as dsl-coverage.test.mjs: raw message AND source position. */
const throwsDsl = (fn, { message, line, col } = {}) => {
    assert.throws(fn, (e) => {
        assert.ok(e instanceof DslError, `expected a DslError, got ${e && e.name}: ${e && e.message}`);
        if (message) assert.match(e.rawMessage, message);
        if (line !== undefined) assert.equal(e.line, line, `wrong LINE reported for: ${e.message}`);
        if (col !== undefined) assert.equal(e.col, col, `wrong COL reported for: ${e.message}`);
        assert.equal(e.message, `${e.rawMessage} (line ${e.line}, col ${e.col})`);
        return true;
    });
};

/** A one-line rule whose `when` is the expression under test. */
const whenRule = (expr) => `quality "X" { on MODIFIERS when ${expr} then flag no_parry }`;
/** A one-line rule whose action VALUE is the expression under test. */
const valueRule = (expr) => `quality "X" { on MODIFIERS then add modifier "m" = ${expr} }`;

/** A literal for one declared parameter — strings quoted, values bare. */
const argFor = (p) => (p.kind === 'string' ? '"Proven"' : '1');

// =============================================================================
// 1. TOO FEW / TOO MANY / ZERO
// =============================================================================

test('arity: a call missing a REQUIRED argument is rejected at compile time', () => {
    // The exact case from the finding: the omitted `default` used to make
    // quality_level return undefined and `set pen += …` write NaN.
    throwsDsl(() => compile('quality "Razor Sharp" { on PENETRATION then set pen += quality_level("Nope") }'), {
        message: /^Function 'quality_level\(\)' expects 2 arguments, got 1 in rule "Razor Sharp"/,
        line: 1, col: 1,
    });
    throwsDsl(() => compile(valueRule('trait_level("Brutal Charge")')), {
        message: /^Function 'trait_level\(\)' expects 2 arguments, got 1 in rule "X"/,
    });
});

test('arity: zero arguments to a function that requires one is rejected', () => {
    // has_quality() used to evaluate to false silently — it matched the literal
    // string "undefined".
    throwsDsl(() => compile(whenRule('has_quality()')), {
        message: /^Function 'has_quality\(\)' expects 1 argument, got 0 in rule "X"/,
    });
    throwsDsl(() => compile(whenRule('has_talent()')), {
        message: /^Function 'has_talent\(\)' expects 1 argument, got 0 in rule "X"/,
    });
    throwsDsl(() => compile(valueRule('half()')), {
        message: /^Function 'half\(\)' expects 1 argument, got 0 in rule "X"/,
    });
});

test('arity: surplus arguments are rejected', () => {
    throwsDsl(() => compile(valueRule('tens(1, 2, 3, 4)')), {
        message: /^Function 'tens\(\)' expects 1 argument, got 4 in rule "X"/,
    });
    throwsDsl(() => compile(whenRule('has_quality("Proven", "Tearing")')), {
        message: /^Function 'has_quality\(\)' expects 1 argument, got 2 in rule "X"/,
    });
    throwsDsl(() => compile(valueRule('quality_level("Proven", 1, 2)')), {
        message: /^Function 'quality_level\(\)' expects 2 arguments, got 3 in rule "X"/,
    });
    // a zero-argument function given an argument
    throwsDsl(() => compile(whenRule('is_reaction(1)')), {
        message: /^Function 'is_reaction\(\)' expects 0 arguments, got 1 in rule "X"/,
    });
    // …and an optional-argument function given a third
    throwsDsl(() => compile(valueRule('condition_severity("On Fire", 0, 1)')), {
        message: /^Function 'condition_severity\(\)' expects 1 or 2 arguments, got 3 in rule "X"/,
    });
});

test('arity: the error names the signature so an author can fix it', () => {
    assert.throws(() => compile(valueRule('quality_level("Proven")')), (e) => {
        assert.match(e.rawMessage, /\(signature: quality_level\("Name", default\)\)$/);
        return true;
    });
});

// =============================================================================
// 2. VALID CALLS STILL COMPILE
// =============================================================================

test('arity: correct calls compile unchanged', () => {
    const ok = [
        whenRule('has_quality("Proven")'),
        whenRule('has_talent("Ambidextrous")'),
        whenRule('has_trait("Daemonic")'),
        whenRule('has_condition("On Fire")'),
        whenRule('has_circumstance("Darkness")'),
        whenRule('configuration("Maximal")'),
        whenRule('is_action("Parry")'),
        whenRule('is_test("Tech-Use")'),
        whenRule('is_reaction()'),
        whenRule('action_subtype("attack")'),
        whenRule('is_natural(10)'),
        valueRule('quality_level("Proven", 1)'),
        valueRule('trait_level("Brutal Charge", 0)'),
        valueRule('circumstance_severity("Haywire Field", 0)'),
        valueRule('condition_severity("Crippled", 0)'),
        valueRule('condition_duration("On Fire", 1)'),
        valueRule('condition_location("Crippled")'),
        valueRule('tens(45)'),
        valueRule('ceil(3)'),
        valueRule('floor(3)'),
        valueRule('half(3)'),
        // nested, and mixed with arithmetic
        valueRule('half(quality_level("Proven", 1) + tens(45))'),
    ];
    for (const src of ok) assert.equal(compile(src).length, 1, src);
});

test('arity: every function in FUNCTION_DEFS is reachable with a valid call', () => {
    assert.ok(FUNCTION_DEFS.length > 0);
    for (const def of FUNCTION_DEFS) {
        assert.ok(Array.isArray(def.params), `${def.name} declares no params[]`);
        const required = def.params.filter((p) => !p.optional);
        // minimum form
        const min = `${def.name}(${required.map(argFor).join(', ')})`;
        // maximum form
        const max = `${def.name}(${def.params.map(argFor).join(', ')})`;
        for (const call of new Set([min, max])) {
            const src = def.scopes.attacker ? valueRule(call) : null;
            if (src) assert.equal(compile(src).length, 1, src);
            // and through every scope that backs it
            for (const scope of Object.keys(def.scopes)) {
                if (scope === 'attacker') continue;
                assert.equal(compile(valueRule(`${scope}.${call}`)).length, 1, `${scope}.${call}`);
            }
        }
        // one MORE than the maximum is always an error
        const over = `${def.name}(${[...def.params, { kind: 'value' }].map(argFor).join(', ')})`;
        throwsDsl(() => compile(valueRule(def.scopes.attacker ? over : `${Object.keys(def.scopes)[0]}.${over}`)), {
            message: new RegExp(`^Function '${def.name}\\(\\)' expects `),
        });
    }
});

// =============================================================================
// 3. OPTIONAL ARGUMENTS ARE GENUINELY OPTIONAL
// =============================================================================

test('arity: an optional argument may be omitted, and the call still works', () => {
    // `default` is optional exactly where the implementation defines the omitted
    // case (num(undefined) === 0) — condition_severity/_duration and
    // circumstance_severity. It is REQUIRED for quality_level/trait_level, whose
    // implementation propagates undefined (the D-2 NaN path).
    const optional = FUNCTION_DEFS.filter((d) => d.params.some((p) => p.optional)).map((d) => d.name);
    assert.deepEqual(optional.sort(), ['circumstance_severity', 'condition_duration', 'condition_severity']);

    const ctx = {
        modifiers: {},
        statuses: [{ name: 'On Fire', severity: 3, duration: 2 }],
        circumstances: [{ name: 'Haywire Field', severity: 4 }],
    };
    const run = (expr) => {
        const [eff] = compile(valueRule(expr));
        eff.apply(ctx);
        return ctx.modifiers.m;
    };
    // present → the structured value; absent → 0, not undefined/NaN
    assert.equal(run('condition_severity("On Fire")'), 3);
    assert.equal(run('condition_duration("On Fire")'), 2);
    assert.equal(run('circumstance_severity("Haywire Field")'), 4);
    assert.equal(run('condition_severity("Nope")'), 0);
    assert.equal(run('circumstance_severity("Nope")'), 0);
    // the explicit-default form is unchanged
    assert.equal(run('condition_severity("Nope", 7)'), 7);
});

// =============================================================================
// 4. WHERE THE CHECK REACHES
// =============================================================================

test('arity: scoped calls are checked with the same signature', () => {
    throwsDsl(() => compile(whenRule('target.trait_level("Daemonic")')), {
        message: /^Function 'trait_level\(\)' expects 2 arguments, got 1 in rule "X"/,
    });
    throwsDsl(() => compile(whenRule('opposing_weapon.has_quality()')), {
        message: /^Function 'has_quality\(\)' expects 1 argument, got 0 in rule "X"/,
    });
    // the correct scoped forms compile
    assert.equal(compile(whenRule('target.trait_level("Daemonic", 0) > 0')).length, 1);
    assert.equal(compile(whenRule('opposing_weapon.has_quality("Force")')).length, 1);
});

test('arity: the check reaches calls nested inside arguments and inside every clause', () => {
    // nested in another call's argument list
    throwsDsl(() => compile(valueRule('half(quality_level("Proven"))')), {
        message: /^Function 'quality_level\(\)' expects 2 arguments, got 1/,
    });
    // inside a `when` condition
    throwsDsl(() => compile(whenRule('quality_level("Proven") > 1')), {
        message: /^Function 'quality_level\(\)' expects 2 arguments, got 1/,
    });
    // in a LATER branch of a multi-branch rule (the first branch is fine)
    throwsDsl(() => compile([
        'quality "X" {',
        '  on MODIFIERS',
        '  when has_quality("Proven") then add modifier "a" = 1',
        '  when has_quality("Tearing") then add modifier "b" = tens()',
        '}',
    ].join('\n')), { message: /^Function 'tens\(\)' expects 1 argument, got 0/, line: 1, col: 1 });
    // in a structured action's sub-expression (apply_status value)
    throwsDsl(() => compile('quality "X" { on ON_HIT then apply_status "Crippled" value quality_level("Crippling") }'), {
        message: /^Function 'quality_level\(\)' expects 2 arguments, got 1/,
    });
});

test('arity: the check reaches the action fields that are not called `value`', () => {
    // Shipped content puts calls in `declare smoke <radius>`, `roll_on … area`
    // and the apply_status/require_test riders (weapon-qualities.dsl: Smoke,
    // Haywire, Hallucinogenic). Only `a.value` used to be walked at all, so
    // NOTHING in these fields was validated — not arity, not even the name.
    const cases = [
        ['quality "X" { on ON_HIT then declare smoke quality_level("Smoke") duration 1d10 }', /quality_level/],
        ['quality "X" { on ON_HIT then declare smoke 3 duration condition_duration("On Fire", 1, 2) }', /condition_duration/],
        ['quality "X" { on ON_MISS then roll_on "Scatter Diagram" area tens() }', /tens/],
        ['quality "X" { on ON_HIT then apply_status "Crippled" duration condition_duration() location condition_location("Crippled") }', /condition_duration/],
        ['quality "X" { on ON_HIT then apply_status "Crippled" location condition_location() }', /condition_location/],
        ['quality "X" { on ON_HIT then require_test "Toughness" 0 "burn" => damage quality_level("Toxic") }', /quality_level/],
        ['quality "X" { on ON_HIT then require_test "Toughness" 0 "burn" => apply_status "On Fire" duration quality_level("Flame") }', /quality_level/],
    ];
    for (const [src, fn] of cases) {
        throwsDsl(() => compile(src), { message: new RegExp(`^Function '${fn.source}\\(\\)' expects `) });
    }
    // the well-formed spellings of the same shapes compile
    assert.equal(compile('quality "X" { on ON_HIT then declare smoke quality_level("Smoke", 1) duration 1d10 + 10 }').length, 1);
    assert.equal(compile('quality "X" { on ON_MISS then roll_on "Scatter Diagram" area quality_level("Haywire", 1) }').length, 1);
    assert.equal(compile('quality "X" { on ON_HIT then require_test "Toughness" 0 "burn" => apply_status "On Fire" duration quality_level("Flame", 1) }').length, 1);
});

test('arity: an UNKNOWN function still reports as unknown, not as an arity error', () => {
    throwsDsl(() => compile(valueRule('exec("rm")')), {
        message: /^Unknown function 'exec\(\)' in rule "X"$/,
    });
    throwsDsl(() => compile(whenRule('wielder.has_trait("X")')), {
        message: /^Unknown scope 'wielder' in rule "X"/,
    });
});

test('arity: a rule that fails the arity check contributes NO effects at all', () => {
    const good = 'quality "Good" { on MODIFIERS then add modifier "g" = 1 }';
    const bad = 'quality "Bad" { on MODIFIERS then add modifier "b" = tens() }';
    assert.equal(compile(good).length, 1);
    throwsDsl(() => compile(`${good}\n${bad}`), { message: /^Function 'tens\(\)' expects 1 argument, got 0/ });
    throwsDsl(() => compile(`${bad}\n${good}`), { message: /^Function 'tens\(\)' expects 1 argument, got 0/ });
});

test('arity: the error carries the offending RULE position in a multi-rule file', () => {
    const src = [
        'dsl 3',                                                        // 1
        'package "p" { system "dh2" }',                                 // 2
        '',                                                             // 3
        'quality "Fine" {',                                             // 4
        '  on MODIFIERS',                                               // 5
        '  when has_quality("Proven") then add modifier "a" = 1',        // 6
        '}',                                                            // 7
        '',                                                             // 8
        'quality "Broken" {',                                           // 9
        '  on PENETRATION',                                             // 10
        '  then set pen += quality_level("Razor Sharp")',               // 11
        '}',                                                            // 12
    ].join('\n');
    throwsDsl(() => compile(src), {
        message: /^Function 'quality_level\(\)' expects 2 arguments, got 1 in rule "Broken"/,
        line: 9, col: 1,
    });
});

test('arity: a hand-built AST is checked too', () => {
    const rule = {
        type: 'Rule', kind: 'quality', name: 'Handmade', on: 'MODIFIERS',
        tier: null, priority: null, meta: null, replaces: null, line: 7, col: 3,
        branches: [{ when: null, actions: [{ action: 'add_modifier', name: 'm', value: { type: 'Call', name: 'tens', args: [] } }] }],
    };
    throwsDsl(() => compileRule(rule), {
        message: /^Function 'tens\(\)' expects 1 argument, got 0 in rule "Handmade"/, line: 7, col: 3,
    });
});

// =============================================================================
// 5. THE ARITY DATA ITSELF
// =============================================================================

test('arity data: FUNCTION_ARITY is derived from FUNCTION_DEFS params and covers every function', () => {
    assert.ok(VOCAB.FUNCTION_ARITY, 'vocabulary.mjs must export FUNCTION_ARITY');
    // exactly the whitelisted functions (unscoped + every scoped-only one)
    const scoped = new Set(Object.values(SCOPED_FUNCTIONS).flatMap((s) => Object.keys(s)));
    assert.deepEqual(Object.keys(VOCAB.FUNCTION_ARITY).sort(), FUNCTION_DEFS.map((d) => d.name).sort());
    for (const name of [...Object.keys(FUNCTIONS), ...scoped]) {
        assert.ok(VOCAB.FUNCTION_ARITY[name], `no arity declared for ${name}()`);
    }
    for (const def of FUNCTION_DEFS) {
        const { min, max } = VOCAB.FUNCTION_ARITY[def.name];
        assert.equal(min, def.params.filter((p) => !p.optional).length, `${def.name} min`);
        assert.equal(max, def.params.length, `${def.name} max`);
        assert.ok(min <= max, `${def.name} min <= max`);
        // no required parameter may follow an optional one
        const firstOptional = def.params.findIndex((p) => p.optional);
        if (firstOptional >= 0) {
            assert.ok(def.params.slice(firstOptional).every((p) => p.optional),
                `${def.name}: a required parameter follows an optional one`);
        }
    }
});

test('arity data: the documented signature is DERIVED from the params, so it cannot drift', () => {
    for (const def of FUNCTION_DEFS) {
        const rendered = def.params.map((p) => (p.kind === 'string' ? `"${p.name}"` : p.name));
        const required = rendered.slice(0, def.params.filter((p) => !p.optional).length).join(', ');
        const optional = rendered.slice(def.params.filter((p) => !p.optional).length);
        const expected = `${def.name}(${required}${optional.length ? `[, ${optional.join(', ')}]` : ''})`;
        assert.equal(def.signature, expected, `signature for ${def.name}`);
    }
});

// =============================================================================
// 6. THE SHIPPED CONTENT GATE
// =============================================================================

test('arity: every shipped rule file still compiles', () => {
    // api/data/rules/*.dsl is real game content: if arity validation rejects any
    // of it, either the content or the arity data is wrong. Neither may ship.
    const names = Object.keys(ruleSources);
    assert.ok(names.length >= 9, 'expected the nine built-in rule files');
    let effects = 0;
    for (const [file, src] of Object.entries(ruleSources)) {
        assert.doesNotThrow(() => { effects += compile(src).length; }, `${file} rules must still compile`);
        assert.doesNotThrow(() => compileTables(src), `${file} tables must still compile`);
        assert.doesNotThrow(() => compileActions(src), `${file} actions must still compile`);
    }
    // a sanity floor, so a silently-emptied source set cannot pass this gate
    // (142 effects at the time of writing)
    assert.ok(effects > 100, `expected the full built-in effect set, got ${effects}`);
});
