/**
 * DH2 Trait DSL — the vocabulary (Stage 2, DSL_ARCHITECTURE.md F2/F8).
 *
 * THE single source of truth for every fact and function the DSL exposes. Each
 * entry is defined ONCE with its type, documentation, and per-scope getters;
 * from this table are derived:
 *   - the interpreter whitelists (FACTS / FUNCTIONS / scoped lookup) — interpreter.mjs
 *   - the human-readable reference (facts / functions lists) — docs.mjs
 * so the docs cannot drift from the code by construction.
 *
 * SCOPES: a predicate may read a fact through a scope path — `target.tb`,
 * `weapon.pen`, `opposing_weapon.has_quality("Force")`. The unscoped name is the
 * `attacker` scope (the acting side), preserving all v1 rules. Legacy prefixed
 * names (target_sb, opposing_has_quality, …) are declared as ALIASES onto
 * (scope, base) pairs and remain valid.
 */
import { hasQuality, qualityLevel, normName } from '../rules/_util.mjs';
import { actionType, isReaction, isAction, actionHasSubtype } from '../actions.mjs';

const num = (x) => Number(x) || 0;

/** Display name of a list entry (string or { name } object). */
export const nameOf = (x) => (x && typeof x === 'object') ? String(x.name ?? '') : String(x ?? '');
/** Normalised prefix membership over strings / named objects — spelling-blind
 *  ("Razor Sharp" ↔ "RazorSharp" ↔ "razor_sharp"; see normName). */
const hasNamed = (list, name) => (list ?? [])
    .some((x) => normName(nameOf(x)).startsWith(normName(name)));
/** First entry matching `name` (for reading structured variables). */
const findNamed = (list, name) => (list ?? [])
    .find((x) => normName(nameOf(x)).startsWith(normName(name)));

export const SCOPE_NAMES = ['attacker', 'target', 'weapon', 'opposing_weapon'];

/**
 * Facts. `scopes.attacker` (when present) is also the UNSCOPED getter.
 * A fact with no attacker getter is reachable only through its scope (or an alias).
 */
