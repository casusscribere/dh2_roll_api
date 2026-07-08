/**
 * Attack actions as first-class fire/attack modes (DH2 core p.222-225):
 * Suppressing Fire (both modes), the auto-fire 94+ jam, the melee multi-attack
 * WS-bonus hit cap, and the RAW talent gates on Swift/Lightning Attack.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const autogun = (extra = {}) => ({ name: 'Autogun', isMelee: false, damage: '1d10+3', pen: 0, damageType: 'Impact', rof: { single: true, burst: 3, full: 10 }, qualities: [], ...extra });
const sword = (extra = {}) => ({ name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [], ...extra });
const TARGET = { armour: 0, toughnessBonus: 0 };

// --- Suppressing Fire (p.224) ---------------------------------------------------
test('Suppressing Fire (Semi): -20 BS, per-2-DoS hits capped at semi RoF, -10 Pinning zone', () => {
    const r = resolveAttack({
        characteristics: { bs: 70, s: 30, t: 30 }, weapon: autogun(), action: 'Suppressing Fire (Semi)',
        target: TARGET,
    }, riggedDice([d100(10), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    assert.equal(r.test.modifiers.attack, -20);
    // 70 - 20 = 50 vs roll 10 → dos 5 → 1 + floor(4/2) = 3 hits, ≤ semi RoF 3
    assert.equal(r.hits.length, 3);
    assert.ok(r.effects.some((e) => e.name === 'Suppressing Fire' && /-10.*Pinning|Difficult \(-10\) Pinning/.test(e.effect)));
});

test('Suppressing Fire (Full): still per-2-DoS accrual (not per-DoS), full-RoF cap, -20 Pinning', () => {
    const r = resolveAttack({
        characteristics: { bs: 70, s: 30, t: 30 }, weapon: autogun(), action: 'Suppressing Fire (Full)',
        target: TARGET,
    }, riggedDice([d100(10), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    // dos 5 with FULL accrual would be 5 hits; RAW is per-2-DoS → 3 (cap full 10 not binding)
    assert.equal(r.hits.length, 3);
    assert.ok(r.effects.some((e) => e.name === 'Suppressing Fire' && /Hard \(-20\) Pinning/.test(e.effect)));
});

test('Pinning zone effect fires even on a MISS (targets duck regardless)', () => {
    const r = resolveAttack({
        characteristics: { bs: 30, s: 30, t: 30 }, weapon: autogun(), action: 'Suppressing Fire (Semi)',
        target: TARGET,
    }, riggedDice([d100(85)]), buildRegistry());
    assert.equal(r.test.success, false);
    assert.ok(r.effects.some((e) => e.name === 'Suppressing Fire'));
});

// --- auto-fire jam threshold (p.223-224: a roll of 94+ jams) ----------------------
test('auto-fire jams on 94 (Suppressing Fire and bursts); single shots do not', () => {
    const jammed = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 }, weapon: autogun(), action: 'Suppressing Fire (Semi)',
        target: TARGET,
    }, riggedDice([d100(94)]), buildRegistry());
    assert.ok(jammed.effects.some((e) => e.name === 'Jam'), 'suppressing fire jams on 94');
    const burst = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 }, weapon: autogun(), action: 'Semi-Auto Burst',
        target: TARGET,
    }, riggedDice([d100(94)]), buildRegistry());
    assert.ok(burst.effects.some((e) => e.name === 'Jam'), 'semi-auto burst jams on 94');
    const single = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 }, weapon: autogun(), action: 'Standard Attack',
        target: TARGET,
    }, riggedDice([d100(94), die(5, 10)]), buildRegistry());
    assert.ok(!single.effects.some((e) => e.name === 'Jam'), 'standard attack keeps the 97+ threshold');
});

test('auto-fire jam defers to Best craftsmanship and Reliable', () => {
    const best = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 }, weapon: autogun({ craftsmanship: 'Best' }), action: 'Full Auto Burst',
        target: TARGET,
    }, riggedDice([d100(94), die(5, 10)]), buildRegistry());
    assert.ok(!best.effects.some((e) => e.name === 'Jam'), 'Best never jams');
    const reliable = resolveAttack({
        characteristics: { bs: 99, s: 30, t: 30 }, weapon: autogun({ qualities: ['Reliable'] }), action: 'Full Auto Burst',
        target: TARGET,
    }, riggedDice([d100(94), die(5, 10)]), buildRegistry());
    assert.ok(!reliable.effects.some((e) => e.name === 'Jam'), 'Reliable keeps its threshold');
});

// --- melee multi-attacks: WS-bonus cap + talent gates (p.223/225) -----------------
test('Swift Attack: per-2-DoS hits capped at the WS BONUS, not the (zero) melee RoF', () => {
    // ws 30 (WSB 3): roll 1 vs 30 → dos 3 → 1 + floor(2/2) = 2 hits (no negative-cap bug)
    const r = resolveAttack({
        characteristics: { ws: 30, s: 30, t: 30 }, weapon: sword(), action: 'Swift Attack',
        talents: ['Swift Attack'], target: TARGET,
    }, riggedDice([d100(1), die(5, 10), die(5, 10)]), buildRegistry());
    assert.equal(r.hits.length, 2);
    assert.ok(!r.effects.some((e) => e.name === 'Swift Attack'), 'no warning when the talent is present');
});

test('Lightning Attack: -10, per-DoS hits capped at WS bonus', () => {
    // ws 60 (WSB 6) → target 60 - 10 + 10 (its own -10 replaces Standard\'s +10? no: action modifier -10)
    // target = 60 + (-10) = 50; roll 10 → dos 5 → 1 + 4 = 5 hits ≤ 6
    const r = resolveAttack({
        characteristics: { ws: 60, s: 30, t: 30 }, weapon: sword(), action: 'Lightning Attack',
        talents: ['Lightning Attack'], target: TARGET,
    }, riggedDice([d100(10), die(5, 10), die(5, 10), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    assert.equal(r.test.modifiers.attack, -10);
    assert.equal(r.hits.length, 5);
    // cap check: ws 20 (WSB 2) — dos would allow 2 additional, cap allows 1
    const capped = resolveAttack({
        characteristics: { ws: 20, s: 30, t: 30 }, weapon: sword(), action: 'Lightning Attack',
        talents: ['Lightning Attack'], modifiers: { boost: 30 }, customModifier: 30,
        target: TARGET,
    }, riggedDice([d100(11), die(5, 10), die(5, 10)]), buildRegistry());
    // target 20 - 10 + 30 = 40; roll 11 → dos 3 → accrual 2, capped at WSB 2 - 1 = 1 → 2 hits
    assert.equal(capped.hits.length, 2);
});

test('Swift/Lightning Attack without the talent surface the RAW gate as a warning', () => {
    // DoS = 1 + tens(target) - tens(roll): roll 5 vs 40 → dos 5 → Swift 3 hits / Lightning 4 hits
    const swift = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 }, weapon: sword(), action: 'Swift Attack',
        target: TARGET,
    }, riggedDice([d100(5), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    assert.ok(swift.effects.some((e) => e.name === 'Swift Attack' && /talent/.test(e.effect)));
    const lightning = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 }, weapon: sword(), action: 'Lightning Attack',
        target: TARGET,
    }, riggedDice([d100(5), die(5, 10), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    assert.ok(lightning.effects.some((e) => e.name === 'Lightning Attack' && /talent/.test(e.effect)));
});

test('Lightning Attack with an Unbalanced weapon warns (RAW: cannot be used)', () => {
    const r = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 }, weapon: sword({ qualities: ['Unbalanced'] }), action: 'Lightning Attack',
        talents: ['Lightning Attack'], target: TARGET,
    }, riggedDice([d100(5), die(5, 10), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());
    assert.ok(r.effects.some((e) => e.name === 'Lightning Attack' && /Unbalanced or Unwieldy/.test(e.effect)));
});

// --- taxonomy: the melee multi-attacks are HALF Actions in 2e (Table 7-1) ---------
test('Swift and Lightning Attack are Half Actions (action_type fact)', () => {
    const reg = buildRegistry(`
        mechanic "half check" { on MODIFIERS when action_type == "Half" then add modifier "half" = 1 }
    `);
    const r = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 }, weapon: sword(), action: 'Swift Attack',
        talents: ['Swift Attack'], target: TARGET,
    }, riggedDice([d100(5), die(5, 10), die(5, 10), die(5, 10)]), reg);
    assert.equal(r.test.modifiers.half, 1);
});
