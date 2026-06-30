/**
 * Stepped engagement phases — engageAttackRoll / engageDamage / engageEvasion /
 * engageOnHit (POST /api/engage). These back the pause/reroll UI; composing them
 * with one rng stream must reproduce the atomic resolveEngagement, and each phase
 * must be independently re-rollable. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveEngagement, engageAttackRoll, engageDamage, engageEvasion, engageOnHit,
} from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const semiAuto = {
    characteristics: { bs: 70, s: 30, t: 30 },
    weapon: { name: 'Autogun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 2, full: 0 }, qualities: [] },
    action: 'Semi-Auto Burst', rangeBand: 'Normal Range',
};
const defender = { characteristics: { ag: 30, t: 30 }, armour: 0, toughnessBonus: 3, evasion: { mode: 'dodge' } };

// --- composition equivalence -------------------------------------------------
test('stepping the four phases over one rng stream reproduces resolveEngagement', () => {
    const rolls = () => [d100(11), die(5, 10), die(5, 10), d100(25)];
    const atomic = resolveEngagement({ attacker: semiAuto, defender, options: {} }, riggedDice(rolls()), buildRegistry());

    // Same rolls, but consumed phase-by-phase (the client holds `state`).
    const reg = buildRegistry();
    const rng = riggedDice(rolls());
    const attack = engageAttackRoll(semiAuto, reg, rng);
    attack.hits = engageDamage(semiAuto, attack, reg, rng).hits;
    const ev = engageEvasion(defender, attack.test.dos, reg, rng);
    const evaded = Math.min(ev.evaded, attack.hits.length);
    const onhit = engageOnHit(semiAuto, defender, attack.hits, evaded, {}, reg, rng);

    assert.equal(attack.test.roll, atomic.attack.test.roll);
    assert.equal(attack.hits.length, atomic.attack.hits.length);
    assert.equal(ev.reaction.test.roll, atomic.reaction.test.roll);
    assert.equal(evaded, atomic.defender.evaded);
    assert.deepEqual(onhit.hits.map((h) => !!h.evaded), atomic.attack.hits.map((h) => !!h.evaded));
    assert.equal(onhit.totalWounds, atomic.attack.totalWounds);
});

// --- per-phase reroll --------------------------------------------------------
test('re-running a phase rerolls only that phase (fresh dice), prior phases unchanged', () => {
    const reg = buildRegistry();
    // First attack roll: 11 → hit. Reroll with 99 → BS70 miss.
    const first = engageAttackRoll(semiAuto, reg, riggedDice([d100(11)]));
    const reroll = engageAttackRoll(semiAuto, reg, riggedDice([d100(99)]));
    assert.equal(first.success, true);
    assert.equal(reroll.success, false);
    assert.notEqual(first.test.roll, reroll.test.roll);

    // Damage reroll on a fixed attack state: different dice → different totals.
    const dmgA = engageDamage(semiAuto, first, reg, riggedDice([die(2, 10), die(2, 10)]));
    const dmgB = engageDamage(semiAuto, first, reg, riggedDice([die(9, 10), die(9, 10)]));
    assert.notEqual(dmgA.hits[0].damage.total, dmgB.hits[0].damage.total);
    // The fixed phase-① state (hit locations) is untouched by the damage reroll.
    assert.deepEqual(dmgA.hits.map((h) => h.location), dmgB.hits.map((h) => h.location));
});

// --- evasion off -------------------------------------------------------------
test('engageEvasion with no reaction mode yields no roll and zero evaded', () => {
    const ev = engageEvasion({ characteristics: { ag: 40 } }, 5, buildRegistry(), riggedDice([]));
    assert.equal(ev.reaction, null);
    assert.equal(ev.evaded, 0);
});
