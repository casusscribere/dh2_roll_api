/**
 * Character schema v2 (ROADMAP.md Phase 2 Lane A; upgraded per
 * CHARACTER_MODEL.md §4 — modeled on the Foundry dark-heresy-3rd-edition
 * acolyte Actor).
 *
 * THE canonical, versioned character document — the interchange format between
 * the import adapters (tools/*), the Roll/Characters UI, and the Foundry Actor
 * importer (foundry/dh2-roll-vm).
 *
 * v2 additions (all optional — v1 documents migrate losslessly):
 * - characteristics are OBJECTS `{ base, advances, modifiers[] }` with the
 *   total DERIVED (base + 5×advances + Σmodifiers) — the Foundry shape.
 * - skills, including specialist skills (Scholastic Lore (X), …) with a
 *   per-speciality advances map; targets derived RAW (untrained = ½
 *   characteristic; known/+10/+20/+30 at advances 1–4).
 * - MODIFIERS BY SOURCE everywhere a number can be adjusted: a modifier is
 *   `{ value, source?, note? }` — e.g. `{ value: 20, source: "Good Bionic
 *   Eyes" }` on Tech-Use ties the +20 to the item that grants it.
 * - xp tracking: total + spent + a per-purchase ledger.
 * - aptitudes `[{ name, source? }]` and the Emperor's Tarot
 *   (`tarot { card, text, effect }` ⇄ Foundry bio.divination).
 *
 * Single-sourced: the FIELDS table drives validateCharacter and
 * /api/character/schema; fields map 1:1 onto Foundry DataFields (Phase 8).
 * Documents carry `schemaVersion`; run migrateCharacter() at every boundary.
 */
import { canonList, normName } from './rules/_util.mjs';

export const CHARACTER_SCHEMA_VERSION = 3;

const CHARACTERISTIC_KEYS = ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'];
const UNNATURAL_KEYS = ['ws', 'bs', 's', 't', 'ag'];
const ARMOUR_KEYS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const DAMAGE_TYPES = ['Impact', 'Energy', 'Explosive', 'Rending'];
const WEAPON_CLASSES = ['melee', 'pistol', 'basic', 'heavy', 'thrown'];
const CRAFTSMANSHIP = ['Poor', 'Common', 'Good', 'Best'];
const PSYKER_CLASSES = ['none', 'bound', 'unbound', 'daemonic'];
/** Amputatable parts (DH2 core p.251 amputated limbs; eyes from crit tables). */
const AMPUTATION_KEYS = ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot', 'leftEye', 'rightEye'];

/** Table 7-26: Carrying, Lifting, & Pushing (DH2 core p.248) — max kg by the
 *  SUM of Strength and Toughness BONUSES (unnatural included). Index 0–20. */
export const CARRY_TABLE = [
    { carry: 0.9, lift: 2.25, push: 4.5 }, { carry: 2.25, lift: 4.5, push: 9 },
    { carry: 4.5, lift: 9, push: 18 },     { carry: 9, lift: 18, push: 36 },
    { carry: 18, lift: 36, push: 72 },     { carry: 27, lift: 54, push: 108 },
    { carry: 36, lift: 72, push: 144 },    { carry: 45, lift: 90, push: 180 },
    { carry: 56, lift: 112, push: 224 },   { carry: 67, lift: 134, push: 268 },
    { carry: 78, lift: 156, push: 312 },   { carry: 90, lift: 180, push: 360 },
    { carry: 112, lift: 224, push: 448 },  { carry: 225, lift: 450, push: 900 },
    { carry: 337, lift: 674, push: 1348 }, { carry: 450, lift: 900, push: 1800 },
    { carry: 675, lift: 1350, push: 2700 },{ carry: 900, lift: 1800, push: 3600 },
    { carry: 1350, lift: 2700, push: 5400 },{ carry: 1800, lift: 3600, push: 7200 },
    { carry: 2250, lift: 4500, push: 9000 },
];

/** The DH2 core skill list (Chapter III) — canonical names, governing
 *  characteristic, and whether the skill is SPECIALIST (takes an (X) — its
 *  document entry carries a `specialities` map). Skill keys in a document are
 *  matched against these names spelling-blind (normName). */
