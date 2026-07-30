/**
 * Combat-action / range-band / aim reference data — DH2 Core Table 7–1
 * (p.218) and the difficulty table (p.229).
 *
 * This module was hand-ported out of dark-heresy-3rd-edition's
 * module/rules/combat-actions.mjs and had NO direct test file, which is how
 * the sibling hit-location port kept a rules bug for as long as it did. Every
 * number below was grep-confirmed against _pdf_text/dh19_core.txt in the DH2
 * corpus on 2026-07-30; the quoted Table 7–1 text is in each assertion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES, canonicalAction,
} from '../lib/rules/combat-actions.mjs';

// --- Table 7-1 modifiers -----------------------------------------------------

test('attack-action modifiers match Table 7-1 (p.218)', () => {
    // "Standard Attack ... +10 to WS or BS, make one melee or ranged attack."
    assert.equal(COMBAT_ACTIONS['Standard Attack'].modifier, 10);
    // "All Out Attack ... Give up that round's Evasion reaction to gain +30 WS."
    assert.equal(COMBAT_ACTIONS['All Out Attack'].modifier, 30);
    // "Charge ... Must move at least 4 metres, +20 to WS."
    assert.equal(COMBAT_ACTIONS['Charge'].modifier, 20);
    // "Called Shot ... Attack a specific location on a target with a -20 to WS or BS."
    assert.equal(COMBAT_ACTIONS['Called Shot'].modifier, -20);
    // "Swift Attack ... +0 WS, additional hit for every two additional degrees of success."
    assert.equal(COMBAT_ACTIONS['Swift Attack'].modifier, 0);
    // "Lightning Attack ... -10 WS, one hit for every degree of success."
    assert.equal(COMBAT_ACTIONS['Lightning Attack'].modifier, -10);
    // "Semi-Auto Burst ... +0 BS, additional hit for every two additional degrees of success."
    assert.equal(COMBAT_ACTIONS['Semi-Auto Burst'].modifier, 0);
    // "Full Auto Burst ... -10 BS, one hit for every degree of success."
    assert.equal(COMBAT_ACTIONS['Full Auto Burst'].modifier, -10);
    // "Suppressing Fire ... -20 BS against targets entering Semi- or Full Auto fire arc."
    assert.equal(COMBAT_ACTIONS['Suppressing Fire (Semi)'].modifier, -20);
    assert.equal(COMBAT_ACTIONS['Suppressing Fire (Full)'].modifier, -20);
});

test('melee/ranged legality matches the Table 7-1 SUBTYPE column', () => {
    const meleeOnly = ['All Out Attack', 'Charge', 'Swift Attack', 'Lightning Attack'];
    const rangedOnly = ['Semi-Auto Burst', 'Full Auto Burst',
        'Suppressing Fire (Semi)', 'Suppressing Fire (Full)'];
    const both = ['Standard Attack', 'Called Shot'];

    for (const a of meleeOnly) {
        assert.equal(COMBAT_ACTIONS[a].melee, true, `${a} is Attack, Melee`);
        assert.equal(COMBAT_ACTIONS[a].ranged, false, `${a} is melee-only`);
    }
    for (const a of rangedOnly) {
        assert.equal(COMBAT_ACTIONS[a].melee, false, `${a} is ranged-only`);
        assert.equal(COMBAT_ACTIONS[a].ranged, true, `${a} is Attack, Ranged`);
    }
    for (const a of both) {
        assert.equal(COMBAT_ACTIONS[a].melee, true, `${a} is "Melee or Ranged"`);
        assert.equal(COMBAT_ACTIONS[a].ranged, true, `${a} is "Melee or Ranged"`);
    }
});

test('every action declares a valid hit rate', () => {
    for (const [name, info] of Object.entries(COMBAT_ACTIONS)) {
        assert.ok(['single', 'semi', 'full'].includes(info.rate), `${name} rate=${info.rate}`);
    }
});

test('one-hit actions are rate "single"', () => {
    for (const a of ['Standard Attack', 'All Out Attack', 'Charge', 'Called Shot']) {
        assert.equal(COMBAT_ACTIONS[a].rate, 'single', a);
    }
});

test('the melee multi-attacks cap on WS bonus, not on weapon RoF', () => {
    // Swift/Lightning are melee, so there is no RoF to cap against (p.223/225).
    assert.equal(COMBAT_ACTIONS['Swift Attack'].cap, 'wsb');
    assert.equal(COMBAT_ACTIONS['Lightning Attack'].cap, 'wsb');
    // No ranged action caps on WS bonus.
    for (const [name, info] of Object.entries(COMBAT_ACTIONS)) {
        if (info.cap === 'wsb') assert.equal(info.melee, true, `${name} caps on wsb so must be melee`);
    }
});

test('the melee multi-attacks are gated by their same-named talent', () => {
    assert.equal(COMBAT_ACTIONS['Swift Attack'].talent, 'Swift Attack');
    assert.equal(COMBAT_ACTIONS['Lightning Attack'].talent, 'Lightning Attack');
});

test('Suppressing Fire (Full) accrues hits at the semi rate but caps at full RoF (p.224)', () => {
    const full = COMBAT_ACTIONS['Suppressing Fire (Full)'];
    assert.equal(full.rate, 'full', 'cap comes from the full-auto RoF');
    assert.equal(full.hitAccrual, 'semi', 'but hits accrue per 2 DoS');
    // The semi variant needs no override — its accrual already equals its rate.
    assert.equal(COMBAT_ACTIONS['Suppressing Fire (Semi)'].hitAccrual, undefined);
});

// --- Range bands and aim -----------------------------------------------------

test('range-band modifiers match the difficulty table (p.229)', () => {
    // "Easy +30 Bonus — Shooting a target at Point Blank range."
    assert.equal(RANGE_BANDS['Point Blank'], 30);
    // "Ordinary +10 Bonus — Shooting a target at Short range."
    assert.equal(RANGE_BANDS['Short Range'], 10);
    assert.equal(RANGE_BANDS['Normal Range'], 0);
    assert.equal(RANGE_BANDS['Long Range'], -10);
    assert.equal(RANGE_BANDS['Extreme Range'], -30);
    // Melee attacks take no range modifier.
    assert.equal(RANGE_BANDS['Melee'], 0);
});

test('aim modifiers match Table 7-1: "+10 (Half) or +20 (Full)"', () => {
    assert.equal(AIM_MODES['None'], 0);
    assert.equal(AIM_MODES['Half'], 10);
    assert.equal(AIM_MODES['Full'], 20);
});

// --- Name canonicalisation ---------------------------------------------------

test('canonicalAction is blind to spacing, case and separators', () => {
    for (const spelling of ['Swift Attack', 'swift_attack', 'SwiftAttack', 'SWIFT-ATTACK', 'swiftattack']) {
        assert.equal(canonicalAction(spelling), 'Swift Attack', spelling);
    }
});

test('canonicalAction returns null for a non-attack action', () => {
    // Parry/Dodge are Reactions, not entries in COMBAT_ACTIONS; the engine
    // falls back to the caller's own action string for these.
    assert.equal(canonicalAction('Parry'), null);
    assert.equal(canonicalAction('Full Defence'), null);
});

test('canonicalAction tolerates null and undefined', () => {
    assert.equal(canonicalAction(null), null);
    assert.equal(canonicalAction(undefined), null);
});