export const FACT_DEFS = [
    // --- weapon / actor ------------------------------------------------------
    { name: 'is_melee', type: 'bool', summary: 'The attack is a melee attack.', scopes: {
        attacker: (c) => !!c.isMelee, weapon: (c) => !!c.isMelee } },
    { name: 'is_ranged', type: 'bool', summary: 'The attack is a ranged attack.', scopes: {
        attacker: (c) => (c.isMelee === undefined ? true : !c.isMelee), weapon: (c) => (c.isMelee === undefined ? true : !c.isMelee) } },
    { name: 'pen', type: 'number', summary: 'The hit\'s base armour penetration. Meaningful at PENETRATION.', scopes: {
        attacker: (c) => c.pen ?? 0, weapon: (c) => c.pen ?? 0 } },
    { name: 'sb', type: 'number', summary: 'Strength Bonus (tens digit of Strength). Scoped: attacker (default) or target.', scopes: {
        attacker: (c) => c.strengthBonus ?? Math.floor(num(c.characteristics?.s) / 10),
        target: (c) => c.target?.strengthBonus ?? Math.floor(num(c.target?.strength) / 10) } },
    { name: 'tb', type: 'number', summary: 'Toughness Bonus (tens digit of Toughness). Scoped: attacker (default) or target.', scopes: {
        attacker: (c) => c.toughnessBonus ?? Math.floor(num(c.characteristics?.t) / 10),
        target: (c) => c.target?.toughnessBonus ?? Math.floor(num(c.target?.toughness) / 10) } },
    { name: 'bs_bonus', type: 'number', summary: 'Ballistic Skill bonus (tens digit of BS).', scopes: {
        attacker: (c) => Math.floor(num(c.characteristics?.bs) / 10) } },
    { name: 'ws_bonus', type: 'number', summary: 'Weapon Skill bonus (tens digit of WS).', scopes: {
        attacker: (c) => Math.floor(num(c.characteristics?.ws) / 10) } },
    // --- test / outcome ------------------------------------------------------
    { name: 'roll', type: 'number', summary: 'The d100 to-hit roll (1–100). Available from POST_ROLL onward.', scopes: {
        attacker: (c) => c.test?.roll ?? c.roll ?? 0 } },
    { name: 'dos', type: 'number', summary: 'Degrees of Success on the to-hit test (0 on a miss).', scopes: {
        attacker: (c) => c.test?.dos ?? c.dos ?? 0 } },
    { name: 'dof', type: 'number', summary: 'Degrees of Failure on the to-hit test (0 on a hit).', scopes: {
        attacker: (c) => c.test?.dof ?? c.dof ?? 0 } },
    { name: 'success', type: 'bool', summary: 'Whether the to-hit test passed. Available from POST_ROLL onward.', scopes: {
        attacker: (c) => c.test?.success ?? c.success ?? false } },
    // --- weapon mechanic / craftsmanship -------------------------------------
    { name: 'jam_threshold', type: 'number', summary: 'A ranged weapon jams on a roll greater than this (default 96 → jams on 97+). Adjusted by Reliable/Unreliable and craftsmanship; 100 = never jams.', scopes: {
        attacker: (c) => c.jamThreshold ?? 96, weapon: (c) => c.jamThreshold ?? 96 } },
    { name: 'craftsmanship', type: 'string', summary: 'The weapon\'s craftsmanship: "Poor", "Common", "Good", or "Best".', scopes: {
        attacker: (c) => c.craftsmanship ?? 'Common', weapon: (c) => c.craftsmanship ?? 'Common' } },
    // --- action context -------------------------------------------------------
    { name: 'action', type: 'string', summary: 'The current action name, e.g. "Standard Attack", "Called Shot", "Parry", "Dodge" — set in every flow including reactions.', scopes: {
        attacker: (c) => c.action ?? '' } },
    { name: 'test_name', type: 'string', summary: 'The generic test\'s name/tag in the test.* pipeline (e.g. "Fear", "Athletics", "Acquisition") — "" outside it. Gate test-affecting rules on it: when test_name == "Fear" …', scopes: {
        attacker: (c) => c.testName ?? '' } },
    { name: 'action_type', type: 'string', summary: 'The current action\'s type: "Half" | "Full" | "Reaction" | "Free" (from the Actions taxonomy), or "" if unknown.', scopes: {
        attacker: (c) => actionType(c.action) } },
    { name: 'is_attack', type: 'bool', summary: 'The current action carries the "attack" subtype (the key designation, e.g. Standard Attack, Charge). Used by Defensive (-10 to attacks) and many others.', scopes: {
        attacker: (c) => actionHasSubtype(c.action, 'attack') } },
    { name: 'range', type: 'string', summary: 'The range band, e.g. "Short Range", "Point Blank", "Melee".', scopes: {
        attacker: (c) => c.rangeBand ?? '' } },
    { name: 'aim', type: 'number', summary: 'Aim bonus value applied (0 = none, 10 = half, 20 = full).', scopes: {
        attacker: (c) => c.aimValue ?? 0 } },
    { name: 'half_aim', type: 'bool', summary: 'Aiming as a Half Action (Aim dropdown = Half, or a "Half Aim" status). The aim bonus is +10.', scopes: {
        attacker: (c) => c.aimValue === 10 || hasNamed(c.statuses, 'Half Aim') } },
    { name: 'full_aim', type: 'bool', summary: 'Aiming as a Full Action (Aim dropdown = Full, or a "Full Aim" status). The aim bonus is +20.', scopes: {
        attacker: (c) => c.aimValue === 20 || hasNamed(c.statuses, 'Full Aim') } },
    { name: 'location', type: 'string', summary: 'The current hit location (e.g. "Head"). Meaningful in the per-hit damage stages.', scopes: {
        attacker: (c) => c.location ?? '' } },
    { name: 'damage_type', type: 'string', summary: 'The weapon damage type: Impact, Energy, Explosive, or Rending (rules may override it, e.g. Sanctified → Holy).', scopes: {
        attacker: (c) => c.damageType ?? '', weapon: (c) => c.damageType ?? '' } },
    { name: 'hit_index', type: 'number', summary: 'Zero-based index of the current hit in a multi-hit attack.', scopes: {
        attacker: (c) => c.hitIndex ?? 0 } },
    // --- per-hit target outcome (ON_HIT) --------------------------------------
    { name: 'damage_dealt', type: 'number', summary: 'This hit\'s total damage (before soak). Meaningful at ON_HIT.', scopes: {
        attacker: (c) => c.damageDealt ?? 0 } },
    { name: 'wounds', type: 'number', summary: 'Wounds this hit inflicted after soak. Meaningful at ON_HIT.', scopes: {
        attacker: (c) => c.woundsInflicted ?? 0 } },
    // --- target-only bases (reachable via target.* or the legacy aliases) -----
    { name: 'armour', type: 'number', summary: 'The struck location\'s current Armour Points (base AP minus any already corroded this attack; 0 if unarmoured). Read at ON_HIT. Scope: target.', scopes: {
        target: (c) => c.targetArmour ?? num(c.target?.armour) } },
    { name: 'unnatural_toughness', type: 'number', summary: 'The target\'s Unnatural Toughness bonus (added to TB when soaking; Felling reduces it). 0 if none. Scope: target.', scopes: {
        target: (c) => num(c.target?.unnaturalToughness) } },
    // --- opposing weapon (Parry context) --------------------------------------
    { name: 'present', type: 'bool', summary: 'In a Parry, an opposing (attacking) weapon was supplied (the engagement provides it). Scope: opposing_weapon. Guards Power Field on a bare /api/parry test.', scopes: {
        opposing_weapon: (c) => !!c.opposingProvided } },
    // --- psyker (Force weapons — static half; the Focus Power rider is Phase 6) --
    { name: 'psy_rating', type: 'number', summary: 'The attacker\'s psy rating (from attacker.psyRating; 0 = not a psyker). Force weapons add it to damage and penetration in a psyker\'s hands (p.145).', scopes: {
        attacker: (c) => Number(c.psyRating) || 0 } },
    { name: 'is_psyker', type: 'bool', summary: 'The attacker has a psy rating > 0.', scopes: {
        attacker: (c) => (Number(c.psyRating) || 0) > 0 } },
    // --- combat state ----------------------------------------------------------
    { name: 'dual_wielding', type: 'bool', summary: 'Wielding two weapons this turn — the "DualWield (main hand)" configuration, or the legacy combat.dualWielding flag.', scopes: {
        attacker: (c) => !!c.combat?.dualWielding || hasNamed(c.configs ?? c.firingModes, 'DualWield (main hand)') } },
    { name: 'firing_offhand', type: 'bool', summary: 'This attack uses the off-hand weapon — the "DualWield (off-hand)" configuration, or the legacy combat.firingOffhand flag.', scopes: {
        attacker: (c) => !!c.combat?.firingOffhand || hasNamed(c.configs ?? c.firingModes, 'DualWield (off-hand)') } },
    { name: 'firing_both', type: 'bool', summary: 'Firing both weapons this turn (set via combat.firingBoth).', scopes: {
        attacker: (c) => !!c.combat?.firingBoth } },
];

