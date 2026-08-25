/**
 * ST-4 (Phase 4 / E-2): optional `description` / `citation` on entry objects.
 *
 * Author-owned text travels IN the document, exactly like `dsl` (D-L) — for
 * custom content only. Canon entries resolve their text by `ref` (the E-1
 * prose overlay / pack citation path), so the validator carries a DRIFT GUARD:
 * a description on an entry whose ref resolves in the chargen pack is a
 * warning — that text will shadow nothing (refs win) and can silently rot.
 *
 * Seven lists carry the fields: talents, traits, psychicPowers, weapons,
 * armourItems, gear, cybernetics. schemaVersion stays 4 — optional fields,
 * no migration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    CHARACTER_SCHEMA_VERSION, emptyCharacter, validateCharacter,
} from '../lib/character-schema.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A doc with one entry in the named list. */
const docWith = (list, entry) => {
    const doc = emptyCharacter('Prose Probe');
    doc[list] = [entry];
    return doc;
};

const CITATION = { book: 'House Rules', page: null, source: 'homebrew' };

/* ── acceptance: custom entries carry prose cleanly ─────────────────────── */

test('a custom talent with description + citation validates with 0 errors, 0 warnings', () => {
    const r = validateCharacter(docWith('talents', {
        name: 'Homebrew', description: 'My text', citation: CITATION,
    }));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.ok, true);
});

test('all seven lists accept description + citation on a custom entry', () => {
    const entries = {
        talents: { name: 'Homebrew' },
        traits: { name: 'Homebrew Trait' },
        psychicPowers: { name: 'Homebrew Power' },
        weapons: { name: 'Homebrew Gun', damage: '1d10+2' },
        armourItems: { name: 'Homebrew Plate', ap: 2, locations: ['body'] },
        gear: { name: 'Homebrew Kit' },
        cybernetics: { name: 'Homebrew Implant' },
    };
    for (const [list, base] of Object.entries(entries)) {
        const r = validateCharacter(docWith(list, {
            ...base, description: 'Custom text', citation: CITATION,
        }));
        assert.deepEqual(r.errors, [], `${list}: ${JSON.stringify(r.errors)}`);
        assert.deepEqual(r.warnings, [], `${list}: ${JSON.stringify(r.warnings)}`);
    }
});

/* ── the drift guard ────────────────────────────────────────────────────── */

test('description + a ref that RESOLVES in the pack → 1 warning (canon text is resolved by ref)', () => {
    const r = validateCharacter(docWith('talents', {
        name: 'Jaded', ref: 'dh2:talent:jaded', description: 'My text',
    }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1, JSON.stringify(r.warnings));
    assert.equal(r.warnings[0].path, 'talents[0]');
    assert.match(r.warnings[0].message, /description present but ref/);
    assert.match(r.warnings[0].message, /dh2:talent:jaded/);
    assert.equal(r.ok, true, 'a warning must not fail validation');
});

test('description + a ref the pack does NOT carry → no drift warning (custom ref namespaces stay quiet)', () => {
    const r = validateCharacter(docWith('talents', {
        name: 'House Talent', ref: 'house:talent:my_thing', description: 'My text',
    }));
    assert.deepEqual(r.errors, []);
    // the ref-pattern warning must not fire either — the ref is well-formed
    assert.deepEqual(r.warnings, [], JSON.stringify(r.warnings));
});

test('a resolving ref WITHOUT a description stays silent (refs alone are the canon path)', () => {
    const r = validateCharacter(docWith('talents', { name: 'Jaded', ref: 'dh2:talent:jaded' }));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
});

/* ── type errors ────────────────────────────────────────────────────────── */

test('citation.page of type string is an error', () => {
    const r = validateCharacter(docWith('talents', {
        name: 'Homebrew', citation: { book: 'House Rules', page: '12', source: 'homebrew' },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
    assert.equal(r.errors[0].path, 'talents[0].citation.page');
});

test('citation must be an object; its book/source must be strings', () => {
    let r = validateCharacter(docWith('gear', { name: 'Kit', citation: 'Core p.120' }));
    assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
    assert.equal(r.errors[0].path, 'gear[0].citation');

    r = validateCharacter(docWith('weapons', { name: 'Gun', damage: '1d10', citation: { book: 7 } }));
    assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
    assert.equal(r.errors[0].path, 'weapons[0].citation.book');

    r = validateCharacter(docWith('cybernetics', { name: 'Arm', citation: { source: 7 } }));
    assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
    assert.equal(r.errors[0].path, 'cybernetics[0].citation.source');
});

test('a non-string description errors on the named-entry lists too (talents/traits/psychicPowers/cybernetics)', () => {
    for (const list of ['talents', 'traits', 'psychicPowers', 'cybernetics']) {
        const r = validateCharacter(docWith(list, { name: 'X', description: 42 }));
        assert.equal(r.ok, false, list);
        assert.equal(r.errors[0].path, `${list}[0].description`, JSON.stringify(r.errors));
    }
});

/* ── the generated JSON Schema artifact ─────────────────────────────────── */

test('character.schema.v4.json carries description + citation under each of the seven entry definitions', () => {
    const schema = JSON.parse(readFileSync(
        join(REPO, 'docs', `character.schema.v${CHARACTER_SCHEMA_VERSION}.json`), 'utf8'));
    const itemObject = (list) => {
        const items = schema.properties[list].items;
        return items.anyOf ? items.anyOf.find((b) => b.type === 'object') : items;
    };
    for (const list of ['talents', 'traits', 'psychicPowers', 'weapons', 'armourItems', 'gear', 'cybernetics']) {
        const obj = itemObject(list);
        assert.ok(obj?.properties?.description, `${list}: description missing from the artifact`);
        assert.ok(obj?.properties?.citation, `${list}: citation missing from the artifact`);
    }
});

/* ── version discipline ─────────────────────────────────────────────────── */

test('ST-4 is additive: schemaVersion stays 4 and an entry without the new fields is untouched', () => {
    assert.equal(CHARACTER_SCHEMA_VERSION, 4);
    const r = validateCharacter(docWith('talents', { name: 'Plain' }));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
});
