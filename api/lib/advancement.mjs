/**
 * Advancement engine (Task CB-2, monorepo docs/CHARACTER_BUILDER_PLAN_2026-07-24.md).
 *
 * Pure functions over schema-v4 character documents + the chargen data pack
 * (api/data/chargen/pack.mjs — corpus-derived, prose-stripped). Exposed
 * through dispatch (`/api/chargen/*`), so the Pages Builder UI today and the
 * rogue-trader-2e Foundry sheet later consume the IDENTICAL cost/prerequisite
 * logic — the one-rules-brain law applied to advancement.
 *
 * DH2 cost rule (corpus data/advancement.json, Tables 2-2/2-4/2-6):
 * cost = f(kind, rank/tier, aptitude matches 0|1|2). "all characters in DARK
 * HERESY have the General aptitude" (core p.79-book) — General always counts.
 * Characteristics have 5 advance ranks (Simple→Expert); skills 4
 * (Known→Veteran); talents cost by tier; psy rating = 200 × new rating.
 *
 * Ledger discipline (decision D-I): applyAdvance mutates NOTHING — it returns
 * a deep-copied doc with the mechanical change AND a typed ledger entry
 * appended atomically. Advance COUNTS stay authoritative for play;
 * validateBuild reconciles ledger↔counts (errors only when the ledger is
 * fully typed, i.e. builder-written; warnings on legacy docs).
 */
import {
    characteristicTotal, canonicalSkillName, SKILL_DEFS, LEDGER_KINDS,
} from './character-schema.mjs';

const CHAR_KEY_BY_NAME = {
    'weapon skill': 'ws', 'ballistic skill': 'bs', 'strength': 's', 'toughness': 't',
    'agility': 'ag', 'intelligence': 'int', 'perception': 'per', 'willpower': 'wp',
    'fellowship': 'fel',
};
const norm = (s) => String(s ?? '').trim().toLowerCase();
const entryName = (e) => (e && typeof e === 'object') ? String(e.name ?? '') : String(e ?? '');

/** The character's aptitude name set (lowercased). General is always held. */
export function aptitudeSet(doc) {
    const set = new Set(['general']);
    for (const a of doc.aptitudes ?? []) set.add(norm(entryName(a)));
    return set;
}

/** Matches (0|1|2) between the character's aptitudes and an advance's pair. */
export function aptitudeMatches(doc, itemAptitudes) {
    const have = aptitudeSet(doc);
    const wanted = new Set((itemAptitudes ?? []).map(norm));   // duplicates never double-count
    let n = 0;
    for (const a of wanted) if (have.has(a)) n++;
    return Math.min(2, n);
}

/**
 * XP cost of one advance. `spec`:
 *  - { kind:'characteristic', matches, rank 1..5 }
 *  - { kind:'skill',          matches, rank 1..4 }
 *  - { kind:'talent',         matches, tier 1..3 }
 *  - { kind:'psy_rating',     rank: newRating }
 *  - { kind:'elite_advance',  cost }               (per-entry xpCost)
 * Throws on out-of-range input.
 */
export function advanceCost(pack, spec) {
    const band = (m) => {
        if (![0, 1, 2].includes(m)) throw new Error(`matches must be 0|1|2, got ${m}`);
        return `matches_${m}`;
    };
    switch (spec.kind) {
        case 'characteristic': {
            const col = pack.costs.characteristic[band(spec.matches)];
            if (!Number.isInteger(spec.rank) || spec.rank < 1 || spec.rank > col.length) throw new Error(`characteristic rank must be 1..${col.length}, got ${spec.rank}`);
            return col[spec.rank - 1];
        }
        case 'skill': {
            const col = pack.costs.skill[band(spec.matches)];
            if (!Number.isInteger(spec.rank) || spec.rank < 1 || spec.rank > col.length) throw new Error(`skill rank must be 1..${col.length}, got ${spec.rank}`);
            return col[spec.rank - 1];
        }
        case 'talent': {
            const tier = pack.costs.talent[`tier_${spec.tier}`];
            if (!tier) throw new Error(`talent tier must be 1..3, got ${spec.tier}`);
            return tier[band(spec.matches)];
        }
        case 'psy_rating': {
            if (!Number.isInteger(spec.rank) || spec.rank < 1) throw new Error(`psy rating must be ≥ 1, got ${spec.rank}`);
            return pack.costs.psyRating.perRating * spec.rank;
        }
        case 'elite_advance': {
            if (!Number.isInteger(spec.cost) || spec.cost < 0) throw new Error('elite advance needs its entry xpCost');
            return spec.cost;
        }
        default:
            throw new Error(`unknown advance kind "${spec.kind}"`);
    }
}

