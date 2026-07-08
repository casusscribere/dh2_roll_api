/**
 * Campaign roster import (CHARACTER_MODEL.md §6b Delta 3, v1-lossy edition).
 *
 * Reads the RT campaign's character workbooks ("Character Sheets/" in
 * RT_GDRIVE) and emits SCHEMA V1 character documents into
 * api/data/characters/roster.mjs — the preset dropdown's data source.
 *
 * v1 is deliberately LOSSY: skills, XP, aptitudes, psy powers, weapon
 * clip/range/mods, and house content are NOT carried (schema v2 will be — see
 * CHARACTER_MODEL.md §4). Every dropped category is recorded in
 * source.unmapped so the loss is visible, not silent.
 *
 * The sheets drift between players (columns shift, extra blocks), so parsing
 * is ANCHOR-LABEL based (find the labelled cell, read relative to it), never
 * fixed cell coordinates.
 *
 * Usage: node tools/import-campaign.mjs [--dry]
 */
import XLSX from 'xlsx';
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = join(__dirname, '..', '..', '..',
    'ORIGINAL MATERIALS', 'RT_GDRIVE', 'Character Sheets');
const OUT = join(__dirname, '..', 'api', 'data', 'characters', 'roster.mjs');

// Active player folders → roster; workbook files that are not character
// sheets (planning docs, lineages, alt builds) are excluded by pattern.
const PLAYER_DIRS = {
    'Chris(Augustine-Jack)': 'Chris',
    'John (Harys-Gnaeus)': 'John',
    'Matt (Uiyeldi-Ogg)': 'Matt',
    'Ryan(Talvdin-Reco)': 'Ryan',
    'Steve(Rex-Uriel)': 'Steve',
};
const EXCLUDE = /goal|priorit|lineage|draco|planning|combat calc/i;

const CHAR_KEYS = {
    'weapon skill': 'ws', 'ballistic skill': 'bs', 'strength': 's', 'toughness': 't',
    'agility': 'ag', 'intelligence': 'int', 'perception': 'per', 'willpower': 'wp', 'fellowship': 'fel',
};
const UNNATURAL_OK = new Set(['ws', 'bs', 's', 't', 'ag']);   // schema v1 limit
const LOCATIONS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

