/**
 * Critical-damage table tests — node --test.
 *
 * Covers getCriticalDamage() and its getFuzzy() helper: the four damage types,
 * fuzzy Left/Right Arm + Leg → Arm/Leg mapping, case-insensitive matching,
 * amount clamping to 10, and graceful null on unknown type/location.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalDamage, getCriticalDamage, getFuzzy } from '../lib/critical-damage.mjs';

const TYPES = ['Energy', 'Explosive', 'Impact', 'Rending'];
const BASE_LOCS = ['Arm', 'Body', 'Head', 'Leg'];

// --- table shape -------------------------------------------------------------
test('criticalDamage: every type × base location has entries 1–10', () => {
    const table = criticalDamage();
    for (const type of TYPES) {
        assert.ok(table[type], `missing type ${type}`);
        for (const loc of BASE_LOCS) {
            assert.ok(table[type][loc], `missing ${type}/${loc}`);
            for (let n = 1; n <= 10; n++) {
                const text = table[type][loc][n];
                assert.equal(typeof text, 'string', `${type}/${loc}/${n} not a string`);
                assert.ok(text.length > 0, `${type}/${loc}/${n} empty`);
            }
        }
    }
});

// --- direct lookups ----------------------------------------------------------
test('getCriticalDamage: returns the exact table cell for a base location', () => {
    const table = criticalDamage();
    assert.equal(getCriticalDamage('Impact', 'Head', 1), table.Impact.Head[1]);
    assert.equal(getCriticalDamage('Energy', 'Body', 10), table.Energy.Body[10]);
});

// --- fuzzy location mapping --------------------------------------------------
test('getCriticalDamage: Left/Right Arm map to the Arm column', () => {
    const table = criticalDamage();
    assert.equal(getCriticalDamage('Rending', 'Left Arm', 4), table.Rending.Arm[4]);
    assert.equal(getCriticalDamage('Rending', 'Right Arm', 4), table.Rending.Arm[4]);
});
test('getCriticalDamage: Left/Right Leg map to the Leg column', () => {
    const table = criticalDamage();
    assert.equal(getCriticalDamage('Explosive', 'Left Leg', 7), table.Explosive.Leg[7]);
    assert.equal(getCriticalDamage('Explosive', 'Right Leg', 7), table.Explosive.Leg[7]);
});

// --- case-insensitive type/location -----------------------------------------
test('getCriticalDamage: type and location matching is case-insensitive', () => {
    const table = criticalDamage();
    assert.equal(getCriticalDamage('impact', 'head', 3), table.Impact.Head[3]);
    assert.equal(getCriticalDamage('RENDING', 'LEFT LEG', 5), table.Rending.Leg[5]);
});

// --- amount clamping ---------------------------------------------------------
test('getCriticalDamage: amount above 10 clamps to the 10 entry', () => {
    const table = criticalDamage();
    assert.equal(getCriticalDamage('Impact', 'Body', 11), table.Impact.Body[10]);
    assert.equal(getCriticalDamage('Impact', 'Body', 99), table.Impact.Body[10]);
});

// --- unknown inputs ----------------------------------------------------------
test('getCriticalDamage: unknown damage type returns null', () => {
    assert.equal(getCriticalDamage('Warp', 'Head', 5), null);
});
test('getCriticalDamage: unknown location returns null', () => {
    assert.equal(getCriticalDamage('Impact', 'Tail', 5), null);
});

// --- getFuzzy helper in isolation -------------------------------------------
test('getFuzzy: collapses Left/Right limbs and matches case-insensitively', () => {
    const obj = { Arm: 'arm-entry', Leg: 'leg-entry', Body: 'body-entry' };
    assert.equal(getFuzzy(obj, 'Left Arm'), 'arm-entry');
    assert.equal(getFuzzy(obj, 'RIGHT LEG'), 'leg-entry');
    assert.equal(getFuzzy(obj, 'body'), 'body-entry');
    assert.equal(getFuzzy(obj, 'Head'), undefined);
});
