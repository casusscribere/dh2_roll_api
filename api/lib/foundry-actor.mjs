/**
 * Character document → Foundry Actor mapping (Foundry importer v3 —
 * CHARACTER_MODEL.md §5, TBD.md §0 step 2).
 *
 * PURE data mapper: schema-v3 document in, `{ name, type, system, flags,
 * items }` out, shaped for the `dark-heresy-3rd-edition` system's acolyte
 * Actor (its template.json shapes are mirrored here so node tests can validate
 * the mapping without a running Foundry). The module's
 * `game.dh2vm.importCharacter` feeds this straight into `Actor.create` +
 * `createEmbeddedDocuments('Item', …)`.
 *
 * Mapping decisions (deliberate, documented):
 * - characteristics: base/advances map 1:1; the MODIFIERS-BY-SOURCE sum lands
 *   in the DH3 `.modifier` field and the per-source breakdown is preserved in
 *   `flags["dh2-roll-vm"].modifierSources` (DH3 has one flat modifier — the
 *   attribution would otherwise be lost).
 * - skills: DH3 camelCase keys, specialist specialities keyed the same way
 *   ({ label, advance, cost, taken }); skill modifiers have no DH3 field →
 *   flags breakdown only.
 * - list-shaped content becomes embedded ITEMS (weapons with clip/equipped/
 *   weight, gear, aptitudes, talents, traits, psychic powers with the
 *   equipped-loadout flag, disorders/malignancies/mutations, critical
 *   injuries, the force field). Weapon qualities ride in the item description
 *   + flags (DH3 nests them as attackSpecial container items — pack-linking
 *   them is Phase 8 work).
 * - tarot → bio.divination; amputations + the XP ledger → module flags.
 * - v4: origin → bio.homeWorld/background/role/elite (+ verbatim copy in
 *   flags for lossless round-trip); influence → characteristics.influence;
 *   weaponTrainings → `Weapon Training (X)` talent Items; cybernetics →
 *   cybernetic Items; extensions → flags; entry-level ref/dsl (builder
 *   addendum) ride each Item's flags; typed ledger fields ride flags.xpLedger
 *   verbatim.
 */
import {
    SKILL_DEFS, canonicalSkillName, modifierTotal, fatigueThreshold,
} from './character-schema.mjs';
import { entryName } from './rules/_util.mjs';

/** doc characteristic key → DH3 characteristic key (7.1.1: exported so the
 *  reverse adapter inverts THIS table, never a second hand-written one). */
export const CHAR_KEY_MAP = {
    ws: 'weaponSkill', bs: 'ballisticSkill', s: 'strength', t: 'toughness',
    ag: 'agility', int: 'intelligence', per: 'perception', wp: 'willpower', fel: 'fellowship',
};

/** "Sleight of Hand" → sleightOfHand, "Tech-Use" → techUse (DH3 key style). */
export const camelKey = (name) => String(name ?? '')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');

/** Canonical skill name → DH3 camelCase key, derived from SKILL_DEFS (7.1.1). */
export const SKILL_KEY_MAP = Object.fromEntries(
    Object.keys(SKILL_DEFS).map((name) => [name, camelKey(name)]));

/** Embedded-item type → the doc list it came from (7.1.1; dotted paths are
 *  nested). weaponTrainings is deliberately absent: its talent stubs fold into
 *  `talents` on the way out (dedupe, D-9) and back (see foundryActorToCharacter). */
export const ITEM_TYPE_TO_LIST = {
    weapon: 'weapons', armour: 'armourItems', gear: 'gear', aptitude: 'aptitudes',
    talent: 'talents', trait: 'traits', psychicPower: 'psychicPowers',
    cybernetic: 'cybernetics', mentalDisorder: 'insanity.disorders',
    malignancy: 'corruption.malignancies', mutation: 'corruption.mutations',
    criticalInjury: 'criticalInjuries', forceField: 'field',
};

const asEntry = (x) => (x && typeof x === 'object') ? x : { name: String(x ?? '') };

/** Item flags for an entry carrying ref/dsl (builder addendum) — {} when bare. */
const entryFlags = (e) => (e.ref !== undefined || e.dsl !== undefined)
    ? { flags: { 'dh2-roll-vm': { ...(e.ref !== undefined && { ref: e.ref }), ...(e.dsl !== undefined && { dsl: e.dsl }) } } }
    : {};

