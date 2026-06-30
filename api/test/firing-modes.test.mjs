/**
 * Firing-mode toggle (Maximal) — a per-shot mode that rewrites the profile when
 * active (firing_mode("…")), and the bump_quality action. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry, availableConfigurations, availableQualities, builtinRules } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const plasma = (firingModes = []) => ({
    characteristics: { bs: 60, s: 30, t: 30 },
    weapon: { name: 'Plasma Gun', isMelee: false, damage: '1d10+7', pen: 6, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Maximal', 'Blast (1)'] },
    action: 'Standard Attack', firingModes,
});

test('Maximal OFF leaves the base profile untouched', () => {
    const r = resolveAttack(plasma([]), riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(r.hits[0].damage.total, 12);              // 5 + 7, no Maximal die
    assert.equal(r.hits[0].damage.modifiers.maximal, undefined);
    assert.equal(r.hits[0].totalPenetration, 6);           // base Pen
});

test('Maximal ON adds +1d10 damage and +2 penetration', () => {
    // dice: to-hit, weapon die, Maximal +1d10
    const r = resolveAttack(plasma(['Maximal']), riggedDice([d100(20), die(5, 10), die(8, 10)]), buildRegistry());
    assert.equal(r.hits[0].damage.modifiers.maximal, 8);   // the +1d10
    assert.equal(r.hits[0].damage.total, 20);              // 5 (die) + 7 (weapon) + 8 (maximal)
    assert.equal(r.hits[0].totalPenetration, 8);           // 6 + 2
});

test('configs[] (the canonical input) drives Maximal via configuration(); it is a Configuration', () => {
    const r = resolveAttack({ ...plasma([]), configs: ['Maximal'] }, riggedDice([d100(20), die(5, 10), die(8, 10)]), buildRegistry());
    assert.equal(r.hits[0].damage.modifiers.maximal, 8);
    assert.ok(availableConfigurations.includes('Maximal'));
    assert.equal(builtinRules.find((b) => b.id === 'maximal')?.category, 'Configurations');
});

test('Maximal is BOTH a Configuration and a recognised weapon quality (quality gates the config)', () => {
    assert.ok(availableConfigurations.includes('Maximal'), 'Maximal is a Configuration');
    assert.ok(availableQualities.includes('Maximal'), 'Maximal is a recognised weapon quality');
    // the config does nothing unless the weapon HAS the Maximal quality
    const noQuality = resolveAttack({ ...plasma([]), configs: ['Maximal'], weapon: { ...plasma([]).weapon, qualities: [] } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(noQuality.hits[0].damage.modifiers.maximal, undefined);
});

test('Maximal raises Blast by 2 (distinct effect name, not a duplicate "Maximal")', () => {
    const r = resolveAttack(plasma(['Maximal']), riggedDice([d100(20), die(5, 10), die(1, 10)]), buildRegistry());
    // the bump is named after the bumped quality ("Blast ↑"), NOT "Maximal", so it
    // doesn't read as a repeat of the Maximal note (the duplicate-log fix)
    const bump = r.effects.find((e) => /Blast/.test(e.name));
    assert.ok(bump, 'a Blast bump effect is recorded');
    assert.match(bump.effect, /Blast \(1\) → \(3\)/);
    assert.equal(r.effects.filter((e) => e.name === 'Maximal').length, 1);   // exactly one "Maximal" effect
    // the range/ammo note + the granted Recharge quality are both surfaced
    assert.ok(r.effects.some((e) => e.name === 'Maximal' && /range/.test(e.effect)));
    assert.ok(r.effects.some((e) => e.name === 'Recharge'));
});

test('firing on Maximal grants the Recharge quality (Recharge note appears)', () => {
    const off = resolveAttack(plasma([]), undefined, buildRegistry());
    assert.ok(!off.effects.some((e) => e.name === 'Recharge'), 'no Recharge when Maximal is off');
    const on = resolveAttack(plasma(['Maximal']), undefined, buildRegistry());
    assert.ok(on.effects.some((e) => e.name === 'Recharge'), 'Recharge granted when firing on Maximal');
});