export const SKILL_DEFS = {
    'Acrobatics':      { characteristic: 'ag' },
    'Athletics':       { characteristic: 's' },
    'Awareness':       { characteristic: 'per' },
    'Charm':           { characteristic: 'fel' },
    'Command':         { characteristic: 'fel' },
    'Commerce':        { characteristic: 'int' },
    'Common Lore':     { characteristic: 'int', specialist: true },
    'Deceive':         { characteristic: 'fel' },
    'Dodge':           { characteristic: 'ag' },
    'Forbidden Lore':  { characteristic: 'int', specialist: true },
    'Inquiry':         { characteristic: 'fel' },
    'Interrogation':   { characteristic: 'wp' },
    'Intimidate':      { characteristic: 's' },
    'Linguistics':     { characteristic: 'int', specialist: true },
    'Logic':           { characteristic: 'int' },
    'Medicae':         { characteristic: 'int' },
    'Navigate':        { characteristic: 'int', specialist: true },
    'Operate':         { characteristic: 'ag', specialist: true },
    'Parry':           { characteristic: 'ws' },
    'Psyniscience':    { characteristic: 'per' },
    'Scholastic Lore': { characteristic: 'int', specialist: true },
    'Scrutiny':        { characteristic: 'per' },
    'Security':        { characteristic: 'int' },
    'Sleight of Hand': { characteristic: 'ag' },
    'Stealth':         { characteristic: 'ag' },
    'Survival':        { characteristic: 'per' },
    'Tech-Use':        { characteristic: 'int' },
    'Trade':           { characteristic: 'int', specialist: true },
};
/** Canonical SKILL_DEFS name for any spelling ("scholastic_lores" → "Scholastic Lore"), or null. */
export const canonicalSkillName = (name) => {
    const k = normName(name).replace(/s$/, '');   // tolerate plural ("Common Lores")
    for (const key of Object.keys(SKILL_DEFS)) if (normName(key).replace(/s$/, '') === k) return key;
    return null;
};

// --- modifiers by source ----------------------------------------------------
// The one shape for every adjustable number: value + WHERE IT COMES FROM.
// { value: +20, source: "Good Bionic Eyes", note?: "…" }
const isModifier = (m) => m && typeof m === 'object' && Number.isInteger(m.value)
    && (m.source === undefined || typeof m.source === 'string')
    && (m.note === undefined || typeof m.note === 'string');
/** Sum of a modifiers array (tolerates undefined). */
export const modifierTotal = (mods) => (mods ?? []).reduce((a, m) => a + (Number(m?.value) || 0), 0);

/** Field reference (drives validation + /api/character/schema). `type` is a
 *  human label; the check lives in validateCharacter. */
