/**
 * Parry (Balanced/Defensive) + Blast scatter tests — node --test.
 *
 * Balanced/Defensive fire at the new PARRY checkpoint via resolveParry; Blast
 * fires at the new ON_MISS checkpoint, producing a scatter result whose distance
 * is reduced by the firer's BS bonus and is further alterable by any DSL rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParry, resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

// --- Balanced / Parry --------------------------------------------------------
test('Balanced grants +10 to a Parry (WS) test', () => {
    const r = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Sword', qualities: ['Balanced'] } }, riggedDice([d100(45)]));
    assert.equal(r.action, 'Parry');
    assert.equal(r.test.characteristic, 'WS');
    assert.equal(r.test.modifiers.balanced, 10);
    assert.equal(r.test.modifiedTarget, 50);   // WS 40 + 10
    assert.equal(r.test.success, true);        // roll 45 <= 50
});

test('a non-Balanced weapon gets no Parry bonus', () => {
    const r = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Club', qualities: [] } }, riggedDice([d100(45)]));
    assert.equal(r.test.modifiers.balanced, undefined);
    assert.equal(r.test.modifiedTarget, 40);
    assert.equal(r.test.success, false);       // 45 > 40
});

test('Defensive: +15 to Parry, -10 to attacks', () => {
    const parry = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Shield', qualities: ['Defensive'] } }, riggedDice([d100(50)]));
    assert.equal(parry.test.modifiers.defensive, 15);

    const atk = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 },
        weapon: { name: 'Shield', isMelee: true, damage: '1d5', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: ['Defensive'] },
        action: 'Standard Attack',
    }, riggedDice([d100(60)]));            // 40 +10 -10 = 50 target; roll 60 → miss
    assert.equal(atk.test.modifiers.defensive, -10);
});

// --- Blast / scatter ---------------------------------------------------------
const FRAG = { name: 'Frag Grenade', isMelee: false, damage: '2d10', pen: 0, damageType: 'Explosive', rof: { single: true, burst: 0, full: 0 }, qualities: ['Blast (3)'] };

test('Blast scatters on a miss: distance defaults to 1d5 m, with a 1d10 direction', () => {
    // BS 40, Standard +10 → target 50; roll 80 → miss. RNG: attack, base 1d5, direction 1d10, detonation 2d10.
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack', rangeBand: 'Normal Range' },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(4, 10), die(6, 10)]), buildRegistry());
    assert.equal(r.test.success, false);
    assert.ok(r.scatter, 'scatter present on a miss');
    assert.equal(r.scatter.baseDistance, 3);          // 1d5
    assert.deepEqual(r.scatter.modifiers, {});        // 1d5 default, no built-in modifiers
    assert.equal(r.scatter.distance, 3);
    assert.equal(r.scatter.direction, 7);             // 1d10 clock face
});

test('a Blast weapon still detonates (rolls damage) at the scatter point on a miss', () => {
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack', rangeBand: 'Normal Range' },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(4, 10), die(6, 10)]), buildRegistry());
    assert.ok(r.scatter.hit, 'detonation damage resolved even though the attack missed');
    assert.equal(r.scatter.hit.damage.total, 10);     // 2d10 = 4 + 6 (Explosive, no SB)
    assert.equal(r.scatter.hit.damageType, 'Explosive');
});

test('a JAMMED Blast weapon does not scatter or detonate (it never fired)', () => {
    // roll 98 > jam_threshold 96 → Jam (fail). The Blast rule is gated out, so no scatter.
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack', rangeBand: 'Normal Range' },
        riggedDice([d100(98)]), buildRegistry());
    assert.equal(r.test.success, false);
    assert.ok(r.effects.some((e) => e.name === 'Jam'));
    assert.equal(r.scatter, undefined);               // no scatter, no detonation
});

test('Blast does not scatter on a hit', () => {
    const r = resolveAttack({ characteristics: { bs: 60, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack', rangeBand: 'Normal Range' },
        riggedDice([d100(20), die(5, 10), die(5, 10)]), buildRegistry());
    assert.equal(r.test.success, true);
    assert.equal(r.scatter, undefined);
});

test('the 1d5 base is set before another DSL rule increases the scatter distance', () => {
    const reg = buildRegistry('generic "Wild Throw" { on ON_MISS then set scatter += 3 }');
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack' },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(2, 10), die(2, 10)]), reg);
    assert.equal(r.scatter.baseDistance, 3);          // Blast's 1d5 base
    assert.equal(r.scatter.modifiers['wild throw'], 3);
    assert.equal(r.scatter.distance, 6);              // 3 + 3
});

test('a DSL rule can decrease the scatter distance, floored at zero', () => {
    const reg = buildRegistry('generic "Pinpoint" { on ON_MISS then set scatter += -10 }');
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack' },
        riggedDice([d100(80), die(3, 5), die(5, 10), die(1, 10), die(1, 10)]), reg);
    assert.equal(r.scatter.distance, 0);              // max(0, 3 − 10)
});