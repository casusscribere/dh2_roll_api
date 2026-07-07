/**
 * Character schema v1 (ROADMAP.md Phase 2, Lane A).
 *
 * THE canonical, versioned character document — the interchange format between
 * the import adapters (tools/adapters/*), the Roll UI (load/save), and the
 * Foundry Actor importer (foundry/dh2-roll-vm). It formalises what the Roll
 * UI's buildEngagementInputs() assembles ad hoc.
 *
 * Single-sourced: the FIELDS table below drives (a) validateCharacter's
 * field-level errors, (b) the /api/character/schema reference payload, and the
 * fields are named/shaped to map 1:1 onto Foundry DataFields when the Phase 8
 * DataModel is written. carry a `schemaVersion` and run migrateCharacter() at
 * every boundary — documents written by older versions stay loadable forever.
 *
 * Design notes:
 * - All nine DH2 characteristics are carried even though the attack loop reads
 *   a subset — the schema describes the CHARACTER, not one API call.
 * - Armour is per-location (Foundry/DH2 shape); the current engine consumes a
 *   single AP value (characterToCombatant picks the body location by default).
 * - Levelled entries (talents/traits/qualities) accept "Name (3)" strings or
 *   { name, level } objects — canonicalised at the engine boundary (Stage 1).
 */
import { canonList } from './rules/_util.mjs';

export const CHARACTER_SCHEMA_VERSION = 1;

const CHARACTERISTIC_KEYS = ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'];
const UNNATURAL_KEYS = ['ws', 'bs', 's', 't', 'ag'];
const ARMOUR_KEYS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const DAMAGE_TYPES = ['Impact', 'Energy', 'Explosive', 'Rending'];
const WEAPON_CLASSES = ['melee', 'pistol', 'basic', 'heavy', 'thrown'];
const CRAFTSMANSHIP = ['Poor', 'Common', 'Good', 'Best'];

/** Field reference (drives validation + /api/character/schema). `type` is a
 *  human label; the check lives in validateCharacter. */
export const CHARACTER_FIELDS = [
    { path: 'schemaVersion', type: 'int', required: true, summary: `Document schema version (current: ${CHARACTER_SCHEMA_VERSION}). Migrations keep old documents loadable.` },
    { path: 'kind', type: '"dh2.character"', required: true, summary: 'Document discriminator.' },
    { path: 'name', type: 'string', required: true, summary: 'Character name.' },
    { path: 'system', type: 'string', required: false, summary: 'Rule system id (default "dh2").' },
    { path: 'characteristics.<ws|bs|s|t|ag|int|per|wp|fel>', type: 'int 0–200', required: true, summary: 'The nine DH2 characteristics (percentile values).' },
    { path: 'unnatural.<ws|bs|s|t|ag>', type: 'int ≥ 0', required: false, summary: 'Unnatural Characteristic values (p.139): +X to the bonus, ⌈X/2⌉ bonus DoS on successful tests.' },
    { path: 'armour.<head|body|leftArm|rightArm|leftLeg|rightLeg>', type: 'int ≥ 0', required: false, summary: 'Armour points by hit location.' },
    { path: 'wounds', type: '{ max, current }', required: false, summary: 'Wound track (carried, not yet consumed by the attack loop).' },
    { path: 'fate', type: '{ max, current }', required: false, summary: 'Fate points (carried, not yet consumed).' },
    { path: 'talents', type: '(string | {name, level})[]', required: false, summary: 'Talent list. "Name (X)" strings or {name, level} objects.' },
    { path: 'traits', type: '(string | {name, level})[]', required: false, summary: 'Trait list (innate DH2.0 traits, e.g. Brutal Charge (3), Daemonic (4)).' },
    { path: 'conditions', type: '(string | {name, severity, duration, location})[]', required: false, summary: 'Active Conditions (Stunned, On Fire, …).' },
    { path: 'circumstances', type: '(string | {name, severity})[]', required: false, summary: 'Environmental Circumstances (Darkness, Haywire Field, …).' },
    { path: 'weapons[]', type: 'weapon', required: false, summary: 'Weapon profiles (see weapon fields).' },
    { path: 'weapons[].name', type: 'string', required: true, summary: 'Weapon name.' },
    { path: 'weapons[].class', type: WEAPON_CLASSES.join(' | '), required: false, summary: 'Weapon class; "melee" and "thrown" drive Strength-Bonus damage.' },
    { path: 'weapons[].damage', type: 'string "XdY+Z"', required: true, summary: 'Damage formula.' },
    { path: 'weapons[].pen', type: 'int ≥ 0', required: false, summary: 'Penetration.' },
    { path: 'weapons[].damageType', type: DAMAGE_TYPES.join(' | '), required: false, summary: 'Damage type.' },
    { path: 'weapons[].rof', type: '{ single, burst, full }', required: false, summary: 'Rate of fire (burst/full as ints).' },
    { path: 'weapons[].qualities', type: '(string | {name, level})[]', required: false, summary: 'Weapon qualities.' },
    { path: 'weapons[].craftsmanship', type: CRAFTSMANSHIP.join(' | '), required: false, summary: 'Craftsmanship tier.' },
    { path: 'weapons[].sbMultiplier', type: 'int 0–2', required: false, summary: 'Strength-Bonus multiple added to damage for melee/thrown (default 1 for melee).' },
    { path: 'field', type: '{ rating, overloadMax }', required: false, summary: 'Force field (absorbs on roll ≤ rating; overloads on roll ≤ overloadMax).' },
    { path: 'source', type: '{ adapter, ... }', required: false, summary: 'Import provenance (adapter name, source identifiers, timestamp).' },
];

