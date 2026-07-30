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
