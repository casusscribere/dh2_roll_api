/**
 * Campaign preset roster (CHARACTER_MODEL.md §6b): the generated documents in
 * api/data/characters/roster.mjs must be valid schema-v1 characters, engine-
 * consumable, and served by GET /api/characters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';
import { validateCharacter, migrateCharacter } from '../lib/character-schema.mjs';
import { characterToCombatant } from '../lib/character-schema.mjs';
import { dispatch } from '../lib/api-router.mjs';

test('every roster document validates against the character schema', () => {
    assert.ok(CHARACTER_ROSTER.length >= 8, `expected the active campaign roster, got ${CHARACTER_ROSTER.length}`);
    for (const { id, name, player, doc } of CHARACTER_ROSTER) {
        assert.ok(id && name && player, `entry metadata complete for ${name}`);
        const r = validateCharacter(migrateCharacter(doc));
        assert.ok(r.ok, `${name}: ${JSON.stringify(r.errors)}`);
        assert.equal(doc.source.adapter, 'xlsx-campaign-v1');
        assert.ok(Array.isArray(doc.source.unmapped) && doc.source.unmapped.length, `${name}: lossiness must be recorded`);
    }
});

test('roster documents convert to combatants (engine-consumable)', () => {
    for (const { name, doc } of CHARACTER_ROSTER) {
        const c = characterToCombatant(migrateCharacter(doc));
        assert.ok(c.characteristics, `${name} → combatant`);
    }
});

test('spot-check known sheet values survive the import', () => {
    const aug = CHARACTER_ROSTER.find((c) => c.id.includes('augustine'))?.doc;
    assert.ok(aug, 'Augustine present');
    assert.equal(aug.characteristics.bs, 68);
    assert.equal(aug.characteristics.s, 34);          // NOT Athletics' 44 (skills-table trap)
    assert.equal(aug.fate.max, 4);
    assert.ok(aug.weapons.some((w) => w.name === 'Shuriken Catapult' && w.rof.burst === 3 && w.rof.full === 10));
    const ogg = CHARACTER_ROSTER.find((c) => c.id === 'ogg')?.doc;
    assert.ok(ogg, 'Ogg present');
    assert.deepEqual(ogg.unnatural, { s: 2, t: 2 });  // Ogryn
    assert.equal(ogg.characteristics.s, 50);
});

test('GET /api/characters serves the roster grouped-ready', () => {
    const res = dispatch('GET', '/api/characters');
    const body = res.body ?? res;
    assert.equal(body.characters.length, CHARACTER_ROSTER.length);
    const c = body.characters[0];
    assert.ok(c.id && c.name && c.player && c.doc?.kind === 'dh2.character');
});
