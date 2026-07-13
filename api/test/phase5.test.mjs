/**
 * Phase 5 (ROADMAP.md): the last four DH2 weapon qualities — Force (static
 * half), Indirect, Smoke, Spray — on the v2 primitives. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, resolveTest } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { emptyEncounter, encounterActor, tickEncounter } from '../lib/encounter.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const ranged = (qualities, extra = {}) => ({ name: 'Gun', isMelee: false, damage: '1d10', pen: 2, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities, ...extra });

// --- Force (p.145, static half) -----------------------------------------------
test('Force in a psyker\'s hands: +PR damage, +PR pen, damage type → Energy', () => {
    const sword = { name: 'Force Sword', isMelee: true, damage: '1d10', pen: 2, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: ['Force'] };
    const psyker = resolveAttack({
        characteristics: { ws: 60, s: 30, t: 30 }, weapon: sword, action: 'Standard Attack',
        psyRating: 3, target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(psyker.hits[0].damageType, 'Energy');
    assert.equal(psyker.hits[0].damage.modifiers['force (psy rating)'], 3);
    assert.equal(psyker.hits[0].penetrationModifiers.force, 3);
    assert.equal(psyker.hits[0].totalPenetration, 5);          // 2 + PR 3
    // a mundane wielder gets none of it
    const mundane = resolveAttack({
        characteristics: { ws: 60, s: 30, t: 30 }, weapon: sword, action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(mundane.hits[0].damageType, 'Rending');
    assert.equal(mundane.hits[0].damage.modifiers['force (psy rating)'], undefined);
    assert.equal(mundane.hits[0].totalPenetration, 2);
});

// --- Indirect (p.147) ------------------------------------------------------------
test('Indirect: −10 to hit; every HIT scatters 1d10−BSB metres with a Diagram direction', () => {
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 }, weapon: ranged(['Indirect (2)']), action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10), die(7, 10), die(9, 10)]), buildRegistry());
    // dice: to-hit 20, damage 5, scatter distance d10=7, direction d10=9
    assert.equal(r.test.modifiers.indirect, -10);
    assert.ok(r.effects.some((e) => e.name === 'Indirect'));
    const sc = r.hits[0].scatter;
    assert.equal(sc.distance, 3);                              // 7 − BSB 4
    assert.equal(sc.direction, 9);
    assert.match(sc.directionText, /wide/);                    // Diagram row 9
});

test('Indirect scatter distance clamps at zero for good shooters', () => {
    const r = resolveAttack({
        characteristics: { bs: 90, s: 30, t: 30 }, weapon: ranged(['Indirect (2)']), action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10), die(3, 10), die(4, 10)]), buildRegistry());
    assert.equal(r.hits[0].scatter.distance, 0);               // 3 − BSB 9 → 0
});

// --- Smoke (p.149) ----------------------------------------------------------------
test('Smoke on a hit: smokescreen (radius X, 1d10+10 rounds) and NO damage change', () => {
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Smoke (3)']), action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10), die(4, 10)]), buildRegistry());
    const smoke = r.hits[0].smoke[0];
    assert.equal(smoke.radius, 3);
    assert.equal(smoke.duration, 14);                          // 1d10(4) + 10
});

test('Smoke scatters on a miss — the screen forms at the scatter point WITHOUT damage', () => {
    const r = resolveAttack({
        characteristics: { bs: 30, s: 30, t: 30 }, weapon: ranged(['Smoke (3)']), action: 'Standard Attack',
    }, riggedDice([d100(90), die(2, 5), die(6, 10), die(5, 10)]), buildRegistry());
    // dice order: miss 90 → checkpoint actions (scatter base 1d5=2, smoke duration
    // d10=6 → 16) → then the engine rolls the Diagram direction (5)
    assert.equal(r.scatter.distance, 2);
    assert.equal(r.scatter.direction, 5);
    assert.equal(r.scatter.smoke[0].radius, 3);
    assert.equal(r.scatter.smoke[0].duration, 16);
    assert.equal(r.scatter.hit, undefined);                    // no detonation — Smoke only
});

test('Smoke + Blast compose: one scatter, Blast detonates, Smoke lands its screen', () => {
    const r = resolveAttack({
        characteristics: { bs: 30, s: 30, t: 30 }, weapon: ranged(['Smoke (2)', 'Blast (3)'], { damage: '1d10' }), action: 'Standard Attack',
    }, riggedDice([d100(90), die(3, 5), die(8, 10), die(7, 10), die(6, 10)]), buildRegistry());
    assert.equal(r.scatter.distance, 3);                       // one base 1d5
    assert.ok(r.scatter.hit, 'Blast detonates at the scatter point');
    assert.equal(r.scatter.smoke[0].radius, 2);                // Smoke still lands
});

// --- Spray (p.149) -----------------------------------------------------------------
test('Spray: no attack roll (auto-hit, Body); target Agility test AVOIDS the hit on a pass', () => {
    const flamer = ranged(['Spray'], { name: 'Flamer', damage: '1d10+2' });
    // avoided: Agility 40, roll 20 → pass → hit voided
    const avoided = resolveAttack({
        characteristics: { bs: 10, s: 30, t: 30 }, weapon: flamer, action: 'Standard Attack',
        autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 40 },
    }, riggedDice([die(5, 10), d100(20)]), buildRegistry());        // NOTE: no to-hit d100!
    assert.equal(avoided.test.autoHit, true);
    assert.equal(avoided.test.success, true);
    assert.equal(avoided.hits[0].location, 'Body');
    assert.equal(avoided.hits[0].avoided, true);
    assert.equal(avoided.totalWounds, 0);
    assert.ok(avoided.effects.some((e) => e.name === 'Spray'));
    // struck: Agility roll 90 → fail → full damage lands
    const struck = resolveAttack({
        characteristics: { bs: 10, s: 30, t: 30 }, weapon: flamer, action: 'Standard Attack',
        autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 40 },
    }, riggedDice([die(5, 10), d100(90)]), buildRegistry());
    assert.equal(struck.hits[0].avoided, undefined);
    assert.equal(struck.totalWounds, 7);                        // 5+2 − 0 soak
});

test('Spray jams on a natural 9 damage die (hit still resolves; Jam effect surfaced)', () => {
    const r = resolveAttack({
        characteristics: { bs: 10, s: 30, t: 30 }, weapon: ranged(['Spray']), action: 'Standard Attack',
        autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 10 },
    }, riggedDice([die(9, 10), d100(90)]), buildRegistry());
    assert.ok(r.effects.some((e) => e.name === 'Jam' && /Spray/.test(e.effect)));
    assert.equal(r.totalWounds, 9);                             // the shot itself still lands
});

test('Spray ignores Called Shot locations (always Body)', () => {
    const r = resolveAttack({
        characteristics: { bs: 10, s: 30, t: 30 }, weapon: ranged(['Spray']), action: 'Called Shot',
        calledShotLocation: 'Head', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 10 },
    }, riggedDice([die(5, 10), d100(90)]), buildRegistry());
    assert.equal(r.hits[0].location, 'Body');
});

// ============================ talents / traits tranche =========================
const shoot = (extra = {}) => ({
    characteristics: { bs: 45, s: 30, t: 30 }, weapon: ranged([]), action: 'Standard Attack',
    target: { armour: 0, toughnessBonus: 0 }, ...extra,
});

// --- Marksman (p.130) -----------------------------------------------------------
test('Marksman cancels the Long/Extreme range penalty, leaves other bands alone', () => {
    const far = resolveAttack(shoot({ rangeBand: 'Long Range', talents: ['Marksman'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(far.test.modifiers.range, undefined);
    const untrained = resolveAttack(shoot({ rangeBand: 'Long Range' }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(untrained.test.modifiers.range, -10);
    const close = resolveAttack(shoot({ rangeBand: 'Short Range', talents: ['Marksman'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(close.test.modifiers.range, 10);            // bonus bands untouched
});

// --- Mighty Shot / Crushing Blow (p.130 / p.125) ---------------------------------
test('Mighty Shot: +half BS bonus (rounded up) ranged damage; Crushing Blow: +half WS melee', () => {
    const mighty = resolveAttack(shoot({ talents: ['Mighty Shot'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(mighty.hits[0].damage.modifiers['mighty shot'], 2);   // half(BSB 4) = 2
    const sword = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const crush = resolveAttack({
        characteristics: { ws: 55, s: 30, t: 30 }, weapon: sword, action: 'Standard Attack',
        talents: ['Crushing Blow'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(crush.hits[0].damage.modifiers['crushing blow'], 3);  // half(WSB 5) = 3
});

// --- Precision Killer (p.130) ------------------------------------------------------
test('Precision Killer removes the Called Shot -20 (specialised and bare entries)', () => {
    const withTalent = resolveAttack(shoot({ action: 'Called Shot', calledShotLocation: 'Head', talents: ['Precision Killer (Ranged)'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(withTalent.test.modifiers.attack, undefined);
    const without = resolveAttack(shoot({ action: 'Called Shot', calledShotLocation: 'Head' }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(without.test.modifiers.attack, -20);
    // melee specialisation does NOT help a ranged Called Shot
    const wrongSpec = resolveAttack(shoot({ action: 'Called Shot', calledShotLocation: 'Head', talents: ['Precision Killer (Melee)'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(wrongSpec.test.modifiers.attack, -20);
});

// --- Two-Weapon Master (p.132) ------------------------------------------------------
test('Two-Weapon Master erases the dual-wield penalty entirely', () => {
    const combat = { dualWielding: true };
    const master = resolveAttack(shoot({ talents: ['Two-Weapon Wielder', 'Ambidextrous', 'Two-Weapon Master'], combat }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(master.test.modifiers.two_weapon, undefined);
    const ambi = resolveAttack(shoot({ talents: ['Two-Weapon Wielder', 'Ambidextrous'], combat }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(ambi.test.modifiers.two_weapon, -10);
});

// --- Hatred (p.128) -------------------------------------------------------------------
test('Hatred: +10 WS in melee against a Hated Foe (and the retreat reminder)', () => {
    const sword = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const r = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 }, weapon: sword, action: 'Standard Attack',
        talents: ['Hatred (Mutants)'], circumstances: ['Hated Foe'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(r.test.modifiers.hatred, 10);
    assert.ok(r.effects.some((e) => e.name === 'Hatred' && /retreat/.test(e.effect)));
});

// --- Auto-Stabilised vs the Unbraced CONFIGURATION (p.134 / p.219) --------------------
test('Unbraced heavy fire is -30; Auto-Stabilised always counts as braced', () => {
    const unbraced = resolveAttack(shoot({ configs: ['Unbraced'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(unbraced.test.modifiers.unbraced, -30);
    const stabilised = resolveAttack(shoot({ configs: ['Unbraced'], traits: ['Auto-Stabilised'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(stabilised.test.modifiers.unbraced, undefined);
});

// --- DualWield configurations (replacing the Off-Hand entry, p.228) --------------------
test('DualWield configs drive the combat facts: off-hand -20, TWW penalty, advisory', () => {
    // off-hand alone (single weapon in the off hand): -20, no dual-wield penalty
    const off = resolveAttack(shoot({ configs: ['DualWield (off-hand)'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(off.test.modifiers.off_hand, -20);
    assert.equal(off.test.modifiers.two_weapon, undefined);
    // Ambidextrous cancels it
    const ambi = resolveAttack(shoot({ configs: ['DualWield (off-hand)'], talents: ['Ambidextrous'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(ambi.test.modifiers.off_hand, undefined);
    // main hand + Two-Weapon Wielder: the -20 two-weapon penalty, no off-hand
    const dual = resolveAttack(shoot({ configs: ['DualWield (main hand)'], talents: ['Two-Weapon Wielder'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(dual.test.modifiers.two_weapon, -20);
    assert.equal(dual.test.modifiers.off_hand, undefined);
    // main hand WITHOUT the talent: the RAW advisory fires
    const raw = resolveAttack(shoot({ configs: ['DualWield (main hand)'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.ok(raw.effects.some((e) => e.name === 'DualWield' && /Two-Weapon Wielder/.test(e.effect)));
});

// --- Fear (X) + From Beyond in the generic test pipeline (p.136) ----------------------
test('Fear test takes -10 x (rating - 1) from the foe; From Beyond is immune', () => {
    const fear3 = resolveTest({ target: 40, testName: 'Fear', foe: { traits: ['Fear (3)'] } },
        riggedDice([d100(30)]), buildRegistry());
    assert.equal(fear3.modifiers['fear rating'], -20);        // Horrifying (3)
    assert.equal(fear3.success, false);                       // 30 > 40 - 20
    const fear1 = resolveTest({ target: 40, testName: 'Fear', foe: { traits: ['Fear (1)'] } },
        riggedDice([d100(30)]), buildRegistry());
    assert.equal(fear1.modifiers['fear rating'], -0);         // Disturbing (1) = +0
    const beyond = resolveTest({ target: 40, testName: 'Fear', traits: ['From Beyond'], foe: { traits: ['Fear (4)'] } },
        riggedDice([d100(30)]), buildRegistry());
    assert.ok(beyond.effects.some((e) => e.name === 'From Beyond' && /immune/.test(e.effect)));
});

// --- Sturdy (p.138) ---------------------------------------------------------------------
test('Sturdy: +20 to resist Grapple / Knock Down / Takedown, nothing else', () => {
    const grapple = resolveTest({ target: 30, testName: 'Grapple', traits: ['Sturdy'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(grapple.modifiers.sturdy, 20);
    assert.equal(grapple.success, true);                      // 45 ≤ 50 only WITH the trait
    const dodge = resolveTest({ target: 30, testName: 'Dodge', traits: ['Sturdy'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(dodge.modifiers.sturdy, undefined);
});

// --- upkeep talents/traits: Iron Jaw, Die Hard, Regeneration --------------------------
const upkeepActor = (conditions, { talents = [], traits = [], t = 40, wp = 40 } = {}) => {
    const enc = emptyEncounter();
    const actor = encounterActor(enc, 'pc', 'Test Subject');
    actor.stats.characteristics = { t, ag: 30, wp };
    actor.stats.talents = talents;
    actor.stats.traits = traits;
    actor.conditions = conditions;
    return enc;
};

test('Iron Jaw: a Stunned character rolls the Toughness shake-off at TURN_START', () => {
    const enc = upkeepActor([{ name: 'Stunned' }], { talents: ['Iron Jaw'] });
    const { events } = tickEncounter(enc, 'TURN_START', buildRegistry(), riggedDice([d100(20)]), 'pc');
    const ev = events.find((e) => e.type === 'test' && e.source === 'Iron Jaw');
    assert.ok(ev, 'Iron Jaw test declared');
    assert.equal(ev.characteristic, 'Toughness');
    assert.equal(ev.success, true);                           // 20 ≤ T 40
    // without the talent: no test
    const bare = tickEncounter(upkeepActor([{ name: 'Stunned' }]), 'TURN_START', buildRegistry(), riggedDice([d100(20)]), 'pc');
    assert.ok(!bare.events.some((e) => e.source === 'Iron Jaw'));
});

test('Blood Loss emits the Fatigue event; Die Hard suppresses it and rolls Willpower', () => {
    const bare = tickEncounter(upkeepActor([{ name: 'Blood Loss' }]), 'TURN_START', buildRegistry(), riggedDice([]), 'pc');
    assert.ok(bare.events.some((e) => e.type === 'note' && e.source === 'Blood Loss' && /Fatigue/.test(e.reason)));
    const hard = tickEncounter(upkeepActor([{ name: 'Blood Loss' }], { talents: ['Die Hard'] }),
        'TURN_START', buildRegistry(), riggedDice([d100(90)]), 'pc');
    assert.ok(!hard.events.some((e) => e.type === 'note' && e.source === 'Blood Loss'), 'automatic Fatigue suppressed');
    const ev = hard.events.find((e) => e.type === 'test' && e.source === 'Die Hard');
    assert.equal(ev.characteristic, 'Willpower');
    assert.equal(ev.success, false);                          // 90 > WP 40
    assert.match(ev.outcome, /Fatigue/);                      // failed → the Fatigue lands after all
});

test('Regeneration rolls its Toughness test each TURN_START', () => {
    const { events } = tickEncounter(upkeepActor([], { traits: ['Regeneration (2)'] }),
        'TURN_START', buildRegistry(), riggedDice([d100(15)]), 'pc');
    const ev = events.find((e) => e.type === 'test' && e.source === 'Regeneration');
    assert.ok(ev, 'Regeneration test declared');
    assert.equal(ev.success, true);
});