const norm = (s) => String(s ?? '').trim();
const low = (s) => norm(s).toLowerCase().replace(/:$/, '');
const int = (s) => { const n = parseInt(String(s ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

/** Load a workbook's Character Sheet tab as a row-major string grid. */
function grid(file) {
    const wb = XLSX.readFile(file);
    const tab = wb.SheetNames.find((n) => /character sheet/i.test(n)) ?? wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, raw: false, defval: '' });
}
/** First cell matching `pred` in row-major order → { r, c } or null. */
function findCell(g, pred, fromRow = 0) {
    for (let r = fromRow; r < g.length; r++) {
        const row = g[r] ?? [];
        for (let c = 0; c < row.length; c++) if (pred(row[c])) return { r, c };
    }
    return null;
}
const at = (g, r, c) => norm((g[r] ?? [])[c]);

/** Parse one workbook into a schema-v1 character document. */
function parseSheet(file, player) {
    const g = grid(file);
    const unmapped = new Set();

    // --- name: A1, else the cleaned filename stem ----------------------------
    let name = at(g, 0, 0);
    if (!name || name === '[Name]') {
        name = basename(file, '.xlsx').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[_]+/g, ' ')
            .replace(/\s*-\s*(sheet|rt)\s*$/i, '').replace(/\s+/g, ' ').trim();
    }

    // --- characteristics: ANCHORED to the CHARACTERISTICS block's Type column
    // (a global scan would hit the Skills table, whose Characteristic column
    // also contains "Strength" etc. — Athletics' score is not Strength!).
    const characteristics = {};
    const chHead = findCell(g, (v) => /^characteristics:?$/i.test(norm(v)));
    let typeCol = null, typeRow = null;
    if (chHead) {
        const typeCell = findCell(g, (v) => norm(v) === 'Type', chHead.r);
        if (typeCell && typeCell.r <= chHead.r + 3) { typeCol = typeCell.c; typeRow = typeCell.r; }
    }
    if (typeCol != null) {
        for (let r = typeRow + 1; r < typeRow + 16; r++) {
            const key = CHAR_KEYS[low(at(g, r, typeCol))];
            if (key) characteristics[key] = int(at(g, r, typeCol + 1)) ?? 0;
        }
    }
    for (const key of Object.values(CHAR_KEYS)) characteristics[key] ??= 0;

    // --- unnatural: optional column, aligned with the SAME base Type rows ----
    const unnatural = {};
    const unHead = findCell(g, (v) => low(v) === 'unnatural');
    if (unHead && typeCol != null) {
        for (let r = typeRow + 1; r < typeRow + 16; r++) {
            const key = CHAR_KEYS[low(at(g, r, typeCol))];
            const v = int(at(g, r, unHead.c));
            if (key && v != null && v > 0) {
                if (UNNATURAL_OK.has(key)) unnatural[key] = v;
                else unmapped.add(`unnatural ${key} (schema v1 limit)`);
            }
        }
    }

    // --- pools: label cell → current (c+1), max (c+2) -------------------------
    const pool = (label) => {
        const hit = findCell(g, (v) => low(v) === label);
        if (!hit) return null;
        const current = int(at(g, hit.r, hit.c + 1)), max = int(at(g, hit.r, hit.c + 2));
        return (current == null && max == null) ? null : { current: current ?? max ?? 0, max: max ?? current ?? 0 };
    };
    const wounds = pool('wounds') ?? { max: 10, current: 10 };
    const fate = pool('fate points') ?? { max: 0, current: 0 };
    if ((pool('psy rating')?.current ?? 0) > 0) unmapped.add('psy rating');

    // --- armour: the STATS "Armor" row (single AP → all locations; lossy) -----
    const armourHit = findCell(g, (v) => low(v) === 'armor');
    const ap = armourHit ? (int(at(g, armourHit.r, armourHit.c + 1)) ?? 0) : 0;
    const armour = Object.fromEntries(LOCATIONS.map((l) => [l, ap]));
    if (armourHit) unmapped.add('armour is the STATS scalar applied to all locations');

    // --- talents: the TALENTS section's name column ---------------------------
    const talents = [];
    const tHead = findCell(g, (v) => norm(v) === 'TALENTS');
    if (tHead) {
        const nameCol = findCell(g, (v) => norm(v) === 'Talent', tHead.r);
        if (nameCol && nameCol.r <= tHead.r + 3) {
            let blanks = 0;
            for (let r = nameCol.r + 1; r < nameCol.r + 60 && blanks < 2; r++) {
                const v = at(g, r, nameCol.c);
                if (!v) { blanks++; continue; }
                blanks = 0;
                if (/^[A-Z\s\/:&-]{7,}$/.test(v)) break;   // next ALL-CAPS section header
                talents.push(v);
            }
        }
    }

    // --- force field: the SHIELDING block's rating ----------------------------
    let field = { rating: 0, overloadMax: 0 };
    const shield = findCell(g, (v) => /^shielding:?$/i.test(norm(v)));
    if (shield) {
        for (let c = shield.c; c < shield.c + 6; c++) {
            const v = int(at(g, shield.r + 1, c));
            if (v != null) { field = { rating: v, overloadMax: 0 }; break; }
        }
    }

    // --- weapons: every "Name:" anchored ARMAMENTS block ----------------------
    const weapons = [];
    for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < (g[r] ?? []).length; c++) {
            if (!/^name:$/i.test(norm(g[r][c]))) continue;
            const w = parseWeaponBlock(g, r, c, unmapped);
            if (w) weapons.push(w);
        }
    }
    if (findCell(g, (v) => norm(v) === 'SKILLS')) unmapped.add('skills (schema v2)');
    if (findCell(g, (v) => /WEAPON TRAINING/i.test(norm(v)))) unmapped.add('weapon trainings (schema v2)');
    if (findCell(g, (v) => /PSY POWERS/i.test(norm(v)))) unmapped.add('psychic powers (schema v2)');
    unmapped.add('xp / aptitudes / gear / house content (schema v2)');

    return {
        schemaVersion: 1, kind: 'dh2.character', system: 'dh2', name,
        characteristics, unnatural, armour, wounds, fate,
        talents, traits: [], conditions: [], circumstances: [],
        weapons, field,
        source: {
            adapter: 'xlsx-campaign-v1', file: basename(file), player,
            importedAt: new Date().toISOString(), unmapped: [...unmapped].sort(),
        },
    };
}

