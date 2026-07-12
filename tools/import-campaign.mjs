/**
 * Campaign roster import (CHARACTER_MODEL.md §6b Delta 3 — schema v2 edition).
 *
 * Reads the RT campaign's character workbooks ("Character Sheets/" in
 * RT_GDRIVE) and emits SCHEMA V2 character documents into
 * api/data/characters/roster.mjs — the preset dropdown's data source.
 *
 * v2 carries: characteristics as { base, advances, modifiers } (advances from
 * the sheet's Upgrades column; base = total − 5×advances so totals round-trip),
 * SKILLS incl. specialist categories (the Lore/Linguistics/Navigate/Operate
 * group rows become per-speciality advances; the Misc column becomes a
 * modifier-by-source), APTITUDES (+origin), and XP (Total/Used + the spending
 * tab as the ledger). Still unmapped (recorded per doc): psy rating, weapon
 * clip/range/mods, gear, house content.
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
import { canonicalSkillName, SKILL_DEFS } from '../api/lib/character-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = join(__dirname, '..', '..', '..',
    'ORIGINAL MATERIALS', 'RT_GDRIVE', 'Character Sheets');
const OUT = join(__dirname, '..', 'api', 'data', 'characters', 'roster.mjs');

// Active roster folders; workbook files that are not character sheets
// (planning docs, lineages, alt builds) are excluded by pattern.
// PRIVACY: the folder names identify the human players — they are used for
// SCANNING ONLY and are stripped from everything the roster stores (no
// player field; player-name parentheticals removed from source filenames).
const ROSTER_DIRS = [
    'Chris(Augustine-Jack)', 'John (Harys-Gnaeus)', 'Matt (Uiyeldi-Ogg)',
    'Ryan(Talvdin-Reco)', 'Steve(Rex-Uriel)',
];
const PLAYER_NAMES = /\s*\((chris|john|matt|ryan|steve|ethan|ian|scott)[^)]*\)/gi;
const EXCLUDE = /goal|priorit|lineage|draco|planning|combat calc/i;

const CHAR_KEYS = {
    'weapon skill': 'ws', 'ballistic skill': 'bs', 'strength': 's', 'toughness': 't',
    'agility': 'ag', 'intelligence': 'int', 'perception': 'per', 'willpower': 'wp', 'fellowship': 'fel',
};
const UNNATURAL_OK = new Set(['ws', 'bs', 's', 't', 'ag']);   // schema v1 limit
const LOCATIONS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

// collapse ALL whitespace (incl. non-breaking spaces — some sheets use them)
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const low = (s) => norm(s).toLowerCase().replace(/:$/, '');
const int = (s) => { const n = parseInt(String(s ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

/** Load a workbook: Character Sheet + XP-spending + Stored Inventory grids. */
function loadWorkbook(file) {
    const wb = XLSX.readFile(file);
    const asGrid = (name) => name
        ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) : null;
    const sheetTab = wb.SheetNames.find((n) => /character sheet/i.test(n)) ?? wb.SheetNames[0];
    const xpTab = wb.SheetNames.find((n) => /exp.*spending/i.test(n)) ?? null;
    const storedTab = wb.SheetNames.find((n) => /stored inventory/i.test(n)) ?? null;
    return { sheet: asGrid(sheetTab), xp: asGrid(xpTab), stored: asGrid(storedTab) };
}

/** Parse an EQUIPMENT block (header cell "Item" + a "Weight" column on the
 *  same row) into gear entries. Used on the Character Sheet (equipped) and
 *  the Stored Inventory tab (equipped: false). */
