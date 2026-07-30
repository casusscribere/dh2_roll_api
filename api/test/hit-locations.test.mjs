/**
 * Hit location — DH2 Core p.226, "Step Three: Attacker Determines Hit Location",
 * Table 7–3. The rule reverses the roll's TWO digits:
 *
 *   "reverse the order of the digits (e.g., a roll of 32 becomes 23, a roll of
 *    20 becomes 02, and so on) and compare this number to Table 7-3"
 *
 * so a roll of 07 becomes 70 (Body), NOT 7 (Head). This module was hand-ported
 * from dark-heresy-3rd-edition and inherited a single-digit reversal bug that
 * sent every roll of 02-09 to the Head. Cross-checked 2026-07-30 against
 * codified-systems/dark_heresy_2e/rules/combat.py, which codifies the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getHitLocationForRoll } from '../lib/hit-locations.mjs';

// Table 7-3, keyed by the REVERSED value.
const TABLE_7_3 = [
    { name: 'Head', min: 1, max: 10 },
    { name: 'Right Arm', min: 11, max: 20 },
    { name: 'Left Arm', min: 21, max: 30 },
    { name: 'Body', min: 31, max: 70 },
    { name: 'Right Leg', min: 71, max: 85 },
    { name: 'Left Leg', min: 86, max: 100 },
];

/** Independent restatement of the rule, used as the oracle. */
function expected(roll) {
    const s = String(roll).padStart(2, '0');
    let reversed = parseInt(s[1] + s[0], 10);
    if (reversed === 0) reversed = 100;
    return TABLE_7_3.find((r) => reversed >= r.min && reversed <= r.max).name;
}

test('single-digit rolls reverse as two digits (the ported bug)', () => {
    assert.equal(getHitLocationForRoll(2), 'Right Arm'); // 02 -> 20
    assert.equal(getHitLocationForRoll(3), 'Left Arm');  // 03 -> 30
    assert.equal(getHitLocationForRoll(7), 'Body');      // 07 -> 70
    assert.equal(getHitLocationForRoll(8), 'Right Leg'); // 08 -> 80
    assert.equal(getHitLocationForRoll(9), 'Left Leg');  // 09 -> 90
});

test('the book example: a roll of 14 reverses to 41 -> Body', () => {
    assert.equal(getHitLocationForRoll(14), 'Body');
});

test('a roll of 1 reverses to 10 -> Head', () => {
    assert.equal(getHitLocationForRoll(1), 'Head');
});

test('two-digit rolls are unaffected by the fix', () => {
    assert.equal(getHitLocationForRoll(32), 'Left Arm'); // 32 -> 23
    assert.equal(getHitLocationForRoll(20), 'Head');     // 20 -> 02
    assert.equal(getHitLocationForRoll(55), 'Body');     // 55 -> 55
    assert.equal(getHitLocationForRoll(19), 'Left Leg'); // 19 -> 91
});

test('every roll 1..100 matches Table 7-3', () => {
    for (let roll = 1; roll <= 100; roll++) {
        assert.equal(getHitLocationForRoll(roll), expected(roll), `roll ${roll}`);
    }
});
