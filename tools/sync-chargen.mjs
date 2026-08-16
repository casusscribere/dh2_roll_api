/**
 * Corpus → chargen data pack (Task CB-1, docs/CHARACTER_BUILDER_PLAN_2026-07-24.md
 * Part 3.2 in the monorepo).
 *
 * Reads the DH2 corpus (codified-systems/dark_heresy_2e), applies the errata
 * overlay by id, and emits api/data/chargen/pack.mjs — the GENERATED,
 * COMMITTED module the Builder UI and the advancement engine consume (Pages
 * CI checks out only this repo, so runtime corpus reads are impossible; the
 * roster.mjs precedent).
 *
 * PROSE-STRIPPED per decision D-H (this repo is PUBLIC with Pages): the
 * projections below are explicit field ALLOWLISTS — ids, names, tiers,
 * aptitudes, prerequisite strings, numeric tables, and `_source`/`_book_page`
 * page tags only. Rulebook prose (benefit/description/concept/skill_use/
 * verbatim quotes/…) is NEVER emitted; a denylist test
 * (api/test/chargen-pack.test.mjs) walks the emitted pack and fails on any
 * prose key. Players consult the books for text.
 *
 * This transform implements the same corpus-consumer contract (errata-by-id
 * deep merge, `dh2:<type>:<snake_id>` slug refs, provenance retention) the
 * rogue-trader-2e pack pipeline will implement — the contract is proven here
 * first (builder plan Part 6, efficiency rationale 5).
 *
 * SECOND EMITTER (ST-1, decision D-N): api/data/chargen/prose.local.mjs — the
 * GIT-IGNORED overlay carrying `description_verbatim` for every corpus entry
 * that has one, keyed by the same `dh2:<type>:<snake_id>` ref. Verbatim GW text
 * must never be committed here; the overlay is regenerated on each machine and
 * `GET /api/prose` degrades to `{ available:false }` without it. The PUBLIC pack
 * gains only `citation { book, page, source }` — page tags are facts, not prose.
 *
 * Run: npm run sync:chargen        (CORPUS_DIR env overrides the default
 * monorepo-relative path). Never hand-edit api/data/chargen/pack.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citationOf } from '../api/lib/prose.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = process.env.CORPUS_DIR
    ?? join(root, '..', '..', 'codified-systems', 'dark_heresy_2e');
const OUT_DIR = join(root, 'api', 'data', 'chargen');
const OUT = join(OUT_DIR, 'pack.mjs');
const OUT_PROSE = join(OUT_DIR, 'prose.local.mjs');

const load = (rel) => JSON.parse(readFileSync(join(CORPUS, rel), 'utf8'));

// ---- errata overlay (consumer contract: deep-merge patches by id) ----------
const errata = load('_errata_overrides.json');
/** Apply data_overrides patches for `section` to entries (matched by id).
 *  Patch fields land on the entry; `_`-prefixed patch keys are errata
 *  metadata and are skipped (they would leak prose). */
function applyErrata(section, entries) {
    const block = errata.data_overrides?.[section];
    if (!block?.patches) return entries;
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const patch of block.patches) {
        const target = byId.get(patch.id);
        if (!target) continue;
        for (const [k, v] of Object.entries(patch)) {
            if (k === 'id' || k.startsWith('_')) continue;
            target[k] = v;
        }
    }
    return entries;
}

// ---- allowlist projections (D-H: mechanical fields ONLY) -------------------
const ref = (type, id) => `dh2:${type}:${id}`;
// `citation` is the PUBLIC half of ST-1: book label + printed page + source id.
// Facts, not expression — safe in the committed pack (D-N). `_source`/`_book_page`
// stay for back-compat with the existing consumers and tests.
const prov = (e) => ({
    _source: e._source,
    ...(e._book_page !== undefined && { _book_page: e._book_page }),
    citation: citationOf(e),
});