/** dsl 3: the legacy prefixed fact aliases (target_sb, target_armour,
 *  opposing_present, …) were REMOVED — use the scoped paths (target.sb, …).
 *  tools/migrate-dsl.mjs rewrites old text. */
export const FACT_ALIASES = {};

/** Functions. Same shape: per-scope implementations, attacker = unscoped. */
export const FUNCTION_DEFS = [
    { name: 'has_quality', signature: 'has_quality("Name")', returns: 'bool', summary: 'Weapon has the named quality. Prefix match — "Proven (3)" matches has_quality("Proven"). Scopes: attacker/weapon (default) or opposing_weapon (the parried weapon).', scopes: {
        attacker: (c, [n]) => hasQuality(c.qualities, String(n)),
        weapon: (c, [n]) => hasQuality(c.qualities, String(n)),
        opposing_weapon: (c, [n]) => hasQuality(c.opposingQualities, String(n)) } },
    { name: 'quality_level', signature: 'quality_level("Name", default)', returns: 'number', summary: 'Numeric level parsed from a quality like "Proven (3)" → 3; returns default if absent/unnumbered.', scopes: {
        attacker: (c, [n, d]) => qualityLevel(c.qualities, String(n), d),
        weapon: (c, [n, d]) => qualityLevel(c.qualities, String(n), d),
        opposing_weapon: (c, [n, d]) => qualityLevel(c.opposingQualities, String(n), d) } },
    { name: 'has_talent', signature: 'has_talent("Name")', returns: 'bool', summary: 'Character has the named talent (from the attack\'s talents[] list). Prefix match.', scopes: {
        attacker: (c, [n]) => hasNamed(c.talents ?? c.actor?.talents, n) } },
    { name: 'has_trait', signature: 'has_trait("Name")', returns: 'bool', summary: 'Character/creature has the named DH2.0 trait (from traits[]). Prefix match — "Brutal Charge (3)" matches has_trait("Brutal Charge"). Scopes: attacker (default) or target (e.g. target.has_trait("Daemonic") — Sanctified).', scopes: {
        attacker: (c, [n]) => hasNamed(c.traits ?? c.actor?.traits, n),
        target: (c, [n]) => hasNamed(c.target?.traits, n) } },
    { name: 'trait_level', signature: 'trait_level("Name", default)', returns: 'number', summary: 'Numeric level parsed from a trait like "Brutal Charge (3)" → 3; returns default if absent/unnumbered. Scopes: attacker (default) or target.', scopes: {
        attacker: (c, [n, d]) => qualityLevel(c.traits, String(n), d),
        target: (c, [n, d]) => qualityLevel(c.target?.traits, String(n), d) } },
    { name: 'has_condition', signature: 'has_condition("Name")', returns: 'bool', summary: 'A named Condition is active on the character (from conditions[] / statuses[]), e.g. "On Fire", "Full Aim", "Stunned".', scopes: {
        attacker: (c, [n]) => hasNamed(c.statuses ?? c.actor?.statuses, n) } },
    { name: 'has_circumstance', signature: 'has_circumstance("Name")', returns: 'bool', summary: 'A named environmental Circumstance is in effect (from circumstances[]).', scopes: {
        attacker: (c, [n]) => hasNamed(c.circumstances ?? c.actor?.circumstances, n) } },
    { name: 'circumstance_severity', signature: 'circumstance_severity("Name", default)', returns: 'number', summary: 'Severity of a structured Circumstance in circumstances[] (e.g. the Haywire Field strength 1–5), or default.', scopes: {
        attacker: (c, [n, d]) => findNamed(c.circumstances ?? c.actor?.circumstances, n)?.severity ?? num(d) } },
    { name: 'configuration', signature: 'configuration("Name")', returns: 'bool', summary: 'A per-character Configuration toggle is on (from configs[] / firingModes[]), e.g. configuration("Maximal").', scopes: {
        attacker: (c, [n]) => hasNamed(c.configs ?? c.firingModes, n) } },
    { name: 'is_action', signature: 'is_action("Name")', returns: 'bool', summary: 'The current action is the named one (case-insensitive), e.g. is_action("Parry"). Works in every flow including reactions.', scopes: {
        attacker: (c, [n]) => isAction(c.action, n) } },
    { name: 'is_test', signature: 'is_test("Name")', returns: 'bool', summary: 'The generic test (test.* pipeline) is the named one, spelling-blind — is_test("Tech-Use") matches testName "tech_use"/"TechUse". THE way to write "+X to <skill>" item/talent rules: when is_test("Tech-Use") [and <condition>] then add modifier "…" = X.', scopes: {
        attacker: (c, [n]) => normName(c.testName ?? '') === normName(n) } },
    { name: 'is_reaction', signature: 'is_reaction()', returns: 'bool', summary: 'The current action is a Reaction (Parry, Dodge, …).', scopes: {
        attacker: (c) => isReaction(c.action) } },
    { name: 'action_subtype', signature: 'action_subtype("Name")', returns: 'bool', summary: 'The current action carries the named subtype (declared via `subtype`/`attack` on the action). `is_attack` is shorthand for action_subtype("attack").', scopes: {
        attacker: (c, [n]) => actionHasSubtype(c.action, n) } },
    { name: 'condition_severity', signature: 'condition_severity("Name", default)', returns: 'number', summary: 'Severity of a structured Condition in conditions[] (e.g. Crippled severity), or default.', scopes: {
        attacker: (c, [n, d]) => findNamed(c.statuses ?? c.actor?.statuses, n)?.severity ?? num(d) } },
    { name: 'condition_duration', signature: 'condition_duration("Name", default)', returns: 'number', summary: 'Remaining duration (rounds) of a structured Condition in conditions[], or default.', scopes: {
        attacker: (c, [n, d]) => findNamed(c.statuses ?? c.actor?.statuses, n)?.duration ?? num(d) } },
    { name: 'condition_location', signature: 'condition_location("Name")', returns: 'string', summary: 'Hit location a structured Condition in conditions[] is bound to, or "".', scopes: {
        attacker: (c, [n]) => findNamed(c.statuses ?? c.actor?.statuses, n)?.location ?? '' } },
    { name: 'tens', signature: 'tens(n)', returns: 'number', summary: 'The tens digit of n, i.e. floor(n / 10).', scopes: {
        attacker: (c, [n]) => Math.floor(num(n) / 10) } },
    { name: 'is_natural', signature: 'is_natural(n)', returns: 'bool', summary: 'True if the d100 roll equals n exactly.', scopes: {
        attacker: (c, [n]) => (c.test?.roll ?? c.roll) === n } },
    // --- arithmetic helpers (Stage 3 — DH2 p.18: fractions round UP by default) ---
    { name: 'ceil', signature: 'ceil(n)', returns: 'number', summary: 'Round n up to the nearest integer.', scopes: {
        attacker: (c, [n]) => Math.ceil(Number(n) || 0) } },
    { name: 'floor', signature: 'floor(n)', returns: 'number', summary: 'Round n down to the nearest integer.', scopes: {
        attacker: (c, [n]) => Math.floor(Number(n) || 0) } },
    { name: 'half', signature: 'half(n)', returns: 'number', summary: 'Half of n, rounded UP — the DH2 default rounding (p.18), e.g. half(3) = 2.', scopes: {
        attacker: (c, [n]) => Math.ceil((Number(n) || 0) / 2) } },
];

