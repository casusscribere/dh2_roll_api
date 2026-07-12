/**
 * Campaign preset roster (CHARACTER_MODEL.md §6b): the generated documents in
 * api/data/characters/roster.mjs must be valid schema-v1 characters, engine-
 * consumable, and served by GET /api/characters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';
import { validateCharacter, migrateCharacter, characteristicTotal, skillTarget } from '../lib/character-schema.mjs';
import { characterToCombatant } from '../lib/character-schema.mjs';
import { dispatch } from '../lib/api-router.mjs';

test('every roster document validates against the character schema', () => {
    assert.ok(CHARACTER_ROSTER.length >= 8, `expected the active campaign roster, got ${CHARACTER_ROSTER.length}`);
    const PLAYER_NAMES = /\b(chris|john|matt|ryan|steve|ethan|ian|scott)\b/i;
    for (const { id, name, player, doc } of CHARACTER_ROSTER) {
        assert.ok(id && name, `entry metadata complete for ${name}`);
        // privacy: human player names are stripped from the roster entirely
        assert.equal(player, undefined, `${name}: no player field`);
        assert.equal(doc.source.player, undefined, `${name}: no source.player`);
        assert.ok(!PLAYER_NAMES.test(doc.source.file ?? ''), `${name}: player name scrubbed from filename (${doc.source.file})`);
        const r = validateCharacter(migrateCharacter(doc));
        assert.ok(r.ok, `${name}: ${JSON.stringify(r.errors)}`);
        assert.equal(doc.schemaVersion, 3);
        assert.equal(doc.source.adapter, 'xlsx-campaign-v3');
        assert.ok(Array.isArray(doc.source.unmapped) && doc.source.unmapped.length, `${name}: residual gaps must be recorded`);
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
    assert.equal(characteristicTotal(aug, 'bs'), 68);
    assert.equal(aug.characteristics.bs.advances, 5);        // Upgrades column
    assert.equal(characteristicTotal(aug, 's'), 34);         // NOT Athletics' 44 (skills-table trap)
    assert.equal(aug.fate.max, 4);
    assert.ok(aug.weapons.some((w) => w.name === 'Shuriken Catapult' && w.rof.burst === 3 && w.rof.full === 10));
    const ogg = CHARACTER_ROSTER.find((c) => c.id === 'ogg')?.doc;
    assert.ok(ogg, 'Ogg present');
    assert.deepEqual(ogg.unnatural, { s: 2, t: 2 });         // Ogryn
    assert.equal(characteristicTotal(ogg, 's'), 50);
});

test('v2 blocks import from the sheets: skills, specialities, aptitudes, xp ledger', () => {
    const aug = CHARACTER_ROSTER.find((c) => c.id.includes('augustine'))?.doc;
    // skills — Dodge advances 4, target 82 per the sheet (Ag 52 + 30)
    assert.equal(aug.skills['Dodge'].advances, 4);
    assert.equal(skillTarget(aug, 'Dodge').target, 82);
    // specialist categories, incl. the side-table lores and "Trade: Linguist"
    assert.equal(skillTarget(aug, 'Forbidden Lore', 'Archaeotech').target, 70);
    assert.ok(Object.keys(aug.skills['Forbidden Lore'].specialities).length >= 8, 'side-table lores merged');
    assert.equal(skillTarget(aug, 'Trade', 'Linguist').target, 80);
    // aptitudes with origin
    assert.ok(aug.aptitudes.some((a) => a.name === 'Knowledge' && a.source === 'Homeworld'));
    // xp: totals + ledger with epoch source
    assert.equal(aug.xp.total, 37000);
    assert.equal(aug.xp.spent, 35950);
    assert.ok(aug.xp.ledger.some((e) => e.name === 'Mighty Shot' && e.cost === 600));
});

test('GET /api/characters serves the roster', () => {
    const res = dispatch('GET', '/api/characters');
    const body = res.body ?? res;
    assert.equal(body.characters.length, CHARACTER_ROSTER.length);
    const c = body.characters[0];
    assert.ok(c.id && c.name && c.doc?.kind === 'dh2.character');
});
