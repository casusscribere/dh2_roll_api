/**
 * Google Sheets adapter (ROADMAP Phase 2, Lane B) — standardized template CSV →
 * canonical character JSON (api/lib/character-schema.mjs).
 *
 * The template (tools/templates/google-sheet-template.csv) is a two-column
 * key,value sheet — structured cells beat prose parsing, so the "Google Docs
 * form" is a SHEET the user fills and exports via File → Download → CSV.
 * Unknown keys are reported (not fatal); validation happens downstream against
 * the schema, giving field-level errors.
 *
 * Keys (case/space-insensitive; see the template):
 *   name, ws, bs, s, t, ag, int, per, wp, fel,
 *   unnatural ws|bs|s|t|ag,
 *   armour head|body|left arm|right arm|left leg|right leg,
 *   wounds max|current, fate max|current,
 *   talents, traits, conditions, circumstances          (comma-separated; "Name (X)" carries a level)
 *   weapon<N> name|class|damage|pen|type|rof burst|rof full|qualities|craftsmanship
 *   field rating|field overload
 */
import { emptyCharacter, CHARACTER_SCHEMA_VERSION } from '../../api/lib/character-schema.mjs';

/** Minimal CSV line splitter with double-quote support (enough for the template). */
function splitCsvLine(line) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQ = false;
            else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const listOf = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Parse template CSV text → { character, unknownKeys } (canonical JSON; validate downstream). */
export function fromGoogleSheetCsv(csvText, { sourceName = 'google-sheets' } = {}) {
    const doc = emptyCharacter('');
    doc.source = { adapter: sourceName, importedAt: null };
    const unknownKeys = [];
    const weapons = new Map();   // N → weapon draft
    const weaponAt = (n) => {
        if (!weapons.has(n)) weapons.set(n, { name: '', damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] });
        return weapons.get(n);
    };

    const CHAR_KEYS = { ws: 'ws', bs: 'bs', s: 's', t: 't', ag: 'ag', int: 'int', per: 'per', wp: 'wp', fel: 'fel' };
    const ARMOUR_KEYS = { head: 'head', body: 'body', 'left arm': 'leftArm', 'right arm': 'rightArm', 'left leg': 'leftLeg', 'right leg': 'rightLeg' };

    for (const rawLine of String(csvText).split(/\r?\n/)) {
        if (!rawLine.trim()) continue;
        const [rawKey, rawValue] = splitCsvLine(rawLine);
        const key = norm(rawKey), value = String(rawValue ?? '').trim();
        if (!key || key.startsWith('#') || key === 'key') continue;   // comments / header row
        const int = () => parseInt(value, 10) || 0;

        let m;
        if (key === 'name') doc.name = value;
        else if (key in CHAR_KEYS) doc.characteristics[CHAR_KEYS[key]] = int();
        else if ((m = /^unnatural (ws|bs|s|t|ag)$/.exec(key))) doc.unnatural[m[1]] = int();
        else if ((m = /^armour (head|body|left arm|right arm|left leg|right leg)$/.exec(key))) doc.armour[ARMOUR_KEYS[m[1]]] = int();
        else if (key === 'wounds max') doc.wounds.max = int();
        else if (key === 'wounds current') doc.wounds.current = int();
        else if (key === 'fate max') doc.fate.max = int();
        else if (key === 'fate current') doc.fate.current = int();
        else if (key === 'talents') doc.talents = listOf(value);
        else if (key === 'traits') doc.traits = listOf(value);
        else if (key === 'conditions') doc.conditions = listOf(value);
        else if (key === 'circumstances') doc.circumstances = listOf(value);
        else if (key === 'field rating') doc.field.rating = int();
        else if (key === 'field overload') doc.field.overloadMax = int();
        else if ((m = /^weapon(\d+) (name|class|damage|pen|type|rof burst|rof full|qualities|craftsmanship)$/.exec(key))) {
            const w = weaponAt(+m[1]);
            switch (m[2]) {
                case 'name': w.name = value; break;
                case 'class': w.class = norm(value); break;
                case 'damage': w.damage = value; break;
                case 'pen': w.pen = int(); break;
                case 'type': w.damageType = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase(); break;
                case 'rof burst': w.rof.burst = int(); break;
                case 'rof full': w.rof.full = int(); break;
                case 'qualities': w.qualities = listOf(value); break;
                case 'craftsmanship': w.craftsmanship = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase(); break;
            }
        }
        else unknownKeys.push(rawKey.trim());
    }

    doc.weapons = [...weapons.keys()].sort((a, b) => a - b).map((n) => weapons.get(n)).filter((w) => w.name);
    doc.schemaVersion = CHARACTER_SCHEMA_VERSION;
    return { character: doc, unknownKeys };
}