/** Legacy prefixed function names → [scope, base]. */
/** dsl 3: the legacy prefixed function aliases (target_has_trait,
 *  opposing_has_quality) were REMOVED — use the scoped calls. */
export const FUNCTION_ALIASES = {};

// ---------------------------------------------------------------------------
// WRITABLE SLOTS and FLAGS (Stage 3, F1) — the `then` side of the vocabulary.
//
// A slot is a named, registered mutation target: `set <slot> (=|+=) <expr>`.
// A flag is a named boolean state: `flag <name>`. Adding a new engine knob is a
// DATA entry here — no parser or interpreter edits. The legacy verbs
// (`set pen += …`, `prevent_parry`, `detonate`, `fail`, `add_die`, …) parse to
// these same slots/flags (sugar), so v1 content is unchanged.
// ---------------------------------------------------------------------------

/** name → { modes, at, summary, apply(ctx, op, value, meta) }.
 *  `meta.penKey` is the rule-named accumulator slot (e.g. "razor sharp"). */
export const SLOT_DEFS = {
    pen: {
        modes: ['=', '+='], at: 'PENETRATION',
        summary: 'Armour penetration. `+=` accumulates under the rule\'s named modifier slot ("+= pen" doubles it); `=` overwrites the base.',
        apply: (ctx, op, v, meta) => {
            if (op === '+=') {
                const key = meta?.penKey ?? 'penetration';
                ctx.penModifiers[key] = (ctx.penModifiers[key] || 0) + v;
            } else ctx.pen = v;
        },
    },
    rf_threshold: {
        modes: ['='], at: 'DIE_ADJUST',
        summary: 'The natural die value that triggers Righteous Fury (default 10; e.g. Vengeful lowers it).',
        apply: (ctx, op, v) => { ctx.rfThreshold = v; },
    },
    jam_threshold: {
        modes: ['='], at: 'POST_ROLL',
        summary: 'A ranged weapon jams on a roll greater than this (default 96). Reliable/Unreliable & craftsmanship set it.',
        apply: (ctx, op, v) => { ctx.jamThreshold = v; },
    },
    scatter: {
        modes: ['=', '+='], at: 'ON_MISS',
        summary: 'Scatter distance: `=` sets the base and activates scatter; `+=` adds a rule-named distance modifier. Final distance = max(0, base + modifiers).',
        apply: (ctx, op, v, meta) => {
            if (op === '+=') {
                const key = meta?.penKey ?? 'scatter';
                ctx.scatterModifiers[key] = (ctx.scatterModifiers[key] || 0) + v;
            } else ctx.scatter = { active: true, base: v };
        },
    },
    damage_type: {
        modes: ['='], at: 'DAMAGE_POOL, DIE_ADJUST',
        summary: 'Override this hit\'s damage type (e.g. Sanctified → "Holy"); surfaced on the damage result.',
        apply: (ctx, op, v) => { ctx.damageType = v; },
    },
    extra_dice: {
        modes: ['+='], at: 'DAMAGE_POOL',
        summary: 'Extra dice added to the damage pool (same size as the weapon die). `add_die N` is sugar for `set extra_dice += N`.',
        apply: (ctx, op, v) => { ctx.extraDice = (ctx.extraDice || 0) + v; },
    },
    extra_hits: {
        modes: ['+='], at: 'HIT_COUNT_BONUS',
        summary: 'Additional hits. `add_hits N` is sugar for `set extra_hits += N`.',
        apply: (ctx, op, v) => { ctx.additionalHits = (ctx.additionalHits || 0) + v; },
    },
    unnatural_toughness_reduction: {
        modes: ['+='], at: 'PENETRATION',
        summary: 'Reduce the target\'s Unnatural Toughness for this damage calc (Felling; Sanctified vs Daemonic). `reduce_unnatural_toughness N` is sugar.',
        apply: (ctx, op, v) => { ctx.unnaturalToughnessReduction = (ctx.unnaturalToughnessReduction || 0) + v; },
    },
};