export const CHARACTER_FIELDS = [
    { path: 'schemaVersion', type: 'int', required: true, summary: `Document schema version (current: ${CHARACTER_SCHEMA_VERSION}). Migrations keep old documents loadable.` },
    { path: 'kind', type: '"dh2.character"', required: true, summary: 'Document discriminator.' },
    { path: 'name', type: 'string', required: true, summary: 'Character name.' },
    { path: 'system', type: 'string', required: false, summary: 'Rule system id (default "dh2").' },
    { path: 'characteristics.<ws|bs|s|t|ag|int|per|wp|fel>', type: '{ base, advances, modifiers[] }', required: true, summary: 'The nine DH2 characteristics. total = base + 5×advances + Σmodifiers (derived — use characteristicTotal). v1 flat ints migrate automatically.' },
    { path: 'characteristics.<k>.modifiers[]', type: '{ value, source?, note? }', required: false, summary: 'Manual modifiers BY SOURCE — e.g. { value: 5, source: "Custom Grip" }.' },
    { path: 'unnatural.<ws|bs|s|t|ag>', type: 'int ≥ 0', required: false, summary: 'Unnatural Characteristic values (p.139): +X to the bonus, ⌈X/2⌉ bonus DoS on successful tests.' },
    { path: 'skills.<Name>', type: '{ advances 0–4, characteristic?, modifiers[], specialities? }', required: false, summary: `A DH2 skill (canonical names: ${Object.keys(SKILL_DEFS).join(', ')}). Target derived RAW: untrained = ½ characteristic; advances 1–4 → +0/+10/+20/+30 (use skillTarget).` },
    { path: 'skills.<Name>.specialities.<X>', type: '{ advances 0–4, modifiers[] }', required: false, summary: 'Specialist-skill entries — Scholastic Lore (Occult), Operate (Surface), … Only valid on specialist skills.' },
    { path: 'skills.<Name>.modifiers[]', type: '{ value, source?, note? }', required: false, summary: 'Skill modifiers BY SOURCE — e.g. { value: 20, source: "Good Bionic Eyes" } on Tech-Use.' },
    { path: 'xp', type: '{ total, spent?, ledger[] }', required: false, summary: 'Experience: earned total, spent (defaults to the ledger sum), and the per-purchase ledger.' },
    { path: 'xp.ledger[]', type: '{ name, cost, source?, date? }', required: false, summary: 'One purchase — "Mighty Shot", 600, "Core RB".' },
    { path: 'aptitudes[]', type: 'string | { name, source? }', required: false, summary: 'Aptitudes with their origin (Homeworld / Background / Role / …).' },
    { path: 'tarot', type: '{ card?, text?, effect? }', required: false, summary: "The Emperor's Tarot / divination drawn at creation (⇄ Foundry bio.divination)." },
    { path: 'weapons[].weight', type: 'number ≥ 0 (kg)', required: false, summary: 'Weapon weight — counts toward encumbrance while equipped.' },
    { path: 'weapons[].equipped', type: 'bool (default true)', required: false, summary: 'On the character (counts weight; available in combat). false = stored.' },
    { path: 'weapons[].clip', type: '{ max, value }', required: false, summary: 'Magazine size and rounds remaining (consumed when ammo tracking lands).' },
    { path: 'armourItems[]', type: '{ name, ap, locations[], weight?, equipped?, maxAgility?, qualities? }', required: false, summary: 'Worn armour as items: AP + covered locations ("all" or head/body/…). Equipped items derive per-location AP (highest wins — armour does not stack); the flat `armour` block is a manual override used when no item is equipped.' },
    { path: 'gear[]', type: '{ name, weight?, quantity?, equipped?, notes? }', required: false, summary: 'Equipment. equipped=true (default) counts weight × quantity toward encumbrance; false = stored (quarters/ship).' },
    { path: 'fatigue', type: '{ current }', required: false, summary: 'Fatigue levels. Threshold is DERIVED: TB + WB (p.233; fatigueThreshold()).' },
    { path: 'psy', type: `{ rating, class: ${PSYKER_CLASSES.join('|')}, sustained }`, required: false, summary: 'Psy rating (0 = not a psyker), psyker class, powers currently sustained.' },
    { path: 'psychicPowers[]', type: 'string | { name, discipline?, cost?, notes?, equipped? }', required: false, summary: 'Known psychic powers. equipped=true (default) = in the active loadout / prepared; the power.* pipeline consumes these in Phase 6.' },
    { path: 'insanity', type: '{ points 0–100, disorders[] }', required: false, summary: 'Insanity points and acquired Mental Disorders.' },
    { path: 'corruption', type: '{ points 0–100, malignancies[], mutations[] }', required: false, summary: 'Corruption points, Malignancies, and Mutations.' },
    { path: 'wounds.critical', type: 'int ≥ 0', required: false, summary: 'Critical damage taken beyond 0 wounds (the crit-table severity).' },
    { path: 'criticalInjuries[]', type: 'string | { location?, effect, source? }', required: false, summary: 'Lasting critical-injury effects (⇄ Foundry criticalInjury Items).' },
    { path: 'amputations[]', type: AMPUTATION_KEYS.join(' | '), required: false, summary: 'Missing limbs/organs (DH2 core p.251).' },
    { path: 'size', type: 'int 1–10', required: false, summary: 'Size trait value (DH2 p.138; 4 = Average). Display + future to-hit modifiers.' },
    { path: 'movementModifier', type: 'int −10–10', required: false, summary: 'Manual movement adjustment: acts as an Agility-Bonus delta for the movement brackets ONLY (does not stack into any other AgB calculation).' },
    { path: '<weapons|armourItems|gear>[].description', type: 'string', required: false, summary: 'Free-text item description.' },
    { path: '<weapons|armourItems|gear>[].dsl', type: 'string (DSL source)', required: false, summary: 'Item-granted rules in the DSL. Applied at roll time ONLY while the item is equipped — e.g. `quality "Good Auspex" { on test.MODIFIERS when is_test("Tech-Use") then add modifier "auspex" = 20 }`.' },
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
        characteristics: Object.fromEntries(CHARACTERISTIC_KEYS.map((k) => [k, { base: 30, advances: 0, modifiers: [] }])),
        unnatural: Object.fromEntries(UNNATURAL_KEYS.map((k) => [k, 0])),
        armour: Object.fromEntries(ARMOUR_KEYS.map((k) => [k, 0])),
        wounds: { max: 10, current: 10, critical: 0 },
        fate: { max: 2, current: 2 },
        fatigue: { current: 0 },
        skills: {},
        xp: { total: 0, ledger: [] },
        aptitudes: [],
        tarot: {},
        psy: { rating: 0, class: 'none', sustained: 0 },
        psychicPowers: [],
        insanity: { points: 0, disorders: [] },
        corruption: { points: 0, malignancies: [], mutations: [] },
        criticalInjuries: [],
        amputations: [],
        talents: [], traits: [], conditions: [], circumstances: [],
        weapons: [],
        armourItems: [],
        gear: [],
        field: { rating: 0, overloadMax: 0 },
    };
}