const projectTalent = (tier) => (e) => ({
    id: e.id, ref: ref('talent', e.id), name: e.name, tier,
    aptitudes: e.aptitudes ?? [], prerequisites: e.prerequisites ?? [],
    specialist: !!e.specialist, ...prov(e),
});
const projectSkill = (e) => ({
    id: e.id, ref: ref('skill', e.id), name: e.name,
    characteristic: e.characteristic, aptitudes: e.aptitudes ?? [],
    specialist: !!e.specialist,
    ...(e.alternate_characteristics?.length && { alternateCharacteristics: e.alternate_characteristics }),
    ...prov(e),
});
const projectHomeworld = (e) => ({
    id: e.id, ref: ref('home_world', e.id), name: e.name,
    characteristicModifiers: e.characteristic_modifiers ?? {},
    fateThreshold: e.fate_threshold, emperorsBlessing: e.emperors_blessing,
    bonusName: e.home_world_bonus?.name ?? '',            // name only; body text is prose
    aptitude: e.home_world_aptitude, woundsFormula: e.wounds_formula,
    recommendedBackgrounds: e.recommended_backgrounds ?? [],
    ...prov(e),
});
const projectBackground = (e) => ({
    id: e.id, ref: ref('background', e.id), name: e.name,
    skillsGranted: e.skills_granted ?? [], talentsGranted: e.talents_granted ?? [],
    startingAptitude: e.starting_aptitude ?? '',
    startingEquipmentClass: e.starting_equipment_class ?? '',
    ...prov(e),
});
const projectRole = (e) => ({
    id: e.id, ref: ref('role', e.id), name: e.name,
    roleAptitudes: e.role_aptitudes ?? [],                // "X or Y" choice strings kept verbatim
    roleTalentChoice: e.role_talent_choice ?? [],
    roleBonusName: e.role_bonus?.name ?? '',              // name only
    ...prov(e),
});
const projectTrait = (e) => ({
    id: e.id, ref: ref('trait', e.id), name: e.name, rated: !!e.rated, ...prov(e),
});
const projectElite = (e) => ({
    id: e.id, ref: ref('elite_advance', e.id), name: e.name,
    xpCost: e.xp_cost ?? null,
    ...(e.prerequisites !== undefined && { prerequisites: e.prerequisites }),
    ...prov(e),
});

// ---- assemble --------------------------------------------------------------
const talentsSrc = load('data/talents.json');
applyErrata('talents', [...talentsSrc.tier_1, ...talentsSrc.tier_2, ...talentsSrc.tier_3]);
const skillsSrc = applyErrata('skills', load('data/skills.json').entries);
const homeworldsSrc = applyErrata('home_worlds', load('data/home_worlds.json').entries);
const backgroundsSrc = applyErrata('backgrounds', load('data/backgrounds.json').entries);
const rolesSrc = load('data/roles.json').entries;
const traitsSrc = load('data/traits.json').entries;
const eliteSrc = load('data/elite_advances.json').entries;
const adv = load('data/advancement.json');

const stripCostTable = (t) => ({ ranks: t.ranks, matches_2: t.matches_2, matches_1: t.matches_1, matches_0: t.matches_0 });

let corpusCommit = 'unknown';
try { corpusCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: CORPUS, encoding: 'utf8' }).trim(); } catch { /* corpus not a git checkout */ }

const pack = {
    packVersion: 1,
    generatedAt: new Date().toISOString(),
    corpus: { system: 'dark_heresy_2e', commit: corpusCommit },
    startingXp: adv.starting_xp.value,
    aptitudes: adv.aptitudes.entries.map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
    characteristicAptitudes: Object.fromEntries(
        Object.entries(adv.characteristic_aptitudes)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, v]) => [k, v.aptitudes])),
    costs: {
        characteristic: stripCostTable(adv.characteristic_advance_costs),
        skill: stripCostTable(adv.skill_advance_costs),
        talent: {
            tier_1: adv.talent_costs.tier_1, tier_2: adv.talent_costs.tier_2, tier_3: adv.talent_costs.tier_3,
        },
        psyRating: { formula: adv.psy_rating_cost.formula, perRating: 200 },
    },
    homeworlds: homeworldsSrc.map(projectHomeworld),
    backgrounds: backgroundsSrc.map(projectBackground),
    roles: rolesSrc.map(projectRole),
    talents: [
        ...talentsSrc.tier_1.map(projectTalent(1)),
        ...talentsSrc.tier_2.map(projectTalent(2)),
        ...talentsSrc.tier_3.map(projectTalent(3)),
    ],
    traits: traitsSrc.map(projectTrait),
    skills: skillsSrc.map(projectSkill),
    eliteAdvances: eliteSrc.map(projectElite),
};

