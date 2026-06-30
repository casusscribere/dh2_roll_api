/**
 * On-hit target effects (Concussive / Crippling) at the ON_HIT checkpoint,
 * with the auto-resolve toggle — node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const maul = (qualities) => ({ name: 'Maul', isMelee: true, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities });

test('Concussive declares a Toughness test (-10*X) and Prone when damage > target SB', () => {
    const r = resolveAttack({
        characteristics: { ws: 50, s: 30, t: 30 }, weapon: maul(['Concussive (2)']), action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 3, strength: 30 },        // target SB 3
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());
    const te = r.hits[0].targetEffects;
    assert.equal(te.tests[0].characteristic, 'Toughness');
    assert.equal(te.tests[0].modifier, -20);                          // -10 * 2
    assert.match(te.tests[0].onFail, /Stunned/);
    assert.deepEqual(te.statuses.map((s) => s.status), ['Prone']);    // damage 5+SB3=8 > 3
    assert.equal(te.tests[0].resolved, undefined);                    // not auto-resolved
});

test('auto-resolve rolls the Concussive Toughness test against the target', () => {
    const r = resolveAttack({
        characteristics: { ws: 50, s: 30, t: 30 }, weapon: maul(['Concussive (1)']), action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 3, toughness: 40, strength: 30 }, autoResolveTests: true,
    }, riggedDice([d100(20), die(5, 10), d100(55)]), buildRegistry());
    const t = r.hits[0].targetEffects.tests[0];
    assert.equal(t.modifier, -10);
    assert.equal(t.resolved.modifiedTarget, 30);                      // T40 - 10
    assert.equal(t.resolved.success, false);                         // roll 55 > 30
    assert.match(t.resolved.outcome, /Stunned/);
});

test('Crippling applies Crippled when the hit inflicts wounds, but not otherwise', () => {
    const hook = (target) => resolveAttack({
        characteristics: { ws: 50, s: 30, t: 30 },
        weapon: { name: 'Hook', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Crippling (2)'] },
        action: 'Standard Attack', target,
    }, riggedDice([d100(20), die(5, 10)]), buildRegistry());

    const wounded = hook({ armour: 0, toughnessBonus: 0 });           // 8 dmg, 0 soak → 8 wounds
    assert.deepEqual(wounded.hits[0].targetEffects.statuses.map((s) => s.status), ['Crippled']);
    // the Crippled status carries the quality's severity (Crippling (2) → 2)
    assert.equal(wounded.hits[0].targetEffects.statuses[0].value, 2);

    const soaked = hook({ armour: 20, toughnessBonus: 5 });           // soak 25 → 0 wounds
    assert.equal(soaked.hits[0].targetEffects, undefined);
});

// --- Corrosive (DH2 core p.145) ---------------------------------------------
const acidGun = (qualities = ['Corrosive']) => ({ name: 'Acid Spray', isMelee: false, damage: '1d10', pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities });

test('Corrosive corrodes the struck location armour; overflow becomes Toughness-ignoring wounds', () => {
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: acidGun(), action: 'Standard Attack',
        target: { armour: 4, toughnessBonus: 3 },
    }, riggedDice([d100(20), die(5, 10), die(7, 10)]), buildRegistry());   // hit, dmg 5, corrode 7
    const ar = r.hits[0].targetEffects.armour[0];
    assert.equal(ar.rolled, 7);
    assert.equal(ar.apBefore, 4);
    assert.equal(ar.apAfter, 0);                       // armour corroded away
    assert.equal(ar.excessToWounds, 3);                // 7 − 4
    assert.equal(ar.source, 'Corrosive');
    assert.equal(r.hits[0].soak.woundsInflicted, 0);   // normal 5 dmg fully soaked (4 armour + 3 TB)
    assert.equal(r.hits[0].corrosiveWounds, 3);
    assert.equal(r.totalWounds, 3);                    // soak 0 + corrosive overflow 3
});

test('Corrosive overflow ignores Toughness and applies in full when unarmoured', () => {
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 }, weapon: acidGun(), action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 5 },                          // high TB, no armour
    }, riggedDice([d100(20), die(2, 10), die(6, 10)]), buildRegistry());
    const ar = r.hits[0].targetEffects.armour[0];
    assert.equal(ar.apBefore, 0);
    assert.equal(ar.excessToWounds, 6);                // whole 1d10, unarmoured
    assert.equal(r.hits[0].soak.woundsInflicted, 0);   // normal 2 dmg soaked by TB 5
    assert.equal(r.totalWounds, 6);                    // overflow is NOT reduced by Toughness
});

test('Corrosive armour loss is cumulative across hits on the same location', () => {
    const r = resolveAttack({
        characteristics: { bs: 60, s: 30, t: 30 }, weapon: acidGun(['Corrosive', 'Twin-Linked']),
        action: 'Called Shot', calledShotLocation: 'Body', target: { armour: 5, toughnessBonus: 0 },
    }, riggedDice([d100(10), die(1, 10), die(4, 10), die(1, 10), die(4, 10)]), buildRegistry());
    assert.equal(r.hits.length, 2);                            // Twin-Linked +1 hit (dos > 1)
    assert.equal(r.hits[0].targetEffects.armour[0].apAfter, 1);       // 5 − 4
    assert.equal(r.hits[1].soak.armour, 1);                          // 2nd hit soaks vs corroded armour
    assert.equal(r.hits[1].targetEffects.armour[0].apBefore, 1);
    assert.equal(r.hits[1].targetEffects.armour[0].excessToWounds, 3); // 4 − 1
    assert.equal(r.totalWounds, 3);
});
// --- Felling (DH2 core p.145) -----------------------------------------------
test('Felling reduces only the target Unnatural Toughness for soak, never base TB', () => {
    const target = { armour: 0, toughnessBonus: 4, unnaturalToughness: 4 };
    const axe = (qualities) => resolveAttack({
        characteristics: { ws: 60, s: 30, t: 30 },
        weapon: { name: 'Axe', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities },
        action: 'Standard Attack', target,
    }, riggedDice([d100(20), die(8, 10)]), buildRegistry());   // dmg 8 + SB 3 = 11
    const plain = axe([]);
    assert.equal(plain.hits[0].soak.reduction, 8);            // 0 armour + TB 4 + Unnatural 4
    assert.equal(plain.hits[0].soak.woundsInflicted, 3);
    const fell = axe(['Felling (2)']);
    assert.equal(fell.hits[0].soak.effectiveUnnatural, 2);    // 4 − 2
    assert.equal(fell.hits[0].soak.reduction, 6);             // TB 4 + Unnatural 2 (base TB untouched)
    assert.equal(fell.hits[0].soak.woundsInflicted, 5);
    const overFell = axe(['Felling (6)']);
    assert.equal(overFell.hits[0].soak.effectiveUnnatural, 0); // clamped at 0
    assert.equal(overFell.hits[0].soak.reduction, 4);          // base TB only — never below
});

// --- Flame + On Fire (DH2 core p.145 / p.243) -------------------------------
test('Flame forces an Agility test; On Fire is applied on a failure, not on a pass', () => {
    const flamer = (agRoll) => resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 },
        weapon: { name: 'Flamer', isMelee: false, damage: '1d10+2', pen: 2, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Flame'] },
        action: 'Standard Attack', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 30 },
    }, riggedDice([d100(20), die(5, 10), d100(agRoll)]), buildRegistry());
    const burned = flamer(80);                                // Ag threshold 30, roll 80 → fail
    assert.equal(burned.hits[0].targetEffects.tests[0].characteristic, 'Agility');
    assert.equal(burned.hits[0].targetEffects.tests[0].resolved.success, false);
    assert.deepEqual(burned.hits[0].targetEffects.statuses.map((s) => s.status), ['On Fire']);
    const safe = flamer(10);                                  // roll 10 → pass, no On Fire
    assert.equal(safe.hits[0].targetEffects.tests[0].resolved.success, true);
    assert.equal(safe.hits[0].targetEffects.statuses?.length ?? 0, 0);
});

test('Flame applies On Fire with a duration (listed in the resolution log)', () => {
    const r = resolveAttack({
        characteristics: { bs: 50, s: 30, t: 30 },
        weapon: { name: 'Flamer', isMelee: false, damage: '1d10+2', pen: 2, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Flame'] },
        action: 'Standard Attack', autoResolveTests: true, target: { armour: 0, toughnessBonus: 0, agility: 30 },
    }, riggedDice([d100(20), die(5, 10), d100(80)]), buildRegistry());   // Ag fail → On Fire
    const st = r.hits[0].targetEffects.statuses[0];
    assert.equal(st.status, 'On Fire');
    assert.equal(st.duration, 'until extinguished');
});