/** { total, spent, remaining } — spent is ALWAYS the ledger sum. */
export function xpSummary(doc) {
    const total = doc.xp?.total ?? 0;
    const spent = (doc.xp?.ledger ?? []).reduce((a, e) => a + (e.cost || 0), 0);
    return { total, spent, remaining: total - spent };
}

/**
 * Prerequisite check against the doc. Parses the common corpus patterns:
 * characteristic thresholds ("Ag 30"), psy rating ("Psy Rating 2"), talent
 * names (incl. "(X)" specialisations), and " or "-joined alternatives.
 * Unparseable prose → a `problems` note (advisory), never a hard block.
 * Returns { met, problems[] }.
 */
export function checkPrerequisites(doc, prerequisites) {
    const problems = [];
    let met = true;
    const talentNames = (doc.talents ?? []).map((t) => norm(entryName(t)));
    const checkOne = (p) => {
        const s = String(p).trim();
        const chr = s.match(/^(ws|bs|s|t|ag|int|per|wp|fel|weapon skill|ballistic skill|strength|toughness|agility|intelligence|perception|willpower|fellowship)\s+(\d+)$/i);
        if (chr) {
            const key = CHAR_KEY_BY_NAME[norm(chr[1])] ?? norm(chr[1]);
            return characteristicTotal(doc, key) >= Number(chr[2]);
        }
        const psy = s.match(/^psy rating (\d+)$/i);
        if (psy) return (doc.psy?.rating ?? 0) >= Number(psy[1]);
        const base = norm(s).replace(/\s*\(.*\)$/, '');
        if (talentNames.some((n) => n === norm(s) || n.replace(/\s*\(.*\)$/, '') === base)) return true;
        return null;                                        // unparseable / not held
    };
    for (const p of prerequisites ?? []) {
        const alternatives = String(p).split(/\s+or\s+/i);
        const results = alternatives.map(checkOne);
        if (results.some((r) => r === true)) continue;
        if (results.every((r) => r === null)) {
            // could be prose we can't parse OR a talent simply not held; flag,
            // don't block (plan CB-2.1: warn-and-confirm pattern)
            problems.push(`unverified prerequisite: "${p}"`);
            continue;
        }
        met = false;
        problems.push(`unmet prerequisite: "${p}"`);
    }
    return { met, problems };
}

const skillEntryFor = (doc, canonical) => {
    const key = Object.keys(doc.skills ?? {}).find((k) => canonicalSkillName(k) === canonical);
    return key ? doc.skills[key] : null;
};

/**
 * Every advance the character could buy next, cost-annotated.
 * Returns [{ kind, ref, name, rank?, tier?, matches, cost, affordable,
 *            prereqsMet, prereqProblems[], speciality? }].
 * Skills: known specialities advance individually; specialist skills also
 * offer a "new speciality" template entry (rank 1, speciality: null).
 */
