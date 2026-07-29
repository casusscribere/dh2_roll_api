/**
 * Task 4.1 merge lane (pipeline plan Phase 4): xlsx-derived roster docs merge
 * with Roll20-derived docs under the D-A precedence policy — build data (stats,
 * skills, talents, ledger, origin, weapons) from xlsx; volatile pools (current
 * wounds/fate/fatigue, conditions) from Roll20; one-sided fields taken as-is;
 * every overridden differing value recorded in source.conflicts[]. Identity
 * matching normalizes names, then falls back to the hand-maintained alias map
 * (decision D-B) for the roster's hard cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, mergeCharacter, mergeRosters } from '../../tools/merge-characters.mjs';
import { migrateCharacter, validateCharacter } from '../lib/character-schema.mjs';

/** Minimal v4-ish xlsx-side doc (authoritative build data). */
function xlsxDoc() {
    return migrateCharacter({
        schemaVersion: 4, kind: 'dh2.character', system: 'dh2',
        name: 'Augustine Haake',
        characteristics: {
            ws: { base: 36, advances: 0, modifiers: [] },
            bs: { base: 39, advances: 5, modifiers: [] },
            s: { base: 23, advances: 0, modifiers: [] },
            t: { base: 26, advances: 0, modifiers: [] },
            ag: { base: 56, advances: 0, modifiers: [] },
            int: { base: 30, advances: 0, modifiers: [] },
            per: { base: 30, advances: 0, modifiers: [] },
            wp: { base: 30, advances: 0, modifiers: [] },
            fel: { base: 30, advances: 0, modifiers: [] }
        },
        wounds: { max: 12, current: 12, critical: 0 },
        fate: { max: 3, current: 3 },
        fatigue: { current: 0 },
        skills: { Dodge: { advances: 2, modifiers: [] } },
        talents: ['Mighty Shot', 'Target Selection'],
        aptitudes: ['General', { name: 'Ballistic Skill', source: 'background' }],
        xp: { total: 5000, ledger: [{ name: 'Mighty Shot', cost: 600 }] },
        origin: { homeworld: { name: 'Feral World' } },
        weapons: [{ name: 'Shuriken Catapult', class: 'basic', damage: '1d10+4' }],
        conditions: [],
        source: { adapter: 'xlsx-campaign-v4', file: 'Augustine Haake.xlsx' }
    });
}

/** Roll20-side doc for the same character: stale build data, live table state. */
function roll20Doc() {
    return migrateCharacter({
        schemaVersion: 4, kind: 'dh2.character', system: 'dh2',
        name: 'Augustine Haake',
        characteristics: {
            ws: { base: 40, advances: 0, modifiers: [] },   // differs — xlsx must win
            bs: { base: 39, advances: 3, modifiers: [] },   // advances differ — xlsx wins
            s: { base: 23, advances: 0, modifiers: [] },
            t: { base: 26, advances: 0, modifiers: [] },
            ag: { base: 56, advances: 0, modifiers: [] },
            int: { base: 30, advances: 0, modifiers: [] },
            per: { base: 30, advances: 0, modifiers: [] },
            wp: { base: 30, advances: 0, modifiers: [] },
            fel: { base: 30, advances: 0, modifiers: [] }
        },
        wounds: { max: 10, current: 4, critical: 1 },        // current/critical — roll20 wins
        fate: { max: 3, current: 1 },                        // current — roll20 wins
        fatigue: { current: 2 },                             // roll20 wins
        skills: { Dodge: { advances: 1, modifiers: [] } },   // xlsx wins
        talents: ['Mighty Shot'],                            // xlsx wins
        xp: { total: 4000, ledger: [] },                     // xlsx wins
        conditions: ['Stunned'],                             // roll20 wins
        cybernetics: [{ name: 'Bionic Eye' }],               // roll20-only — taken as-is
        influence: 27,                                       // roll20-only — taken as-is
        source: { adapter: 'roll20-dump-v4', roll20CharacterId: '-KAfx', roll20Name: 'Augustine Haake' }
    });
}

