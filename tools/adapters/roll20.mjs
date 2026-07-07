/**
 * Roll20 adapter (ROADMAP Phase 2, Lane B) — Roll20 character attribute JSON →
 * canonical character JSON (api/lib/character-schema.mjs).
 *
 * Input shape: the attribute dump Roll20's API (or the common exporter
 * userscripts) produce — `{ name, attribs: [{ name, current, max }, …] }`.
 * Community DH2 sheets differ in attribute naming, so the mapping is
 * CANDIDATE-DRIVEN: each canonical field lists the attribute names it accepts
 * (first hit wins, case/underscore-insensitive). Weapons come from Roll20
 * repeating sections (`repeating_weapons_<rowid>_<field>`). Anything the
 * mapping can't place is returned in `unmapped` so the user can see gaps;
 * schema validation downstream reports the field-level consequences.
 */
import { emptyCharacter, CHARACTER_SCHEMA_VERSION } from '../../api/lib/character-schema.mjs';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');

/** canonical → candidate Roll20 attribute names (normalised). */
const CHAR_MAP = {
    ws: ['weaponskill', 'ws'],
    bs: ['ballisticskill', 'bs'],
    s: ['strength', 'str', 's'],
    t: ['toughness', 'tou', 't'],
    ag: ['agility', 'agi', 'ag'],
    int: ['intelligence', 'int'],
    per: ['perception', 'per'],
    wp: ['willpower', 'wp', 'will'],
    fel: ['fellowship', 'fel'],
};
const MISC_MAP = {
    'wounds.max': ['wounds', 'woundsmax', 'wound'],           // max comes from .max when present
    'fate.max': ['fate', 'fatepoints', 'fatemax'],
};
const ARMOUR_MAP = {
    head: ['armourhead', 'armorhead', 'aphead'],
    body: ['armourbody', 'armorbody', 'apbody'],
    leftArm: ['armourleftarm', 'armorleftarm', 'apleftarm'],
    rightArm: ['armourrightarm', 'armorrightarm', 'aprightarm'],
    leftLeg: ['armourleftleg', 'armorleftleg', 'apleftleg'],
    rightLeg: ['armourrightleg', 'armorrightleg', 'aprightleg'],
};

/** Parse a Roll20 attribute export → { character, unmapped }. */
export function fromRoll20(json, { sourceName = 'roll20' } = {}) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const attribs = data.attribs ?? data.attributes ?? [];
    const byName = new Map();
    for (const a of attribs) byName.set(norm(a.name), a);

    const doc = emptyCharacter(data.name ?? 'Roll20 import');
    doc.source = { adapter: sourceName, roll20Name: data.name ?? null, importedAt: null };
    const used = new Set();
    const pick = (candidates) => {
        for (const c of candidates) if (byName.has(c)) { used.add(c); return byName.get(c); }
        return null;
    };
    const intOf = (a, prop = 'current') => (a ? parseInt(a[prop], 10) || 0 : 0);

    for (const [key, candidates] of Object.entries(CHAR_MAP)) {
        const a = pick(candidates);
        if (a) doc.characteristics[key] = intOf(a);
    }
    // unnatural: sheets usually store as e.g. "unnatural_strength"
    for (const key of ['ws', 'bs', 's', 't', 'ag']) {
        const a = pick(CHAR_MAP[key].map((c) => `unnatural${c}`));
        if (a) doc.unnatural[key] = intOf(a);
    }
    for (const [loc, candidates] of Object.entries(ARMOUR_MAP)) {
        const a = pick(candidates);
        if (a) doc.armour[loc] = intOf(a);
    }
    const wounds = pick(MISC_MAP['wounds.max']);
    if (wounds) { doc.wounds.max = intOf(wounds, 'max') || intOf(wounds); doc.wounds.current = intOf(wounds); }
    const fate = pick(MISC_MAP['fate.max']);
    if (fate) { doc.fate.max = intOf(fate, 'max') || intOf(fate); doc.fate.current = intOf(fate); }

    // repeating sections: repeating_<section>_<rowid>_<field>
    const repeating = new Map();   // section → rowid → {field: value}
    for (const a of attribs) {
        const m = /^repeating_([a-z0-9]+)_([-A-Za-z0-9]+)_(.+)$/.exec(a.name ?? '');
        if (!m) continue;
        used.add(norm(a.name));
        const [, section, rowId, field] = m;
        if (!repeating.has(section)) repeating.set(section, new Map());
        const row = repeating.get(section);
        if (!row.has(rowId)) row.set(rowId, {});
        row.get(rowId)[norm(field)] = a.current;
    }
    // weapons
    for (const section of ['weapons', 'weapon', 'attacks']) {
        for (const row of (repeating.get(section) ?? new Map()).values()) {
            const name = row.name ?? row.weaponname ?? row.weapon;
            if (!name) continue;
            doc.weapons.push({
                name: String(name),
                class: /melee/i.test(String(row.class ?? row.type ?? '')) ? 'melee' : undefined,
                damage: String(row.damage ?? '1d10'),
                pen: parseInt(row.pen ?? row.penetration, 10) || 0,
                damageType: ({ i: 'Impact', e: 'Energy', x: 'Explosive', r: 'Rending' })[norm(String(row.damagetype ?? row.type ?? 'i')).charAt(0)] ?? 'Impact',
                rof: { single: true, burst: parseInt(row.rofburst ?? row.semi, 10) || 0, full: parseInt(row.roffull ?? row.full, 10) || 0 },
                qualities: String(row.qualities ?? row.special ?? '').split(',').map((x) => x.trim()).filter(Boolean),
            });
        }
    }
    // talents / traits from repeating sections when present
    for (const row of (repeating.get('talents') ?? new Map()).values()) {
        if (row.name) doc.talents.push(String(row.name));
    }
    for (const row of (repeating.get('traits') ?? new Map()).values()) {
        if (row.name) doc.traits.push(String(row.name));
    }

    const unmapped = attribs
        .filter((a) => !used.has(norm(a.name)) && !/^repeating_/.test(a.name ?? ''))
        .map((a) => a.name);
    doc.schemaVersion = CHARACTER_SCHEMA_VERSION;
    return { character: doc, unmapped };
}
