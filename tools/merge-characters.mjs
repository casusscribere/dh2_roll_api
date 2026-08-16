/**
 * Task 4.1 (pipeline plan Phase 4): merge xlsx-derived roster docs with
 * Roll20-derived docs into one schema-v4 doc per character.
 *
 * Precedence (decision D-A): the Excel sheets are the build authority
 * (characteristics, skills, talents, aptitudes, XP ledger, origin, weapons,
 * max pools); the Roll20 table is the live-state authority (current wounds/
 * fate/fatigue, conditions). Fields carried by only one side are taken as-is.
 * Every overridden differing value is recorded in `source.conflicts[]` so
 * nothing is silently dropped.
 *
 * Identity matching (decision D-B): normalized-name equality first, then the
 * hand-maintained alias map `tools/adapters/roster-aliases.json`
 * (`{ "<roll20 name or id>": "<xlsx roster id>" }`), else unmatched-with-warning.
 *
 * CLI: node tools/merge-characters.mjs --roll20=<dir-or-file> --xlsx-roster
 *        --out=<dir> [--report] [--strict] [--emit-unmatched]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateCharacter, validateCharacter } from '../api/lib/character-schema.mjs';

const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

/** Lowercase, drop parentheticals, strip punctuation, collapse whitespace. */
export function normalizeName(name) {
    return String(name ?? '')
        .toLowerCase()
        .replace(/\(.*?\)/g, ' ')
        .replace(/[^\p{L}\p{N} ]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A value that actually carries information (for the take-as-is rule). */
function meaningful(v) {
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
}

const CHAR_KEYS = ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'];

/** Volatile table state — Roll20 wins (path, getter, setter). */
const VOLATILE_PATHS = [
    'wounds.current', 'wounds.critical', 'fate.current', 'fatigue.current', 'conditions'
];

/** Build-data paths compared for conflict reporting (xlsx wins). */
function buildConflictPaths(xlsx, roll20) {
    const paths = [];
    for (const k of CHAR_KEYS) {
        paths.push(`characteristics.${k}.base`, `characteristics.${k}.advances`);
    }
    const skillNames = new Set([
        ...Object.keys(xlsx.skills ?? {}), ...Object.keys(roll20.skills ?? {})
    ]);
    for (const name of skillNames) {
        paths.push(`skills.${name}.advances`);
        // Specialist skills (Common/Forbidden/Scholastic Lore, Linguistics,
        // Navigate, Operate, Trade) hold their ranks per speciality and leave
        // `.advances` undefined, so the line above alone silently dropped every
        // speciality difference (finding D-4, 2026-07-30).
        const specNames = new Set([
            ...Object.keys(xlsx.skills?.[name]?.specialities ?? {}),
            ...Object.keys(roll20.skills?.[name]?.specialities ?? {})
        ]);
        for (const spec of specNames) paths.push(`skills.${name}.specialities.${spec}.advances`);
    }
    paths.push('talents', 'traits', 'aptitudes', 'weapons', 'armourItems', 'gear',
        'xp.total', 'xp.ledger', 'origin', 'wounds.max', 'fate.max', 'psy.rating');
    return paths;
}

function getPath(doc, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

function setPath(doc, dotted, value) {
    const keys = dotted.split('.');
    const last = keys.pop();
    let o = doc;
    for (const k of keys) {
        if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
        o = o[k];
    }
    o[last] = value;
}

/** Comparable projection: entry lists compare by name so `"X"` ≡ `{name:"X"}`. */
function comparable(v) {
    if (Array.isArray(v)) return JSON.stringify(v.map(e => e?.name ?? e));
    return JSON.stringify(v);
}

/**
 * Merge one character. Both inputs are migrated to the current schema first.
 * @returns {{doc: object, conflicts: object[]}}
 */
export function mergeCharacter(xlsxIn, roll20In) {
    const xlsx = migrateCharacter(clone(xlsxIn));
    const roll20 = migrateCharacter(clone(roll20In));
    const doc = clone(xlsx);
    const conflicts = [];

    // 1. One-sided fill: top-level fields only Roll20 carries meaningfully.
    for (const key of Object.keys(roll20)) {
        if (key === 'source') continue;
        if (!meaningful(doc[key]) && meaningful(roll20[key])) doc[key] = clone(roll20[key]);
    }

    // 2. Volatile table state: Roll20 wins where it carries the field at all.
    for (const p of VOLATILE_PATHS) {
        const rv = getPath(roll20, p);
        if (rv === undefined) continue;
        const xv = getPath(xlsx, p);
        if (xv !== undefined && comparable(xv) !== comparable(rv)) {
            conflicts.push({ path: p, xlsx: clone(xv), roll20: clone(rv), winner: 'roll20' });
        }
        setPath(doc, p, clone(rv));
    }

    // 3. Build-data conflicts: xlsx already won (doc is its clone) — record overrides.
    for (const p of buildConflictPaths(xlsx, roll20)) {
        const xv = getPath(xlsx, p);
        const rv = getPath(roll20, p);
        if (!meaningful(xv) || !meaningful(rv)) continue;
        if (comparable(xv) !== comparable(rv)) {
            conflicts.push({ path: p, xlsx: clone(xv), roll20: clone(rv), winner: 'xlsx' });
        }
    }

    doc.source = {
        adapter: 'merge',
        mergedAt: new Date().toISOString(),
        inputs: [xlsx.source ?? { adapter: 'xlsx' }, roll20.source ?? { adapter: 'roll20' }],
        conflicts
    };
    return { doc, conflicts };
}

/**
 * Match + merge a whole roster.
 * @param {object} opts
 * @param {Array<{id, name, doc}>} opts.xlsx     xlsx-derived roster entries
 * @param {object[]} opts.roll20                 roll20-derived v4 docs
 * @param {Record<string,string>} [opts.aliases] roll20 name/id → xlsx id
 */
export function mergeRosters({ xlsx, roll20, aliases = {} }) {
    const warnings = [];
    const merged = [];
    const usedRoll20 = new Set();

    // Index roll20 docs by normalized name, plus by raw name and id for aliases.
    const byNorm = new Map();
    const byAliasKey = new Map();
    for (const doc of roll20) {
        const norm = normalizeName(doc.name);
        if (!byNorm.has(norm)) byNorm.set(norm, doc);
        for (const key of [doc.name, doc.source?.roll20Name, doc.source?.roll20CharacterId]) {
            if (key != null && !byAliasKey.has(key)) byAliasKey.set(key, doc);
        }
    }
    // Reverse alias: xlsx id → roll20 key.
    const aliasByXlsxId = {};
    for (const [r20Key, xlsxId] of Object.entries(aliases)) aliasByXlsxId[xlsxId] = r20Key;

    const unmatchedXlsx = [];
    for (const entry of xlsx) {
        let counterpart = byNorm.get(normalizeName(entry.name));
        let via = 'name';
        if (!counterpart) {
            const r20Key = aliasByXlsxId[entry.id];
            if (r20Key != null) {
                counterpart = byAliasKey.get(r20Key);
                via = 'alias';
                if (!counterpart) warnings.push(`alias for "${entry.id}" points at unknown roll20 key "${r20Key}"`);
            }
        }
        if (!counterpart) {
            warnings.push(`no roll20 counterpart for xlsx character "${entry.name}" (${entry.id})`);
            unmatchedXlsx.push(entry);
            continue;
        }
        if (usedRoll20.has(counterpart)) warnings.push(`roll20 character "${counterpart.name}" matched more than one xlsx entry`);
        usedRoll20.add(counterpart);
        const { doc, conflicts } = mergeCharacter(entry.doc, counterpart);
        merged.push({ id: entry.id, name: entry.name, via, doc, conflicts });
    }

    const unmatchedRoll20 = roll20.filter(d => !usedRoll20.has(d));
    for (const d of unmatchedRoll20) warnings.push(`no xlsx counterpart for roll20 character "${d.name}"`);

    return { merged, unmatchedXlsx, unmatchedRoll20, warnings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { report: false, strict: false, emitUnmatched: false, xlsxRoster: false };
    for (const a of argv) {
        if (a.startsWith('--roll20=')) args.roll20 = a.slice(9);
        else if (a === '--xlsx-roster') args.xlsxRoster = true;
        else if (a.startsWith('--out=')) args.out = a.slice(6);
        else if (a.startsWith('--aliases=')) args.aliases = a.slice(10);
        else if (a === '--report') args.report = true;
        else if (a === '--strict') args.strict = true;
        else if (a === '--emit-unmatched') args.emitUnmatched = true;
        else throw new Error(`unknown argument: ${a}`);
    }
    return args;
}

/** Per-character report table (matched via, conflict count, validation). */
export function mergeReport(out) {
    const lines = [];
    lines.push('| character | via | conflicts | validation |');
    lines.push('|---|---|---|---|');
    for (const m of out.merged) {
        const v = validateCharacter(m.doc);
        const status = v.ok ? (v.warnings?.length ? `ok (${v.warnings.length} warn)` : 'ok') : `${v.errors.length} ERROR`;
        lines.push(`| ${m.name} | ${m.via} | ${m.conflicts.length} | ${status} |`);
    }
    for (const u of out.unmatchedXlsx) lines.push(`| ${u.name} | UNMATCHED (xlsx only) | — | — |`);
    lines.push(`\n${out.merged.length} merged, ${out.unmatchedXlsx.length} xlsx-unmatched, ${out.unmatchedRoll20.length} roll20-unmatched.`);
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.roll20 || !args.out) {
        console.error('usage: node tools/merge-characters.mjs --roll20=<dir-or-file> --xlsx-roster --out=<dir> [--aliases=<file>] [--report] [--strict] [--emit-unmatched]');
        process.exit(2);
    }
    const here = path.dirname(fileURLToPath(import.meta.url));

    // Roll20 side: a dump file (bridge envelope), a single doc, or a dir of docs.
    const { fromRoll20Dump } = await import(pathToFileURL(path.join(here, 'adapters', 'roll20.mjs')));
    const loadRoll20 = (p) => {
        const json = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(json.characters) && json.schema) return fromRoll20Dump(json).map(r => r.character);
        return [migrateCharacter(json)];
    };
    const stat = fs.statSync(args.roll20);
    const roll20 = stat.isDirectory()
        ? fs.readdirSync(args.roll20).filter(f => f.endsWith('.json')).flatMap(f => loadRoll20(path.join(args.roll20, f)))
        : loadRoll20(args.roll20);

    // xlsx side: the committed roster module.
    if (!args.xlsxRoster) throw new Error('only --xlsx-roster mode is implemented (reads api/data/characters/roster.mjs)');
    const { CHARACTER_ROSTER } = await import(pathToFileURL(path.join(here, '..', 'api', 'data', 'characters', 'roster.mjs')));
    const xlsx = CHARACTER_ROSTER.map(e => ({ id: e.id, name: e.name, doc: e.doc }));

    const aliasFile = args.aliases ?? path.join(here, 'adapters', 'roster-aliases.json');
    const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : {};

    const out = mergeRosters({ xlsx, roll20, aliases });

    fs.mkdirSync(args.out, { recursive: true });
    for (const m of out.merged) {
        fs.writeFileSync(path.join(args.out, `${m.id}.json`), JSON.stringify(m.doc, null, 2) + '\n');
    }
    if (args.emitUnmatched) {
        for (const u of out.unmatchedXlsx) {
            fs.writeFileSync(path.join(args.out, `${u.id}.unmatched.json`), JSON.stringify(migrateCharacter(u.doc), null, 2) + '\n');
        }
    }
    for (const w of out.warnings.slice(0, 30)) console.warn(`warn: ${w}`);
    if (out.warnings.length > 30) console.warn(`… ${out.warnings.length - 30} more warnings`);
    if (args.report) console.log('\n' + mergeReport(out));
    console.log(`\nwrote ${out.merged.length} merged docs to ${args.out}`);

    const totalConflicts = out.merged.reduce((n, m) => n + m.conflicts.length, 0);
    if (args.strict && totalConflicts > 0) {
        console.error(`--strict: ${totalConflicts} conflicts present`);
        process.exit(1);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    await main();
}