function parseGearBlock(g, equipped) {
    const out = [];
    const itemHead = findCell(g, (v) => norm(v) === 'Item');
    if (!itemHead) return out;
    let weightCol = null;
    for (let c = itemHead.c + 1; c <= itemHead.c + 8; c++) if (low(at(g, itemHead.r, c)) === 'weight') { weightCol = c; break; }
    let blanks = 0;
    for (let r = itemHead.r + 1; r < itemHead.r + 70 && blanks < 4; r++) {
        const name = at(g, r, itemHead.c);
        if (!name) { blanks++; continue; }
        blanks = 0;
        if (/^[A-Z\s\/:&-]{7,}$/.test(name)) break;   // next ALL-CAPS section
        const entry = { name, equipped };
        const w = weightCol != null ? parseFloat(String(at(g, r, weightCol)).replace(/[^\d.]/g, '')) : NaN;
        const qty = /^(\d+)\s+/.exec(name);           // "3 Smoke Grenades"
        if (qty) entry.quantity = parseInt(qty[1]);
        // the sheet's Weight cell is the ROW TOTAL; the schema stores per-unit
        if (Number.isFinite(w) && w >= 0) entry.weight = Math.round((w / (entry.quantity ?? 1)) * 100) / 100;
        out.push(entry);
    }
    return out;
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

/** Parse one workbook into a schema-v3 character document. */
function parseSheet(file) {
    const { sheet: g, xp: xpGrid, stored: storedGrid } = loadWorkbook(file);
    const unmapped = new Set();

    // --- name: A1, else the cleaned filename stem ----------------------------
    let name = at(g, 0, 0);
    if (!name || name === '[Name]') {
        name = basename(file, '.xlsx').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[_]+/g, ' ')
            .replace(/\s*-\s*(sheet|rt)\s*$/i, '').replace(/\s+/g, ' ').trim();
    }
    name = name.replace(PLAYER_NAMES, '').replace(/\s+/g, ' ').trim();   // privacy: no player names

    // --- characteristics: ANCHORED to the CHARACTERISTICS block's Type column
    // (a global scan would hit the Skills table, whose Characteristic column
    // also contains "Strength" etc. — Athletics' score is not Strength!).
    // v2 shape { base, advances, modifiers }: the sheet stores the TOTAL score
    // plus an Upgrades count (aligned with the block's SECOND, sorted name
    // column at typeCol+2); base = total − 5×advances so totals round-trip.
    const totals = {}, advancesByKey = {};
    const chHead = findCell(g, (v) => /^characteristics:?$/i.test(norm(v)));
    let typeCol = null, typeRow = null;
    if (chHead) {
        const typeCell = findCell(g, (v) => norm(v) === 'Type', chHead.r);
        if (typeCell && typeCell.r <= chHead.r + 3) { typeCol = typeCell.c; typeRow = typeCell.r; }
    }
    if (typeCol != null) {
        for (let r = typeRow + 1; r < typeRow + 16; r++) {
            const label = low(at(g, r, typeCol));
            const key = CHAR_KEYS[label];
            if (key) totals[key] = int(at(g, r, typeCol + 1)) ?? 0;
            // Insanity/Corruption live in the same column on these sheets
            else if (label === 'insanity' || label === 'corruption') totals[label] = int(at(g, r, typeCol + 1)) ?? 0;
        }
        const upHead = findCell(g, (v) => low(v) === 'upgrades');
        if (upHead) {
            for (let r = typeRow + 1; r < typeRow + 16; r++) {
                const key = CHAR_KEYS[low(at(g, r, typeCol + 2))];   // sorted column
                const adv = int(at(g, r, upHead.c));
                if (key && adv != null) advancesByKey[key] = Math.max(0, Math.min(5, adv));
            }
        }
    }
    const characteristics = {};
    for (const key of Object.values(CHAR_KEYS)) {
        const total = totals[key] ?? 0;
        const advances = advancesByKey[key] ?? 0;
        characteristics[key] = { base: Math.max(0, total - 5 * advances), advances, modifiers: [] };
    }

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
    const wounds = { critical: 0, ...(pool('wounds') ?? { max: 10, current: 10 }) };
    const fate = pool('fate points') ?? { max: 0, current: 0 };
    const fatigue = { current: pool('fatigue')?.current ?? 0 };
    const psyRating = pool('psy rating')?.current ?? 0;
    const psy = { rating: psyRating, class: psyRating > 0 ? 'bound' : 'none', sustained: 0 };

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

    // --- skills: the SKILLS table (Name | Characteristic | Score | Rank | Misc).
    // Rows with an EMPTY characteristic cell are specialist GROUP HEADERS
    // ("Forbidden Lores", "Operate"); the rows that follow are that group's
    // specialities until a plain base skill appears. "Type" rows are the
    // sheet's blank placeholders. Score is derived — we carry Rank (advances)
    // and Misc (a modifier-by-source). "Trade: Linguist" style names map to
    // specialist skill + speciality.
    const skills = {};
    const skillsHead = findCell(g, (v) => norm(v) === 'SKILLS');
    if (skillsHead) {
        const nameHead = findCell(g, (v) => norm(v) === 'Name', skillsHead.r);
        if (nameHead && nameHead.r <= skillsHead.r + 2 && nameHead.c >= skillsHead.c) {
            const nc = nameHead.c;
            let group = null, blanks = 0;
            const entry = (canonical) => (skills[canonical] ??= SKILL_DEFS[canonical].specialist
                ? { specialities: {} } : { advances: 0 });
            const putMods = (obj, misc) => { if (misc) obj.modifiers = [{ value: misc, source: 'sheet Misc column' }]; };
            for (let r = nameHead.r + 1; r < nameHead.r + 90 && blanks < 3; r++) {
                const name = at(g, r, nc);
                if (!name) { blanks++; continue; }
                blanks = 0;
                if (name === 'Type') continue;                        // placeholder rows
                const charCell = at(g, r, nc + 1);
                const rank = Math.max(0, Math.min(4, int(at(g, r, nc + 3)) ?? 0));
                const misc = int(at(g, r, nc + 4)) ?? 0;
                const colonSpec = /^([^:]+):\s*(.+)$/.exec(name);     // "Trade: Linguist"
                const canonical = canonicalSkillName(colonSpec ? colonSpec[1] : name);
                if (!charCell) {                                       // group header row
                    group = (canonical && SKILL_DEFS[canonical].specialist) ? canonical : null;
                    if (group) entry(group);
                    continue;
                }
                if (canonical && SKILL_DEFS[canonical].specialist && colonSpec) {
                    const e = entry(canonical);
                    const s = { advances: rank }; putMods(s, misc);
                    e.specialities[colonSpec[2].trim()] = s;
                    group = null;
                } else if (canonical && !SKILL_DEFS[canonical].specialist) {
                    const e = entry(canonical);                        // plain skill row
                    e.advances = rank; putMods(e, misc);
                    const ck = CHAR_KEYS[low(charCell)];
                    if (ck && ck !== SKILL_DEFS[canonical].characteristic) e.characteristic = ck;
                    group = null;
                } else if (group) {                                    // speciality row
                    const e = entry(group);
                    const s = { advances: rank }; putMods(s, misc);
                    e.specialities[name] = s;
                }
                // else: unknown standalone row — skip (house columns, notes)
            }
        }
    }

    // --- speciality SIDE TABLES ("Forbidden Lores | Ranks") — the sheets keep
    // the full lore lists here; the main SKILLS table often holds a subset.
    // Detected by a "Ranks" cell within 3 columns of a specialist-group name on
    // the same row (the main table's group headers have no Ranks neighbour).
    // Merged into the group's specialities without overwriting main-table rows.
    for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < (g[r] ?? []).length; c++) {
            const canonical = canonicalSkillName(at(g, r, c));
            if (!canonical || !SKILL_DEFS[canonical].specialist) continue;
            let ranksCol = null;
            for (let cc = c + 1; cc <= c + 3; cc++) if (low(at(g, r, cc)) === 'ranks') { ranksCol = cc; break; }
            if (ranksCol == null) continue;
            const e = (skills[canonical] ??= { specialities: {} });
            e.specialities ??= {};
            let blanks = 0;
            for (let rr = r + 1; rr < r + 30 && blanks < 2; rr++) {
                const spec = at(g, rr, c);
                if (!spec) { blanks++; continue; }
                blanks = 0;
                if (/^[A-Z\s\/:&-]{7,}$/.test(spec) || spec.startsWith('*')) break;   // next section / footnote
                const rank = int(at(g, rr, ranksCol));
                if (rank == null) continue;
                const exists = Object.keys(e.specialities).some((k) => k.toLowerCase() === spec.toLowerCase());
                if (!exists) e.specialities[spec] = { advances: Math.max(0, Math.min(4, rank)) };
            }
        }
    }

    // --- aptitudes: APTITUDES header → Aptitude | (Characteristic) | Source ---
    const aptitudes = [];
    const aptHead = findCell(g, (v) => norm(v) === 'APTITUDES');
    if (aptHead) {
        const nameCol = findCell(g, (v) => norm(v) === 'Aptitude', aptHead.r);
        if (nameCol && nameCol.r <= aptHead.r + 2) {
            let blanks = 0;
            for (let r = nameCol.r + 1; r < nameCol.r + 20 && blanks < 2; r++) {
                const v = at(g, r, nameCol.c);
                if (!v) { blanks++; continue; }
                blanks = 0;
                if (/^[A-Z\s\/:&-]{7,}$/.test(v)) break;               // next section
                const src = at(g, r, nameCol.c + 2);
                aptitudes.push(src ? { name: v, source: src } : v);
            }
        }
    }

    // --- xp: the Experience block (Total/Used) + the spending tab as ledger ---
    const xp = { total: 0, ledger: [] };
    const xpTotal = findCell(g, (v) => norm(v) === 'Total');
    if (xpTotal) xp.total = int(at(g, xpTotal.r, xpTotal.c + 1)) ?? 0;
    const xpUsed = findCell(g, (v) => norm(v) === 'Used');
    if (xpUsed) { const u = int(at(g, xpUsed.r, xpUsed.c + 1)); if (u != null) xp.spent = u; }
    if (xpGrid) {
        let epoch = null;
        for (let r = 0; r < Math.min(xpGrid.length, 400); r++) {
            const marker = norm(xpGrid[r]?.[0]);
            if (marker) epoch = marker;
            const name = norm(xpGrid[r]?.[1]);
            const cost = int(xpGrid[r]?.[2]);
            if (name && cost != null && cost >= 0 && !/^(remaining|total|used)$/i.test(name)) {
                xp.ledger.push(epoch ? { name, cost, source: epoch } : { name, cost });
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
    // --- gear: the EQUIPMENT block (carried) + the Stored Inventory tab -------
    const gear = parseGearBlock(g, true);
    if (storedGrid) gear.push(...parseGearBlock(storedGrid, false));

    // --- psychic powers: PSY POWERS block (Power | Tree | Notes) --------------
    const psychicPowers = [];
    const ppHead = findCell(g, (v) => /^PSY(CHIC)? POWERS$/i.test(norm(v)));
    if (ppHead) {
        const powerCol = findCell(g, (v) => norm(v) === 'Power', ppHead.r);
        if (powerCol && powerCol.r <= ppHead.r + 2) {
            let blanks = 0;
            for (let r = powerCol.r + 1; r < powerCol.r + 30 && blanks < 2; r++) {
                const nm = at(g, r, powerCol.c);
                if (!nm) { blanks++; continue; }
                blanks = 0;
                if (/^[A-Z\s\/:&-]{7,}$/.test(nm)) break;
                const p = { name: nm, equipped: true };   // known = in the loadout by default
                const tree = at(g, r, powerCol.c + 1);
                const notes = at(g, r, powerCol.c + 2);
                if (tree) p.discipline = tree;
                if (notes) p.notes = notes;
                psychicPowers.push(p);
            }
        }
    }

    // --- mutations / malignancies / disorders (named lists) -------------------
    const mutmal = parseNamedSection(g, (v) => /^MUTATIONS?\s*\/\s*MALIGNANCIES$/i.test(norm(v)));
    const mutations = mutmal.filter((n) => /mutation/i.test(n));
    const malignancies = mutmal.filter((n) => !/mutation/i.test(n));
    const disorders = parseNamedSection(g, (v) => /^(MENTAL )?DISORDERS$/i.test(norm(v)));

    if (findCell(g, (v) => /WEAPON TRAINING/i.test(norm(v)))) unmapped.add('weapon trainings');
    unmapped.add('house content (Dramatic Moments, custom traits)');
    unmapped.add('armour worn as items (the STATS AP scalar is the flat armour block)');

    return {
        schemaVersion: 3, kind: 'dh2.character', system: 'dh2', name,
        characteristics, unnatural, armour, wounds, fate, fatigue,
        skills, xp, aptitudes, tarot: {},
        psy, psychicPowers,
        insanity: { points: totals.insanity ?? 0, disorders },
        corruption: { points: totals.corruption ?? 0, malignancies, mutations },
        criticalInjuries: [], amputations: [],
        talents, traits: [], conditions: [], circumstances: [],
        weapons, armourItems: [], gear, field,
        source: {
            adapter: 'xlsx-campaign-v3',
            file: basename(file).replace(PLAYER_NAMES, '').replace(/\s+/g, ' ').trim(),
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
    const clipSize = int(at(g, dRow + 1, c + 2));   // the Clip column → clip { max, value }
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
    if (!isMelee && clipSize != null && clipSize > 0) w.clip = { max: clipSize, value: clipSize };
    return w;
}

/** A simple named-list section: an ALL-CAPS header cell, names in the rows
 *  below the same column (until 2 blanks or the next ALL-CAPS section). */
function parseNamedSection(g, headerPred, maxRows = 25) {
    const head = findCell(g, headerPred);
    if (!head) return [];
    const out = [];
    let blanks = 0;
    for (let r = head.r + 1; r < head.r + maxRows && blanks < 2; r++) {
        const v = at(g, r, head.c);
        if (!v) { blanks++; continue; }
        blanks = 0;
        if (/^[A-Z\s\/:&-]{7,}$/.test(v)) break;
        out.push(v);
    }
    return out;
}

// ---------------------------------------------------------------------------
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const roster = [];
for (const dir of ROSTER_DIRS) {
    const full = join(SHEETS_DIR, dir);
    if (!existsSync(full)) { console.warn(`⚠ missing folder (roster dir)`); continue; }
    for (const f of readdirSync(full).filter((f) => f.endsWith('.xlsx') && !EXCLUDE.test(f))) {
        try {
            const doc = parseSheet(join(full, f));
            roster.push({ id: kebab(doc.name), name: doc.name, doc });
            const nSkills = Object.keys(doc.skills).length;
            console.log(`✓ ${doc.name}  (${doc.weapons.length} weapons, ${doc.talents.length} talents, ${nSkills} skills, ${doc.aptitudes.length} aptitudes, ${doc.xp.ledger.length} xp entries)`);
        } catch (e) {
            console.warn(`✗ ${basename(f)}: ${e.message}`);
        }
    }
}
roster.sort((a, b) => a.name.localeCompare(b.name));

const out = `/**
 * Campaign character roster — GENERATED by \`node tools/import-campaign.mjs\`.
 * Do not edit by hand; re-run the importer when the sheets change.
 * Schema v2 (residual gaps in each doc's source.unmapped). ${roster.length} characters.
 */
export const CHARACTER_ROSTER = ${JSON.stringify(roster, null, 2)};
`;
if (process.argv.includes('--dry')) console.log(`\n(dry run) would write ${OUT}`);
else { writeFileSync(OUT, out); console.log(`\n→ ${OUT} (${roster.length} characters)`); }