// --- derived physical state (single-source; UI + tests use these) -------------
/** A characteristic's BONUS: tens digit of the total + unnatural. */
export const characteristicBonus = (doc, key) =>
    Math.floor(characteristicTotal(doc, key) / 10) + (doc.unnatural?.[key] ?? 0);

/** Encumbrance (Table 7-26, p.248): carried kg = every EQUIPPED weapon/armour
 *  item/gear entry (× quantity); limits from the SB+TB sum (unnatural incl.). */
export function encumbrance(doc) {
    const wt = (x) => Number(x?.weight) || 0;
    const eq = (x) => x?.equipped !== false;
    let carried = 0;
    for (const w of doc.weapons ?? []) if (eq(w)) carried += wt(w);
    for (const a of doc.armourItems ?? []) if (eq(a)) carried += wt(a);
    for (const g of doc.gear ?? []) if (eq(g)) carried += wt(g) * (g.quantity ?? 1);
    const sum = Math.max(0, Math.min(CARRY_TABLE.length - 1,
        characteristicBonus(doc, 's') + characteristicBonus(doc, 't')));
    const limits = CARRY_TABLE[sum];
    return {
        carried: Math.round(carried * 100) / 100, sbPlusTb: sum,
        carry: limits.carry, lift: limits.lift, push: limits.push,
        encumbered: carried > limits.carry,
    };
}

/** Per-location AP: the highest EQUIPPED armour item covering each location
 *  (armour does not stack); the flat `armour` block is the fallback when no
 *  item is equipped. */
export function armourByLocation(doc) {
    const worn = (doc.armourItems ?? []).filter((a) => a.equipped !== false);
    if (!worn.length) return { ...Object.fromEntries(ARMOUR_KEYS.map((k) => [k, 0])), ...(doc.armour ?? {}) };
    const out = Object.fromEntries(ARMOUR_KEYS.map((k) => [k, 0]));
    for (const a of worn) {
        const locs = (a.locations ?? ['all']).includes('all') ? ARMOUR_KEYS : a.locations;
        for (const l of locs) if (l in out) out[l] = Math.max(out[l], a.ap ?? 0);
    }
    return out;
}

/** Fatigue threshold = Toughness bonus + Willpower bonus (p.233). */
export const fatigueThreshold = (doc) => characteristicBonus(doc, 't') + characteristicBonus(doc, 'wp');

/** Structured-time movement (Table 7-23, p.245): AgB / ×2 / ×3 / ×6 metres.
 *  `movementModifier` is a manual AgB-delta for the brackets ONLY (talents like
 *  Sprint, injuries, GM fiat) — it never feeds back into any AgB calculation. */
export function movement(doc) {
    const agb = Math.max(0, characteristicBonus(doc, 'ag') + (doc.movementModifier ?? 0));
    return { half: agb, full: agb * 2, charge: agb * 3, run: agb * 6 };
}

// --- derivation helpers (single-source; UI + combatant + tests use these) -----
/** A characteristic's TOTAL: base + 5×advances + Σ modifiers-by-source. */
export function characteristicTotal(doc, key) {
    const c = doc.characteristics?.[key];
    if (typeof c === 'number') return c;   // pre-migration flat form
    if (!c || typeof c !== 'object') return 0;
    return (c.base ?? 0) + 5 * (c.advances ?? 0) + modifierTotal(c.modifiers);
}
/**
 * A skill's test TARGET, RAW (DH2 core p.94): untrained = ½ characteristic
 * (round down); advances 1–4 = characteristic +0/+10/+20/+30. Skill and
 * speciality modifiers-by-source are added on top. `speciality` picks the
 * (X) entry of a specialist skill — an UNKNOWN speciality is untrained even
 * if the parent skill has entries.
 * Returns { target, characteristic, advances, trained, modifiers } or null
 * for an unknown skill name.
 */