/** name → { at, summary, apply(ctx) }. `flag <name>` sets it. */
export const FLAG_DEFS = {
    no_parry: {
        at: 'POST_ROLL',
        summary: 'The attack cannot be Parried (Flexible); the engagement refuses a Parry reaction and notes it. `prevent_parry` is sugar.',
        apply: (ctx) => { ctx.preventParry = true; },
    },
    cannot_parry: {
        at: 'PARRY',
        summary: 'THIS weapon cannot be used to Parry (Unwieldy); resolveParry refuses the reaction. `cannot_parry` (verb) is sugar.',
        apply: (ctx) => { ctx.cannotParry = true; },
    },
    detonate: {
        at: 'ON_MISS',
        summary: 'Resolve the weapon\'s damage at the scatter point even on a miss (Blast). `detonate` (verb) is sugar.',
        apply: (ctx) => { ctx.detonate = true; },
    },
    attack_failed: {
        at: 'POST_ROLL',
        summary: 'Cancel the attack\'s success (a jam). `fail` is sugar.',
        apply: (ctx) => { ctx.success = false; },
    },
    keep_highest: {
        at: 'DAMAGE_POOL',
        summary: 'Keep only the original number of damage dice, highest values (pairs with extra dice — Tearing). `keep_highest` (verb) is sugar.',
        apply: (ctx) => { ctx.keepHighest = ctx.parsed.count; ctx.tearing = true; },
    },
};