export function listAvailableAdvances(doc, pack) {
    const { remaining } = xpSummary(doc);
    const out = [];
    const push = (a) => out.push({ ...a, affordable: a.cost <= remaining });

    // characteristics — next rank each (max = table length, 5)
    for (const [key, aptPair] of Object.entries(pack.characteristicAptitudes)) {
        const cur = doc.characteristics?.[key]?.advances ?? 0;
        const max = pack.costs.characteristic.matches_2.length;
        if (cur >= max) continue;
        const matches = aptitudeMatches(doc, aptPair);
        push({
            kind: 'characteristic', ref: key, name: `${key.toUpperCase()} advance ${cur + 1}`,
            rank: cur + 1, matches,
            cost: advanceCost(pack, { kind: 'characteristic', matches, rank: cur + 1 }),
            prereqsMet: true, prereqProblems: [],
        });
    }

    // skills — next rank per known entry/speciality; new-speciality template
    for (const s of pack.skills) {
        const matches = aptitudeMatches(doc, s.aptitudes);
        const canonical = canonicalSkillName(s.name);
        const entry = canonical ? skillEntryFor(doc, canonical) : null;
        const nextFor = (advances, speciality) => {
            if (advances >= 4) return;
            push({
                kind: 'skill', ref: s.ref, name: speciality ? `${s.name} (${speciality})` : s.name,
                rank: advances + 1, matches, speciality: speciality ?? undefined,
                cost: advanceCost(pack, { kind: 'skill', matches, rank: advances + 1 }),
                prereqsMet: true, prereqProblems: [],
            });
        };
        if (s.specialist) {
            for (const [spec, sv] of Object.entries(entry?.specialities ?? {})) nextFor(sv.advances ?? 0, spec);
            push({
                kind: 'skill', ref: s.ref, name: `${s.name} (new speciality)`, rank: 1,
                matches, speciality: null,
                cost: advanceCost(pack, { kind: 'skill', matches, rank: 1 }),
                prereqsMet: true, prereqProblems: [],
            });
        } else {
            nextFor(entry?.advances ?? 0, null);
        }
    }

    // talents — not already held (non-specialist), prereq-checked
    const held = new Set((doc.talents ?? []).map((t) => norm(entryName(t)).replace(/\s*\(.*\)$/, '')));
    for (const t of pack.talents) {
        if (!t.specialist && held.has(norm(t.name))) continue;
        const matches = aptitudeMatches(doc, t.aptitudes);
        const { met, problems } = checkPrerequisites(doc, t.prerequisites);
        push({
            kind: 'talent', ref: t.ref, name: t.name, tier: t.tier, matches,
            cost: advanceCost(pack, { kind: 'talent', matches, tier: t.tier }),
            prereqsMet: met, prereqProblems: problems,
        });
    }

    // psy rating — psykers only (rating > 0 or Psyker elite advance held)
    const isPsyker = (doc.psy?.rating ?? 0) > 0
        || (doc.origin?.eliteAdvances ?? []).some((e) => /psyker/i.test(entryName(e)));
    if (isPsyker) {
        const next = (doc.psy?.rating ?? 0) + 1;
        push({
            kind: 'psy_rating', ref: 'psy.rating', name: `Psy Rating ${next}`, rank: next,
            matches: 0,
            cost: advanceCost(pack, { kind: 'psy_rating', rank: next }),
            prereqsMet: true, prereqProblems: [],
        });
    }

    // elite advances — not already taken
    const taken = new Set((doc.origin?.eliteAdvances ?? []).map((e) => norm(entryName(e))));
    for (const e of pack.eliteAdvances) {
        if (taken.has(norm(e.name)) || e.xpCost == null) continue;
        const { met, problems } = checkPrerequisites(doc,
            typeof e.prerequisites === 'string' ? [e.prerequisites] : e.prerequisites);
        push({
            kind: 'elite_advance', ref: e.ref, name: e.name, matches: 0, cost: e.xpCost,
            prereqsMet: met, prereqProblems: problems,
        });
    }

    return out;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Buy one advance: returns { doc, entry } where doc is a DEEP COPY with the
 * mechanical change applied and the typed ledger entry appended atomically.
 * `advance` is an element of listAvailableAdvances (or the same shape).
 * Throws on: unaffordable, rank-skipping, duplicate talent/elite, non-psyker
 * psy purchase. Unmet PARSED prerequisites throw unless `confirmed: true`
 * (unverifiable prose prerequisites never block — warn-and-confirm).
 */
export function applyAdvance(doc, pack, advance, { confirmed = false } = {}) {
    const d = structuredClone(doc);
    if (advance.prereqsMet === false && !confirmed) throw new Error(`prerequisites unmet: ${(advance.prereqProblems ?? []).join('; ')} (pass confirmed:true to override)`);

    // kind-specific validation (duplicates, rank sequence) runs BEFORE the XP
    // gate so the user sees the more specific error; d is a discardable clone.
    switch (advance.kind) {
        case 'characteristic': {
            const c = d.characteristics[advance.ref];
            if (!c) throw new Error(`unknown characteristic "${advance.ref}"`);
            if ((c.advances ?? 0) + 1 !== advance.rank) throw new Error(`rank ${advance.rank} skips (current advances: ${c.advances ?? 0})`);
            c.advances = advance.rank;
            break;
        }
        case 'skill': {
            const packSkill = pack.skills.find((s) => s.ref === advance.ref);
            const canonical = canonicalSkillName(packSkill?.name ?? '');
            if (!canonical) throw new Error(`unknown skill ref "${advance.ref}"`);
            d.skills ??= {};
            if (packSkill.specialist) {
                if (!advance.speciality) throw new Error('specialist skill advance needs a speciality');
                const entry = (d.skills[canonical] ??= { specialities: {} });
                entry.specialities ??= {};
                const sv = (entry.specialities[advance.speciality] ??= { advances: 0 });
                if ((sv.advances ?? 0) + 1 !== advance.rank) throw new Error(`rank ${advance.rank} skips (current: ${sv.advances ?? 0})`);
                sv.advances = advance.rank;
            } else {
                const entry = (d.skills[canonical] ??= { advances: 0 });
                if ((entry.advances ?? 0) + 1 !== advance.rank) throw new Error(`rank ${advance.rank} skips (current: ${entry.advances ?? 0})`);
                entry.advances = advance.rank;
            }
            break;
        }
        case 'talent': {
            const name = advance.speciality ? `${advance.name} (${advance.speciality})` : advance.name;
            const held = (d.talents ?? []).some((t) => norm(entryName(t)) === norm(name));
            if (held) throw new Error(`talent already held: ${name}`);
            (d.talents ??= []).push({ name, ref: advance.ref });
            break;
        }
        case 'psy_rating': {
            d.psy ??= { rating: 0, class: 'bound', sustained: 0 };
            if (d.psy.rating + 1 !== advance.rank) throw new Error(`psy rating ${advance.rank} skips (current: ${d.psy.rating})`);
            d.psy.rating = advance.rank;
            if (d.psy.class === 'none') d.psy.class = 'bound';
            break;
        }
        case 'elite_advance': {
            d.origin ??= { homeworld: null, background: null, role: null, eliteAdvances: [] };
            (d.origin.eliteAdvances ??= []).push({ name: advance.name, ref: advance.ref, cost: advance.cost });
            break;
        }
        default:
            throw new Error(`unknown advance kind "${advance.kind}"`);
    }

    const { remaining } = xpSummary(doc);
    if (advance.cost > remaining) throw new Error(`insufficient XP: cost ${advance.cost}, remaining ${remaining}`);

    const entry = {
        name: advance.speciality ? `${advance.name}` : advance.name,
        cost: advance.cost,
        kind: advance.kind,
        ref: advance.ref,
        ...(advance.rank !== undefined && { rank: advance.rank }),
        ...(advance.matches !== undefined && { matches: advance.matches }),
        date: today(),
    };
    d.xp ??= { total: 0, ledger: [] };
    (d.xp.ledger ??= []).push(entry);
    return { doc: d, entry };
}

/**
 * Character-creation origin application: homeworld (aptitude, fate threshold,
 * Emperor's Blessing, wounds formula returned for the UI to roll), background
 * (granted skills/talents + starting aptitude — "X or Y" grants resolved via
 * `choices`), role (aptitudes; "X or Y" via `choices`; talent choice via
 * `choices.roleTalent`). Characteristic GENERATION (the 2d10+25 rolls and the
 * homeworld's +/− roll advantage) is a Builder-UI step (decision D-K) — this
 * function records `characteristicModifiers` info without touching scores.
 * Returns { doc, woundsFormula, fateThreshold, emperorsBlessing, choicesNeeded[] }.
 */
export function applyOrigin(doc, pack, { homeworldRef, backgroundRef, roleRef, choices = {} } = {}) {
    const d = structuredClone(doc);
    const find = (list, r) => list.find((e) => e.ref === r) ?? null;
    const hw = homeworldRef ? find(pack.homeworlds, homeworldRef) : null;
    const bg = backgroundRef ? find(pack.backgrounds, backgroundRef) : null;
    const role = roleRef ? find(pack.roles, roleRef) : null;
    for (const [ref, hit, label] of [[homeworldRef, hw, 'homeworld'], [backgroundRef, bg, 'background'], [roleRef, role, 'role']]) {
        if (ref && !hit) throw new Error(`unknown ${label} ref "${ref}"`);
    }
    const choicesNeeded = [];
    d.origin ??= { homeworld: null, background: null, role: null, eliteAdvances: [] };
    d.aptitudes ??= [];
    const grantAptitude = (name, source) => {
        if (!name) return;
        if (/\s+or\s+/i.test(name)) {
            const pick = choices[name];
            if (!pick) { choicesNeeded.push({ kind: 'aptitude', options: name.split(/\s+or\s+/i), key: name, source }); return; }
            name = pick;
        }
        // duplicate aptitude → the player picks another (RAW); surface as a choice
        if (d.aptitudes.some((a) => norm(entryName(a)) === norm(name))) {
            choicesNeeded.push({ kind: 'duplicate_aptitude', duplicate: name, source });
            return;
        }
        d.aptitudes.push({ name, source });
    };

    if (hw) {
        d.origin.homeworld = { name: hw.name, ref: hw.ref };
        grantAptitude(hw.aptitude, 'homeworld');
        d.fate = { max: hw.fateThreshold, current: hw.fateThreshold };   // +1 on Emperor's Blessing (UI rolls it)
    }
    if (bg) {
        d.origin.background = { name: bg.name, ref: bg.ref };
        grantAptitude(bg.startingAptitude, 'background');
        d.skills ??= {};
        for (const grant of bg.skillsGranted) {
            let g = grant;
            if (/\s+or\s+/i.test(g)) {
                const pick = choices[g];
                if (!pick) { choicesNeeded.push({ kind: 'skill', options: g.split(/\s+or\s+/i), key: g, source: 'background' }); continue; }
                g = pick;
            }
            const m = g.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
            const canonical = canonicalSkillName(m ? m[1] : g);
            if (!canonical) { choicesNeeded.push({ kind: 'unresolved_skill', grant: g, source: 'background' }); continue; }
            if (SKILL_DEFS[canonical].specialist) {
                const spec = m ? m[2] : null;
                if (!spec) { choicesNeeded.push({ kind: 'speciality', skill: canonical, key: g, source: 'background' }); continue; }
                const entry = (d.skills[canonical] ??= { specialities: {} });
                entry.specialities ??= {};
                entry.specialities[spec] = { advances: Math.max(1, entry.specialities[spec]?.advances ?? 0) };
            } else {
                const entry = (d.skills[canonical] ??= { advances: 0 });
                entry.advances = Math.max(1, entry.advances ?? 0);
            }
        }
        for (const grant of bg.talentsGranted) {
            let g = grant;
            if (/\s+or\s+/i.test(g)) {
                const pick = choices[g];
                if (!pick) { choicesNeeded.push({ kind: 'talent', options: g.split(/\s+or\s+/i), key: g, source: 'background' }); continue; }
                g = pick;
            }
            if (!(d.talents ?? []).some((t) => norm(entryName(t)) === norm(g))) (d.talents ??= []).push({ name: g });
        }
    }
    if (role) {
        d.origin.role = { name: role.name, ref: role.ref };
        for (const apt of role.roleAptitudes) grantAptitude(apt, 'role');
        const pick = choices.roleTalent;
        if (role.roleTalentChoice?.length) {
            if (!pick) choicesNeeded.push({ kind: 'talent', options: role.roleTalentChoice, key: 'roleTalent', source: 'role' });
            else if (!(d.talents ?? []).some((t) => norm(entryName(t)) === norm(pick))) (d.talents ??= []).push({ name: pick });
        }
    }
    d.xp ??= { total: 0, ledger: [] };
    if (!d.xp.total) d.xp.total = pack.startingXp;

    return {
        doc: d,
        woundsFormula: hw?.woundsFormula ?? null,
        fateThreshold: hw?.fateThreshold ?? null,
        emperorsBlessing: hw?.emperorsBlessing ?? null,
        characteristicModifiers: hw?.characteristicModifiers ?? {},
        choicesNeeded,
    };
}

/**
 * Ledger ↔ counts reconciliation (decision D-I). Replays typed ledger entries
 * and compares against stored advance counts / held talents. Docs whose
 * ledger is FULLY typed (every entry has a known `kind`) must reconcile
 * exactly → mismatches are ERRORS; docs with any untyped entries are legacy →
 * mismatches are WARNINGS. Overspend (spent > total) is always an error.
 */
export function validateBuild(doc, pack) {
    const errors = [], warnings = [];
    const ledger = doc.xp?.ledger ?? [];
    const fullyTyped = ledger.length > 0 && ledger.every((e) => LEDGER_KINDS.includes(e.kind));
    const report = (msg) => (fullyTyped ? errors : warnings).push(msg);

    const { total, spent, remaining } = xpSummary(doc);
    if (remaining < 0) errors.push(`overspent: ledger total ${spent} exceeds earned XP ${total}`);

    // replay typed characteristic/skill purchases into expected counts
    const expChar = {}, expSkill = {};
    for (const e of ledger) {
        if (e.kind === 'characteristic' && e.ref) expChar[e.ref] = Math.max(expChar[e.ref] ?? 0, e.rank ?? ((expChar[e.ref] ?? 0) + 1));
        if (e.kind === 'skill' && e.ref) {
            const k = `${e.ref}|${e.name}`;
            expSkill[k] = Math.max(expSkill[k] ?? 0, e.rank ?? ((expSkill[k] ?? 0) + 1));
        }
    }
    for (const [key, exp] of Object.entries(expChar)) {
        const got = doc.characteristics?.[key]?.advances ?? 0;
        if (got !== exp) report(`characteristic ${key}: ledger implies ${exp} advances, doc has ${got}`);
    }
    // talents bought must be held
    for (const e of ledger) {
        if (e.kind !== 'talent') continue;
        const held = (doc.talents ?? []).some((t) => norm(entryName(t)) === norm(e.name));
        if (!held) report(`ledger buys talent "${e.name}" but the doc does not hold it`);
    }
    // held talents with a corpus entry should have a purchase OR an origin grant
    const granted = new Set();
    for (const list of [doc.origin?.eliteAdvances ?? []]) for (const g of list) granted.add(norm(entryName(g)));
    const bought = new Set(ledger.filter((e) => e.kind === 'talent').map((e) => norm(e.name)));
    for (const t of doc.talents ?? []) {
        const name = norm(entryName(t));
        const inPack = pack.talents.some((p) => norm(p.name) === name.replace(/\s*\(.*\)$/, ''));
        if (inPack && !bought.has(name) && ledger.length) {
            (fullyTyped ? warnings : warnings).push(`talent "${entryName(t)}" held without a ledger purchase (origin grant or import)`);
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}
