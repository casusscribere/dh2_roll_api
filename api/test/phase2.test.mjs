/**
 * Phase 2 (ROADMAP.md): character schema v1 — validation, migration, the
 * schema→engine mapping — and the Google-Sheets / Roll20 import adapters
 * round-tripping into a real engine resolution. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
    CHARACTER_SCHEMA_VERSION, emptyCharacter, validateCharacter, migrateCharacter, characterToCombatant,
} from '../lib/character-schema.mjs';
import { fromGoogleSheetCsv } from '../../tools/adapters/google-sheets.mjs';
import { fromRoll20 } from '../../tools/adapters/roll20.mjs';
import { dispatch } from '../lib/api-router.mjs';
import { resolveEngagement } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateCsv = readFileSync(join(__dirname, '..', '..', 'tools', 'templates', 'google-sheet-template.csv'), 'utf8');

// --- schema ------------------------------------------------------------------
test('emptyCharacter validates clean', () => {
    const r = validateCharacter(emptyCharacter('Test'));
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
});

test('validateCharacter reports field-level errors', () => {
    const doc = emptyCharacter('Bad');
    doc.characteristics.ws = 'high';           // wrong type
    delete doc.characteristics.fel;            // missing
    doc.weapons = [{ name: '', damage: 'lots' }];
    doc.kind = 'wrong';
    const r = validateCharacter(doc);
    assert.equal(r.ok, false);
    const paths = r.errors.map((e) => e.path);
    assert.ok(paths.includes('characteristics.ws'));
    assert.ok(paths.includes('characteristics.fel'));
    assert.ok(paths.includes('weapons[0].name'));
    assert.ok(paths.includes('weapons[0].damage'));
    assert.ok(paths.includes('kind'));
});

test('unknown keys warn but do not fail (forward compatibility)', () => {
    const doc = emptyCharacter('Future');
    doc.armour.tail = 3;
    doc.characteristics.psi = 40;
    const r = validateCharacter(doc);
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.path === 'armour.tail'));
    assert.ok(r.warnings.some((w) => w.path === 'characteristics.psi'));
});

test('migrateCharacter stamps version 0/undefined docs up to v1', () => {
    const migrated = migrateCharacter({ name: 'Old', characteristics: {} });
    assert.equal(migrated.schemaVersion, CHARACTER_SCHEMA_VERSION);
    assert.equal(migrated.kind, 'dh2.character');
});

test('characterToCombatant maps schema → engine shape (melee SB, armour by location)', () => {
    const doc = emptyCharacter('Mapper');
    doc.characteristics.s = 42; doc.characteristics.t = 38;
    doc.unnatural.s = 2; doc.unnatural.t = 1;
    doc.armour.body = 5; doc.armour.head = 1;
    doc.weapons = [{ name: 'Axe', class: 'melee', damage: '1d10+2', pen: 1, damageType: 'Rending', qualities: ['Tearing'] }];
    const c = characterToCombatant(doc);
    assert.equal(c.weapon.isMelee, true);
    assert.equal(c.weapon.sbMultiplier, 1);                      // melee default
    assert.deepEqual(c.weapon.qualities, [{ name: 'Tearing', level: null }]);
    assert.equal(c.armour, 5);                                    // body by default
    assert.equal(characterToCombatant(doc, { location: 'head' }).armour, 1);
    assert.equal(c.toughnessBonus, 3);
    assert.equal(c.unnaturalToughness, 1);
    assert.equal(c.unnatural.s, 2);
});

// --- /api/character endpoints (via the shared router) --------------------------
test('GET /api/character/schema returns version, fields, template', () => {
    const { status, body } = dispatch('GET', '/api/character/schema');
    assert.equal(status, 200);
    assert.equal(body.version, CHARACTER_SCHEMA_VERSION);
    assert.ok(body.fields.some((f) => f.path === 'weapons[].damage'));
    assert.equal(validateCharacter(body.template).ok, true);
});

test('POST /api/character/validate migrates, validates, and previews the combatant', () => {
    const good = dispatch('POST', '/api/character/validate', { character: emptyCharacter('Ok') });
    assert.equal(good.body.ok, true);
    assert.ok(good.body.combatant);
    const bad = dispatch('POST', '/api/character/validate', { character: { kind: 'dh2.character', name: 'X' } });
    assert.equal(bad.body.ok, false);
    assert.ok(bad.body.errors.some((e) => e.path.startsWith('characteristics')));
});

// --- Google Sheets adapter -----------------------------------------------------
test('google-sheets adapter parses the shipped template into a valid character', () => {
    const { character, unknownKeys } = fromGoogleSheetCsv(templateCsv);
    assert.deepEqual(unknownKeys, []);
    const r = validateCharacter(character);
    assert.deepEqual(r.errors, []);
    assert.equal(character.name, 'Interrogator Vex');
    assert.equal(character.characteristics.bs, 40);
    assert.equal(character.armour.body, 4);
    assert.deepEqual(character.talents, ['Ambidextrous', 'Two-Weapon Wielder']);
    assert.deepEqual(character.traits, ['Brutal Charge (3)']);
    assert.equal(character.weapons.length, 2);
    assert.equal(character.weapons[0].name, 'Boltgun');
    assert.equal(character.weapons[0].damageType, 'Explosive');
    assert.equal(character.weapons[0].rof.burst, 3);
    assert.equal(character.weapons[1].class, 'melee');
});

// --- Roll20 adapter -------------------------------------------------------------
const ROLL20_SAMPLE = {
    name: 'Acolyte Var',
    attribs: [
        { name: 'weapon_skill', current: 38, max: '' },
        { name: 'ballistic_skill', current: 42, max: '' },
        { name: 'strength', current: 36, max: '' },
        { name: 'toughness', current: 34, max: '' },
        { name: 'agility', current: 33, max: '' },
        { name: 'intelligence', current: 30, max: '' },
        { name: 'perception', current: 32, max: '' },
        { name: 'willpower', current: 31, max: '' },
        { name: 'fellowship', current: 28, max: '' },
        { name: 'unnatural_strength', current: 2, max: '' },
        { name: 'armour_body', current: 5, max: '' },
        { name: 'wounds', current: 9, max: 13 },
        { name: 'fate', current: 2, max: 3 },
        { name: 'repeating_weapons_-Nabc123_name', current: 'Autogun' },
        { name: 'repeating_weapons_-Nabc123_damage', current: '1d10+3' },
        { name: 'repeating_weapons_-Nabc123_pen', current: '0' },
        { name: 'repeating_weapons_-Nabc123_qualities', current: 'Reliable' },
        { name: 'repeating_talents_-Ndef456_name', current: 'Ambidextrous' },
        { name: 'some_sheet_internal', current: 'x' },
    ],
};

test('roll20 adapter maps attributes, repeating weapons/talents, and reports unmapped', () => {
    const { character, unmapped } = fromRoll20(ROLL20_SAMPLE);
    const r = validateCharacter(character);
    assert.deepEqual(r.errors, []);
    assert.equal(character.name, 'Acolyte Var');
    assert.equal(character.characteristics.ws, 38);
    assert.equal(character.characteristics.fel, 28);
    assert.equal(character.unnatural.s, 2);
    assert.equal(character.armour.body, 5);
    assert.equal(character.wounds.max, 13);
    assert.equal(character.wounds.current, 9);
    assert.equal(character.weapons[0].name, 'Autogun');
    assert.deepEqual(character.weapons[0].qualities, ['Reliable']);
    assert.deepEqual(character.talents, ['Ambidextrous']);
    assert.ok(unmapped.includes('some_sheet_internal'));
});

// --- round-trip: template → adapter → combatant → engine ------------------------
test('round-trip: the template character attacks the Roll20 character through the engine', () => {
    const atkDoc = fromGoogleSheetCsv(templateCsv).character;
    const defDoc = fromRoll20(ROLL20_SAMPLE).character;
    const attacker = { ...characterToCombatant(atkDoc, { weaponIndex: 1 }), action: 'Charge' };   // the Sword, melee
    const defender = { ...characterToCombatant(defDoc), evasion: { mode: 'dodge' }, characteristics: { ...characterToCombatant(defDoc).characteristics } };
    const out = resolveEngagement({ attacker, defender, options: { autoResolveTests: true } },
        riggedDice([d100(20), die(6, 10), d100(90)]), buildRegistry());
    assert.equal(out.attack.test.success, true);
    // Brutal Charge (3) fires on the Charge: +3 damage modifier from the imported trait
    assert.equal(out.attack.hits[0].damage.modifiers['brutal charge'], 3);
    // melee SB from S 35 → +3
    assert.equal(out.attack.hits[0].damage.modifiers['strength bonus'], 3);
    // defender soaks with imported body armour 5 + TB 3
    assert.equal(out.attack.hits[0].soak.armour, 5);
});