/** Doc lists for the reference page. */
export const SLOT_DOCS = Object.entries(SLOT_DEFS).map(([name, s]) => ({
    name, modes: s.modes, at: s.at, summary: s.summary,
}));
export const FLAG_DOCS = Object.entries(FLAG_DEFS).map(([name, f]) => ({
    name, at: f.at, summary: f.summary,
}));

// ---------------------------------------------------------------------------
// Derived tables (consumed by interpreter.mjs and docs.mjs)
// ---------------------------------------------------------------------------

const buildFlat = (defs, aliases) => {
    const flat = {};
    for (const d of defs) if (d.scopes.attacker) flat[d.name] = d.scopes.attacker;
    for (const [alias, [scope, base]] of Object.entries(aliases)) {
        const def = defs.find((x) => x.name === base);
        if (def?.scopes[scope]) flat[alias] = def.scopes[scope];
    }
    return flat;
};
const buildScoped = (defs) => {
    const out = {};
    for (const s of SCOPE_NAMES) out[s] = {};
    for (const d of defs) for (const [s, get] of Object.entries(d.scopes)) out[s][d.name] = get;
    return out;
};

/** Flat (unscoped + alias) tables — the v1-compatible whitelists. */
export const FLAT_FACTS = buildFlat(FACT_DEFS, FACT_ALIASES);
export const FLAT_FUNCTIONS = buildFlat(FUNCTION_DEFS, FUNCTION_ALIASES);
/** scope → name → getter. */
export const SCOPED_FACTS = buildScoped(FACT_DEFS);
export const SCOPED_FUNCTIONS = buildScoped(FUNCTION_DEFS);

