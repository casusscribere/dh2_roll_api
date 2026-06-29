/**
 * Weapon-data integrity tests — node --test.
 *
 * Validates data/weapons.json (the corpus served by /api/weapons and consumed
 * by resolveAttack). Guards against silent corruption when the dataset is
 * regenerated: shape, required fields, types, parseable damage, provenance,
 * and cross-consistency with the engine (every damageType is a crit-table key).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDamageFormula } from '../lib/engine.mjs';
import { criticalDamage } from '../lib/critical-damage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'weapons.json'), 'utf8'));
const weapons = raw.weapons;
const CRIT_TYPES = new Set(Object.keys(criticalDamage()));  // Energy/Explosive/Impact/Rending

// --- wrapper shape -----------------------------------------------------------
test('weapons.json: has _source, count, and a weapons array', () => {
    assert.equal(typeof raw._source, 'string');
    assert.ok(Array.isArray(weapons));
    assert.equal(raw.count, weapons.length, 'declared count matches array length');
});

test('weapons.json: contains the expected 144 profiles', () => {
    assert.equal(weapons.length, 144);
});

// --- required fields present and typed ---------------------------------------
test('weapons.json: every profile has required fields with correct types', () => {
    for (const w of weapons) {
        const where = w.id ?? w.name ?? '<unknown>';
        assert.equal(typeof w.id, 'string', `${where}: id`);
        assert.ok(w.id.length > 0, `${where}: empty id`);
        assert.equal(typeof w.name, 'string', `${where}: name`);
        assert.equal(typeof w.class, 'string', `${where}: class`);
        assert.equal(typeof w.isMelee, 'boolean', `${where}: isMelee`);
        assert.equal(typeof w.damage, 'string', `${where}: damage`);
        assert.equal(typeof w.damageType, 'string', `${where}: damageType`);
        assert.ok(Number.isInteger(w.pen), `${where}: pen must be integer`);
        assert.ok(w.pen >= 0, `${where}: pen must be non-negative`);
        assert.equal(typeof w.sbMultiplier, 'number', `${where}: sbMultiplier`);
        assert.ok(Array.isArray(w.qualities), `${where}: qualities array`);
        assert.equal(typeof w.source, 'string', `${where}: source`);
        assert.ok(w.source.length > 0, `${where}: empty source`);
    }
});

// --- ids are unique ----------------------------------------------------------
test('weapons.json: ids are unique', () => {
    const ids = weapons.map((w) => w.id);
    assert.equal(new Set(ids).size, ids.length);
});

// --- rof shape ---------------------------------------------------------------
test('weapons.json: every rof has single/burst/full of valid types', () => {
    for (const w of weapons) {
        assert.ok(w.rof && typeof w.rof === 'object', `${w.id}: rof object`);
        assert.equal(typeof w.rof.single, 'boolean', `${w.id}: rof.single`);
        assert.ok(Number.isInteger(w.rof.burst), `${w.id}: rof.burst integer`);
        assert.ok(Number.isInteger(w.rof.full), `${w.id}: rof.full integer`);
    }
});

// --- damage formulas all parse ----------------------------------------------
test('weapons.json: every damage formula parses via the engine', () => {
    const bad = weapons.filter((w) => parseDamageFormula(w.damage) === null)
        .map((w) => `${w.id}="${w.damage}"`);
    assert.deepEqual(bad, [], `unparseable damage formulas: ${bad.join(', ')}`);
});

// --- qualities are strings ---------------------------------------------------
test('weapons.json: all qualities are non-empty strings', () => {
    for (const w of weapons) {
        for (const q of w.qualities) {
            assert.equal(typeof q, 'string', `${w.id}: quality not a string`);
            assert.ok(q.length > 0, `${w.id}: empty quality`);
        }
    }
});

// --- cross-consistency with the crit table -----------------------------------
test('weapons.json: every damageType is a key in the critical-damage table', () => {
    const bad = weapons.filter((w) => !CRIT_TYPES.has(w.damageType))
        .map((w) => `${w.id}=${w.damageType}`);
    assert.deepEqual(bad, [], `damageTypes absent from crit table: ${bad.join(', ')}`);
});
