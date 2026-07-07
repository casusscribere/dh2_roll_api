/**
 * DH2 Trait DSL — human-readable reference metadata.
 *
 * Single source of truth for the documentation surfaced on the Rules page
 * (/api/dsl-docs). A parity test (test/dsl-docs.test.mjs) asserts that this
 * file documents EXACTLY the checkpoints, facts and functions the engine
 * actually exposes, so the docs cannot silently drift from the code.
 */

import { FACT_DOCS, FUNCTION_DOCS, SCOPED_ONLY_DOCS, SCOPE_NAMES, SLOT_DOCS, FLAG_DOCS } from './vocabulary.mjs';

export const DSL_DOCS = {
    structure: {
        template:
`dsl 3                             // version pragma (dsl 1/2 text is rejected — tools/migrate-dsl.mjs upgrades it)
package "dh2.core.example" {      // optional, one per file — provenance for every rule in it
  system "dh2"                    // rule system id
  source "Dark Heresy 2e Core Rulebook"
}

<kind> "<name>" [tier N] {
  meta { page <N> [ref "…"] }     // optional — rule provenance (book page / cross-ref)
  on <PIPELINE.>CHECKPOINT        // required — where the rule fires (bare = attack pipeline)
  priority <N>                    // optional — order within a checkpoint (default 0)
  replaces "<pkg>/<rule-id>"      // optional — layered override: drop the named rule
  [when <predicate>] then <action> [; <action> ...]   // one or more branches
  [when <predicate>] then <action> [; <action> ...]
}`,
        kinds: [
            { name: 'quality', note: 'A weapon quality. Usually gated on has_quality("…").' },
            { name: 'talent', note: 'A character talent (bought with XP). Usually gated on has_talent("…").' },
            { name: 'trait', note: 'A DH2.0 trait — innate ability, like a talent but not purchasable with XP. Usually gated on has_trait("…").' },
            { name: 'circumstance', note: 'An environmental/situational modifier (Darkness, Haywire Field). Gated on has_circumstance("…").' },
            { name: 'condition', note: 'An active state on the character (On Fire, Stunned, Aiming). Gated on has_condition("…").' },
            { name: 'configuration', note: 'A per-character toggle for a shot/turn (Maximal, grip). Gated on configuration("…").' },
            { name: 'mechanic', note: 'A base weapon/system mechanic (Jam, craftsmanship tiers).' },
            { name: 'miscellaneous', note: 'A generic/custom rule with no particular source semantics.' },
        ],
        notes: [
            'The kind is a label/grouping; it does not change execution. Gate a rule with the matching function: talent→has_talent, trait→has_trait, condition→has_condition, quality→has_quality. (The v1 kind aliases status/generic/rule were removed in dsl 3.)',
            'Character inputs to an attack: talents[], traits[], statuses[] (and the weapon\'s qualities[]).',
            'priority: lower runs first within a checkpoint. Convention — injectors 0–49, additive bonuses 50–99, cancellers/clamps 100+.',
            'tier N is optional metadata (e.g. talent tier); it does not affect execution.',
            'Comments run from // or # to end of line.',
            'Provenance (Stage 0): a file may open with a `dsl 2` pragma and one `package "name" { system "…" source "…" }` block; rules may carry `meta { page N }`. Compiled effects then expose page/package/system/sourceBook and a stable qualifiedId ("pkg/rule-id").',
            'Pipelines (Phase 3): `on` takes `pipeline.CHECKPOINT`. A bare checkpoint is the default `attack` pipeline; the generic-test pipeline is `test.MODIFIERS` / `test.POST_ROLL` (behind /api/test — gate on test_name).',
            'Layered overrides (Phase 3): `replaces "<package>/<rule-id>"` drops the named rule\'s effects entirely when this rule\'s layer (custom rules) is active — the static, id-based successor to the runtime `suppress` (which remains for same-layer overrides like Overheats→Jam).',
            'Levelled entries (Stage 1): qualities/talents/traits are canonically { name, level } objects internally; strings like "Proven (3)" or "Vengeful 9" are accepted at the API boundary and parsed once. Both forms work everywhere (has_quality, quality_level, bump_quality, …).',
            'A rule may have several "when … then …" branches; each is evaluated independently (compiles to its own effect, in order). A branch with no "when" is unconditional. Use this for stepped effects — e.g. Accurate adds one die at DoS≥3 and a second only at DoS≥5.',
            'Within a branch, several actions may be separated by ";". Multiple rules may share a file/snippet.',
        ],
    },

    // Ordered by the sequence in which they fire during an attack.
    checkpoints: [
        { name: 'MODIFIERS', group: 'To-hit test', summary: 'Accumulate to-hit modifiers before the d100 is rolled. Modifiers are summed and capped at ±60.', use: 'Attack bonuses/penalties (talents, off-hand, custom buffs).' },
        { name: 'POST_ROLL', group: 'To-hit test', summary: 'Immediately after the d100, once roll / success / DoS / DoF are known, before hits are counted.', use: 'Jams, overheats; emit narrative effects or fail (cancel) the attack.' },
        { name: 'ON_MISS', group: 'To-hit test', summary: 'After a missed attack. A rule sets a base scatter distance (set scatter = …) and may alter it (set scatter += …); the engine rolls the 1d10 direction.', use: 'Blast (X) scatter on a miss (p.230).' },
        { name: 'HIT_COUNT_MULT', group: 'Hit count', summary: 'Multiply the number of extra hits — runs BEFORE the weapon Rate-of-Fire cap.', use: 'Storm (doubles extra hits).' },
        { name: 'HIT_COUNT_BONUS', group: 'Hit count', summary: 'Add flat extra hits — runs AFTER the Rate-of-Fire cap.', use: 'Twin-Linked (+1 hit at DoS ≥ 2).' },
        { name: 'PENETRATION', group: 'Per hit', summary: 'Adjust the hit\'s armour penetration, before damage is rolled.', use: 'Razor Sharp / Melta (double penetration).' },
        { name: 'DAMAGE_POOL', group: 'Per hit', summary: 'Shape the damage dice pool before it is rolled (extra dice, keep-highest).', use: 'Tearing (extra die, keep highest).' },
        { name: 'DIE_ADJUST', group: 'Per hit', summary: 'After dice are rolled: per-die transforms and the Righteous Fury threshold.', use: 'Proven (floor_die), Primitive (cap_die), Vengeful (rf_threshold).' },
        { name: 'DAMAGE_MODS', group: 'Per hit', summary: 'Add flat or bonus-dice modifiers to the damage total.', use: 'Accurate (+1d10 by DoS), flat blessings.' },
        { name: 'ON_HIT', group: 'Per hit', summary: 'After a hit\'s damage and soak. Declare target tests (require_test) or statuses (apply_status); auto-resolved when the toggle is on and target stats are supplied.', use: 'Concussive (Toughness test → Stunned/Prone), Crippling (Crippled).' },
        { name: 'PARRY', group: 'Defensive reaction', summary: 'Modifiers for a Parry (a WS test made to negate an incoming melee attack). Runs in the Parry flow and in Engagement (parry evasion).', use: 'Balanced (+10), Defensive (+15), Unbalanced (−10), Unwieldy (cannot_parry).' },
        { name: 'POST_PARRY', group: 'Defensive reaction', summary: 'After the Parry test, once its success is known. The opposing (attacking) weapon\'s qualities are readable via opposing_has_quality().', use: 'Power Field (roll to destroy the attacker\'s weapon on a successful parry).' },
        { name: 'EVASION', group: 'Defensive reaction', summary: 'Modifiers for a Dodge (Agility) evasion test in an Engagement (POST /api/resolve).', use: 'Dodge bonuses from defender talents/conditions.' },
        { name: 'test.MODIFIERS', group: 'Generic test pipeline', summary: 'Accumulate modifiers before a GENERIC characteristic/skill test (the test.* pipeline behind /api/test). Gate on test_name, talents, conditions, circumstances.', use: 'Test-affecting talents (e.g. Resistance), condition penalties on any test.' },
        { name: 'test.POST_ROLL', group: 'Generic test pipeline', summary: 'After a generic test resolves (roll/success/DoS known). May emit narrative effects or fail the result.', use: 'Narrative riders on generic tests.' },
        { name: 'upkeep.TURN_START', group: 'Upkeep pipeline', summary: 'Start of an actor\'s turn, run against the EncounterState (Phase 4). Rules read the actor\'s active conditions and declare damage/tests; the engine owns duration/decay/cooldown mechanics.', use: 'On Fire (declare damage 1d10 per round).' },
        { name: 'upkeep.TURN_END', group: 'Upkeep pipeline', summary: 'End of an actor\'s turn. The Recharge cooldown clears here (mechanism).', use: 'Toxified (Toughness test → 1d10 damage on failure).' },
        { name: 'upkeep.ROUND_END', group: 'Upkeep pipeline', summary: 'End of the round. Durations tick down and expire; severities with `decay` reduce (Haywire Field) — engine mechanism.', use: 'Round-scale condition riders.' },
    ],

    // Read-only variables usable in `when` predicates and action expressions.
    // DERIVED from vocabulary.mjs (Stage 2 — single source): the unscoped facts
    // plus legacy scoped aliases. Each entry lists the scopes it is available in.
    facts: FACT_DOCS,
    // Scoped-only bases (no unscoped form): reach them via <scope>.<name>.
    scopes: {
        names: SCOPE_NAMES,
        summary: 'A fact/function may be read through a scope path — target.tb, weapon.pen, opposing_weapon.has_quality("Force"). The unscoped name is the attacker scope. Legacy prefixed names (target_sb, opposing_has_quality, …) remain as aliases.',
        scopedOnly: SCOPED_ONLY_DOCS,
    },

    // DERIVED from vocabulary.mjs (Stage 2 — single source), incl. legacy aliases.
    functions: FUNCTION_DOCS,

    // Registered mutation targets (Stage 3): `set <slot> (=|+=) <expr>` and
    // `flag <name>` — the primitives every set-verb/flag-verb is sugar for.
    // DERIVED from vocabulary.mjs.
    slots: SLOT_DOCS,
    flags: FLAG_DOCS,

    actions: [
        { syntax: 'set <slot> (= | +=) <expr>', at: 'per slot', summary: 'THE generic mutation (Stage 3): write a registered slot — see the slots table. The specific set-verbs below (set pen, add_die, reduce_unnatural_toughness, …) are sugar for this.' },
        { syntax: 'flag <name>', at: 'per flag', summary: 'THE generic boolean state (Stage 3): raise a registered flag — see the flags table. prevent_parry/cannot_parry/detonate/fail/keep_highest are sugar for this.' },
        { syntax: 'declare test|status|table_roll|armour_damage|damage|event …', at: 'ON_HIT, POST_ROLL, upkeep.*, …', summary: 'THE generic declaration namespace (Stage 3): alternative surface syntax for require_test / apply_status / roll_on / corrode / emit — plus `declare damage <expr> [, "reason"]` (Phase 4): direct damage against the actor, used by upkeep ticks (On Fire\'s 1d10/round).' },
        { syntax: 'require_test … => damage <expr>', at: 'ON_HIT, upkeep.*', summary: 'On-fail damage follow-up (Phase 4): the expression (e.g. 1d10) rolls ONLY when the test fails — Toxified\'s end-of-turn Toughness test.' },
        { syntax: 'require_test "Char" <expr> "text" avoids_hit', at: 'ON_HIT', summary: 'INVERTED stakes (Phase 5): a PASSED test negates the hit entirely (wounds voided) — Spray\'s Challenging (+0) Agility test.' },
        { syntax: 'declare smoke <radius> [duration <expr>]', at: 'ON_HIT, ON_MISS', summary: 'A smokescreen at the impact/scatter point (Smoke (X), p.149): radius in metres, duration in rounds (1d10+10). On a miss it lands at the scatter point without damage unless the weapon also detonates (Blast).' },
        { syntax: 'declare scatter_hit <distance-expr>', at: 'ON_HIT', summary: 'This HIT scatters (Indirect (X), p.147): the engine rolls the Scatter Diagram direction and attaches {direction, distance} to the hit (distance clamped at 0, e.g. 1d10 − bs_bonus).' },
        { syntax: 'add modifier "key" = <expr>', at: 'MODIFIERS, DAMAGE_MODS', summary: 'Add a named modifier (to-hit or damage) with the given value.' },
        { syntax: 'set modifier "key" = <expr>', at: 'MODIFIERS, DAMAGE_MODS', summary: 'Set/overwrite a named modifier\'s value.' },
        { syntax: 'cancel modifier "key"', at: 'MODIFIERS, DAMAGE_MODS', summary: 'Remove a named modifier entirely.' },
        { syntax: 'multiply_hits <expr>', at: 'HIT_COUNT_MULT', summary: 'Multiply the number of extra hits by N.' },
        { syntax: 'set pen += <expr>  /  set pen = <expr>', at: 'PENETRATION', summary: 'Increase (or set) the hit\'s armour penetration. "+= pen" doubles it.' },
        { syntax: 'set rf_threshold = <expr>', at: 'DIE_ADJUST', summary: 'Set the natural die value that triggers Righteous Fury (default 10; e.g. Vengeful lowers it).' },
        { syntax: 'set jam_threshold = <expr>', at: 'POST_ROLL', summary: 'Set the ranged jam threshold (jams on roll > threshold; default 96). Reliable/Unreliable & craftsmanship use this.' },
        { syntax: 'set damage_type = <expr>', at: 'DAMAGE_POOL, DIE_ADJUST', summary: 'Override this hit\'s damage type (e.g. Sanctified → "Holy", Force → "Energy"); surfaced on the damage result. Set it before damage is rolled.' },
        { syntax: 'set scatter = <expr>  /  set scatter += <expr>', at: 'ON_MISS', summary: 'Set the base scatter distance (activates scatter) / add a DSL-alterable distance modifier. Final distance = max(0, base + modifiers); the engine rolls the 1d10 direction.' },
        { syntax: 'floor_die <expr>', at: 'DIE_ADJUST', summary: 'Raise any damage die below N up to N (Proven).' },
        { syntax: 'cap_die <expr>', at: 'DIE_ADJUST', summary: 'Cap any damage die above N at N (Primitive).' },
        { syntax: 'emit "name", "text"', at: 'POST_ROLL', summary: 'Attach a named narrative effect (with optional description) to the result.' },
        { syntax: 'suppress "Rule Name"', at: 'any', summary: 'Skip another rule by name for the rest of this checkpoint run (must run at lower priority than the target). E.g. Overheats suppresses the baseline Jam mechanic.' },
        { syntax: 'require_test "Characteristic" <expr> "on-fail" [=> roll_on "Table" | => apply_status "Cond" [value/duration/location <expr>]]', at: 'ON_HIT', summary: 'Declare a test the target must pass (modifier = expr) or suffer the on-fail consequence. Auto-rolled when enabled. The optional => follow-up on a FAILED test rolls a roll_table (Hallucinogenic) or applies a Condition with optional structured vars (Flame → On Fire duration "until extinguished").' },
        { syntax: 'roll_on "Table Name" [+ <expr>] [area <expr>]', at: 'ON_HIT, ON_MISS', summary: 'Roll on a roll_table (defined with the roll_table block); the engine rolls its die (+ optional modifier), records the matching row, and applies any statuses it carries. Optional `area` surfaces a radius with the result (Haywire field area). Used by Haywire and by Blast (Scatter Diagram).' },
        { syntax: 'apply_status "name" [value <expr>] [duration <expr>] [location <expr>] [, "reason"]', at: 'ON_HIT', summary: 'Apply a Condition to the target (e.g. Prone, Crippled) with optional structured variables — severity value (e.g. Crippling(X) → value X), duration in rounds, and hit location — plus an optional reason shown in the report.' },
        { syntax: 'corrode <expr>', at: 'ON_HIT', summary: 'Corrosive: reduce the struck location\'s Armour Points by <expr> (cumulative across hits); any overflow beyond current AP — or all of it if unarmoured — is dealt to the target as wounds, ignoring Toughness.' },
        { syntax: 'bump_quality "Name" by <expr>', at: 'DAMAGE_POOL, PENETRATION', summary: 'Increase an existing weapon quality\'s rating in place, e.g. Maximal raising Blast (3) → Blast (5). No-op if the weapon lacks the quality.' },
        { syntax: 'add_quality "Name"', at: 'any', summary: 'Grant the weapon a quality this shot (e.g. Maximal granting Recharge), so has_quality("Name") becomes true for later checkpoints. No-op if already present.' },
    ],

    expressions: [
        'Numbers: 10, 0, etc. Negatives via unary minus: -20.',
        'Dice literals: 1d10, 2d6 — rolled when the action runs, using the engine RNG.',
        'Arithmetic: + - * / with parentheses, e.g. (sb * 2) + 1.',
        'Facts and functions may appear in expressions, e.g. quality_level("Proven", 2).',
        'Strings use double or single quotes; booleans are true / false.',
    ],

    operators: {
        logical: ['and', 'or', 'not'],
        comparison: ['==', '!=', '>', '<', '>=', '<='],
        arithmetic: ['+', '-', '*', '/'],
        grouping: ['( )'],
    },
};

/** Convenience name lists used by the parity test. */
export const DOCUMENTED_CHECKPOINTS = DSL_DOCS.checkpoints.map((c) => c.name);
export const DOCUMENTED_FACTS = DSL_DOCS.facts.map((f) => f.name);
export const DOCUMENTED_FUNCTIONS = DSL_DOCS.functions.map((f) => f.signature.split('(')[0]);