// ---------------------------------------------------------------------------
// Step 4.1.1 — precedence policy (decision D-A)
// ---------------------------------------------------------------------------

test('merge: build data comes from xlsx, volatile pools from roll20', () => {
    const { doc } = mergeCharacter(xlsxDoc(), roll20Doc());
    // build data → xlsx
    assert.equal(doc.characteristics.ws.base, 36);
    assert.equal(doc.characteristics.bs.advances, 5);
    assert.equal(doc.skills.Dodge.advances, 2);
    assert.deepEqual(doc.talents.map(t => t.name ?? t), ['Mighty Shot', 'Target Selection']);
    assert.equal(doc.xp.total, 5000);
    assert.equal(doc.xp.ledger.length, 1);
    assert.equal(doc.origin.homeworld.name, 'Feral World');
    assert.equal(doc.weapons[0].name, 'Shuriken Catapult');
    assert.equal(doc.wounds.max, 12);                 // max wounds are build data
    // volatile pools → roll20
    assert.equal(doc.wounds.current, 4);
    assert.equal(doc.wounds.critical, 1);
    assert.equal(doc.fate.current, 1);
    assert.equal(doc.fatigue.current, 2);
    assert.deepEqual(doc.conditions, ['Stunned']);
});

test('merge: fields present on only one side are taken as-is', () => {
    const { doc } = mergeCharacter(xlsxDoc(), roll20Doc());
    assert.equal(doc.influence, 27);                                  // roll20-only
    assert.equal(doc.cybernetics[0].name, 'Bionic Eye');              // roll20-only
    assert.equal(doc.origin.homeworld.name, 'Feral World');           // xlsx-only
});

test('merge: every overridden differing value lands in source.conflicts[]', () => {
    const { doc } = mergeCharacter(xlsxDoc(), roll20Doc());
    assert.equal(doc.source.adapter, 'merge');
    assert.equal(doc.source.inputs.length, 2);
    const paths = doc.source.conflicts.map(c => c.path);
    assert.ok(paths.includes('characteristics.ws.base'), `ws.base conflict missing: ${paths}`);
    assert.ok(paths.includes('characteristics.bs.advances'));
    assert.ok(paths.includes('skills.Dodge.advances'));
    assert.ok(paths.includes('talents'));
    assert.ok(paths.includes('xp.total'));
    assert.ok(paths.includes('wounds.max'));
    assert.ok(paths.includes('wounds.current'));
    assert.ok(paths.includes('fate.current'));
    assert.ok(paths.includes('fatigue.current'));
    assert.ok(paths.includes('conditions'));
    // equal values are NOT conflicts
    assert.ok(!paths.includes('characteristics.bs.base'));
    const ws = doc.source.conflicts.find(c => c.path === 'characteristics.ws.base');
    assert.equal(ws.xlsx, 36);
    assert.equal(ws.roll20, 40);
    assert.equal(ws.winner, 'xlsx');
    const wounds = doc.source.conflicts.find(c => c.path === 'wounds.current');
    assert.equal(wounds.winner, 'roll20');
});

test('merge: merged doc passes validateCharacter with zero errors', () => {
    const { doc } = mergeCharacter(xlsxDoc(), roll20Doc());
    const v = validateCharacter(doc);
    assert.ok(v.ok, JSON.stringify(v.errors));
});

// ---------------------------------------------------------------------------
// Step 4.1.2 — identity matching
// ---------------------------------------------------------------------------

test('normalizeName strips quotes, punctuation, and parentheticals', () => {
    assert.equal(normalizeName('"Jack" "Balvdin?" (First Officer)'), 'jack balvdin');
    assert.equal(normalizeName('Augustine Haake'), 'augustine haake');
    assert.equal(normalizeName('Shas’ui Kai ta ran Y’eldi'), 'shasui kai ta ran yeldi');
    assert.equal(normalizeName('Uriel "Yuri"'), 'uriel yuri');
});

