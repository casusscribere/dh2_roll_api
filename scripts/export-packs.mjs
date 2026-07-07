/**
 * Pack export v1 (ROADMAP Phase 3, Lane C): generate Foundry compendium packs
 * FROM THE DSL SOURCE — the "DSL is the source of truth, Foundry is a compile
 * target" principle made real.
 *
 *   npm run export:packs
 *
 * - roll_table declarations → native RollTable documents
 * - weapon-quality rules   → attackSpecial Items (the dh systems' quality item
 *   type), with `hasLevel` from the valued-names analysis and provenance
 *   (package · book · page) in the description.
 *
 * Source JSON is written to foundry/dh2-roll-vm/packs-src/<pack>/ and compiled
 * to Foundry v12+ **LevelDB** directories in foundry/dh2-roll-vm/packs/ via
 * @foundryvtt/foundryvtt-cli (per the format decision in FOUNDRY_MIGRATION.md —
 * no legacy NeDB .db). Deterministic _ids (name-hashed) keep pack diffs stable
 * across regenerations.
 */
import { compilePack } from '@foundryvtt/foundryvtt-cli';
import { createHash } from 'crypto';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { rollTables, weaponQualityEffects, availableValued } from '../api/lib/rules/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const moduleDir = join(root, 'foundry', 'dh2-roll-vm');

/** Deterministic 16-char alphanumeric Foundry id from a seed string. */
const fid = (seed) => createHash('sha1').update(seed).digest('base64')
    .replace(/[^A-Za-z0-9]/g, '').slice(0, 16).padEnd(16, '0');
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---- RollTables from roll_table declarations --------------------------------
const tableDocs = rollTables.map((t) => {
    const id = fid(`table:${t.name}`);
    return {
        _id: id,
        _key: `!tables!${id}`,
        name: t.name,
        img: 'icons/svg/d20-grey.svg',
        description: `Generated from the dh2_roll_api DSL (roll_table "${t.name}").`,
        formula: `${t.die.count}d${t.die.sides}`,
        replacement: true,
        displayRoll: true,
        results: t.rows.map((r) => ({
            _id: fid(`row:${t.name}:${r.lo}`),
            // embedded documents carry their own LevelDB key (CLI hierarchy walk)
            _key: `!tables.results!${id}.${fid(`row:${t.name}:${r.lo}`)}`,
            type: 0,
            text: r.text + (r.statuses?.length ? `  → applies: ${r.statuses.join(', ')}` : ''),
            img: 'icons/svg/d20-black.svg',
            weight: r.hi - r.lo + 1,
            range: [r.lo, r.hi],
            drawn: false,
            documentCollection: '',
            documentId: null,
            flags: {},
        })),
        flags: { 'dh2-roll-vm': { generated: true } },
    };
});

// ---- attackSpecial Items from weapon-quality rules ---------------------------
// One item per player-facing quality NAME (multi-rule qualities like Accurate
// collapse to one item), with provenance from the first matching effect.
const byName = new Map();
for (const e of weaponQualityEffects) {
    if (e.source !== 'quality' || byName.has(e.name)) continue;
    byName.set(e.name, e);
}
const valued = new Set(availableValued);
const qualityDocs = [...byName.values()].map((e) => {
    const id = fid(`quality:${e.name}`);
    const cite = [e.sourceBook, e.page ? `p.${e.page}` : null].filter(Boolean).join(' ');
    return {
        _id: id,
        _key: `!items!${id}`,
        name: e.name,
        type: 'attackSpecial',
        img: 'icons/svg/sword.svg',
        system: {
            description: `${cite ? cite + '. ' : ''}Generated from the dh2_roll_api DSL rule ${e.qualifiedId}`
                + ` (checkpoint ${e.checkpoint}${valued.has(e.name) ? '; takes a level (X)' : ''}).`,
            hasLevel: valued.has(e.name),
            level: 0,
        },
        effects: [],
        flags: { 'dh2-roll-vm': { generated: true, qualifiedId: e.qualifiedId, page: e.page } },
    };
});

// ---- write source JSON + compile to LevelDB ----------------------------------
const PACKS = [
    { name: 'rules-tables', docs: tableDocs },
    { name: 'attack-specials', docs: qualityDocs },
];
for (const pack of PACKS) {
    const srcDir = join(moduleDir, 'packs-src', pack.name);
    const outDir = join(moduleDir, 'packs', pack.name);
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(srcDir, { recursive: true });
    for (const doc of pack.docs) {
        writeFileSync(join(srcDir, `${slug(doc.name)}.json`), JSON.stringify(doc, null, 2));
    }
    await compilePack(srcDir, outDir, { log: false });
    console.log(`✓ pack ${pack.name}: ${pack.docs.length} documents → LevelDB at foundry/dh2-roll-vm/packs/${pack.name}`);
}
console.log('  Redeploy with `npm run deploy:foundry` to ship the packs to the live install.');
