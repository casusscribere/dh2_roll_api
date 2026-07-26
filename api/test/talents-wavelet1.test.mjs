/**
 * Wavelet-1 talent content tests — node --test.
 *
 * Golden cases for the 2026-07 talent sweep (data/rules/talents.dsl "wavelet 1"
 * section + the paired Firing into Melee / Baneful Presence circumstances).
 * House rule: no untested rules — every talent gets at least one positive case
 * (talent held → exact effect) and one negative (absent / condition unmet →
 * no effect). All d100s are rigged; assertions are on resolved modifier sets,
 * effects, and scatter/penetration outputs, per the phase5 conventions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, resolveTest, resolveParry } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const GUN = { name: 'Gun', isMelee: false, damage: '1d10', pen: 2, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] };
const SWORD = { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [] };
const shoot = (extra = {}) => ({
    characteristics: { bs: 45, s: 30, t: 30 }, weapon: GUN, action: 'Standard Attack',
    target: { armour: 0, toughnessBonus: 0 }, ...extra,
});
const swing = (extra = {}) => ({
    characteristics: { ws: 40, s: 30, t: 30 }, weapon: SWORD, action: 'Standard Attack',
    target: { armour: 0, toughnessBonus: 0 }, ...extra,
});

// --- Resistance (X) (p.131) --------------------------------------------------
test('Resistance (Fear): +10 on the matching resist test, nothing on others', () => {
    const fear = resolveTest({ target: 40, testName: 'Fear', talents: ['Resistance (Fear)'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(fear.modifiers.resistance, 10);
    assert.equal(fear.success, true);                          // 45 ≤ 50 only WITH the talent
    // (combined roster spellings like "Resistance (Fear, Psychic Powers)" do NOT
    //  prefix-match "Resistance (Fear)" — normalize the roster, per the triage.)
    // wrong specialisation: no bonus
    const cold = resolveTest({ target: 40, testName: 'Fear', talents: ['Resistance (Cold)'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(cold.modifiers.resistance, undefined);
    assert.equal(cold.success, false);
});

// --- Jaded (p.128) -----------------------------------------------------------
test('Jaded voids mundane Fear tests; a Supernatural source still applies', () => {
    const mundane = resolveTest({ target: 40, testName: 'Fear', talents: ['Jaded'] },
        riggedDice([d100(30)]), buildRegistry());
    assert.ok(mundane.effects.some((e) => e.name === 'Jaded' && /mundane/.test(e.effect)));
    const daemon = resolveTest({ target: 40, testName: 'Fear', talents: ['Jaded'], circumstances: ['Supernatural'] },
        riggedDice([d100(30)]), buildRegistry());
    assert.ok(!daemon.effects.some((e) => e.name === 'Jaded'));
    const bare = resolveTest({ target: 40, testName: 'Fear' }, riggedDice([d100(30)]), buildRegistry());
    assert.ok(!bare.effects.some((e) => e.name === 'Jaded'));
});

// --- Firing into Melee circumstance + Target Selection (p.229 / p.132) --------
test('Firing into Melee: -20 to ranged attacks; Target Selection cancels it', () => {
    const penalised = resolveAttack(shoot({ circumstances: ['Firing into Melee'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(penalised.test.modifiers.firing_into_melee, -20);
    const talented = resolveAttack(shoot({ circumstances: ['Firing into Melee'], talents: ['Target Selection'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(talented.test.modifiers.firing_into_melee, undefined);
    // melee attacks never take the shooting penalty
    const melee = resolveAttack(swing({ circumstances: ['Firing into Melee'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(melee.test.modifiers.firing_into_melee, undefined);
});

test('Target Selection: aiming beforehand also protects friendly targets', () => {
    const aimed = resolveAttack(shoot({ circumstances: ['Firing into Melee'], talents: ['Target Selection'], aim: 'Full' }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.ok(aimed.effects.some((e) => e.name === 'Target Selection' && /friendly/.test(e.effect)));
    const snap = resolveAttack(shoot({ circumstances: ['Firing into Melee'], talents: ['Target Selection'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.ok(!snap.effects.some((e) => e.name === 'Target Selection'));
});

// --- Peer (p.130) ------------------------------------------------------------
test('Peer: +10 on Fellowship-based tests against the flagged Peer Group', () => {
    const charm = resolveTest({ target: 40, testName: 'Charm', talents: ['Peer (Underworld)'], circumstances: ['Peer Group'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(charm.modifiers.peer, 10);
    assert.equal(charm.success, true);                         // 45 ≤ 50 only WITH the bonus
    // not interacting with the group: no bonus
    const stranger = resolveTest({ target: 40, testName: 'Charm', talents: ['Peer (Underworld)'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(stranger.modifiers.peer, undefined);
    // non-Fellowship test: no bonus even with the flag
    const medicae = resolveTest({ target: 40, testName: 'Medicae', talents: ['Peer (Underworld)'], circumstances: ['Peer Group'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(medicae.modifiers.peer, undefined);
});

// --- Double Tap (p.125) ------------------------------------------------------
test('Double Tap: +20 on the GM-flagged follow-up ranged attack', () => {
    const followUp = resolveAttack(shoot({ talents: ['Double Tap'], circumstances: ['Follow-Up Shot'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(followUp.test.modifiers['double tap'], 20);
    const first = resolveAttack(shoot({ talents: ['Double Tap'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(first.test.modifiers['double tap'], undefined);
});

// --- Counter Attack (p.125) --------------------------------------------------
test('Counter Attack: the riposte advisory fires only on a successful Parry', () => {
    const parried = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Sword', qualities: [] }, talents: ['Counter Attack'] },
        riggedDice([d100(30)]), buildRegistry());
    assert.equal(parried.test.success, true);
    assert.ok(parried.effects.some((e) => e.name === 'Counter Attack' && /-20/.test(e.effect)));
    const failed = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Sword', qualities: [] }, talents: ['Counter Attack'] },
        riggedDice([d100(80)]), buildRegistry());
    assert.ok(!failed.effects.some((e) => e.name === 'Counter Attack'));
    const untalented = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Sword', qualities: [] } },
        riggedDice([d100(30)]), buildRegistry());
    assert.ok(!untalented.effects.some((e) => e.name === 'Counter Attack'));
});

// --- Mounted Warrior (Enemies Within p.58) -----------------------------------
test('Mounted Warrior offsets 10 of the GM-flagged mounted penalty, per specialisation', () => {
    const ranged = resolveAttack(shoot({ talents: ['Mounted Warrior (Ranged)'], circumstances: ['Mounted'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(ranged.test.modifiers['mounted warrior'], 10);
    // wrong specialisation for the attack type: no offset
    const wrongSpec = resolveAttack(shoot({ talents: ['Mounted Warrior (Melee)'], circumstances: ['Mounted'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(wrongSpec.test.modifiers['mounted warrior'], undefined);
    // bare entry (specialisation not recorded) applies to both
    const bareMelee = resolveAttack(swing({ talents: ['Mounted Warrior'], circumstances: ['Mounted'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(bareMelee.test.modifiers['mounted warrior'], 10);
    // not mounted: nothing
    const onFoot = resolveAttack(shoot({ talents: ['Mounted Warrior (Ranged)'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(onFoot.test.modifiers['mounted warrior'], undefined);
});

// --- Eye of Vengeance (p.127) ------------------------------------------------
test('Eye of Vengeance (Fate toggle on): +DoS to damage and penetration of the shot', () => {
    // BS 45 + Standard +10 → target 55; roll 15 → DoS 5.
    const r = resolveAttack(shoot({ talents: ['Eye of Vengeance'], configs: ['Eye of Vengeance'] }),
        riggedDice([d100(15), die(7, 10)]), buildRegistry());
    assert.equal(r.test.dos, 5);
    assert.equal(r.hits[0].damage.modifiers['eye of vengeance'], 5);
    assert.equal(r.hits[0].penetrationModifiers['eye of vengeance'], 5);
    assert.equal(r.hits[0].totalPenetration, 7);               // base 2 + DoS 5
    assert.ok(r.effects.some((e) => e.name === 'Eye of Vengeance' && /Fate/.test(e.effect)));
});

test('Eye of Vengeance without the Fate spend (or the talent) adds nothing', () => {
    const noSpend = resolveAttack(shoot({ talents: ['Eye of Vengeance'] }),
        riggedDice([d100(15), die(7, 10)]), buildRegistry());
    assert.equal(noSpend.hits[0].damage.modifiers['eye of vengeance'], undefined);
    assert.equal(noSpend.hits[0].totalPenetration, 2);
    assert.ok(!noSpend.effects.some((e) => e.name === 'Eye of Vengeance'));
    const noTalent = resolveAttack(shoot({ configs: ['Eye of Vengeance'] }),
        riggedDice([d100(15), die(7, 10)]), buildRegistry());
    assert.equal(noTalent.hits[0].totalPenetration, 2);
});

// --- Grenadier (Enemies Without p.62) ----------------------------------------
const FRAG = { name: 'Frag Grenade', isMelee: false, damage: '2d10', pen: 0, damageType: 'Explosive', rof: { single: true, burst: 0, full: 0 }, qualities: ['Blast (3)'] };

test('Grenadier reduces a Blast miss\'s scatter by half BS bonus, floored at 0', () => {
    // BS 40 (BSB 4 → half = 2), Standard +10 → target 50; roll 80 → miss.
    // Dice: attack, scatter base 1d5, direction 1d10, detonation 2d10.
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack', talents: ['Grenadier'] },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(4, 10), die(6, 10)]), buildRegistry());
    assert.equal(r.scatter.baseDistance, 3);                   // Blast's 1d5
    assert.equal(r.scatter.modifiers.grenadier, -2);           // −half(BSB 4)
    assert.equal(r.scatter.distance, 1);
    // without the talent the 1d5 stands untouched
    const bare = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: FRAG, action: 'Standard Attack' },
        riggedDice([d100(80), die(3, 5), die(7, 10), die(4, 10), die(6, 10)]), buildRegistry());
    assert.equal(bare.scatter.modifiers.grenadier, undefined);
    assert.equal(bare.scatter.distance, 3);
});

// --- Push the Limit (Enemies Without p.63) -----------------------------------
test('Push the Limit: +20 on a declared Operate test; DoF 4+ rolls the crit advisory', () => {
    const pushed = resolveTest({ target: 30, testName: 'Operate', talents: ['Push the Limit'], conditions: ['Push the Limit'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(pushed.modifiers['push the limit'], 20);
    assert.equal(pushed.success, true);                        // 45 ≤ 50 only WITH the +20
    assert.ok(!pushed.effects.some((e) => e.name === 'Push the Limit'));   // no crit advisory on a pass
    // catastrophic failure: target 50, roll 99 → DoF 5 → Motive Systems advisory
    const wreck = resolveTest({ target: 30, testName: 'Operate', talents: ['Push the Limit'], conditions: ['Push the Limit'] },
        riggedDice([d100(99)]), buildRegistry());
    assert.ok(wreck.effects.some((e) => e.name === 'Push the Limit' && /Motive Systems/.test(e.effect)));
    // not declared this round: no bonus
    const undeclared = resolveTest({ target: 30, testName: 'Operate', talents: ['Push the Limit'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(undeclared.modifiers['push the limit'], undefined);
    // wrong test: no bonus even when declared
    const athletics = resolveTest({ target: 30, testName: 'Athletics', talents: ['Push the Limit'], conditions: ['Push the Limit'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(athletics.modifiers['push the limit'], undefined);
});

// --- Superior Chirurgeon (p.131) ---------------------------------------------
test('Superior Chirurgeon: +20 to Medicae with the first-aid advisory, nothing elsewhere', () => {
    const medicae = resolveTest({ target: 40, testName: 'Medicae', talents: ['Superior Chirurgeon'] },
        riggedDice([d100(55)]), buildRegistry());
    assert.equal(medicae.modifiers['superior chirurgeon'], 20);
    assert.equal(medicae.success, true);                       // 55 ≤ 60 only WITH the talent
    assert.ok(medicae.effects.some((e) => e.name === 'Superior Chirurgeon' && /first aid/.test(e.effect)));
    const aware = resolveTest({ target: 40, testName: 'Awareness', talents: ['Superior Chirurgeon'] },
        riggedDice([d100(55)]), buildRegistry());
    assert.equal(aware.modifiers['superior chirurgeon'], undefined);
});

// --- Coordinated Interrogation (p.124) ---------------------------------------
test('Coordinated Interrogation: +10 to Interrogation plus the assistance advisory', () => {
    const r = resolveTest({ target: 40, testName: 'Interrogation', talents: ['Coordinated Interrogation'] },
        riggedDice([d100(45)]), buildRegistry());
    assert.equal(r.modifiers['coordinated interrogation'], 10);
    assert.ok(r.effects.some((e) => e.name === 'Coordinated Interrogation' && /\+5/.test(e.effect)));
    const bare = resolveTest({ target: 40, testName: 'Interrogation' }, riggedDice([d100(45)]), buildRegistry());
    assert.equal(bare.modifiers['coordinated interrogation'], undefined);
});

// --- Divine Protection (Enemies Within p.57) ---------------------------------
test('Divine Protection: Spray attacks surface the allies-unharmed advisory', () => {
    const flamer = { name: 'Flamer', isMelee: false, damage: '1d10+2', pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Spray'] };
    const blessed = resolveAttack({
        characteristics: { bs: 30, s: 30, t: 30 }, weapon: flamer, action: 'Standard Attack',
        talents: ['Divine Protection'], autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 40 },
    }, riggedDice([die(5, 10), d100(90)]), buildRegistry());
    assert.ok(blessed.effects.some((e) => e.name === 'Divine Protection' && /allies/.test(e.effect)));
    const mundane = resolveAttack({
        characteristics: { bs: 30, s: 30, t: 30 }, weapon: flamer, action: 'Standard Attack',
        autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 40 },
    }, riggedDice([die(5, 10), d100(90)]), buildRegistry());
    assert.ok(!mundane.effects.some((e) => e.name === 'Divine Protection'));
    // a non-Spray weapon gains nothing from the talent
    const gun = resolveAttack(shoot({ talents: ['Divine Protection'] }),
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.ok(!gun.effects.some((e) => e.name === 'Divine Protection'));
});

// --- Baneful Presence circumstance + Iron Faith (core p.135 / Beyond p.61) ----
test('Baneful Presence: -10 to Willpower-based tests in the radius; Iron Faith is immune', () => {
    const cowed = resolveTest({ target: 40, testName: 'Willpower', circumstances: ['Baneful Presence'] },
        riggedDice([d100(35)]), buildRegistry());
    assert.equal(cowed.modifiers['baneful presence'], -10);
    assert.equal(cowed.success, false);                        // 35 > 30
    const fear = resolveTest({ target: 40, testName: 'Fear', circumstances: ['Baneful Presence'] },
        riggedDice([d100(35)]), buildRegistry());
    assert.equal(fear.modifiers['baneful presence'], -10);
    const faithful = resolveTest({ target: 40, testName: 'Willpower', talents: ['Iron Faith'], circumstances: ['Baneful Presence'] },
        riggedDice([d100(35)]), buildRegistry());
    assert.equal(faithful.modifiers['baneful presence'], undefined);
    assert.equal(faithful.success, true);
    // non-Willpower tests are untouched by the aura
    const aware = resolveTest({ target: 40, testName: 'Awareness', circumstances: ['Baneful Presence'] },
        riggedDice([d100(35)]), buildRegistry());
    assert.equal(aware.modifiers['baneful presence'], undefined);
});