/**
 * Item types that are SET-VALUED: you either have the talent or you do not, and
 * DH3 carries no quantity on them, so two Items with the same name are one
 * thing recorded twice. Weapons/armour/gear are deliberately NOT here — a
 * character really can carry two lasguns, or a pict recorder equipped and a
 * second one stowed, and collapsing those would delete inventory.
 */
const SET_VALUED_ITEM_TYPES = new Set(['talent']);

/**
 * De-dupe identity: item type + case/whitespace-insensitive name. Parentheticals
 * are KEPT — `Weapon Training (Las)` and `Weapon Training (Bolt)` are different
 * talents — so this is deliberately NOT the roster's `normalizeName`.
 */
const itemKey = (i) => JSON.stringify([i.type, String(i.name).toLowerCase().replace(/\s+/g, ' ').trim()]);

/**
 * Collapse duplicate set-valued Items (finding D-9, 2026-07-30). A character
 * carrying both a `talents` entry `Weapon Training (Las)` and
 * `weaponTrainings: ['Las']` produced the same talent Item twice, at two
 * different tiers — real for several campaign PCs.
 *
 * The FIRST occurrence wins its place and identity: emission order puts
 * `talents` (character-authored — tier, notes, source, ref/dsl flags) ahead of
 * the synthesized `weaponTrainings` stubs. A later duplicate only FILLS fields
 * the winner left unset, so no value either entry actually carried is lost —
 * the stub's known tier 1 lands on a talent entry whose sheet recorded no tier,
 * but never overwrites a real one. A talent's `system` fields are a number
 * (`tier`, 0 = unrecorded) or a string (`benefit`/`description`, '' = absent),
 * so "unset" is exactly "falsy" here.
 */
function dedupeItems(items) {
    const out = [];
    const byKey = new Map();
    for (const item of items) {
        if (!SET_VALUED_ITEM_TYPES.has(item.type)) { out.push(item); continue; }
        const kept = byKey.get(itemKey(item));
        if (!kept) { byKey.set(itemKey(item), item); out.push(item); continue; }
        for (const [k, v] of Object.entries(item.system)) {
            if (!kept.system[k] && v) kept.system[k] = v;
        }
        const lost = item.flags?.['dh2-roll-vm'];      // ref/dsl provenance, if any
        if (lost) {
            if (!kept.flags) kept.flags = { 'dh2-roll-vm': {} };
            const ns = kept.flags['dh2-roll-vm'];
            for (const [k, v] of Object.entries(lost)) if (ns[k] === undefined) ns[k] = v;
        }
    }
    return out;
}

/**
 * Map a MIGRATED character document to Foundry Actor data.
 * Returns { name, type, system, flags, items } — items are plain
 * `{ name, type, system, flags? }` objects ready for createEmbeddedDocuments.
 */