export function skillTarget(doc, skillName, speciality = null) {
    const canonical = canonicalSkillName(skillName);
    if (!canonical) return null;
    const def = SKILL_DEFS[canonical];
    // find the document entry under any spelling
    const entryKey = Object.keys(doc.skills ?? {}).find((k) => canonicalSkillName(k) === canonical);
    const entry = entryKey ? doc.skills[entryKey] : null;
    let advances = 0;
    let mods = [...(entry?.modifiers ?? [])];
    if (def.specialist) {
        const specs = entry?.specialities ?? {};
        const sKey = speciality == null ? null
            : Object.keys(specs).find((k) => normName(k) === normName(speciality));
        const spec = sKey ? specs[sKey] : null;
        advances = spec?.advances ?? 0;
        mods = mods.concat(spec?.modifiers ?? []);
    } else {
        advances = entry?.advances ?? 0;
    }
    const charKey = entry?.characteristic ?? def.characteristic;
    const charVal = characteristicTotal(doc, charKey);
    const base = advances > 0 ? charVal + (advances - 1) * 10 : Math.floor(charVal / 2);
    return {
        target: base + modifierTotal(mods),
        characteristic: charKey, advances, trained: advances > 0, modifiers: mods,
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

    // modifiers-by-source list check (shared by characteristics & skills)
    const checkModifiers = (mods, path) => {
        if (mods === undefined) return;
        if (!Array.isArray(mods)) { err(path, 'Must be an array of { value, source?, note? }'); return; }
        mods.forEach((m, i) => { if (!isModifier(m)) err(`${path}[${i}]`, 'Must be { value: int, source?: string, note?: string }'); });
    };

    // characteristics — v2 objects (v1 flat ints are accepted; migrate normalises)
    if (!doc.characteristics || typeof doc.characteristics !== 'object') err('characteristics', 'Required object');
    else {
        for (const k of CHARACTERISTIC_KEYS) {
            const v = doc.characteristics[k];
            if (v === undefined) { err(`characteristics.${k}`, 'Required'); continue; }
            if (isInt(v)) {   // v1 shorthand — still a valid total
                if (v < 0 || v > 200) err(`characteristics.${k}`, 'Integer 0–200 required');
                continue;
            }
            if (!v || typeof v !== 'object') { err(`characteristics.${k}`, '{ base, advances, modifiers[] } (or a flat int) required'); continue; }
            if (!isInt(v.base) || v.base < 0 || v.base > 200) err(`characteristics.${k}.base`, 'Integer 0–200 required');
            if (v.advances !== undefined && (!isInt(v.advances) || v.advances < 0 || v.advances > 5)) err(`characteristics.${k}.advances`, 'Integer 0–5 required');
            checkModifiers(v.modifiers, `characteristics.${k}.modifiers`);
        }
        for (const k of Object.keys(doc.characteristics)) if (!CHARACTERISTIC_KEYS.includes(k)) warn(`characteristics.${k}`, 'Unknown characteristic (ignored)');
    }

    // skills (incl. specialist categories)
    if (doc.skills !== undefined) {
        if (!doc.skills || typeof doc.skills !== 'object' || Array.isArray(doc.skills)) err('skills', 'Must be an object keyed by skill name');
        else for (const [name, s] of Object.entries(doc.skills)) {
            const canonical = canonicalSkillName(name);
            if (!canonical) { warn(`skills.${name}`, 'Not a DH2 core skill name (kept, but skillTarget will not resolve it)'); continue; }
            if (!s || typeof s !== 'object') { err(`skills.${name}`, 'Must be an object'); continue; }
            const specialist = !!SKILL_DEFS[canonical].specialist;
            if (s.advances !== undefined && (!isInt(s.advances) || s.advances < 0 || s.advances > 4)) err(`skills.${name}.advances`, 'Integer 0–4 required');
            if (s.characteristic !== undefined && !CHARACTERISTIC_KEYS.includes(s.characteristic)) err(`skills.${name}.characteristic`, `One of: ${CHARACTERISTIC_KEYS.join(', ')}`);
            checkModifiers(s.modifiers, `skills.${name}.modifiers`);
            if (s.specialities !== undefined) {
                if (!specialist) warn(`skills.${name}.specialities`, `${canonical} is not a specialist skill (entries ignored by skillTarget)`);
                if (!s.specialities || typeof s.specialities !== 'object') err(`skills.${name}.specialities`, 'Must be an object keyed by speciality');
                else for (const [spec, sv] of Object.entries(s.specialities)) {
                    if (!sv || typeof sv !== 'object') { err(`skills.${name}.specialities.${spec}`, 'Must be an object'); continue; }
                    if (sv.advances !== undefined && (!isInt(sv.advances) || sv.advances < 0 || sv.advances > 4)) err(`skills.${name}.specialities.${spec}.advances`, 'Integer 0–4 required');
                    checkModifiers(sv.modifiers, `skills.${name}.specialities.${spec}.modifiers`);
                }
            }
            if (specialist && s.advances) warn(`skills.${name}.advances`, 'Specialist skill — per-speciality advances are what skillTarget reads');
        }
    }

    // xp
    if (doc.xp !== undefined) {
        if (!doc.xp || typeof doc.xp !== 'object') err('xp', 'Must be { total, spent?, ledger[] }');
        else {
            if (doc.xp.total !== undefined && !isNonNegInt(doc.xp.total)) err('xp.total', 'Non-negative integer required');
            if (doc.xp.spent !== undefined && !isNonNegInt(doc.xp.spent)) err('xp.spent', 'Non-negative integer required');
            if (doc.xp.ledger !== undefined) {
                if (!Array.isArray(doc.xp.ledger)) err('xp.ledger', 'Must be an array');
                else doc.xp.ledger.forEach((e, i) => {
                    if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !isNonNegInt(e.cost)) err(`xp.ledger[${i}]`, '{ name: string, cost: int ≥ 0, source?, date? } required');
                });
            }
        }
    }

    // aptitudes
    if (doc.aptitudes !== undefined) {
        if (!Array.isArray(doc.aptitudes)) err('aptitudes', 'Must be an array');
        else doc.aptitudes.forEach((a, i) => { if (!isNamedEntry(a)) err(`aptitudes[${i}]`, 'Must be a string or { name, source? }'); });
    }

    // Emperor's Tarot
    if (doc.tarot !== undefined) {
        if (!doc.tarot || typeof doc.tarot !== 'object') err('tarot', 'Must be { card?, text?, effect? }');
        else for (const p of ['card', 'text', 'effect']) if (doc.tarot[p] !== undefined && typeof doc.tarot[p] !== 'string') err(`tarot.${p}`, 'String required');
    }

    const isNonNegNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

    // armour items (worn equipment deriving per-location AP)
    if (doc.armourItems !== undefined) {
        if (!Array.isArray(doc.armourItems)) err('armourItems', 'Must be an array');
        else doc.armourItems.forEach((a, i) => {
            const at = (p) => `armourItems[${i}].${p}`;
            if (!a || typeof a !== 'object') { err(`armourItems[${i}]`, 'Must be an object'); return; }
            if (typeof a.name !== 'string' || !a.name.trim()) err(at('name'), 'Required non-empty string');
            if (!isNonNegInt(a.ap)) err(at('ap'), 'Non-negative integer AP required');
            if (a.locations !== undefined) {
                if (!Array.isArray(a.locations)) err(at('locations'), 'Must be an array ("all" or location keys)');
                else a.locations.forEach((l, li) => { if (l !== 'all' && !ARMOUR_KEYS.includes(l)) warn(at(`locations[${li}]`), `Unknown location "${l}" (ignored)`); });
            }
            if (a.weight !== undefined && !isNonNegNum(a.weight)) err(at('weight'), 'Non-negative number (kg) required');
            if (a.equipped !== undefined && typeof a.equipped !== 'boolean') err(at('equipped'), 'Boolean required');
            if (a.maxAgility !== undefined && !isNonNegInt(a.maxAgility)) err(at('maxAgility'), 'Non-negative integer required');
        });
    }

    // gear
    if (doc.gear !== undefined) {
        if (!Array.isArray(doc.gear)) err('gear', 'Must be an array');
        else doc.gear.forEach((g, i) => {
            const at = (p) => `gear[${i}].${p}`;
            if (!g || typeof g !== 'object') { err(`gear[${i}]`, 'Must be an object'); return; }
            if (typeof g.name !== 'string' || !g.name.trim()) err(at('name'), 'Required non-empty string');
            if (g.weight !== undefined && !isNonNegNum(g.weight)) err(at('weight'), 'Non-negative number (kg) required');
            if (g.quantity !== undefined && (!isInt(g.quantity) || g.quantity < 1)) err(at('quantity'), 'Integer ≥ 1 required');
            if (g.equipped !== undefined && typeof g.equipped !== 'boolean') err(at('equipped'), 'Boolean required');
        });
    }

    // fatigue / psy / insanity / corruption
    if (doc.fatigue !== undefined) {
        if (!doc.fatigue || typeof doc.fatigue !== 'object') err('fatigue', 'Must be { current }');
        else if (doc.fatigue.current !== undefined && !isNonNegInt(doc.fatigue.current)) err('fatigue.current', 'Non-negative integer required');
    }
    if (doc.psy !== undefined) {
        if (!doc.psy || typeof doc.psy !== 'object') err('psy', 'Must be { rating, class, sustained }');
        else {
            if (doc.psy.rating !== undefined && !isNonNegInt(doc.psy.rating)) err('psy.rating', 'Non-negative integer required');
            if (doc.psy.class !== undefined && !PSYKER_CLASSES.includes(doc.psy.class)) err('psy.class', `One of: ${PSYKER_CLASSES.join(', ')}`);
            if (doc.psy.sustained !== undefined && !isNonNegInt(doc.psy.sustained)) err('psy.sustained', 'Non-negative integer required');
        }
    }
    if (doc.psychicPowers !== undefined) {
        if (!Array.isArray(doc.psychicPowers)) err('psychicPowers', 'Must be an array');
        else doc.psychicPowers.forEach((p, i) => {
            if (!isNamedEntry(p)) { err(`psychicPowers[${i}]`, 'Must be a string or { name, … }'); return; }
            if (p && typeof p === 'object') {
                if (p.equipped !== undefined && typeof p.equipped !== 'boolean') err(`psychicPowers[${i}].equipped`, 'Boolean required');
                if (p.cost !== undefined && !isNonNegInt(p.cost)) err(`psychicPowers[${i}].cost`, 'Non-negative integer required');
                for (const f of ['discipline', 'notes']) if (p[f] !== undefined && typeof p[f] !== 'string') err(`psychicPowers[${i}].${f}`, 'String required');
            }
        });
    }
    for (const [block, lists] of [['insanity', ['disorders']], ['corruption', ['malignancies', 'mutations']]]) {
        const b = doc[block];
        if (b === undefined) continue;
        if (!b || typeof b !== 'object') { err(block, 'Must be an object'); continue; }
        if (b.points !== undefined && (!isInt(b.points) || b.points < 0 || b.points > 100)) err(`${block}.points`, 'Integer 0–100 required');
        for (const ln of lists) {
            if (b[ln] === undefined) continue;
            if (!Array.isArray(b[ln])) { err(`${block}.${ln}`, 'Must be an array'); continue; }
            b[ln].forEach((e, i) => { if (!isNamedEntry(e)) err(`${block}.${ln}[${i}]`, 'Must be a string or { name, … }'); });
        }
    }

    // critical damage / injuries / amputations
    if (doc.wounds?.critical !== undefined && !isNonNegInt(doc.wounds.critical)) err('wounds.critical', 'Non-negative integer required');
    if (doc.criticalInjuries !== undefined) {
        if (!Array.isArray(doc.criticalInjuries)) err('criticalInjuries', 'Must be an array');
        else doc.criticalInjuries.forEach((c, i) => {
            const ok = typeof c === 'string' || (c && typeof c === 'object' && typeof c.effect === 'string');
            if (!ok) err(`criticalInjuries[${i}]`, 'Must be a string or { location?, effect, source? }');
            else if (c && typeof c === 'object' && c.location !== undefined && !ARMOUR_KEYS.includes(c.location)) warn(`criticalInjuries[${i}].location`, `Unknown location "${c.location}"`);
        });
    }
    if (doc.amputations !== undefined) {
        if (!Array.isArray(doc.amputations)) err('amputations', 'Must be an array');
        else doc.amputations.forEach((a, i) => { if (!AMPUTATION_KEYS.includes(a)) warn(`amputations[${i}]`, `Unknown part "${a}" (known: ${AMPUTATION_KEYS.join(', ')})`); });
    }

    // size / movement modifier / item description+dsl
    if (doc.size !== undefined && (!isInt(doc.size) || doc.size < 1 || doc.size > 10)) err('size', 'Integer 1–10 required (4 = Average)');
    if (doc.movementModifier !== undefined && (!isInt(doc.movementModifier) || doc.movementModifier < -10 || doc.movementModifier > 10)) err('movementModifier', 'Integer −10–10 required');
    for (const listName of ['weapons', 'armourItems', 'gear']) {
        (Array.isArray(doc[listName]) ? doc[listName] : []).forEach((item, i) => {
            if (item && typeof item === 'object') {
                if (item.description !== undefined && typeof item.description !== 'string') err(`${listName}[${i}].description`, 'String required');
                if (item.dsl !== undefined && typeof item.dsl !== 'string') err(`${listName}[${i}].dsl`, 'String (DSL source) required');
            }
        });
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
            if (w.weight !== undefined && !(typeof w.weight === 'number' && Number.isFinite(w.weight) && w.weight >= 0)) err(at('weight'), 'Non-negative number (kg) required');
            if (w.equipped !== undefined && typeof w.equipped !== 'boolean') err(at('equipped'), 'Boolean required');
            if (w.clip !== undefined) {
                if (!w.clip || typeof w.clip !== 'object') err(at('clip'), 'Must be { max, value }');
                else for (const p of ['max', 'value']) if (w.clip[p] !== undefined && !isNonNegInt(w.clip[p])) err(at(`clip.${p}`), 'Non-negative integer required');
            }
        });
    }
    // field
    if (doc.field !== undefined) {
        if (typeof doc.field !== 'object') err('field', 'Must be { rating, overloadMax }');
        else for (const p of ['rating', 'overloadMax']) if (doc.field[p] !== undefined && !isNonNegInt(doc.field[p])) err(`field.${p}`, 'Non-negative integer required');
    }

    return { ok: errors.length === 0, errors, warnings };
}

