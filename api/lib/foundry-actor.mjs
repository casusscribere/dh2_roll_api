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

const CHAR_KEY_MAP = {
    ws: 'weaponSkill', bs: 'ballisticSkill', s: 'strength', t: 'toughness',
    ag: 'agility', int: 'intelligence', per: 'perception', wp: 'willpower', fel: 'fellowship',
};

/** "Sleight of Hand" → sleightOfHand, "Tech-Use" → techUse (DH3 key style). */
export const camelKey = (name) => String(name ?? '')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');

const asEntry = (x) => (x && typeof x === 'object') ? x : { name: String(x ?? '') };

/** Item flags for an entry carrying ref/dsl (builder addendum) — {} when bare. */
const entryFlags = (e) => (e.ref !== undefined || e.dsl !== undefined)
    ? { flags: { 'dh2-roll-vm': { ...(e.ref !== undefined && { ref: e.ref }), ...(e.dsl !== undefined && { dsl: e.dsl }) } } }
    : {};

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
    for (const [rawName, s] of Object.entries(doc.skills ?? {})) {
        const canonical = canonicalSkillName(rawName);
        if (!canonical) continue;                       // unknown skills stay doc-only
        const key = camelKey(canonical);
        const def = SKILL_DEFS[canonical];
        const entry = { advance: s.advances ?? 0, isSpecialist: !!def.specialist };
        if (def.specialist && s.specialities) {
            entry.specialities = {};
            for (const [spec, sv] of Object.entries(s.specialities)) {
                entry.specialities[camelKey(spec)] = {
                    label: spec, advance: sv.advances ?? 0, cost: 0, taken: (sv.advances ?? 0) > 0,
                };
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
            flags: { 'dh2-roll-vm': { qualities: (w.qualities ?? []).map(entryName) } },
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
        },
    };

    return { name: doc.name, type: 'acolyte', system, flags, items };
}
