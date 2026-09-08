/**
 * xlsx adapter v4 coverage (pipeline plan Task 2.2): parseGrids maps the
 * sheet's CREATION / WEAPON TRAINING / CYBERNETICS / Influence / DRAMATIC
 * MOMENTS blocks into the schema-v4 fields, normalizes aptitude sources, and
 * emits a document that passes validateCharacter. Grid fixtures are synthetic
 * (the real workbooks are gitignored per privacy decision D9) but follow the
 * sheets' anchor-label layout exactly as parseGrids expects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// D9: a SYNTHETIC roster config (never real names) injected before the module
// loads, so the player-parenthetical stripping path is testable everywhere —
// CI included, where the real git-ignored config rightly does not exist.
const cfgDir = mkdtempSync(join(tmpdir(), 'dh2-roster-cfg-'));
const cfgPath = join(cfgDir, 'campaign-roster.fixture.mjs');
writeFileSync(cfgPath, `export const ROSTER_DIRS = ['Zzplayer(Testchar)'];
export const PLAYER_NAMES = /\\s*\\((zzplayer)[^)]*\\)/gi;
export const playerNames = ['Zzplayer'];
`);
process.env.CAMPAIGN_ROSTER_CONFIG = cfgPath;

const { parseGrids } = await import('../../tools/import-campaign.mjs');
const { validateCharacter, CHARACTER_SCHEMA_VERSION } = await import('../lib/character-schema.mjs');

/** Minimal Character Sheet grid with the v4-relevant blocks. */
function sheetGrid() {
    return [
        ['Testchar Von Fixture'],                                       // r0: name
        [],
        ['CHARACTERISTICS:'],                                           // r2
        ['Type', 'Score', 'TypeAlpha', 'Upgrades'],                     // r3 (anchor "Type")
        ['Weapon Skill', '45', 'Weapon Skill', '1'],                    // r4 (upgrades col aligns to TypeAlpha)
        ['Ballistic Skill', '40', 'Ballistic Skill', '2'],
        ['Influence', '27'],                                            // influence rides the Type column
        [],
        ['CREATION'],
        ['Home World', 'Feral World'],
        ['Background', 'Outcast'],
        ['Role', 'Assassin'],
        ['Divination', 'Trust in your fear.'],
        ['Elite Advance', 'Psyker'],
        [],
        ['WEAPON TRAINING'],
        ['Bolt'],
        ['Las'],
        [],
        ['CYBERNETICS'],
        ['Bionic Eyes'],
        [],
        ['APTITUDES'],
        ['Aptitude', '', 'Source'],
        ['Toughness', '', 'Homeworld'],
        ['Knowledge', '', 'BG'],
        ['Fieldcraft', '', 'Role'],
        [],
        ['TALENTS'],
        ['Talent'],
        ['Jaded'],
        [],
        ['DRAMATIC MOMENTS'],
        ['Saved the captain'],
        [],
        [],
        ['Total', '3000'],                                              // XP block
        ['Used', '2500'],
    ];
}

test('Task 2.2: parseGrids emits a valid v4 doc with origin/influence/trainings/cybernetics/extensions', () => {
    const doc = parseGrids({ sheet: sheetGrid(), xp: null, stored: null }, 'Testchar (zzplayer).xlsx');
    assert.equal(doc.schemaVersion, CHARACTER_SCHEMA_VERSION);
    assert.equal(doc.source.adapter, 'xlsx-campaign-v4');
    assert.equal(doc.name, 'Testchar Von Fixture');

    // origin + divination
    assert.deepEqual(doc.origin.homeworld, { name: 'Feral World' });
    assert.deepEqual(doc.origin.background, { name: 'Outcast' });
    assert.deepEqual(doc.origin.role, { name: 'Assassin' });
    assert.deepEqual(doc.origin.eliteAdvances, [{ name: 'Psyker' }]);
    assert.equal(doc.tarot.text, 'Trust in your fear.');

    // influence from the characteristics block
    assert.equal(doc.influence, 27);

    // v4 lists
    assert.deepEqual(doc.weaponTrainings, ['Bolt', 'Las']);
    assert.deepEqual(doc.cybernetics, ['Bionic Eyes']);
    assert.deepEqual(doc.extensions['dramatic-moments'], { entries: ['Saved the captain'] });
    assert.ok(!doc.source.unmapped.some((u) => /weapon trainings|house content/.test(u)),
        `mapped blocks must leave unmapped: ${JSON.stringify(doc.source.unmapped)}`);

    // aptitude sources normalized to the v4 enum
    assert.deepEqual(doc.aptitudes.map((a) => a.source), ['homeworld', 'background', 'role']);

    // characteristics still round-trip (total = base + 5×advances)
    assert.deepEqual(doc.characteristics.ws, { base: 40, advances: 1, modifiers: [] });
    assert.deepEqual(doc.characteristics.bs, { base: 30, advances: 2, modifiers: [] });

    // xp block + privacy scrub
    assert.equal(doc.xp.total, 3000);
    assert.equal(doc.xp.spent, 2500);
    assert.equal(doc.source.file, 'Testchar.xlsx');

    const r = validateCharacter(doc);
    assert.ok(r.ok, JSON.stringify(r.errors));
});

test('Task 2.2: v4 blocks are optional — a sheet without them yields empty defaults', () => {
    const doc = parseGrids({ sheet: [['Bare'], [], ['CHARACTERISTICS:'], ['Type', 'Score'], ['Weapon Skill', '30']], xp: null, stored: null }, 'Bare.xlsx');
    assert.equal(doc.schemaVersion, CHARACTER_SCHEMA_VERSION);
    assert.deepEqual(doc.origin, { homeworld: null, background: null, role: null, eliteAdvances: [] });
    assert.equal(doc.influence, 0);
    assert.deepEqual(doc.weaponTrainings, []);
    assert.deepEqual(doc.cybernetics, []);
    assert.deepEqual(doc.extensions, {});
    assert.deepEqual(doc.tarot, {});
    assert.ok(validateCharacter(doc).ok);
});
