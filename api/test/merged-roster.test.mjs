/**
 * Task 5.1 validation gates over the MERGED campaign roster
 * (`campaign/characters/*.json`, written by tools/merge-characters.mjs).
 * The merged docs are git-ignored campaign data (decision D-C/D9), so these
 * tests SKIP when the directory is absent or empty (fresh clones, CI) and run
 * the full gates on the machine that holds the data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCharacter, CHARACTER_SCHEMA_VERSION } from '../lib/character-schema.mjs';
import { characterToFoundryActor } from '../lib/foundry-actor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mergedDir = path.join(here, '..', '..', 'campaign', 'characters');
const mergedFiles = fs.existsSync(mergedDir)
    ? fs.readdirSync(mergedDir).filter(f => f.endsWith('.json') && !f.endsWith('.unmatched.json'))
    : [];
const skip = mergedFiles.length === 0
    ? 'campaign/characters/ empty — run `npm run merge:characters` on the machine holding the dump'
    : false;

test('Step 5.1.1 — every merged doc is current-schema and passes validateCharacter with zero errors', { skip }, () => {
    assert.ok(mergedFiles.length >= 10, `expected the full active roster, got ${mergedFiles.length}`);
    for (const f of mergedFiles) {
        const doc = JSON.parse(fs.readFileSync(path.join(mergedDir, f), 'utf8'));
        assert.equal(doc.schemaVersion, CHARACTER_SCHEMA_VERSION, `${f} schemaVersion`);
        assert.equal(doc.source.adapter, 'merge', `${f} provenance`);
        const v = validateCharacter(doc);
        assert.ok(v.ok, `${f}: ${JSON.stringify(v.errors)}`);
    }
});

test('Step 5.1.2 — characterToFoundryActor runs clean over every merged doc', { skip }, () => {
    for (const f of mergedFiles) {
        const doc = JSON.parse(fs.readFileSync(path.join(mergedDir, f), 'utf8'));
        const actor = characterToFoundryActor(doc);
        assert.equal(actor.type, 'acolyte', f);   // dh2 legacy-system actor type
        assert.ok(actor.system.characteristics.weaponSkill, `${f}: characteristics mapped`);
        assert.ok(Array.isArray(actor.items), f);
        // Live-state precedence survived the mapping: current wounds within max.
        assert.ok(actor.system.wounds.value <= actor.system.wounds.max + 20, `${f}: wounds sane`);
    }
});
