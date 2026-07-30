/**
 * Characteristic-bonus derivation: a bonus is the tens digit of the
 * characteristic (DH2 Core p.24), plus any Unnatural (X) rating.
 *
 * Added 2026-07-29 after a mutation probe: changing `/ 10` to `/ 9` at
 * engine.mjs:349 and :388 killed none of the then-429 tests, despite every
 * damage figure in the engine flowing through that expression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { engageAttackRoll } from '../lib/engine.mjs';

// rng that always rolls low → the to-hit test always succeeds, so `meta` is populated.
const alwaysHits = () => 0.0;

function sbFor(strength, unnaturalStrength = 0) {
    const out = engageAttackRoll({
        characteristics: { ws: 60, bs: 60, s: strength, t: 40, ag: 40 },
        unnatural: { s: unnaturalStrength },
        weapon: { name: 'Test Blade', damage: '1d10', class: 'melee', qualities: [] },
        action: 'Standard Attack',
    }, undefined, alwaysHits);
    assert.ok(out.success, 'fixture must hit so that meta is populated');
    return out.meta.sb;
}

test('strength bonus is the tens digit of Strength', () => {
    for (const [s, expected] of [[10, 1], [39, 3], [40, 4], [45, 4], [70, 7]]) {
        assert.equal(sbFor(s), expected, `S ${s} should give SB ${expected}`);
    }
});

test('a Strength of 9 or less gives a strength bonus of 0', () => {
    assert.equal(sbFor(9), 0);
});

test('Unnatural Strength (X) adds X on top of the tens digit', () => {
    assert.equal(sbFor(40, 2), 6);
    assert.equal(sbFor(35, 1), 4);
});

// --- The Blast scatter-detonate branch (engine.mjs:349) -----------------------
// A Blast weapon that MISSES still resolves damage at the scatter point, and
// that branch re-derives the strength bonus with its own copy of the formula.
// A thrown grenade is the reachable case: strengthBonusMultiple() returns 0 for
// ranged weapons unless `thrown === true`, so only a thrown Blast weapon lets
// the SB actually reach the scatter damage.
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const THROWN_FRAG = {
    name: 'Frag Grenade', isMelee: false, thrown: true, damage: '2d10', pen: 0,
    damageType: 'Explosive', rof: { single: true, burst: 0, full: 0 },
    qualities: ['Blast (3)'],
};

function scatterDamageFor(strength) {
    // BS 40, Standard +10 → target 50; roll 80 → miss.
    // Dice: attack d100, scatter base 1d5, direction 1d10, then 2d10 damage.
    const r = resolveAttack(
        { characteristics: { bs: 40, s: strength, t: 30 }, weapon: THROWN_FRAG,
          action: 'Standard Attack', rangeBand: 'Normal Range' },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(4, 10), die(6, 10)]),
        buildRegistry(),
    );
    assert.equal(r.test.success, false, 'fixture must miss so the scatter branch runs');
    assert.ok(r.scatter?.hit, 'a Blast weapon detonates at the scatter point');
    return r.scatter.hit.damage;
}

test('the scatter-detonate branch derives the strength bonus from Strength', () => {
    // 2d10 rigged to 4 + 6 = 10, plus SB (thrown → sbTimes 1).
    assert.equal(scatterDamageFor(30).total, 10 + 3, 'S 30 → SB 3');
    assert.equal(scatterDamageFor(50).total, 10 + 5, 'S 50 → SB 5');
    assert.equal(scatterDamageFor(9).total, 10 + 0, 'S 9 → SB 0');
});
