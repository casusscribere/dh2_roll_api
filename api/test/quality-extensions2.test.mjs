/**
 * Second batch of weapon-quality extensions — Inaccurate, Lance, Shocking,
 * Snare, Scatter, Sanctified (Holy + Daemonic negation), Toxic/Toxified, plus
 * the mutually-exclusive quality conflict detector. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, resolveEngagement, resolveParry } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { findQualityConflicts } from '../lib/rules/quality-conflicts.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const ranged = (qualities, damage = '1d10', extra = {}) => ({ name: 'Gun', isMelee: false, damage, pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities, ...extra });

// --- (1) Inaccurate ----------------------------------------------------------
test('Inaccurate cancels the Aim bonus; a plain weapon keeps it', () => {
    const plain = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: ranged([]), action: 'Standard Attack', aim: 'Full' },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(plain.test.modifiers.aim, 20);                 // Full Aim = +20
    const inacc = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: ranged(['Inaccurate']), action: 'Standard Attack', aim: 'Full' },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(inacc.test.modifiers.aim, undefined);          // no benefit from Aim
});

// --- (2) Lance ---------------------------------------------------------------
test('Lance adds base penetration once per degree of success', () => {
    const r = resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: ranged(['Lance'], '1d10', { pen: 5 }), action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 } },
        riggedDice([d100(11), die(5, 10)]), buildRegistry());
    const dos = r.test.dos;
    assert.ok(dos >= 1);
    assert.equal(r.hits[0].penetrationModifiers.lance, 5 * dos);     // base pen × DoS
    assert.equal(r.hits[0].totalPenetration, 5 + 5 * dos);          // base + bonus
});

// --- (2) Shocking ------------------------------------------------------------
test('Shocking forces a Toughness test → Stunned only when the hit wounds', () => {
    const wounding = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Shocking']), action: 'Standard Attack', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, toughness: 30 } },
        riggedDice([d100(20), die(5, 10), d100(80)]), buildRegistry());   // 5 dmg, 0 soak → wounds; test 80 fails
    const t = wounding.hits[0].targetEffects.tests[0];
    assert.equal(t.characteristic, 'Toughness');
    assert.equal(t.resolved.success, false);
    assert.deepEqual(wounding.hits[0].targetEffects.statuses.map((s) => s.status), ['Stunned']);

    const soaked = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Shocking']), action: 'Standard Attack', autoResolveTests: true, target: { armour: 10, toughnessBonus: 5, toughness: 30 } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());   // 5 dmg vs 15 soak → 0 wounds
    assert.equal(soaked.hits[0].targetEffects, undefined);      // no test declared
});

// --- (2) Snare ---------------------------------------------------------------
test('Snare (2) forces an Agility test at -20 → Immobilised on a fail', () => {
    const r = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Snare (2)']), action: 'Standard Attack', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 40 } },
        riggedDice([d100(20), die(5, 10), d100(80)]), buildRegistry());
    const t = r.hits[0].targetEffects.tests[0];
    assert.equal(t.characteristic, 'Agility');
    assert.equal(t.modifier, -20);                              // -10 × 2
    assert.equal(t.resolved.modifiedTarget, 20);               // Ag 40 − 20
    assert.deepEqual(r.hits[0].targetEffects.statuses.map((s) => s.status), ['Immobilised']);
});

// --- (4) Scatter (the quality, not the scatter mechanic) ---------------------
test('Scatter: +10 hit & +3 dmg at Point Blank, +10 hit at Short, -3 dmg at longer', () => {
    const at = (rangeBand) => resolveAttack({ characteristics: { bs: 40, s: 30, t: 30 }, weapon: ranged(['Scatter']), action: 'Standard Attack', rangeBand, target: { armour: 0, toughnessBonus: 0 } },
        riggedDice([d100(15), die(5, 10)]), buildRegistry());
    const pb = at('Point Blank');
    assert.equal(pb.test.modifiers['scatter (close)'], 10);
    assert.equal(pb.hits[0].damage.modifiers.scatter, 3);
    const sh = at('Short Range');
    assert.equal(sh.test.modifiers['scatter (close)'], 10);
    assert.equal(sh.hits[0].damage.modifiers.scatter, undefined);   // no damage change at Short
    const lg = at('Long Range');
    assert.equal(lg.test.modifiers['scatter (close)'], undefined);
    assert.equal(lg.hits[0].damage.modifiers.scatter, -3);
});

// --- (3) Sanctified ----------------------------------------------------------
test('Sanctified makes the damage count as Holy', () => {
    const r = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Sanctified']), action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(r.hits[0].damageType, 'Holy');
    assert.equal(r.hits[0].damage.damageType, 'Holy');
});

test('Sanctified negates a Daemonic target\'s Unnatural Toughness (Holy attack)', () => {
    const target = { armour: 0, toughnessBonus: 3, unnaturalToughness: 4, traits: ['Daemonic (4)'] };
    const shot = (qualities) => resolveAttack({ characteristics: { bs: 60, s: 30, t: 30 }, weapon: ranged(qualities), action: 'Standard Attack', target },
        riggedDice([d100(20), die(8, 10)]), buildRegistry());
    const plain = shot([]);
    assert.equal(plain.hits[0].soak.effectiveUnnatural, 4);     // full Daemonic UT applies
    assert.equal(plain.hits[0].soak.reduction, 7);             // TB 3 + UT 4
    const holy = shot(['Sanctified']);
    assert.equal(holy.hits[0].soak.effectiveUnnatural, 0);     // negated by Holy
    assert.equal(holy.hits[0].soak.reduction, 3);              // TB 3 only
});

test('Sanctified does NOT touch Unnatural Toughness on a non-Daemonic target', () => {
    const r = resolveAttack({ characteristics: { bs: 60, s: 30, t: 30 }, weapon: ranged(['Sanctified']), action: 'Standard Attack', target: { armour: 0, toughnessBonus: 3, unnaturalToughness: 4 } },
        riggedDice([d100(20), die(8, 10)]), buildRegistry());
    assert.equal(r.hits[0].soak.effectiveUnnatural, 4);        // untouched (not Daemonic)
});

test('Sanctified negates Daemonic Unnatural Toughness through the stepped engagement too', () => {
    const r = resolveEngagement({
        attacker: { characteristics: { bs: 60, s: 30, t: 30 }, weapon: ranged(['Sanctified']), action: 'Standard Attack' },
        defender: { armour: 0, toughnessBonus: 3, unnaturalToughness: 4, traits: ['Daemonic (4)'] },
        options: {},
    }, riggedDice([d100(20), die(8, 10)]), buildRegistry());
    const hit = r.attack.hits[0];
    assert.equal(hit.damageType, 'Holy');
    assert.equal(hit.soak.effectiveUnnatural, 0);   // UT negated in phase ①, carried to soak
    assert.equal(hit.soak.reduction, 3);            // TB 3 only
});

// --- (6) Toxic / Toxified ----------------------------------------------------
test('Toxic (3) inflicts the Toxified condition (severity 3) when the hit wounds', () => {
    const r = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Toxic (3)']), action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    const st = r.hits[0].targetEffects.statuses[0];
    assert.equal(st.status, 'Toxified');
    assert.equal(st.value, 3);
    // no wound → no Toxified
    const soaked = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Toxic (3)']), action: 'Standard Attack', target: { armour: 10, toughnessBonus: 5 } },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.equal(soaked.hits[0].targetEffects, undefined);
});

// --- Unbalanced / Unwieldy / Power Field (parry qualities) ------------------
const melee = (qualities, extra = {}) => ({ name: 'Blade', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 3 }, qualities, ...extra });

test('Unbalanced: -10 to Parry, and a note when used for a Lightning Attack', () => {
    const p = resolveParry({ characteristics: { ws: 50 }, weapon: melee(['Unbalanced']) }, riggedDice([d100(40)]), buildRegistry());
    assert.equal(p.test.modifiers.unbalanced, -10);
    const la = resolveAttack({ characteristics: { ws: 60, s: 30, t: 30 }, weapon: melee(['Unbalanced']), action: 'Lightning Attack' },
        riggedDice([d100(50), die(5, 10)]), buildRegistry());   // roll 50 → 1 DoS → single hit
    assert.ok(la.effects.some((e) => e.name === 'Unbalanced'));
});

test('Unwieldy cannot Parry — the parry flow refuses the reaction', () => {
    const p = resolveParry({ characteristics: { ws: 60 }, weapon: melee(['Unwieldy']) }, riggedDice([d100(10)]), buildRegistry());
    assert.equal(p.prevented, true);
    assert.match(p.note, /Unwieldy/);
    assert.equal(p.test.success, false);
    // through the engagement: an Unwieldy defender weapon evades nothing
    const r = resolveEngagement({
        attacker: { characteristics: { ws: 60, s: 30, t: 30 }, weapon: melee([]), action: 'Standard Attack' },
        defender: { characteristics: { ws: 60, t: 30 }, armour: 0, toughnessBonus: 3, weapon: melee(['Unwieldy']), evasion: { mode: 'parry' } },
        options: {},
    }, riggedDice([d100(20), die(5, 10), d100(10)]), buildRegistry());
    assert.equal(r.reaction.prevented, true);
    assert.equal(r.defender.evaded, 0);
});

test('Power Field destroys the attacker\'s weapon on a successful parry (26+), but is immune vs Force', () => {
    const engage = (attackerQualities, pfRoll) => resolveEngagement({
        attacker: { characteristics: { ws: 50, s: 30, t: 30 }, weapon: melee(attackerQualities), action: 'Standard Attack' },
        defender: { characteristics: { ws: 60, t: 30 }, armour: 0, toughnessBonus: 3, weapon: melee(['Power Field']), evasion: { mode: 'parry' } },
        options: {},
    }, riggedDice([d100(30), die(5, 10), d100(20), d100(pfRoll)]), buildRegistry());
    const destroyed = engage([], 30);                          // attacker weapon plain → eligible
    assert.equal(destroyed.reaction.test.success, true);       // parry landed
    assert.equal(destroyed.reaction.tableRolls[0].table, 'Power Field Destruction');
    assert.equal(destroyed.reaction.tableRolls[0].roll, 30);
    assert.match(destroyed.reaction.tableRolls[0].text, /DESTROYED/);
    const safe = engage([], 10);                               // roll 10 → survives
    assert.match(safe.reaction.tableRolls[0].text, /survives/);
    const immune = engage(['Force'], 30);                      // attacker weapon is Force → immune
    assert.equal(immune.reaction.tableRolls, undefined);       // no destruction roll
});

test('Power Field does not roll on a bare /api/parry test (no opposing weapon)', () => {
    const p = resolveParry({ characteristics: { ws: 70 }, weapon: melee(['Power Field']) }, riggedDice([d100(10)]), buildRegistry());
    assert.equal(p.test.success, true);
    assert.equal(p.tableRolls, undefined);   // opposing_present is false
});

// --- (4) Lance + Melta both scale off the BASE penetration ------------------
test('Lance and Melta each modify base penetration independently (no compounding)', () => {
    const r = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 },
        weapon: { name: 'Conversion Beamer', isMelee: false, damage: '1d10', pen: 5, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Lance', 'Melta'] },
        action: 'Standard Attack', rangeBand: 'Short Range', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(11), die(5, 10)]), buildRegistry());
    const dos = r.test.dos;
    const pm = r.hits[0].penetrationModifiers;
    assert.equal(pm.lance, 5 * dos);                  // base 5 × DoS
    assert.equal(pm.melta, 5);                        // base 5 (NOT 5 + lance) — reads base pen
    assert.equal(r.hits[0].totalPenetration, 5 + 5 * dos + 5);   // base + lance + melta
});

// --- (1) mutual-exclusion conflict detector ---------------------------------
test('findQualityConflicts flags opposed qualities and ignores clean lists', () => {
    assert.deepEqual(findQualityConflicts(['Reliable', 'Unreliable']), [{ axis: 'reliability', members: ['Reliable', 'Unreliable'] }]);
    assert.deepEqual(findQualityConflicts(['Accurate']), []);
    assert.equal(findQualityConflicts(['Unwieldy', 'Balanced']).length, 1);
});

test('a weapon carrying opposed qualities surfaces a Quality conflict warning', () => {
    const r = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Reliable', 'Unreliable']), action: 'Standard Attack' },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    const warn = r.effects.find((e) => e.name === 'Quality conflict');
    assert.ok(warn, 'expected a Quality conflict effect');
    assert.match(warn.effect, /Reliable \+ Unreliable/);
    // a clean weapon has no such warning
    const clean = resolveAttack({ characteristics: { bs: 50, s: 30, t: 30 }, weapon: ranged(['Reliable']), action: 'Standard Attack' },
        riggedDice([d100(20), die(5, 10)]), buildRegistry());
    assert.ok(!clean.effects.some((e) => e.name === 'Quality conflict'));
});
