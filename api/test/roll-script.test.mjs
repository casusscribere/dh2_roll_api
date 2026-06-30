/**
 * Debug "force roll" support — rollScript records every d-roll and can force
 * faces by index; the engine surfaces a labelled trace. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { d, rollScript } from '../lib/dice.mjs';
import { engageAttackRoll, resolveEngagement } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';

const gunman = {
    characteristics: { bs: 50, s: 30, t: 30 },
    weapon: { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
    action: 'Standard Attack',
};

test('rollScript forces die faces by index, clamps to range, and records a labelled trace', () => {
    const rng = rollScript([7, undefined, 99]);
    assert.equal(d(10, rng, 'a'), 7);                 // forced face
    const b = d(100, rng, 'b'); assert.ok(b >= 1 && b <= 100);   // unforced → random
    assert.equal(d(5, rng, 'c'), 5);                  // 99 clamped to the d5 max
    assert.equal(rng.trace.length, 3);
    assert.deepEqual(rng.trace.map((t) => [t.sides, t.label, t.forced]),
        [[10, 'a', true], [100, 'b', false], [5, 'c', true]]);
    assert.equal(rng.trace[0].value, 7);
});

test('forcing the to-hit roll drives the engagement outcome; the trace names the roll', () => {
    const rng = rollScript([99]);                     // to-hit 99 → miss
    const attack = engageAttackRoll(gunman, buildRegistry(), rng);
    assert.equal(attack.test.roll, 99);
    assert.equal(attack.success, false);
    assert.equal(rng.trace[0].label, 'to-hit');
    assert.equal(rng.trace[0].sides, 100);
});

test('resolveEngagement records the whole roll sequence in order', () => {
    const rng = rollScript([10]);                     // force a hit
    resolveEngagement({
        attacker: gunman,
        defender: { characteristics: { ag: 30 }, armour: 2, toughnessBonus: 3, evasion: { mode: 'none' } },
        options: {},
    }, rng, buildRegistry());
    assert.ok(rng.trace.length >= 2);                 // to-hit + ≥1 damage die
    assert.equal(rng.trace[0].label, 'to-hit');
    assert.ok(rng.trace.some((t) => t.label.startsWith('damage die')));
});