/** Migrate any older document to the current version (switch fallthrough per
 *  version, exactly like Foundry world migrations). */
export function migrateCharacter(doc) {
    const d = { ...doc };
    switch (d.schemaVersion) {
        case undefined:
        case 0:
            d.schemaVersion = 1;
            d.kind = d.kind ?? 'dh2.character';
            // fallthrough:
        case 1: {
            // v1 → v2: flat characteristic ints become { base, advances, modifiers }
            // (total-preserving: base = old total), and the v2 blocks default empty.
            if (d.characteristics && typeof d.characteristics === 'object') {
                d.characteristics = Object.fromEntries(Object.entries(d.characteristics).map(([k, v]) =>
                    [k, isFinite(v) && typeof v === 'number' ? { base: v, advances: 0, modifiers: [] } : v]));
            }
            d.skills ??= {};
            d.xp ??= { total: 0, ledger: [] };
            d.aptitudes ??= [];
            d.tarot ??= {};
            d.schemaVersion = 2;
            // fallthrough:
        }
        case 2:
            // v2 → v3: equipment (armour items / gear / weights + equip toggle)
            // and the remaining DH2 state blocks default empty. Existing weapons
            // are the character's kit — they stay equipped.
            d.armourItems ??= [];
            d.gear ??= [];
            d.fatigue ??= { current: 0 };
            d.psy ??= { rating: 0, class: 'none', sustained: 0 };
            d.psychicPowers ??= [];
            d.insanity ??= { points: 0, disorders: [] };
            d.corruption ??= { points: 0, malignancies: [], mutations: [] };
            d.criticalInjuries ??= [];
            d.amputations ??= [];
            if (d.wounds && typeof d.wounds === 'object') d.wounds = { critical: 0, ...d.wounds };
            d.schemaVersion = 3;
            // fallthrough:
        case 3:
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
    const w = (doc.weapons ?? [])[weaponIndex];
    // derived totals (v2 objects OR v1 flat ints — characteristicTotal handles both)
    const ct = (k) => characteristicTotal(doc, k);
    return {
        name: doc.name,
        characteristics: { ws: ct('ws'), bs: ct('bs'), s: ct('s'), t: ct('t'), ag: ct('ag'), wp: ct('wp') },
        unnatural: { ...(doc.unnatural ?? {}) },
        weapon: w ? {
            name: w.name,
            isMelee: w.class === 'melee',
            thrown: w.class === 'thrown' || undefined,
            damage: w.damage,
            pen: w.pen ?? 0,
            damageType: w.damageType ?? 'Impact',
            rof: { single: w.rof?.single !== false, burst: Number(w.rof?.burst) || 0, full: Number(w.rof?.full) || 0 },
            qualities: canonList(w.qualities),
            craftsmanship: w.craftsmanship ?? 'Common',
            sbMultiplier: w.sbMultiplier ?? (w.class === 'melee' || w.class === 'thrown' ? 1 : 0),
        } : undefined,
        talents: canonList(doc.talents),
        traits: canonList(doc.traits),
        conditions: doc.conditions ?? [],
        circumstances: doc.circumstances ?? [],
        // psyker (Force weapons read this; the power.* pipeline will too)
        psyRating: doc.psy?.rating ?? 0,
        // defender-side extras (harmless on the attacker side):
        armour: armourByLocation(doc)[location] ?? 0,
        toughnessBonus: Math.floor(ct('t') / 10),
        unnaturalToughness: doc.unnatural?.t ?? 0,
        field: doc.field ?? { rating: 0, overloadMax: 0 },
    };
}