/** A minimal valid document (also the UI "new character" template). */
export function emptyCharacter(name = 'New Character') {
    return {
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        kind: 'dh2.character',
        name,
        system: 'dh2',
        characteristics: Object.fromEntries(CHARACTERISTIC_KEYS.map((k) => [k, 30])),
        unnatural: Object.fromEntries(UNNATURAL_KEYS.map((k) => [k, 0])),
        armour: Object.fromEntries(ARMOUR_KEYS.map((k) => [k, 0])),
        wounds: { max: 10, current: 10 },
        fate: { max: 2, current: 2 },
        talents: [], traits: [], conditions: [], circumstances: [],
        weapons: [],
        field: { rating: 0, overloadMax: 0 },
    };
}

const isInt = (v) => Number.isInteger(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isNamedEntry = (v) => typeof v === 'string' || (v && typeof v === 'object' && typeof v.name === 'string');

/**
 * Validate a character document. Returns { ok, errors, warnings } where each
 * entry is { path, message } — field-level, for the importer UI.
 * Unknown keys are warnings (forward compatibility), not errors.
 */
export function validateCharacter(doc) {
    const errors = [], warnings = [];
    const err = (path, message) => errors.push({ path, message });
    const warn = (path, message) => warnings.push({ path, message });

    if (!doc || typeof doc !== 'object') return { ok: false, errors: [{ path: '', message: 'Not an object' }], warnings };

    if (!isInt(doc.schemaVersion)) err('schemaVersion', 'Required integer');
    else if (doc.schemaVersion > CHARACTER_SCHEMA_VERSION) warn('schemaVersion', `Document is v${doc.schemaVersion}; this build knows v${CHARACTER_SCHEMA_VERSION} — fields may be ignored`);
    if (doc.kind !== 'dh2.character') err('kind', 'Must be "dh2.character"');
    if (typeof doc.name !== 'string' || !doc.name.trim()) err('name', 'Required non-empty string');
    if (doc.system !== undefined && typeof doc.system !== 'string') err('system', 'Must be a string');

    // characteristics
    if (!doc.characteristics || typeof doc.characteristics !== 'object') err('characteristics', 'Required object');
    else {
        for (const k of CHARACTERISTIC_KEYS) {
            const v = doc.characteristics[k];
            if (v === undefined) err(`characteristics.${k}`, 'Required');
            else if (!isInt(v) || v < 0 || v > 200) err(`characteristics.${k}`, 'Integer 0–200 required');
        }
        for (const k of Object.keys(doc.characteristics)) if (!CHARACTERISTIC_KEYS.includes(k)) warn(`characteristics.${k}`, 'Unknown characteristic (ignored)');
    }
    // unnatural
    if (doc.unnatural !== undefined) {
        if (typeof doc.unnatural !== 'object') err('unnatural', 'Must be an object');
        else for (const [k, v] of Object.entries(doc.unnatural)) {
            if (!UNNATURAL_KEYS.includes(k)) warn(`unnatural.${k}`, 'Unknown/unsupported unnatural characteristic (ignored)');
            else if (!isNonNegInt(v)) err(`unnatural.${k}`, 'Non-negative integer required');
        }
    }
    // armour
    if (doc.armour !== undefined) {
        if (typeof doc.armour !== 'object') err('armour', 'Must be an object');
        else for (const [k, v] of Object.entries(doc.armour)) {
            if (!ARMOUR_KEYS.includes(k)) warn(`armour.${k}`, 'Unknown hit location (ignored)');
            else if (!isNonNegInt(v)) err(`armour.${k}`, 'Non-negative integer required');
        }
    }
    // wounds / fate
    for (const trackName of ['wounds', 'fate']) {
        const track = doc[trackName];
        if (track === undefined) continue;
        if (typeof track !== 'object') { err(trackName, 'Must be { max, current }'); continue; }
        for (const p of ['max', 'current']) if (track[p] !== undefined && !isInt(track[p])) err(`${trackName}.${p}`, 'Integer required');
    }
    // rule lists
    for (const listName of ['talents', 'traits', 'conditions', 'circumstances']) {
        const list = doc[listName];
        if (list === undefined) continue;
        if (!Array.isArray(list)) { err(listName, 'Must be an array'); continue; }
        list.forEach((entry, i) => { if (!isNamedEntry(entry)) err(`${listName}[${i}]`, 'Must be a string or { name, … } object'); });
    }
    // weapons
    if (doc.weapons !== undefined) {
        if (!Array.isArray(doc.weapons)) err('weapons', 'Must be an array');
        else doc.weapons.forEach((w, i) => {
            const at = (p) => `weapons[${i}].${p}`;
            if (!w || typeof w !== 'object') { err(`weapons[${i}]`, 'Must be an object'); return; }
            if (typeof w.name !== 'string' || !w.name.trim()) err(at('name'), 'Required non-empty string');
            if (typeof w.damage !== 'string' || !/^\s*\d+\s*d\s*\d+\s*([+-]\s*\d+)?\s*$/i.test(w.damage)) err(at('damage'), 'Damage formula "XdY[+Z]" required');
            if (w.class !== undefined && !WEAPON_CLASSES.includes(w.class)) err(at('class'), `One of: ${WEAPON_CLASSES.join(', ')}`);
            if (w.pen !== undefined && !isNonNegInt(w.pen)) err(at('pen'), 'Non-negative integer required');
            if (w.damageType !== undefined && !DAMAGE_TYPES.includes(w.damageType)) err(at('damageType'), `One of: ${DAMAGE_TYPES.join(', ')}`);
            if (w.craftsmanship !== undefined && !CRAFTSMANSHIP.includes(w.craftsmanship)) err(at('craftsmanship'), `One of: ${CRAFTSMANSHIP.join(', ')}`);
            if (w.qualities !== undefined) {
                if (!Array.isArray(w.qualities)) err(at('qualities'), 'Must be an array');
                else w.qualities.forEach((q, qi) => { if (!isNamedEntry(q)) err(at(`qualities[${qi}]`), 'Must be a string or { name, level }'); });
            }
            if (w.rof !== undefined && (typeof w.rof !== 'object' || w.rof === null)) err(at('rof'), 'Must be { single, burst, full }');
            if (w.sbMultiplier !== undefined && (!isInt(w.sbMultiplier) || w.sbMultiplier < 0 || w.sbMultiplier > 2)) err(at('sbMultiplier'), 'Integer 0–2 required');
        });
    }
    // field
    if (doc.field !== undefined) {
        if (typeof doc.field !== 'object') err('field', 'Must be { rating, overloadMax }');
        else for (const p of ['rating', 'overloadMax']) if (doc.field[p] !== undefined && !isNonNegInt(doc.field[p])) err(`field.${p}`, 'Non-negative integer required');
    }

    return { ok: errors.length === 0, errors, warnings };
}

/** Migrate any older document to the current version. v1 is the first version,
 *  so this is the identity plus defaults — the pattern (switch fallthrough per
 *  version, exactly like Foundry world migrations) is established from day one. */
export function migrateCharacter(doc) {
    const d = { ...doc };
    switch (d.schemaVersion) {
        case undefined:
        case 0:
            d.schemaVersion = 1;
            d.kind = d.kind ?? 'dh2.character';
            // fallthrough for future versions:
        case 1:
            break;
        default:
            break;   // newer than us — validateCharacter warns
    }
    return d;
}

/**
 * THE schema → engine mapping (used by the Roll UI, the Foundry Actor importer
 * and tests): turn a character document into the engagement combatant shape.
 * `weaponIndex` picks the weapon (default 0). Armour uses the body location
 * unless `location` is given (the engine consumes one AP value today).
 */
export function characterToCombatant(doc, { weaponIndex = 0, location = 'body' } = {}) {
    const c = doc.characteristics ?? {};
    const w = (doc.weapons ?? [])[weaponIndex];
    return {
        name: doc.name,
        characteristics: { ws: c.ws ?? 0, bs: c.bs ?? 0, s: c.s ?? 0, t: c.t ?? 0, ag: c.ag ?? 0, wp: c.wp ?? 0 },
        unnatural: { ...(doc.unnatural ?? {}) },
        weapon: w ? {
            name: w.name,
            isMelee: w.class === 'melee',
            thrown: w.class === 'thrown' || undefined,
            damage: w.damage,
            pen: w.pen ?? 0,
            damageType: w.damageType ?? 'Impact',
            rof: { single: true, burst: Number(w.rof?.burst) || 0, full: Number(w.rof?.full) || 0 },
            qualities: canonList(w.qualities),
            craftsmanship: w.craftsmanship ?? 'Common',
            sbMultiplier: w.sbMultiplier ?? (w.class === 'melee' || w.class === 'thrown' ? 1 : 0),
        } : undefined,
        talents: canonList(doc.talents),
        traits: canonList(doc.traits),
        conditions: doc.conditions ?? [],
        circumstances: doc.circumstances ?? [],
        // defender-side extras (harmless on the attacker side):
        armour: (doc.armour ?? {})[location] ?? 0,
        toughnessBonus: Math.floor((c.t ?? 0) / 10),
        unnaturalToughness: doc.unnatural?.t ?? 0,
        field: doc.field ?? { rating: 0, overloadMax: 0 },
    };
}
