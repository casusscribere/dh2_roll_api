/**
 * Phase 6 (ROADMAP.md): psychic powers — the power.* pipeline, psy strength
 * + push (p.194–195), Phenomena → Perils (p.196–197), opposed resist (p.195),
 * psychic attack modes (p.198), the Force weapon rider (p.145), and the
 * psychic talents. node --test.
 *
 * Dice order the engine consumes (helpers.riggedDice is a strict queue):
 *   power.MODIFIERS rules (Warp Conduit 1d5) → Focus Power d100 → opposed
 *   resist d100 → power.POST_ROLL rules (Warp Lock 1d5) → Phenomena d100
 *   (→ Favoured re-roll d100) → Perils d100 → power.EFFECT → rider d10s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFocusPower, resolveTest } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { CHECKPOINTS, PIPELINES } from '../lib/pipeline.mjs';
import { dispatch } from '../lib/api-router.mjs';
import { characterToCombatant, emptyCharacter } from '../lib/character-schema.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const reg = () => buildRegistry();
const psyker = (extra = {}) => ({
    characteristics: { wp: 50 }, psyRating: 3, psykerClass: 'bound',
    power: { name: 'Smite', difficulty: 0 }, ...extra,
});

// --- pipeline + vocabulary ------------------------------------------------------
test('the power pipeline exposes its five checkpoints', () => {
    assert.deepEqual(PIPELINES.power, ['power.MODIFIERS', 'power.POST_ROLL', 'power.PHENOMENA', 'power.PERILS', 'power.EFFECT']);
    assert.equal(CHECKPOINTS.POWER_PHENOMENA, 'power.PHENOMENA');
});

// --- Step 1: psychic strength (p.194) ---------------------------------------------
test('effective psy rating below base: +10 per point; above base (push): −10 per point', () => {
    const low = resolveFocusPower(psyker({ effectivePsyRating: 1 }), riggedDice([d100(60)]), reg());
    assert.equal(low.modifiers['psy rating'], 20);            // 2 below base 3
    assert.equal(low.psy.push, 0);
    assert.equal(low.test.modifiedTarget, 70);
    const high = resolveFocusPower(psyker({ effectivePsyRating: 5 }), riggedDice([d100(34), d100(20)]), reg());   // pushing + no doubles → Phenomena die
    assert.equal(high.modifiers['psy rating'], -20);          // pushing +2
    assert.equal(high.psy.push, 2);
    assert.equal(high.psy.pushing, true);
    // default = base rating, no modifier
    const base = resolveFocusPower(psyker(), riggedDice([d100(34)]), reg());
    assert.equal(base.modifiers['psy rating'], undefined);
    assert.equal(base.psy.effective, 3);
});

test('push caps by psyker class (Table 6–1): bound +2, unbound +4, daemonic +3; must be ≥ 1', () => {
    assert.throws(() => resolveFocusPower(psyker({ effectivePsyRating: 6 }), riggedDice([]), reg()), /bound.*\+2|cap/i);
    const unbound = resolveFocusPower(psyker({ psykerClass: 'unbound', effectivePsyRating: 7 }), riggedDice([d100(34), d100(40)]), reg());
    assert.equal(unbound.psy.push, 4);
    assert.throws(() => resolveFocusPower(psyker({ psykerClass: 'unbound', effectivePsyRating: 8 }), riggedDice([]), reg()), /cap/i);
    const daemonic = resolveFocusPower(psyker({ psykerClass: 'daemonic', effectivePsyRating: 6 }), riggedDice([d100(34), d100(40)]), reg());
    assert.equal(daemonic.psy.push, 3);
    assert.throws(() => resolveFocusPower(psyker({ effectivePsyRating: 0 }), riggedDice([]), reg()), /at least 1/i);
});

test('a non-psyker (psy rating 0) cannot make a Focus Power test', () => {
    assert.throws(() => resolveFocusPower(psyker({ psyRating: 0 }), riggedDice([]), reg()), /psy rating/i);
});

test('the power difficulty and caller modifiers join the ±60-capped modifier set; the target is the focus characteristic', () => {
    const r = resolveFocusPower(psyker({ power: { name: 'Smite', difficulty: -10 }, modifiers: { situational: 5 } }), riggedDice([d100(45)]), reg());
    assert.equal(r.modifiers.difficulty, -10);
    assert.equal(r.modifiers.situational, 5);
    assert.equal(r.test.target, 50);
    assert.equal(r.test.modifiedTarget, 45);
    assert.equal(r.success, true);
    assert.equal(r.dos, 1);
    // an explicit target (a Psyniscience power) overrides the characteristic
    const p = resolveFocusPower(psyker({ target: 35, power: { name: 'Forewarning', difficulty: 0 } }), riggedDice([d100(45)]), reg());
    assert.equal(p.test.target, 35);
    assert.equal(p.success, false);
});

// --- Step 2: doubles → Phenomena; pushing inverts (p.194) --------------------------
test('not pushing: doubles trigger Phenomena, anything else does not', () => {
    const dbl = resolveFocusPower(psyker(), riggedDice([d100(33), d100(10)]), reg());   // 33 = doubles; phenomena d100
    assert.equal(dbl.test.doubles, true);
    assert.equal(dbl.phenomena.triggered, true);
    assert.match(dbl.phenomena.reason, /doubles/);
    assert.equal(dbl.phenomena.roll, 10);
    assert.match(dbl.phenomena.text, /^Mind Warp/);
    const plain = resolveFocusPower(psyker(), riggedDice([d100(34)]), reg());
    assert.equal(plain.test.doubles, false);
    assert.equal(plain.phenomena.triggered, false);
});

test('pushing: any roll EXCEPT doubles triggers Phenomena', () => {
    const push = psyker({ effectivePsyRating: 4 });
    const plain = resolveFocusPower(push, riggedDice([d100(12), d100(2)]), reg());
    assert.equal(plain.phenomena.triggered, true);
    assert.match(plain.phenomena.reason, /push/i);
    const dbl = resolveFocusPower(push, riggedDice([d100(22)]), reg());
    assert.equal(dbl.phenomena.triggered, false);
});

test('a natural 100 is doubles (0/0) AND the automatic failure', () => {
    const r = resolveFocusPower(psyker(), riggedDice([d100(100), d100(2)]), reg());
    assert.equal(r.test.autoFailure, true);
    assert.equal(r.test.doubles, true);
    assert.equal(r.phenomena.triggered, true);
});

test('power.noPhenomena (the Force rider) never rolls Phenomena', () => {
    const r = resolveFocusPower(psyker({ power: { name: 'Force Weapon', difficulty: 0, noPhenomena: true } }), riggedDice([d100(33)]), reg());
    assert.equal(r.phenomena.triggered, false);
    assert.match(r.phenomena.reason, /cannot generate/i);
});

// --- Phenomena → Perils chain (p.196–197) ------------------------------------------
test('a Phenomena result of 75+ chains into Perils of the Warp', () => {
    const r = resolveFocusPower(psyker(), riggedDice([d100(33), d100(80), d100(3)]), reg());
    assert.equal(r.phenomena.roll, 80);
    assert.match(r.phenomena.text, /^Perils of the Warp/);
    assert.equal(r.perils.roll, 3);
    assert.match(r.perils.text, /^The Gibbering/);
    // a low phenomena roll does not
    const low = resolveFocusPower(psyker(), riggedDice([d100(33), d100(20)]), reg());
    assert.equal(low.perils, null);
});

test('Perils rows carry their conditions (Locked In → Prone + Unconscious)', () => {
    const r = resolveFocusPower(psyker(), riggedDice([d100(33), d100(90), d100(27)]), reg());
    assert.deepEqual(r.perils.statuses, ['Prone', 'Unconscious']);
});

// --- class + sustaining modifiers to the Phenomena roll (Table 6–1, p.195 / p.198) --
test('unbound psykers add +10 to Phenomena when not pushing, +5 per point pushed when pushing', () => {
    const normal = resolveFocusPower(psyker({ psykerClass: 'unbound' }), riggedDice([d100(33), d100(20)]), reg());
    assert.equal(normal.phenomena.modifier, 10);
    assert.equal(normal.phenomena.roll, 30);
    const push3 = resolveFocusPower(psyker({ psykerClass: 'unbound', effectivePsyRating: 6 }), riggedDice([d100(12), d100(20)]), reg());
    assert.equal(push3.phenomena.modifier, 15);
});

test('daemonic psykers add +10 normally, +10 per point pushed; bound psykers add nothing', () => {
    const dae = resolveFocusPower(psyker({ psykerClass: 'daemonic', effectivePsyRating: 5 }), riggedDice([d100(12), d100(20)]), reg());
    assert.equal(dae.phenomena.modifier, 20);
    assert.ok(dae.effects.some((e) => /Daemonic/.test(e.name)));     // unaffected unless Perils
    const bound = resolveFocusPower(psyker({ effectivePsyRating: 5 }), riggedDice([d100(12), d100(20)]), reg());
    assert.equal(bound.phenomena.modifier, 0);
});

test('sustaining two or more powers: +10 to Phenomena per power after the first and the final psy rating drops by the count', () => {
    const r = resolveFocusPower(psyker({ sustained: 2 }), riggedDice([d100(33), d100(20)]), reg());
    assert.equal(r.phenomena.modifier, 10);
    assert.equal(r.psy.final, 1);                              // 3 − 2
    const one = resolveFocusPower(psyker({ sustained: 1 }), riggedDice([d100(33), d100(20)]), reg());
    assert.equal(one.phenomena.modifier, 0);
    assert.equal(one.psy.final, 3);
});

test('a Warp-tainted psyker (Grand Incursion survivor) adds +10 to both tables', () => {
    const r = resolveFocusPower(psyker({ conditions: ['Warp-Tainted'] }), riggedDice([d100(33), d100(70), d100(10)]), reg());
    assert.equal(r.phenomena.modifier, 10);
    assert.equal(r.phenomena.roll, 80);                        // 70 + 10 → Perils
    assert.equal(r.perils.modifier, 10);
    assert.equal(r.perils.roll, 20);
});

// --- talents ------------------------------------------------------------------------
test('Favoured by the Warp rolls Phenomena twice and keeps the lower (both reported); never on a Perils result', () => {
    const r = resolveFocusPower(psyker({ talents: ['Favoured by the Warp'] }), riggedDice([d100(33), d100(50), d100(20)]), reg());
    assert.deepEqual(r.phenomena.rolls, [50, 20]);
    assert.equal(r.phenomena.roll, 20);
    assert.match(r.phenomena.text, /^Memory Worm/);
    const perils = resolveFocusPower(psyker({ talents: ['Favoured by the Warp'] }), riggedDice([d100(33), d100(80), d100(3)]), reg());
    assert.deepEqual(perils.phenomena.rolls, [80]);            // no second roll
    assert.equal(perils.perils.roll, 3);
});

test('Warp Conduit (Fate spent, pushing): +1d5 final psy rating, +30 Phenomena — the push penalty is unchanged', () => {
    const r = resolveFocusPower(psyker({ effectivePsyRating: 5, talents: ['Warp Conduit'], configs: ['Warp Conduit (Fate)'] }),
        riggedDice([die(4, 5), d100(12), d100(20)]), reg());
    assert.equal(r.psy.final, 9);                              // 5 + 1d5(4)
    assert.equal(r.modifiers['psy rating'], -20);              // still the chosen +2
    assert.equal(r.phenomena.modifier, 30);
    // not pushing → the talent does nothing
    const idle = resolveFocusPower(psyker({ talents: ['Warp Conduit'], configs: ['Warp Conduit (Fate)'] }), riggedDice([d100(12)]), reg());
    assert.equal(idle.psy.final, 3);
});

test('Warp Lock (used): the Phenomena are ignored; 1d5 Energy to the Head, no Focus Power until next turn', () => {
    const r = resolveFocusPower(psyker({ talents: ['Warp Lock'], configs: ['Warp Lock'] }), riggedDice([d100(33), die(3, 5)]), reg());
    assert.equal(r.phenomena.triggered, false);
    assert.match(r.phenomena.reason, /Warp Lock/);
    assert.equal(r.declaredDamage[0].amount, 3);
    assert.match(r.declaredDamage[0].reason, /Head/);
});

// --- opposed Focus Power tests (p.195) ------------------------------------------------
test('opposed: the psyker wins only by passing AND out-degreeing the resister; a resisting psyker adds double his psy rating', () => {
    const opposedPower = { name: 'Dominate', difficulty: 0, opposed: true };
    // psyker WP 50 rolls 20 (4 DoS); target WP 40 + 2×PR 2 = 44 rolls 30 (2 DoS) → psyker wins by 2
    const win = resolveFocusPower(psyker({ power: opposedPower, opposed: { characteristics: { wp: 40 }, psyRating: 2 } }),
        riggedDice([d100(20), d100(30)]), reg());
    assert.equal(win.opposed.test.modifiers['psy rating x2'], 4);
    assert.equal(win.opposed.test.modifiedTarget, 44);
    assert.equal(win.opposed.won, true);
    assert.equal(win.opposed.margin, 2);
    // target rolls 1 (auto-success, 5 DoS) → psyker loses despite passing
    const lose = resolveFocusPower(psyker({ power: opposedPower, opposed: { characteristics: { wp: 40 } } }),
        riggedDice([d100(20), d100(1)]), reg());
    assert.equal(lose.opposed.won, false);
    // a TIE is not a win — the psyker needs MORE degrees than the resister
    const tie = resolveFocusPower(psyker({ power: opposedPower, opposed: { characteristics: { wp: 40 } } }),
        riggedDice([d100(40), d100(30)]), reg());          // 2 DoS vs 2 DoS
    assert.equal(tie.dos, 2);
    assert.equal(tie.opposed.test.dos, 2);
    assert.equal(tie.opposed.won, false);
    assert.equal(tie.opposed.margin, 0);
    // a failed Focus Power test never wins
    const fail = resolveFocusPower(psyker({ power: opposedPower, opposed: { characteristics: { wp: 40 } } }),
        riggedDice([d100(80), d100(90)]), reg());
    assert.equal(fail.opposed.won, false);
});

test('the resist test runs the test.* pipeline as "Psychic Powers": Resistance, Bastion of Iron Will, Strong Minded fire', () => {
    const r = resolveFocusPower(psyker({
        power: { name: 'Dominate', difficulty: 0, opposed: true },
        opposed: { characteristics: { wp: 40 }, psyRating: 2, talents: ['Resistance (Psychic Powers)', 'Bastion of Iron Will', 'Strong Minded'] },
    }), riggedDice([d100(20), d100(95)]), reg());
    assert.equal(r.opposed.test.testName, 'Psychic Powers');
    assert.equal(r.opposed.test.modifiers.resistance, 10);
    assert.equal(r.opposed.test.modifiers['bastion of iron will'], 10);   // 5 × PR 2
    assert.ok(r.opposed.test.effects.some((e) => e.name === 'Strong Minded'));   // failed → may re-roll
});

// --- Force weapon rider (p.145) ---------------------------------------------------------
test('Force rider: an opposed win deals +1d10 Energy per DoS, ignoring Armour and Toughness', () => {
    const r = resolveFocusPower(psyker({
        power: { name: 'Force Weapon', difficulty: 0, opposed: true, noPhenomena: true },
        opposed: { characteristics: { wp: 30 } },
    }), riggedDice([d100(10), d100(50), die(7, 10), die(4, 10), die(9, 10), die(2, 10), die(5, 10)]), reg());
    // WP 50 roll 10 → 5 DoS; resister fails → 5 rider dice
    assert.equal(r.dos, 5);
    assert.equal(r.opposed.won, true);
    assert.deepEqual(r.rider.dice, [7, 4, 9, 2, 5]);
    assert.equal(r.rider.total, 27);
    assert.equal(r.rider.damageType, 'Energy');
    assert.equal(r.rider.ignoresArmour, true);
    assert.equal(r.rider.ignoresToughness, true);
    // lost → no rider
    const lost = resolveFocusPower(psyker({
        power: { name: 'Force Weapon', difficulty: 0, opposed: true, noPhenomena: true },
        opposed: { characteristics: { wp: 60 } },
    }), riggedDice([d100(45), d100(5)]), reg());
    assert.equal(lost.rider, null);
});

// --- psychic attack modes (p.198) -------------------------------------------------------
test('Psychic Bolt/Barrage/Storm hit counts: 1 / 1 + ⌊(DoS−1)/2⌋ / DoS, capped at the effective psy rating', () => {
    const bolt = resolveFocusPower(psyker({ power: { name: 'Smite', difficulty: 0, attackMode: 'bolt' } }), riggedDice([d100(1)]), reg());
    assert.equal(bolt.hits, 1);
    const barrage = resolveFocusPower(psyker({ power: { name: 'Smite', difficulty: 0, attackMode: 'barrage' } }), riggedDice([d100(1)]), reg());
    assert.equal(barrage.dos, 6);                               // roll 1 vs 50
    assert.equal(barrage.hits, 3);                              // 1 + ⌊5/2⌋ = 3 (= the PR cap)
    const storm = resolveFocusPower(psyker({ power: { name: 'Smite', difficulty: 0, attackMode: 'storm' } }), riggedDice([d100(1)]), reg());
    assert.equal(storm.hits, 3);                                // 6 DoS capped at PR 3
    const miss = resolveFocusPower(psyker({ power: { name: 'Smite', difficulty: 0, attackMode: 'storm' } }), riggedDice([d100(90)]), reg());
    assert.equal(miss.hits, 0);
    const blast = resolveFocusPower(psyker({ power: { name: 'Smite', difficulty: 0, attackMode: 'blast' } }), riggedDice([d100(1)]), reg());
    assert.equal(blast.hits, null);                             // everyone in the radius
    assert.ok(blast.effects.some((e) => /Blast/.test(e.name)));
});

// --- DSL surface -----------------------------------------------------------------------------
test('custom power.* rules see the psyker facts and can force / cancel Phenomena', () => {
    const custom = buildRegistry(`
        talent "Calm Mind" { on power.POST_ROLL when has_talent("Calm Mind") and phenomena and not is_pushing then flag no_phenomena }
        condition "Blood Rain" { on power.POST_ROLL when has_condition("Blood Rain") then flag phenomena; set phenomena_roll += 75 }
        miscellaneous "Probe" { on power.EFFECT when is_power("Smite") and effective_psy_rating >= 3 and psyker_class == "bound" then emit "Probe", "seen" }
    `);
    const calm = resolveFocusPower(psyker({ talents: ['Calm Mind'] }), riggedDice([d100(33)]), custom);
    assert.equal(calm.phenomena.triggered, false);
    assert.ok(calm.effects.some((e) => e.name === 'Probe'));
    const rain = resolveFocusPower(psyker({ conditions: ['Blood Rain'] }), riggedDice([d100(12), d100(10), d100(50)]), custom);
    assert.equal(rain.phenomena.triggered, true);
    assert.equal(rain.phenomena.roll, 85);
    assert.match(rain.perils.text, /^Warp Whispers/);
});

// --- API + schema --------------------------------------------------------------------------
test('POST /api/power dispatches the flow with forcedRolls and a rollTrace; bad input is a 400', () => {
    const { status, body } = dispatch('POST', '/api/power', {
        characteristics: { wp: 50 }, psyRating: 3, power: { name: 'Smite', difficulty: 0 }, forcedRolls: [33, 5],
    });
    assert.equal(status, 200);
    assert.equal(body.test.roll, 33);
    assert.equal(body.phenomena.roll, 5);
    assert.ok(body.rollTrace.some((t) => /Focus Power/.test(t.label)));
    assert.ok(body.rollTrace.some((t) => /Psychic Phenomena/.test(t.label)));
    const bad = dispatch('POST', '/api/power', { characteristics: { wp: 50 }, psyRating: 0, power: { name: 'Smite' } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /psy rating/i);
});

test('/api/options lists the psyker classes with their push caps', () => {
    const { body } = dispatch('GET', '/api/options');
    assert.deepEqual(body.psykerClasses.map((c) => [c.id, c.maxPush]), [['bound', 2], ['unbound', 4], ['daemonic', 3]]);
});

test('characterToCombatant carries psyker class and sustained count for the power pipeline', () => {
    const doc = { ...emptyCharacter(), psy: { rating: 4, class: 'unbound', sustained: 1 } };
    const c = characterToCombatant(doc);
    assert.equal(c.psyRating, 4);
    assert.equal(c.psykerClass, 'unbound');
    assert.equal(c.sustained, 1);
});

test('resolveTest exposes psy_rating to test.* rules (the resister side)', () => {
    const r = resolveTest({ target: 40, testName: 'Psychic Powers', psyRating: 3, talents: ['Bastion of Iron Will'] }, riggedDice([d100(50)]), reg());
    assert.equal(r.modifiers['bastion of iron will'], 15);
});