export function characterToFoundryActor(doc) {
    // --- characteristics: base + advance count + summed modifiers ------------
    const characteristics = {};
    const modifierSources = { characteristics: {}, skills: {} };
    for (const [k, foundryKey] of Object.entries(CHAR_KEY_MAP)) {
        const c = doc.characteristics?.[k];
        const obj = (c && typeof c === 'object') ? c : { base: Number(c) || 0, advances: 0, modifiers: [] };
        characteristics[foundryKey] = {
            base: obj.base ?? 0,
            advance: obj.advances ?? 0,
            modifier: modifierTotal(obj.modifiers),
            unnatural: doc.unnatural?.[k] ?? 0,
        };
        if ((obj.modifiers ?? []).length) modifierSources.characteristics[k] = obj.modifiers;
    }

    // --- skills: DH3 camel keys, specialities preserved -----------------------
    const skills = {};
    const skillCharacteristics = {};                    // R-8 overrides — no DH3 field, flags-carried
    for (const [rawName, s] of Object.entries(doc.skills ?? {})) {
        const canonical = canonicalSkillName(rawName);
        if (!canonical) continue;                       // unknown skills stay doc-only
        if (s.characteristic) skillCharacteristics[canonical] = s.characteristic;
        const key = SKILL_KEY_MAP[canonical];
        const def = SKILL_DEFS[canonical];
        const entry = { advance: s.advances ?? 0, isSpecialist: !!def.specialist };
        if (def.specialist && s.specialities) {
            entry.specialities = {};
            for (const [spec, sv] of Object.entries(s.specialities)) {
                entry.specialities[camelKey(spec)] = {
                    label: spec, advance: sv.advances ?? 0, cost: 0, taken: (sv.advances ?? 0) > 0,
                };
                // speciality-level modifiers have no DH3 field either (7.1.3)
                if ((sv.modifiers ?? []).length) {
                    ((modifierSources.specialities ??= {})[canonical] ??= {})[spec] = sv.modifiers;
                }
            }
        }
        skills[key] = entry;
        if ((s.modifiers ?? []).length) modifierSources.skills[canonical] = s.modifiers;
    }

    // --- xp / bio / pools ------------------------------------------------------
    const spent = doc.xp?.spent ?? (doc.xp?.ledger ?? []).reduce((a, e) => a + (e.cost || 0), 0);
    const tarotBits = [doc.tarot?.card, doc.tarot?.text, doc.tarot?.effect].filter(Boolean);

    // v4 origin → DH3 bio strings (verbatim object preserved in flags)
    const originName = (m) => (m == null ? '' : (typeof m === 'string' ? m : m.name ?? ''));
    characteristics.influence = { base: doc.influence ?? 0, advance: 0, modifier: 0, unnatural: 0 };

    const system = {
        characteristics,
        skills,
        wounds: {
            max: doc.wounds?.max ?? 10,
            value: doc.wounds?.current ?? doc.wounds?.max ?? 10,
            critical: doc.wounds?.critical ?? 0,
        },
        fate: { max: doc.fate?.max ?? 0, value: doc.fate?.current ?? doc.fate?.max ?? 0 },
        fatigue: { value: doc.fatigue?.current ?? 0, max: fatigueThreshold(doc) },
        psy: {
            rating: doc.psy?.rating ?? 0,
            sustained: doc.psy?.sustained ?? 0,
            class: (doc.psy?.class && doc.psy.class !== 'none') ? doc.psy.class : 'bound',
            hasFocus: false,
        },
        insanity: doc.insanity?.points ?? 0,
        corruption: doc.corruption?.points ?? 0,
        experience: { total: doc.xp?.total ?? 0, used: spent },
        bio: {
            divination: tarotBits.join(' — '),
            homeWorld: originName(doc.origin?.homeworld),
            background: originName(doc.origin?.background),
            role: originName(doc.origin?.role),
            elite: (doc.origin?.eliteAdvances ?? []).map((e) => originName(e)).filter(Boolean).join(', '),
        },
    };

    // --- embedded items ---------------------------------------------------------
    const items = [];
    for (const w of doc.weapons ?? []) {
        items.push({
            name: w.name, type: 'weapon',
            system: {
                class: w.class ?? 'basic', damage: w.damage,
                penetration: w.pen ?? 0, damageType: w.damageType ?? 'Impact',
                craftsmanship: (w.craftsmanship ?? 'Common').toLowerCase(),
                equipped: w.equipped !== false,
                weight: w.weight ?? 0,
                clip: { max: w.clip?.max ?? 0, value: w.clip?.value ?? w.clip?.max ?? 0 },
                rateOfFire: { single: w.rof?.single === false ? 0 : 1, burst: w.rof?.burst ?? 0, full: w.rof?.full ?? 0 },
                description: (w.qualities ?? []).length ? `Qualities: ${w.qualities.map(entryName).join(', ')}` : '',
            },
            flags: { 'dh2-roll-vm': {
                qualities: (w.qualities ?? []).map(entryName),
                ...(w.sbMultiplier != null && { sbMultiplier: w.sbMultiplier }),   // engine-only field (7.1.3)
            } },
        });
    }
    for (const a of doc.armourItems ?? []) {
        items.push({
            name: a.name, type: 'armour',
            system: {
                equipped: a.equipped !== false, weight: a.weight ?? 0,
                maxAgility: a.maxAgility ?? 0,
                description: `AP ${a.ap} (${(a.locations ?? ['all']).join(', ')})`,
            },
            flags: { 'dh2-roll-vm': { ap: a.ap, locations: a.locations ?? ['all'] } },
        });
    }
    for (const g of doc.gear ?? []) {
        items.push({
            name: g.name, type: 'gear',
            system: {
                equipped: g.equipped !== false, weight: g.weight ?? 0,
                description: g.notes ?? '',
            },
            flags: { 'dh2-roll-vm': { quantity: g.quantity ?? 1 } },
        });
    }
    for (const a of doc.aptitudes ?? []) {
        const e = asEntry(a);
        items.push({ name: e.name, type: 'aptitude', system: { description: e.source ? `Source: ${e.source}` : '' } });
    }
    for (const t of doc.talents ?? []) {
        const e = asEntry(t);
        items.push({ name: e.name, type: 'talent', system: { tier: e.tier ?? 0, benefit: e.notes ?? '', description: e.source ? `Source: ${e.source}` : '' }, ...entryFlags(e) });
    }
    for (const w of doc.weaponTrainings ?? []) {
        items.push({ name: `Weapon Training (${w})`, type: 'talent', system: { tier: 1, benefit: '', description: '' } });
    }
    for (const t of doc.traits ?? []) {
        const e = asEntry(t);
        items.push({ name: e.name, type: 'trait', system: e.level != null ? { level: e.level } : {}, ...entryFlags(e) });
    }
    for (const c of doc.cybernetics ?? []) {
        const e = asEntry(c);
        items.push({
            name: e.name, type: 'cybernetic',
            system: { description: [e.location && `Location: ${e.location}`, e.notes].filter(Boolean).join(' — ') },
            ...entryFlags(e),
        });
    }
    for (const p of doc.psychicPowers ?? []) {
        const e = asEntry(p);
        const extra = entryFlags(e).flags?.['dh2-roll-vm'] ?? {};
        items.push({
            name: e.name, type: 'psychicPower',
            system: { discipline: e.discipline ?? '', cost: e.cost ?? 0, sustained: 'No', description: e.notes ?? '' },
            flags: { 'dh2-roll-vm': { equipped: e.equipped !== false, ...extra } },   // loadout state (no DH3 field)
        });
    }
    for (const d of doc.insanity?.disorders ?? []) {
        items.push({ name: entryName(d), type: 'mentalDisorder', system: {} });
    }
    for (const m of doc.corruption?.malignancies ?? []) {
        items.push({ name: entryName(m), type: 'malignancy', system: {} });
    }
    for (const m of doc.corruption?.mutations ?? []) {
        items.push({ name: entryName(m), type: 'mutation', system: {} });
    }
    for (const c of doc.criticalInjuries ?? []) {
        const e = (c && typeof c === 'object') ? c : { effect: String(c) };
        items.push({
            name: e.effect.slice(0, 60), type: 'criticalInjury',
            system: { part: e.location ?? 'body', type: 'impact', description: e.effect + (e.source ? ` (${e.source})` : '') },
        });
    }
    if ((doc.field?.rating ?? 0) > 0) {
        items.push({ name: 'Force Field', type: 'forceField', system: { protectionRating: doc.field.rating, activated: true, overloaded: false } });
    }

    const flags = {
        'dh2-roll-vm': {
            schemaVersion: doc.schemaVersion,
            modifierSources,
            amputations: doc.amputations ?? [],
            xpLedger: doc.xp?.ledger ?? [],          // typed fields (kind/ref/rank/matches) ride verbatim
            source: doc.source ?? null,
            origin: doc.origin ?? null,              // verbatim (refs incl.) for lossless round-trip
            extensions: doc.extensions ?? {},
            // Two more no-DH3-field carries (added with 7.1.3 so the reverse
            // adapter is lossless; both follow the modifierSources pattern):
            // the R-8 skill-characteristic overrides and the flat manual-AP
            // armour block (4 of 10 campaign PCs carry one).
            ...(Object.keys(skillCharacteristics).length && { skillCharacteristics }),
            ...(Object.values(doc.armour ?? {}).some((v) => v) && { armour: doc.armour }),
        },
    };

    return { name: doc.name, type: 'acolyte', system, flags, items: dedupeItems(items) };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7.1.3 — the reverse adapter: Foundry Actor data → character document.
 * Inverts the exported tables above programmatically; the round-trip contract
 * (foundry-actor-roundtrip.test.mjs) is
 *   normalize(reverse(forward(doc))) ≡ normalize(doc)
 * over the whole campaign roster.
 * ═══════════════════════════════════════════════════════════════════════════ */

const INV_CHAR_KEY = Object.fromEntries(Object.entries(CHAR_KEY_MAP).map(([d, f]) => [f, d]));
const INV_SKILL_KEY = Object.fromEntries(Object.entries(SKILL_KEY_MAP).map(([d, f]) => [f, d]));
const UNNATURAL_DOC_KEYS = ['ws', 'bs', 's', 't', 'ag'];
const tierCase = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
const itemNs = (item) => item.flags?.['dh2-roll-vm'] ?? {};
const refDslOf = (item) => {
    const ns = itemNs(item);
    return { ...(ns.ref !== undefined && { ref: ns.ref }), ...(ns.dsl !== undefined && { dsl: ns.dsl }) };
};

/** A talent Item indistinguishable from a synthesized weaponTrainings stub. */
const isTrainingStub = (item) =>
    /^Weapon Training \(.+\)$/.test(item.name)
    && (item.system?.tier ?? 0) === 1 && !item.system?.benefit && !item.system?.description
    && Object.keys(itemNs(item)).length === 0;

/**
 * Map Foundry Actor data ({ name, type, system, flags, items }) back to a
 * schema-v4 character document. Field-for-field inverse of
 * characterToFoundryActor, with the documented one-way joins recovered in
 * their display form (tarot ← bio.divination; criticalInjury source stays
 * inside the effect text) — normalizeForRoundTrip compares in that form.
 */
export function foundryActorToCharacter(actor) {
    const sys = actor.system ?? {};
    const ns = actor.flags?.['dh2-roll-vm'] ?? {};
    const modSrc = ns.modifierSources ?? { characteristics: {}, skills: {} };

    // --- characteristics + unnatural (inverted table) -------------------------
    const characteristics = {};
    const unnatural = {};
    for (const [docKey, foundryKey] of Object.entries(CHAR_KEY_MAP)) {
        const c = sys.characteristics?.[foundryKey] ?? {};
        characteristics[docKey] = {
            base: c.base ?? 0,
            advances: c.advance ?? 0,
            modifiers: modSrc.characteristics?.[docKey]
                ?? (c.modifier ? [{ value: c.modifier, source: 'foundry' }] : []),
        };
        if (UNNATURAL_DOC_KEYS.includes(docKey)) unnatural[docKey] = c.unnatural ?? 0;
    }

    // --- skills (inverted key map; overrides + modifiers from flags) ----------
    const skills = {};
    for (const [foundryKey, entry] of Object.entries(sys.skills ?? {})) {
        const canonical = INV_SKILL_KEY[foundryKey];
        if (!canonical) continue;
        const s = { advances: entry.advance ?? 0, modifiers: modSrc.skills?.[canonical] ?? [] };
        if (ns.skillCharacteristics?.[canonical]) s.characteristic = ns.skillCharacteristics[canonical];
        if (entry.specialities) {
            s.specialities = {};
            for (const sv of Object.values(entry.specialities)) {
                s.specialities[sv.label] = {
                    advances: sv.advance ?? 0,
                    modifiers: modSrc.specialities?.[canonical]?.[sv.label] ?? [],
                };
            }
        }
        skills[canonical] = s;
    }

    // --- embedded items → the doc lists (ITEM_TYPE_TO_LIST semantics) ---------
    const weapons = [], armourItems = [], gear = [], aptitudes = [], talents = [];
    const weaponTrainings = [], traits = [], psychicPowers = [], cybernetics = [];
    const disorders = [], malignancies = [], mutations = [], criticalInjuries = [];
    let field = { rating: 0, overloadMax: 0 };
    for (const item of actor.items ?? []) {
        const s = item.system ?? {};
        const flagsNs = itemNs(item);
        switch (item.type) {
            case 'weapon':
                weapons.push({
                    name: item.name, class: s.class, damage: s.damage, pen: s.penetration ?? 0,
                    damageType: s.damageType, craftsmanship: tierCase(s.craftsmanship ?? 'common'),
                    equipped: s.equipped !== false, weight: s.weight ?? 0,
                    clip: { max: s.clip?.max ?? 0, value: s.clip?.value ?? 0 },
                    rof: { single: (s.rateOfFire?.single ?? 1) !== 0, burst: s.rateOfFire?.burst ?? 0, full: s.rateOfFire?.full ?? 0 },
                    qualities: flagsNs.qualities ?? [],
                    ...(flagsNs.sbMultiplier != null && { sbMultiplier: flagsNs.sbMultiplier }),
                });
                break;
            case 'armour':
                armourItems.push({
                    name: item.name, ap: flagsNs.ap ?? 0, locations: flagsNs.locations ?? ['all'],
                    weight: s.weight ?? 0, equipped: s.equipped !== false,
                    maxAgility: s.maxAgility || null,
                });
                break;
            case 'gear':
                gear.push({
                    name: item.name, weight: s.weight ?? 0, equipped: s.equipped !== false,
                    quantity: flagsNs.quantity ?? 1,
                    ...(s.description && { notes: s.description }),
                });
                break;
            case 'aptitude': {
                const m = /^Source: (.*)$/.exec(s.description ?? '');
                aptitudes.push(m ? { name: item.name, source: m[1] } : { name: item.name });
                break;
            }
            case 'talent': {
                if (isTrainingStub(item)) { weaponTrainings.push(item.name.slice('Weapon Training ('.length, -1)); break; }
                const src = /^Source: (.*)$/.exec(s.description ?? '');
                talents.push({
                    name: item.name,
                    ...(s.tier && { tier: s.tier }), ...(s.benefit && { notes: s.benefit }),
                    ...(src && { source: src[1] }), ...refDslOf(item),
                });
                break;
            }
            case 'trait':
                traits.push({ name: item.name, ...(s.level != null && { level: s.level }), ...refDslOf(item) });
                break;
            case 'psychicPower':
                psychicPowers.push({
                    name: item.name,
                    ...(s.discipline && { discipline: s.discipline }), ...(s.cost && { cost: s.cost }),
                    ...(s.description && { notes: s.description }),
                    ...(flagsNs.equipped === false && { equipped: false }), ...refDslOf(item),
                });
                break;
            case 'cybernetic': {
                const m = /^Location: (.*?)(?: — ([^]*))?$/.exec(s.description ?? '');
                cybernetics.push({
                    name: item.name,
                    ...(m && { location: m[1] }),
                    ...(m ? (m[2] && { notes: m[2] }) : (s.description && { notes: s.description })),
                    ...refDslOf(item),
                });
                break;
            }
            case 'mentalDisorder': disorders.push(item.name); break;
            case 'malignancy': malignancies.push(item.name); break;
            case 'mutation': mutations.push(item.name); break;
            case 'criticalInjury':
                criticalInjuries.push({
                    ...(s.part && s.part !== 'body' && { location: s.part }),
                    effect: s.description ?? item.name,
                });
                break;
            case 'forceField':
                field = { rating: s.protectionRating ?? 0, overloadMax: 0 };
                break;
            /* unknown types are module content, not doc content — dropped */
        }
    }

    const emptyArmour = { head: 0, body: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 };
    return {
        schemaVersion: ns.schemaVersion ?? 4,
        kind: 'dh2.character',
        name: actor.name,
        system: 'dh2',
        characteristics, unnatural, skills,
        armour: ns.armour ?? emptyArmour,
        wounds: { max: sys.wounds?.max ?? 10, current: sys.wounds?.value ?? sys.wounds?.max ?? 10, critical: sys.wounds?.critical ?? 0 },
        fate: { max: sys.fate?.max ?? 0, current: sys.fate?.value ?? sys.fate?.max ?? 0 },
        fatigue: { current: sys.fatigue?.value ?? 0 },
        psy: {
            rating: sys.psy?.rating ?? 0,
            class: (sys.psy?.rating ?? 0) > 0 ? (sys.psy?.class ?? 'bound') : 'none',
            sustained: sys.psy?.sustained ?? 0,
        },
        insanity: { points: sys.insanity ?? 0, disorders },
        corruption: { points: sys.corruption ?? 0, malignancies, mutations },
        influence: sys.characteristics?.influence?.base ?? 0,
        xp: { total: sys.experience?.total ?? 0, spent: sys.experience?.used ?? 0, ledger: ns.xpLedger ?? [] },
        tarot: sys.bio?.divination ? { text: sys.bio.divination } : {},
        origin: ns.origin ?? { homeworld: null, background: null, role: null, eliteAdvances: [] },
        extensions: ns.extensions ?? {},
        amputations: ns.amputations ?? [],
        ...(ns.source != null && { source: ns.source }),
        weapons, armourItems, gear, aptitudes, talents, weaponTrainings, traits,
        psychicPowers, cybernetics, criticalInjuries, field,
        conditions: [], circumstances: [],
    };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * normalizeForRoundTrip — canonical comparison form for the contract above.
 * Exported: CB-4 reuses it to assert wizard output survives the Foundry trip.
 * ═══════════════════════════════════════════════════════════════════════════ */

const asName = (x) => ((x && typeof x === 'object') ? { ...x } : { name: String(x ?? '') });

/** Drop empty leaves (undefined/null/''/0/[]/{}). `false` is KEPT — an
 *  equipped:false is exactly the value the R-4 work exists to preserve. */
function clean(v) {
    if (Array.isArray(v)) {
        const out = v.map(clean).filter((x) => x !== undefined);
        return out.length ? out : undefined;
    }
    if (v && typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) {
            const c = clean(x);
            if (c !== undefined) out[k] = c;
        }
        return Object.keys(out).length ? out : undefined;
    }
    if (v === undefined || v === null || v === '' || v === 0) return undefined;
    return v;
}

/**
 * Canonicalize a character document for round-trip comparison:
 * - string entries ≡ { name } objects across every entry list;
 * - weaponTrainings fold into `Weapon Training (X)` talent entries (deduped,
 *   talents first — the forward map's own D-9 collapse);
 * - tarot collapses to its joined display string (bio.divination is a join);
 * - criticalInjuries collapse to display form (source inside the effect);
 * - craftsmanship case-folds; rof.single becomes boolean; clip.value defaults
 *   to max; wounds/fate current default to max; xp.spent becomes effective;
 * - psychicPowers drop equipped:true (the default);
 * - `system` drops when it is the default 'dh2';
 * - then every empty-default leaf is dropped (see clean()).
 */
export function normalizeForRoundTrip(doc) {
    const d = structuredClone(doc);

    const tarotBits = [d.tarot?.card, d.tarot?.text, d.tarot?.effect].filter(Boolean);
    d.tarot = tarotBits.length ? tarotBits.join(' — ') : undefined;

    const talents = (d.talents ?? []).map(asName);
    const seen = new Set(talents.map((t) => t.name.toLowerCase().replace(/\s+/g, ' ').trim()));
    for (const w of d.weaponTrainings ?? []) {
        const name = `Weapon Training (${w})`;
        if (!seen.has(name.toLowerCase())) { talents.push({ name }); seen.add(name.toLowerCase()); }
    }
    d.talents = talents.map((t) => { delete t.tier; return t; });   // stub tier-1 vs unrecorded 0 is dedupe noise
    delete d.weaponTrainings;

    for (const list of ['traits', 'aptitudes', 'cybernetics', 'psychicPowers']) {
        d[list] = (d[list] ?? []).map(asName);
    }
    d.psychicPowers = d.psychicPowers.map((p) => {
        if (p.equipped !== false) delete p.equipped;
        return p;
    });
    if (d.insanity) d.insanity.disorders = (d.insanity.disorders ?? []).map((x) => asName(x).name);
    if (d.corruption) {
        d.corruption.malignancies = (d.corruption.malignancies ?? []).map((x) => asName(x).name);
        d.corruption.mutations = (d.corruption.mutations ?? []).map((x) => asName(x).name);
    }

    for (const list of ['weapons', 'armourItems', 'gear']) {
        d[list] = (d[list] ?? []).map((it) => {
            const e = { ...it };
            if (e.equipped !== false) delete e.equipped;       // absent means carried
            if (list === 'gear' && (e.quantity ?? 1) === 1) delete e.quantity;
            return e;
        });
    }
    d.weapons = (d.weapons ?? []).map((w) => ({
        ...w,
        craftsmanship: (w.craftsmanship ?? 'common').toLowerCase(),
        qualities: (w.qualities ?? []).map((q) => asName(q).name),
        rof: w.rof && { ...w.rof, single: w.rof.single !== false && w.rof.single !== 0 },
        clip: w.clip && { max: w.clip.max ?? 0, value: w.clip.value ?? w.clip.max ?? 0 },
    }));
    d.criticalInjuries = (d.criticalInjuries ?? []).map((c) => {
        const e = (c && typeof c === 'object') ? c : { effect: String(c) };
        return {
            ...(e.location && e.location !== 'body' && { location: e.location }),
            effect: (e.effect ?? '') + (e.source ? ` (${e.source})` : ''),
        };
    });

    if (d.wounds) d.wounds = { ...d.wounds, current: d.wounds.current ?? d.wounds.max };
    if (d.fate) d.fate = { ...d.fate, current: d.fate.current ?? d.fate.max };
    if (d.xp) {
        d.xp = {
            ...d.xp,
            spent: d.xp.spent ?? (d.xp.ledger ?? []).reduce((a, e) => a + (e.cost || 0), 0),
        };
    }
    if (d.system === 'dh2') delete d.system;

    return clean(d) ?? {};
}