function rosterFixture() {
    // Slimmed stand-ins for the real xlsx roster + roll20 dump names.
    const xlsx = [
        { id: 'augustine-haake', name: 'Augustine Haake', doc: xlsxDoc() },
        { id: 'baron-talvdin-hourace-horp', name: 'Baron Talvdin Hourace Horp', doc: { ...xlsxDoc(), name: 'Baron Talvdin Hourace Horp' } },
        { id: 'jack-balvdin-first-officer', name: '"Jack" "Balvdin?" (First Officer)', doc: { ...xlsxDoc(), name: '"Jack" "Balvdin?" (First Officer)' } }
    ];
    const roll20 = [
        { ...roll20Doc(), name: 'Augustine Haake' },
        { ...roll20Doc(), name: 'Talvdin', source: { adapter: 'roll20-dump-v4', roll20Name: 'Talvdin' } },
        { ...roll20Doc(), name: 'Future Ogg', source: { adapter: 'roll20-dump-v4', roll20Name: 'Future Ogg' } }
    ];
    const aliases = { 'Talvdin': 'baron-talvdin-hourace-horp' };
    return { xlsx, roll20, aliases };
}

test('mergeRosters: exact normalized match, alias-map match, and unmatched with warnings', () => {
    const { xlsx, roll20, aliases } = rosterFixture();
    const out = mergeRosters({ xlsx, roll20, aliases });
    const byId = Object.fromEntries(out.merged.map(m => [m.id, m]));
    assert.equal(byId['augustine-haake'].via, 'name');
    assert.equal(byId['baron-talvdin-hourace-horp'].via, 'alias');
    // Jack has no roll20 counterpart in this fixture → unmatched xlsx, warned
    assert.ok(out.unmatchedXlsx.some(u => u.id === 'jack-balvdin-first-officer'));
    // Future Ogg is roll20-only → unmatched roll20, warned
    assert.ok(out.unmatchedRoll20.some(u => u.name === 'Future Ogg'));
    assert.ok(out.warnings.length >= 2);
    // merged docs carry the merge provenance
    assert.equal(byId['augustine-haake'].doc.source.adapter, 'merge');
});

test('mergeRosters: alias map may target a roll20 character id too', () => {
    const { xlsx, roll20 } = rosterFixture();
    roll20[1].source.roll20CharacterId = '-KAfTalvdin';
    const out = mergeRosters({ xlsx, roll20, aliases: { '-KAfTalvdin': 'baron-talvdin-hourace-horp' } });
    const m = out.merged.find(m => m.id === 'baron-talvdin-hourace-horp');
    assert.ok(m, 'alias by roll20 id should match');
    assert.equal(m.via, 'alias');
});

// ---------------------------------------------------------------------------
// Step 4.1.3 — report + the committed alias map
// ---------------------------------------------------------------------------

test('mergeReport prints a per-character table with via/conflicts/validation and totals', async () => {
    const { mergeReport } = await import('../../tools/merge-characters.mjs');
    const { xlsx, roll20, aliases } = rosterFixture();
    const out = mergeRosters({ xlsx, roll20, aliases });
    const report = mergeReport(out);
    assert.match(report, /\| character \| via \| conflicts \| validation \|/);
    assert.match(report, /\| Augustine Haake \| name \| \d+ \| ok/);
    assert.match(report, /\| Baron Talvdin Hourace Horp \| alias \|/);
    assert.match(report, /UNMATCHED \(xlsx only\)/);
    assert.match(report, /2 merged, 1 xlsx-unmatched, 1 roll20-unmatched\./);
});

test('committed roster-aliases.json parses and its values are real xlsx roster ids', async () => {
    const fs = await import('node:fs');
    const aliases = JSON.parse(fs.readFileSync(new URL('../../tools/adapters/roster-aliases.json', import.meta.url), 'utf8'));
    const { CHARACTER_ROSTER } = await import('../data/characters/roster.mjs');
    const ids = new Set(CHARACTER_ROSTER.map(c => c.id));
    const entries = Object.entries(aliases).filter(([k]) => !k.startsWith('_'));
    assert.ok(entries.length >= 5, 'the five known hard cases should be covered');
    for (const [r20Key, xlsxId] of entries) {
        assert.ok(ids.has(xlsxId), `alias "${r20Key}" targets unknown roster id "${xlsxId}"`);
    }
});
