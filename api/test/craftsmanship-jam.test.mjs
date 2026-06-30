/**
 * Razor Sharp (ranged), Jam-as-mechanic, and weapon craftsmanship — node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, resolveParry } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const ranged = (extra, qualities = [], craftsmanship = 'Common') => ({
    characteristics: { bs: 99, s: 30, t: 30 },
    weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities, craftsmanship },
    action: 'Standard Attack', rangeBand: 'Normal Range', ...extra,
});
const jammed = (r) => r.effects.some((e) => e.name === 'Jam');

// --- Razor Sharp now applies to ranged too -----------------------------------
test('Razor Sharp doubles penetration on a RANGED attack at DoS>2', () => {
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 },
        weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 4, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Razor Sharp'] },
        action: 'Standard Attack', rangeBand: 'Normal Range',
    }, riggedDice([d100(10), die(5, 10)]), buildRegistry());
    assert.equal(r.hits[0].penetrationModifiers['razor sharp'], 4);
    assert.equal(r.hits[0].totalPenetration, 8);
});

// --- Jam threshold (mechanic) ------------------------------------------------
test('default ranged weapon jams on 97+ but not on 96', () => {
    assert.equal(jammed(resolveAttack(ranged({}), riggedDice([d100(97)]), buildRegistry())), true);
    assert.equal(jammed(resolveAttack(ranged({}), riggedDice([d100(96), die(5, 10)]), buildRegistry())), false);
});

test('Reliable jams only on 100; Unreliable jams on 91+', () => {
    assert.equal(jammed(resolveAttack(ranged({}, ['Reliable']), riggedDice([d100(99), die(5, 10)]), buildRegistry())), false);
    assert.equal(jammed(resolveAttack(ranged({}, ['Reliable']), riggedDice([d100(100)]), buildRegistry())), true);
    assert.equal(jammed(resolveAttack(ranged({}, ['Unreliable']), riggedDice([d100(92)]), buildRegistry())), true);
});

// --- craftsmanship: ranged jam -----------------------------------------------
test('ranged craftsmanship adjusts jamming: Poor 91+, Good only 100, Best never', () => {
    assert.equal(jammed(resolveAttack(ranged({}, [], 'Poor'), riggedDice([d100(92)]), buildRegistry())), true);
    assert.equal(jammed(resolveAttack(ranged({}, [], 'Good'), riggedDice([d100(99), die(5, 10)]), buildRegistry())), false);
    assert.equal(jammed(resolveAttack(ranged({}, [], 'Best'), riggedDice([d100(100)]), buildRegistry())), false);
});

test('Best craftsmanship weapon never overheats', () => {
    const r = resolveAttack(ranged({}, ['Overheats'], 'Best'), riggedDice([d100(95), die(5, 10)]), buildRegistry());
    assert.equal(r.effects.some((e) => e.name === 'Overheats'), false);
});

// --- craftsmanship: melee WS + damage ----------------------------------------
test('melee craftsmanship: Poor -10 / Good +5 / Best +10 to hit, Best +1 damage', () => {
    const mk = (craftsmanship) => ({
        characteristics: { ws: 50, s: 30, t: 30 },
        weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [], craftsmanship },
        action: 'Standard Attack',
    });
    assert.equal(resolveAttack(mk('Poor'), riggedDice([d100(20), die(5, 10)]), buildRegistry()).test.modifiers.craftsmanship, -10);
    assert.equal(resolveAttack(mk('Good'), riggedDice([d100(20), die(5, 10)]), buildRegistry()).test.modifiers.craftsmanship, 5);
    const best = resolveAttack(mk('Best'), riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(best.test.modifiers.craftsmanship, 10);
    assert.equal(best.hits[0].damage.modifiers.craftsmanship, 1);   // Best melee +1 damage
});

test('craftsmanship applies to a Parry (Poor -10 to WS)', () => {
    const r = resolveParry({ characteristics: { ws: 50 }, weapon: { name: 'Sword', qualities: [], craftsmanship: 'Poor' } }, riggedDice([d100(45)]));
    assert.equal(r.test.modifiers.craftsmanship, -10);
    assert.equal(r.test.modifiedTarget, 40);
});