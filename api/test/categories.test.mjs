/**
 * Rule-category tests — node --test.
 *
 * Covers the renamed `condition` kind and the new `trait` (DH2.0 innate) and
 * `status` (active condition) categories: that the parser accepts the kinds,
 * and that traits/statuses supplied to an attack activate their rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { parse } from '../lib/dsl/parser.mjs';
import { compile } from '../lib/dsl/compiler.mjs';
import { buildRegistry, builtinRules } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

// --- parser accepts the canonical kinds + normalises aliases -----------------
test('parser accepts the nine kinds and normalises aliases (status→condition, generic/rule→miscellaneous)', () => {
    const prog = parse(`
        quality       "a" { on MODIFIERS then fail }
        talent        "b" { on MODIFIERS then fail }
        trait         "c" { on MODIFIERS then fail }
        circumstance  "d" { on MODIFIERS then fail }
        condition     "e" { on MODIFIERS then fail }
        mechanic      "f" { on MODIFIERS then fail }
        miscellaneous "g" { on MODIFIERS then fail }
        status        "h" { on MODIFIERS then fail }
        generic       "i" { on MODIFIERS then fail }
        rule          "j" { on MODIFIERS then fail }
    `);
    assert.deepEqual(prog.rules.map(r => r.kind),
        ['quality', 'talent', 'trait', 'circumstance', 'condition', 'mechanic', 'miscellaneous', 'condition', 'miscellaneous', 'miscellaneous']);
    assert.equal(compile('condition "On Fire" { on MODIFIERS when has_condition("On Fire") then add modifier "x" = -10 }')[0].source, 'condition');
    assert.equal(compile('status "On Fire" { on MODIFIERS when has_status("On Fire") then add modifier "x" = -10 }')[0].source, 'condition');
});

// --- helper ------------------------------------------------------------------
const meleeCharge = (extra, queue) => resolveAttack({
    characteristics: { ws: 50, s: 30, t: 30 },
    weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
    action: 'Charge',
    ...extra,
}, riggedDice(queue));

// --- trait (DH2.0): Brutal Charge --------------------------------------------
test('trait Brutal Charge (3) adds 3 melee damage on a Charge', () => {
    const r = meleeCharge({ traits: ['Brutal Charge (3)'] }, [d100(30), die(5, 10)]);
    assert.equal(r.hits[0].damage.modifiers['brutal charge'], 3);
    assert.equal(r.hits[0].damage.total, 11); // die 5 + Strength Bonus 3 + Brutal Charge 3
});

test('Brutal Charge is inactive without the trait, and inactive when not charging', () => {
    const noTrait = meleeCharge({ traits: [] }, [d100(30), die(5, 10)]);
    assert.equal(noTrait.hits[0].damage.modifiers['brutal charge'], undefined);

    const notCharging = resolveAttack({
        characteristics: { ws: 50, s: 30, t: 30 },
        weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Standard Attack', traits: ['Brutal Charge (3)'],
    }, riggedDice([d100(30), die(5, 10)]));
    assert.equal(notCharging.hits[0].damage.modifiers['brutal charge'], undefined);
});

// --- status: aim + on fire ---------------------------------------------------
const rangedAttack = (extra) => resolveAttack({
    characteristics: { bs: 50, s: 30, t: 30 },
    weapon: { name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
    action: 'Standard Attack', ...extra,
}, riggedDice([d100(50), die(5, 10)]));

test('status Full Aim applies the aim bonus', () => {
    assert.equal(rangedAttack({ statuses: ['Full Aim'] }).test.modifiers.aim, 20);
    assert.equal(rangedAttack({ statuses: ['Half Aim'] }).test.modifiers.aim, 10);
});

test('status On Fire applies a penalty; absent status does nothing', () => {
    assert.equal(rangedAttack({ statuses: ['On Fire'] }).test.modifiers.on_fire, -10);
    assert.equal(rangedAttack({ statuses: [] }).test.modifiers.on_fire, undefined);
    assert.equal(rangedAttack({}).test.modifiers.aim, undefined);
});

// --- renamed taxonomy: conditions[] alias + circumstances --------------------
test('conditions[] input drives a Condition rule (statuses[] is an accepted alias)', () => {
    assert.equal(rangedAttack({ conditions: ['Full Aim'] }).test.modifiers.aim, 20);
    assert.equal(rangedAttack({ conditions: ['On Fire'] }).test.modifiers.on_fire, -10);
});

test('apply_status records structured Condition variables (severity, duration, location)', () => {
    const reg = buildRegistry('quality "Concuss" { on ON_HIT when has_quality("Concuss") then apply_status "Stunned" duration 3 location "Head", "knocked silly" }');
    const r = resolveAttack({ characteristics: { ws: 60, s: 30, t: 30 }, weapon: { name: 'Club', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Concuss'] }, action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 } },
        riggedDice([d100(20), die(5, 10)]), reg);
    const st = r.hits[0].targetEffects.statuses[0];
    assert.equal(st.status, 'Stunned');
    assert.equal(st.duration, 3);
    assert.equal(st.location, 'Head');
});

test('condition_* accessors read a structured Condition object from conditions[]', () => {
    const reg = buildRegistry('circumstance "Crippled Drag" { on MODIFIERS when condition_severity("Crippled", 0) > 0 then add modifier "crippled drag" = (-1 * condition_severity("Crippled", 0)) }');
    const r = resolveAttack({ characteristics: { ws: 50, s: 30, t: 30 }, weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack', conditions: [{ name: 'Crippled', severity: 4 }] },
        riggedDice([d100(20), die(5, 10)]), reg);
    assert.equal(r.test.modifiers['crippled drag'], -4);   // -1 × severity 4
});

test('has_circumstance gates a Circumstance rule on the circumstances[] list', () => {
    const reg = buildRegistry('circumstance "Smoke" { on MODIFIERS when has_circumstance("Smoke") then add modifier "smoke" = -20 }');
    const lit = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: { name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack' },
        riggedDice([d100(50), die(5, 10)]), reg);
    assert.equal(lit.test.modifiers.smoke, undefined);             // no circumstance → inactive
    const smoky = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: { name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] }, action: 'Standard Attack', circumstances: ['Smoke'] },
        riggedDice([d100(50), die(5, 10)]), reg);
    assert.equal(smoky.test.modifiers.smoke, -20);
});

// --- toggling built-in rules off ---------------------------------------------
test('builtinRules lists toggleable rules with ids (excluding combat-action core)', () => {
    const ids = builtinRules.map(r => r.id);
    assert.ok(ids.includes('tearing'));
    assert.ok(ids.includes('ambidextrous'));
    assert.ok(ids.includes('brutal-charge'));
    assert.ok(!ids.includes('action-modifier')); // combat-action core is not toggleable
});

test('disabling a built-in rule excludes it from the registry used for a roll', () => {
    const weapon = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Tearing'] };
    const input = { characteristics: { ws: 60, s: 0, t: 30 }, weapon, action: 'Standard Attack' };

    // Tearing active (default): one extra die rolled, kept-highest, tearing flag set.
    const on = resolveAttack(input, riggedDice([d100(30), die(3, 10), die(8, 10)]), buildRegistry());
    assert.equal(on.hits[0].damage.tearing, true);
    assert.deepEqual(on.hits[0].damage.dice.rolled.length, 2);

    // Tearing disabled: rule excluded — only one die, no tearing.
    const off = resolveAttack(input, riggedDice([d100(30), die(3, 10)]), buildRegistry(undefined, ['tearing']));
    assert.equal(off.hits[0].damage.tearing, false);
    assert.equal(off.hits[0].damage.dice.rolled.length, 1);
});

test('disabling a multi-branch rule (Accurate) suppresses all its branches', () => {
    const weapon = { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Accurate'] };
    const input = { characteristics: { bs: 80, s: 0, t: 30 }, weapon, action: 'Standard Attack', aim: 'Full' };

    // BS80, aimed, roll 10 → high DoS: both Accurate branches fire (two bonus dice).
    const on = resolveAttack(input, riggedDice([d100(10), die(4, 10), die(6, 10), die(7, 10)]), buildRegistry());
    assert.equal(on.hits[0].damage.modifiers['accurate'], 6);
    assert.equal(on.hits[0].damage.modifiers['accurate x 2'], 7);

    // Accurate disabled by its ruleId — neither branch fires, no bonus dice rolled.
    const off = resolveAttack(input, riggedDice([d100(10), die(4, 10)]), buildRegistry(undefined, ['accurate']));
    assert.equal(off.hits[0].damage.modifiers['accurate'], undefined);
    assert.equal(off.hits[0].damage.modifiers['accurate x 2'], undefined);
    assert.equal(off.hits[0].damage.total, 4);
});

test('Accurate depends on half_aim/full_aim: +10 to hit and bonus damage only when aiming', () => {
    const weapon = { name: 'Long Las', isMelee: false, damage: '1d10', pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Accurate'] };

    // Not aiming: no Accurate to-hit bonus, no bonus damage dice.
    const noAim = resolveAttack({ characteristics: { bs: 80, s: 0, t: 30 }, weapon, action: 'Standard Attack' },
        riggedDice([d100(10), die(4, 10)]), buildRegistry());
    assert.equal(noAim.test.modifiers.accurate_aim, undefined);
    assert.equal(noAim.hits[0].damage.modifiers['accurate'], undefined);

    // Full aim: +20 aim, +10 Accurate to-hit, and the bonus damage dice.
    const aimed = resolveAttack({ characteristics: { bs: 80, s: 0, t: 30 }, weapon, action: 'Standard Attack', aim: 'Full' },
        riggedDice([d100(10), die(4, 10), die(6, 10), die(7, 10)]), buildRegistry());
    assert.equal(aimed.test.modifiers.aim, 20);
    assert.equal(aimed.test.modifiers.accurate_aim, 10);
    assert.equal(aimed.hits[0].damage.modifiers['accurate'], 6);
    assert.equal(aimed.hits[0].damage.modifiers['accurate x 2'], 7);
});