/** One ARMAMENTS block: Name: / <name> / Quality|RoF|Range / <values> /
 *  Damage|Pen|Clip / <values> / Special / <qualities> [/ <mods>]. */
function parseWeaponBlock(g, r, c, unmapped) {
    // an empty name cell does NOT skip the block — some sheets leave it blank
    // (merged cells); a block with real damage still imports, visibly unnamed
    const name = at(g, r + 1, c) || '(unnamed weapon)';
    // locate the Quality header within the next two rows (layouts drift)
    let qRow = null;
    for (let rr = r + 2; rr <= r + 3; rr++) if (low(at(g, rr, c)) === 'quality') { qRow = rr; break; }
    if (qRow == null) return null;
    const quality = at(g, qRow + 1, c);
    const rof = at(g, qRow + 1, c + 1);
    let dRow = null;
    for (let rr = qRow + 2; rr <= qRow + 3; rr++) if (low(at(g, rr, c)) === 'damage') { dRow = rr; break; }
    if (dRow == null) return null;
    const dmgText = at(g, dRow + 1, c);
    const pen = int(at(g, dRow + 1, c + 1)) ?? 0;
    if (int(at(g, dRow + 1, c + 2)) != null) unmapped.add('weapon clip (schema v2)');
    let specials = '';
    for (let rr = dRow + 2; rr <= dRow + 3; rr++) if (low(at(g, rr, c)) === 'special') { specials = at(g, rr + 1, c); break; }

    const dm = /(\d+\s*d\s*\d+(?:\s*[+\-]\s*\d+)?)/i.exec(dmgText);
    if (!dm) return null;   // empty/placeholder block
    const damage = dm[1].replace(/\s+/g, '');
    const typeTail = dmgText.slice(dm.index + dm[1].length).toLowerCase();
    const damageType = /rend|(^|\s)r\b/.test(typeTail) ? 'Rending'
        : /energ|(^|\s)e\b/.test(typeTail) ? 'Energy'
        : /expl|(^|\s)x\b/.test(typeTail) ? 'Explosive' : 'Impact';

    const rm = /(s)?\s*\/\s*(\d+|-)\s*\/\s*(\d+|-)/i.exec(rof);
    const isMelee = !rm && !/\d/.test(rof);
    const craft = { normal: 'Common', common: 'Common', good: 'Good', best: 'Best', poor: 'Poor' }[low(quality)] ?? 'Common';
    const qualities = specials.split(',').map((s) => s.trim()).filter((s) => s && s !== '-');

    const w = {
        name, class: isMelee ? 'melee' : 'basic', damage, pen, damageType,
        qualities, craftsmanship: craft,
        rof: isMelee
            ? { single: true, burst: 0, full: 0 }
            : { single: rof.trim().toLowerCase().startsWith('s'), burst: rm && rm[2] !== '-' ? +rm[2] : 0, full: rm && rm[3] !== '-' ? +rm[3] : 0 },
    };
    if (isMelee) w.sbMultiplier = 1;
    return w;
}

// ---------------------------------------------------------------------------
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const roster = [];
for (const [dir, player] of Object.entries(PLAYER_DIRS)) {
    const full = join(SHEETS_DIR, dir);
    if (!existsSync(full)) { console.warn(`⚠ missing folder: ${dir}`); continue; }
    for (const f of readdirSync(full).filter((f) => f.endsWith('.xlsx') && !EXCLUDE.test(f))) {
        try {
            const doc = parseSheet(join(full, f), player);
            roster.push({ id: kebab(doc.name), player, name: doc.name, doc });
            console.log(`✓ ${player.padEnd(6)} ${doc.name}  (${doc.weapons.length} weapons, ${doc.talents.length} talents)`);
        } catch (e) {
            console.warn(`✗ ${f}: ${e.message}`);
        }
    }
}
roster.sort((a, b) => a.player.localeCompare(b.player) || a.name.localeCompare(b.name));

const out = `/**
 * Campaign character roster — GENERATED by \`node tools/import-campaign.mjs\`.
 * Do not edit by hand; re-run the importer when the sheets change.
 * Schema v1 (lossy — see each doc's source.unmapped). ${roster.length} characters.
 */
export const CHARACTER_ROSTER = ${JSON.stringify(roster, null, 2)};
`;
if (process.argv.includes('--dry')) console.log(`\n(dry run) would write ${OUT}`);
else { writeFileSync(OUT, out); console.log(`\n→ ${OUT} (${roster.length} characters)`); }
