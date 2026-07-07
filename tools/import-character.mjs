/**
 * Character importer CLI (ROADMAP Phase 2, Lane B).
 *
 *   node tools/import-character.mjs <file> [--adapter=auto|google|roll20] [--out=<file>]
 *
 * Runs the source-specific adapter → canonical character JSON → schema
 * validation (field-level errors). Auto-detection: .csv → google-sheets;
 * .json containing `attribs` → roll20; .json with `schemaVersion` →
 * passthrough (validate/migrate only). Exit code 1 on validation errors.
 * The resulting JSON loads into the Roll UI (Character import) and into
 * Foundry via game.dh2vm.importCharacter().
 */
import { readFileSync, writeFileSync } from 'fs';
import { fromGoogleSheetCsv } from './adapters/google-sheets.mjs';
import { fromRoll20 } from './adapters/roll20.mjs';
import { validateCharacter, migrateCharacter } from '../api/lib/character-schema.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
if (!file) {
    console.error('usage: node tools/import-character.mjs <file> [--adapter=auto|google|roll20] [--out=<file>]');
    process.exit(2);
}

const text = readFileSync(file, 'utf8');
let adapter = opt('adapter', 'auto');
if (adapter === 'auto') {
    if (/\.csv$/i.test(file)) adapter = 'google';
    else {
        const peek = JSON.parse(text);
        adapter = peek.attribs || peek.attributes ? 'roll20' : peek.schemaVersion !== undefined ? 'canonical' : 'roll20';
    }
}

let character, notes = [];
if (adapter === 'google') {
    const r = fromGoogleSheetCsv(text);
    character = r.character;
    if (r.unknownKeys.length) notes.push(`unknown template keys ignored: ${r.unknownKeys.join(', ')}`);
} else if (adapter === 'roll20') {
    const r = fromRoll20(text);
    character = r.character;
    if (r.unmapped.length) notes.push(`unmapped Roll20 attributes: ${r.unmapped.slice(0, 20).join(', ')}${r.unmapped.length > 20 ? ` (+${r.unmapped.length - 20} more)` : ''}`);
} else {
    character = JSON.parse(text);
}

character = migrateCharacter(character);
if (character.source) character.source.importedAt = new Date().toISOString();
const result = validateCharacter(character);

for (const n of notes) console.error(`note: ${n}`);
for (const w of result.warnings) console.error(`warn: ${w.path} — ${w.message}`);
if (!result.ok) {
    for (const e of result.errors) console.error(`ERROR: ${e.path} — ${e.message}`);
    console.error(`\n${result.errors.length} validation error(s) — fix the source and re-run.`);
    process.exit(1);
}

const out = opt('out', '');
const json = JSON.stringify(character, null, 2);
if (out) { writeFileSync(out, json); console.error(`✓ valid ${character.kind} v${character.schemaVersion} "${character.name}" → ${out}`); }
else console.log(json);
