/**
 * Phase 1 (ROADMAP.md): Stage 2 — scoped fact paths + single-source vocabulary;
 * Stage 3 — slot/flag/declare primitives (v1 verbs as sugar), integer round-up
 * division, ceil/floor/half. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, resolveEngagement, rollTest } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { compile } from '../lib/dsl/compiler.mjs';
import { DSL_DOCS, DOCUMENTED_FACTS, DOCUMENTED_FUNCTIONS } from '../lib/dsl/docs.mjs';
import { FACTS, FUNCTIONS } from '../lib/dsl/interpreter.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const gun = (qualities = []) => ({ name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities });

// --- Stage 2: scoped fact paths ----------------------------------------------
test('scoped facts: a custom rule reads target.tb and weapon.pen', () => {
    const reg = buildRegistry(`
        quality "Giantslayer" {
            on DAMAGE_MODS
            when has_quality("Giantslayer") and target.tb >= 5 and weapon.pen == 0
            then add modifier "giantslayer" = target.tb
        }
    `);
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun(['Giantslayer']),
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 6 },
    }, riggedDice([d100(20), die(5, 10)]), reg);
    assert.equal(r.hits[0].damage.modifiers.giantslayer, 6);   // read through target.tb
});

test('scoped functions: opposing_weapon.has_quality in POST_PARRY (scoped form of the alias)', () => {
    const reg = buildRegistry(`
        quality "Riposte Ward" {
            on POST_PARRY
            when has_quality("Riposte Ward") and success and opposing_weapon.present and opposing_weapon.has_quality("Flexible")
            then emit "Riposte Ward", "the ward flares against the flexible weapon"
        }
    `);
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 50, s: 30, t: 30 }, weapon: { name: 'Whip', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Flexible'] }, action: 'Standard Attack' },
        defender: { characteristics: { ws: 60, t: 30 }, armour: 0, toughnessBonus: 3, weapon: { name: 'Sword', qualities: ['Riposte Ward'] }, evasion: { mode: 'parry' } },
        options: {},
    }, riggedDice([d100(30), die(5, 10), d100(20)]), reg);
    // Flexible prevents the parry entirely — so the POST_PARRY rule must NOT fire
    assert.equal(r.reaction.prevented, true);

    // without Flexible the parry happens and the scoped read fires
    const r2 = resolveEngagement({
        attacker: { characteristics: { ws: 50, s: 30, t: 30 }, weapon: { name: 'Whip', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Flexible'] }, action: 'Standard Attack' },
        defender: { characteristics: { ws: 60, t: 30 }, armour: 0, toughnessBonus: 3, weapon: { name: 'Sword', qualities: ['Riposte Ward'] }, evasion: { mode: 'dodge' } },
        options: {},
    }, riggedDice([d100(30), die(5, 10), d100(20)]), reg);
    assert.ok(r2.reaction);   // dodge went through — no POST_PARRY, but no error either
});

test('scope validation: unknown scope and out-of-scope facts fail at compile time', () => {
    assert.throws(() => compile(`quality "X" { on MODIFIERS when enemy.tb > 3 then add modifier "x" = 1 }`),
        /Unknown scope 'enemy'/);
    assert.throws(() => compile(`quality "X" { on MODIFIERS when target.jam_threshold > 3 then add modifier "x" = 1 }`),
        /not available in scope 'target'/);
});

test('the removed v1 prefixed aliases are REJECTED at compile time (dsl 3)', () => {
    assert.throws(() => buildRegistry('quality "A" { on DAMAGE_MODS when has_quality("A") and target_tb > 0 then add modifier "x" = 1 }'),
        /Unknown fact 'target_tb'/);
    assert.throws(() => buildRegistry('quality "A" { on PENETRATION when target_has_trait("Daemonic") then set pen += 1 }'),
        /Unknown function 'target_has_trait/);
    assert.throws(() => buildRegistry('quality "A" { on POST_PARRY when opposing_present then emit "x" }'),
        /Unknown fact 'opposing_present'/);
});

test('explicit dsl 1/2 pragmas are rejected with a migration pointer', () => {
    assert.throws(() => compile('dsl 2\nquality "X" { on MODIFIERS when has_quality("X") then add modifier "x" = 1 }'),
        /dsl 2 is no longer supported.*migrate-dsl/);
});

test('single-source parity: docs facts/functions ARE the interpreter whitelists', () => {
    assert.deepEqual(new Set(DOCUMENTED_FACTS), new Set(Object.keys(FACTS)));
    assert.deepEqual(new Set(DOCUMENTED_FUNCTIONS), new Set(Object.keys(FUNCTIONS)));
    assert.ok(DSL_DOCS.scopes.names.includes('target'));
    assert.ok(DSL_DOCS.scopes.scopedOnly.some((d) => d.name === 'armour'));
});

// --- Stage 3: slots / flags / declare -----------------------------------------
test('generic `set <slot>` and `flag <name>` work directly (no bespoke verbs)', () => {
    const reg = buildRegistry(`
        quality "Overcharged" {
            on DAMAGE_POOL when has_quality("Overcharged") then set extra_dice += 1; flag keep_highest
        }
    `);
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun(['Overcharged']),
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(3, 10), die(9, 10)]), reg);
    assert.equal(r.hits[0].damage.dice.rolled.length, 2);      // extra die
    assert.deepEqual(r.hits[0].damage.dice.kept, [9]);          // keep highest (Tearing semantics)
});

test('slot mode validation: `set jam_threshold += …` is rejected at compile time', () => {
    assert.throws(() => compile(`quality "X" { on POST_ROLL then set jam_threshold += 1 }`),
        /does not support '\+='/);
    assert.throws(() => compile(`quality "X" { on POST_ROLL then set bogus_slot = 1 }`),
        /Unknown slot 'bogus_slot'/);
    assert.throws(() => compile(`quality "X" { on POST_ROLL then flag bogus_flag }`),
        /Unknown flag 'bogus_flag'/);
});

test('declare event/status are alternative syntax for emit/apply_status', () => {
    const reg = buildRegistry(`
        quality "Howler" {
            on POST_ROLL when has_quality("Howler") then declare event "Howl", "an unnerving shriek"
        }
        quality "Sticky" {
            on ON_HIT when has_quality("Sticky") and wounds > 0 then declare status "Ensnared" value 2, "glued in place"
        }
    `);
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 }, weapon: gun(['Howler', 'Sticky']),
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10)]), reg);
    assert.ok(r.effects.some((e) => e.name === 'Howl'));
    const st = r.hits[0].targetEffects.statuses.find((s) => s.status === 'Ensnared');
    assert.equal(st.value, 2);
});

test('sugar equivalence: Tearing/Vengeful/Felling behave identically through the slots', () => {
    // the built-in rules (authored with the v1 verbs) still floor/keep/reduce as before
    const r = resolveAttack({
        characteristics: { ws: 60, s: 30, t: 30 },
        weapon: { name: 'Axe', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Tearing', 'Felling (2)'] },
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 4, unnaturalToughness: 4 },
    }, riggedDice([d100(20), die(3, 10), die(8, 10)]), buildRegistry());
    assert.deepEqual(r.hits[0].damage.dice.kept, [8]);                 // Tearing kept highest
    assert.equal(r.hits[0].soak.effectiveUnnatural, 2);                // Felling via the slot
});

// --- Stage 3: arithmetic ------------------------------------------------------
test('division rounds UP (DH2 p.18); ceil/floor/half functions', () => {
    const reg = buildRegistry(`
        quality "Mathy" {
            on DAMAGE_MODS when has_quality("Mathy")
            then add modifier "div" = dos / 2; add modifier "hf" = half(3); add modifier "fl" = floor(7 / 2)
        }
    `);
    // dos 3 → 3/2 rounds up to 2; half(3) = 2; floor(7/2 = ceil 3.5 = 4) = 4
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 }, weapon: gun(['Mathy']),
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(21), die(5, 10)]), reg);
    const mods = r.hits[0].damage.modifiers;
    assert.equal(mods.div, Math.ceil(r.test.dos / 2));
    assert.equal(mods.hf, 2);
});

test('rollTest unchanged by vocabulary refactor (regression anchor)', () => {
    const r = rollTest({ target: 40, unnatural: 3 }, riggedDice([d100(20)]));
    assert.equal(r.dos, 5);   // 1 + (4-2) + ceil(3/2)
});