// unique-ref guard (deterministic slug ids — collisions fail the sync)
const refs = new Set();
for (const list of [pack.homeworlds, pack.backgrounds, pack.roles, pack.talents, pack.traits, pack.skills, pack.eliteAdvances]) {
    for (const e of list) {
        if (refs.has(e.ref)) throw new Error(`duplicate ref: ${e.ref}`);
        refs.add(e.ref);
    }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `/**
 * DH2 chargen data pack — GENERATED by \`npm run sync:chargen\` from the corpus
 * (${pack.corpus.system} @ ${corpusCommit.slice(0, 12)}). Do not edit by hand.
 * PROSE-STRIPPED per decision D-H: mechanical fields + page tags only.
 */
export const CHARGEN_PACK = ${JSON.stringify(pack, null, 2)};
`);
console.log(`✓ ${OUT}  (${pack.talents.length} talents, ${pack.skills.length} skills, ${pack.homeworlds.length} homeworlds, ${pack.backgrounds.length} backgrounds, ${pack.roles.length} roles, ${pack.traits.length} traits, ${pack.eliteAdvances.length} elite advances, ${pack.aptitudes.length} aptitudes)`);

// ---- second emitter: the prose overlay (ST-1, decision D-N) ----------------
// GIT-IGNORED. Everything with a `description_verbatim` in the corpus, keyed by
// the same `dh2:<type>:<snake_id>` ref the pack stamps. Types the pack does not
// (yet) emit are included so ST-2/ST-3 can resolve hover text for weapons, gear,
// armour, cybernetics, characteristics, conditions and psychic powers too.
const PROSE_SOURCES = [
    // [corpus file,               errata section, ref type token]
    ['data/talents.json', 'talents', 'talent'],           // all buckets, incl. the EW supplements
    ['data/traits.json', null, 'trait'],
    ['data/weapons.json', 'weapons', 'weapon'],
    ['data/armor.json', 'armor', 'armour'],               // file is armor.json; ref token is `armour`
    ['data/gear.json', null, 'gear'],
    ['data/cybernetics.json', null, 'cybernetic'],
    ['data/skills.json', 'skills', 'skill'],
    ['data/characteristics.json', null, 'characteristic'],
    ['data/conditions.json', null, 'condition'],
    ['data/psychic_powers.json', null, 'psychic_power'],
];

/** Every object in `node` that is a corpus entry carrying verbatim text. */
function collectProse(node, out = []) {
    if (Array.isArray(node)) { for (const v of node) collectProse(v, out); return out; }
    if (!node || typeof node !== 'object') return out;
    if (typeof node.description_verbatim === 'string' && typeof node.id === 'string') { out.push(node); return out; }
    for (const v of Object.values(node)) collectProse(v, out);
    return out;
}

/** A prose source that is absent is not an error: partial corpora (and the
 *  synthetic corpora the script tests build) legitimately lack most of them. */
function loadOptional(rel) {
    try { return load(rel); }
    catch (err) { if (err?.code === 'ENOENT') return null; throw err; }
}

const prose = {};
const proseCounts = [];
const proseSkipped = [];
for (const [file, section, type] of PROSE_SOURCES) {
    const doc = loadOptional(file);
    if (doc === null) { proseSkipped.push(file); continue; }
    const entries = collectProse(doc);
    if (section) applyErrata(section, entries);
    for (const e of entries) {
        const key = ref(type, e.id);
        if (Object.hasOwn(prose, key)) throw new Error(`duplicate prose ref: ${key} (${file})`);
        prose[key] = {
            text: e.description_verbatim,
            sha256: e._text_sha256 ?? null,
            citation: citationOf(e),
        };
    }
    proseCounts.push(`${entries.length} ${type}`);
}

writeFileSync(OUT_PROSE, `// GENERATED — NEVER COMMIT (decision D-N). Verbatim GW text for local builds only.
// Emitted by \`npm run sync:chargen\` from ${pack.corpus.system} @ ${corpusCommit.slice(0, 12)}.
// Git-ignored (.gitignore: api/data/chargen/*.local.mjs); GET /api/prose serves it
// when present and reports { available:false } when it is not. Do not edit by hand.
export const PROSE = ${JSON.stringify(prose, null, 2)};
`);
console.log(`✓ ${OUT_PROSE}  (${Object.keys(prose).length} prose entries: ${proseCounts.join(', ')})  [git-ignored — D-N]`);
if (proseSkipped.length) console.warn(`  note: prose sources absent from the corpus, skipped: ${proseSkipped.join(', ')}`);