/** Doc lists (docs.mjs re-exports these — parity with the whitelists is structural). */
export const FACT_DOCS = [
    ...FACT_DEFS.filter((d) => d.scopes.attacker).map((d) => ({
        name: d.name, type: d.type, summary: d.summary,
        scopes: Object.keys(d.scopes),
    })),
    ...Object.entries(FACT_ALIASES).map(([alias, [scope, base]]) => ({
        name: alias, type: FACT_DEFS.find((d) => d.name === base)?.type ?? 'unknown',
        summary: `Alias of ${scope}.${base} (legacy prefixed name).`,
        scopes: [scope],
    })),
];
export const FUNCTION_DOCS = [
    ...FUNCTION_DEFS.filter((d) => d.scopes.attacker).map((d) => ({
        name: d.name, signature: d.signature, returns: d.returns, summary: d.summary,
        scopes: Object.keys(d.scopes),
    })),
    ...Object.entries(FUNCTION_ALIASES).map(([alias, [scope, base]]) => {
        const def = FUNCTION_DEFS.find((d) => d.name === base);
        return {
            name: alias, signature: def ? def.signature.replace(def.name, alias) : `${alias}(…)`,
            returns: def?.returns ?? 'unknown',
            summary: `Alias of ${scope}.${base}(…) (legacy prefixed name).`,
            scopes: [scope],
        };
    }),
];
/** Scoped-only bases (no unscoped form) — documented under "scopes" in the reference. */
export const SCOPED_ONLY_DOCS = FACT_DEFS.filter((d) => !d.scopes.attacker).map((d) => ({
    name: d.name, type: d.type, summary: d.summary, scopes: Object.keys(d.scopes),
}));
