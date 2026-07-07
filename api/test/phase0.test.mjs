/**
 * Phase 0 (ROADMAP.md): Stage 0 — `dsl` pragma, `package` headers, rule `meta`
 * provenance; Stage 1 — canonical { name, level } for qualities/talents/traits
 * at the API boundary. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/dsl/parser.mjs';
import { compile, programInfo } from '../lib/dsl/compiler.mjs';
import { canonEntry, canonList, hasQuality, qualityLevel } from '../lib/rules/_util.mjs';
import { builtinSources, builtinRules, buildRegistry } from '../lib/rules/index.mjs';
import { resolveAttack } from '../lib/engine.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const SRC = `
dsl 2
package "test.pkg" {
  system "dh2"
  source "Test Book"
  requires "core.combat"
}

quality "Metered" {
  meta { page 145 ref "see also p.230" }
  on MODIFIERS
  when has_quality("Metered")
  then add modifier "m" = 10
}

quality "Bare" {
  on MODIFIERS
  when has_quality("Bare")
  then add modifier "b" = 5
}
`;

// --- Stage 0: pragma + package + meta ----------------------------------------
test('parser: dsl pragma, package header, and rule meta are captured', () => {
    const program = parse(SRC);
    assert.equal(program.dslVersion, 2);
    assert.equal(program.package.name, 'test.pkg');
    assert.equal(program.package.system, 'dh2');
    assert.equal(program.package.source, 'Test Book');
    assert.deepEqual(program.package.requires, ['core.combat']);
    assert.equal(program.rules[0].meta.page, 145);
    assert.equal(program.rules[0].meta.ref, 'see also p.230');
    assert.equal(program.rules[1].meta, null);
});

test('programInfo defaults: a header-less v1 file is dsl 1, no package', () => {
    const info = programInfo('quality "X" { on MODIFIERS when has_quality("X") then add modifier "x" = 1 }');
    assert.equal(info.dslVersion, 1);
    assert.equal(info.package, null);
});

test('compile attaches provenance (page, package, system, sourceBook, qualifiedId)', () => {
    const effects = compile(SRC);
    const metered = effects.find((e) => e.name === 'Metered');
    assert.equal(metered.page, 145);
    assert.equal(metered.package, 'test.pkg');
    assert.equal(metered.system, 'dh2');
    assert.equal(metered.sourceBook, 'Test Book');           // from the package header
    assert.equal(metered.qualifiedId, 'test.pkg/metered');
    const bare = effects.find((e) => e.name === 'Bare');
    assert.equal(bare.page, null);                            // no rule meta
    assert.equal(bare.sourceBook, 'Test Book');               // still inherits the package source
});

test('rule meta { source } overrides the package source book', () => {
    const eff = compile(`
        package "p" { system "dh2" source "Core" }
        quality "Q" { meta { page 9 source "Errata" } on MODIFIERS when has_quality("Q") then add modifier "q" = 1 }
    `)[0];
    assert.equal(eff.sourceBook, 'Errata');
});

test('every built-in file declares dsl 2 and a dh2.core.* package', () => {
    assert.equal(builtinSources.length, 9);
    for (const b of builtinSources) {
        assert.equal(b.dslVersion, 2, `${b.file} should declare dsl 2`);
        assert.ok(b.package?.name?.startsWith('dh2.core.'), `${b.file} should have a dh2.core.* package`);
        assert.equal(b.package.system, 'dh2');
        assert.ok(b.package.source, `${b.file} should name a source book`);
    }
});

test('builtinRules carry provenance (Corrosive → p.145, dh2.core.weapon-qualities)', () => {
    const corrosive = builtinRules.find((r) => r.id === 'corrosive');
    assert.equal(corrosive.page, 145);
    assert.equal(corrosive.package, 'dh2.core.weapon-qualities');
    assert.equal(corrosive.system, 'dh2');
    assert.equal(corrosive.qualifiedId, 'dh2.core.weapon-qualities/corrosive');
});

// --- Stage 1: canonical { name, level } ---------------------------------------
test('canonEntry parses "Name (X)" / "Name X" and passes objects through', () => {
    assert.deepEqual(canonEntry('Proven (3)'), { name: 'Proven', level: 3 });
    assert.deepEqual(canonEntry('Vengeful 9'), { name: 'Vengeful', level: 9 });
    assert.deepEqual(canonEntry('Tearing'), { name: 'Tearing', level: null });
    assert.deepEqual(canonEntry({ name: 'Blast', level: 5 }), { name: 'Blast', level: 5 });
});

test('hasQuality / qualityLevel accept both strings and { name, level }', () => {
    for (const list of [['Proven (3)', 'Tearing'], [{ name: 'Proven', level: 3 }, { name: 'Tearing', level: null }]]) {
        assert.equal(hasQuality(list, 'Proven'), true);
        assert.equal(hasQuality(list, 'Blast'), false);
        assert.equal(qualityLevel(list, 'Proven', 0), 3);
        assert.equal(qualityLevel(list, 'Tearing', 7), 7);   // unlevelled → fallback
    }
});

test('object qualities behave identically to string qualities in a full attack', () => {
    const attack = (qualities) => resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 },
        weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities },
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(1, 10)]), buildRegistry());
    const str = attack(['Proven (3)']);
    const obj = attack([{ name: 'Proven', level: 3 }]);
    assert.equal(str.hits[0].damage.dice.adjusted[0], 3);    // Proven floors the 1 → 3
    assert.deepEqual(obj.hits[0].damage.dice.adjusted, str.hits[0].damage.dice.adjusted);
    assert.equal(obj.hits[0].damage.total, str.hits[0].damage.total);
});

test('bump_quality / add_quality produce canonical { name, level } entries', () => {
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 },
        weapon: { name: 'Plasma', isMelee: false, damage: '1d10', pen: 2, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Maximal', 'Blast (1)'] },
        action: 'Standard Attack', configs: ['Maximal'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10), die(5, 10)]), buildRegistry());
    // the bump is reported with the same text as before (no stringly round-trip)
    assert.ok(r.effects.some((e) => e.name === 'Blast ↑' && /Blast \(1\) → \(3\)/.test(e.effect)));
    // Recharge was granted dynamically and its POST_ROLL note fired
    assert.ok(r.effects.some((e) => e.name === 'Recharge'));
});
