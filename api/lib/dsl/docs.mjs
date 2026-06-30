/**
 * DH2 Trait DSL — human-readable reference metadata.
 *
 * Single source of truth for the documentation surfaced on the Rules page
 * (/api/dsl-docs). A parity test (test/dsl-docs.test.mjs) asserts that this
 * file documents EXACTLY the checkpoints, facts and functions the engine
 * actually exposes, so the docs cannot silently drift from the code.
 */

export const DSL_DOCS = {
    structure: {
        template:
`<kind> "<name>" [tier N] {
  on <CHECKPOINT>                 // required — where the rule fires
  priority <N>                    // optional — order within a checkpoint (default 0)
  [when <predicate>] then <action> [; <action> ...]   // one or more branches
  [when <predicate>] then <action> [; <action> ...]
}`,
        kinds: [
            { name: 'talent', note: 'A character talent (bought with XP). Usually gated on has_talent("…").' },
            { name: 'trait', note: 'A DH2.0 trait — innate ability, like a talent but not purchasable with XP. Usually gated on has_trait("…").' },
            { name: 'condition', note: 'A situational rule that is not a purchasable talent (e.g. the off-hand penalty).' },
            { name: 'quality', note: 'A weapon quality. Usually gated on has_quality("…").' },
            { name: 'status', note: 'An active status condition on the character (e.g. On Fire, Full Aim). Gated on has_status("…").' },
            { name: 'generic', note: 'A generic/custom rule with no particular source semantics. ("rule" is an accepted alias.)' },
        ],
        notes: [
            'The kind is a label/grouping; it does not change execution. Gate a rule with the matching function: talent→has_talent, trait→has_trait, status→has_status, quality→has_quality.',
            'Character inputs to an attack: talents[], traits[], statuses[] (and the weapon\'s qualities[]).',
            'priority: lower runs first within a checkpoint. Convention — injectors 0–49, additive bonuses 50–99, cancellers/clamps 100+.',
            'tier N is optional metadata (e.g. talent tier); it does not affect execution.',
            'Comments run from // or # to end of line.',
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
    ],

    // Read-only variables usable in `when` predicates and action expressions.
    facts: [
        { name: 'is_melee', type: 'bool', summary: 'The attack is a melee attack.' },
        { name: 'is_ranged', type: 'bool', summary: 'The attack is a ranged attack.' },
        { name: 'pen', type: 'number', summary: 'The hit\'s base armour penetration. Meaningful at PENETRATION.' },
        { name: 'sb', type: 'number', summary: 'Attacker Strength Bonus (tens digit of Strength).' },
        { name: 'tb', type: 'number', summary: 'Toughness Bonus (tens digit of Toughness).' },
        { name: 'bs_bonus', type: 'number', summary: 'Ballistic Skill bonus (tens digit of BS).' },
        { name: 'ws_bonus', type: 'number', summary: 'Weapon Skill bonus (tens digit of WS).' },
        { name: 'jam_threshold', type: 'number', summary: 'A ranged weapon jams on a roll greater than this (default 96 → jams on 97+). Adjusted by Reliable/Unreliable and craftsmanship; 100 = never jams.' },
        { name: 'craftsmanship', type: 'string', summary: 'The weapon\'s craftsmanship: "Poor", "Common", "Good", or "Best".' },
        { name: 'damage_dealt', type: 'number', summary: 'This hit\'s total damage (before soak). Meaningful at ON_HIT.' },
        { name: 'wounds', type: 'number', summary: 'Wounds this hit inflicted after soak. Meaningful at ON_HIT.' },
        { name: 'target_sb', type: 'number', summary: 'The target\'s Strength Bonus (from the optional target block).' },
        { name: 'target_tb', type: 'number', summary: 'The target\'s Toughness Bonus (from the optional target block).' },
        { name: 'target_armour', type: 'number', summary: 'The struck location\'s current Armour Points (base AP minus any already corroded this attack; 0 if unarmoured). Read at ON_HIT.' },
        { name: 'target_unnatural_toughness', type: 'number', summary: 'The target\'s Unnatural Toughness bonus (added to TB when soaking; Felling reduces it). 0 if none.' },
        { name: 'roll', type: 'number', summary: 'The d100 to-hit roll (1–100). Available from POST_ROLL onward.' },
        { name: 'dos', type: 'number', summary: 'Degrees of Success on the to-hit test (0 on a miss).' },
        { name: 'dof', type: 'number', summary: 'Degrees of Failure on the to-hit test (0 on a hit).' },
        { name: 'success', type: 'bool', summary: 'Whether the to-hit test passed. Available from POST_ROLL onward.' },
        { name: 'action', type: 'string', summary: 'The current action name, e.g. "Standard Attack", "Called Shot", "Parry", "Dodge" — set in every flow including reactions.' },
        { name: 'action_type', type: 'string', summary: 'The current action\'s type: "Half" | "Full" | "Reaction" | "Free" (from the Actions taxonomy), or "" if unknown.' },
        { name: 'is_attack', type: 'bool', summary: 'The current action carries the "attack" subtype (the key designation, e.g. Standard Attack, Charge). Used by Defensive (-10 to attacks) and many others.' },
        { name: 'range', type: 'string', summary: 'The range band, e.g. "Short Range", "Point Blank", "Melee".' },
        { name: 'aim', type: 'number', summary: 'Aim bonus value applied (0 = none, 10 = half, 20 = full).' },
        { name: 'half_aim', type: 'bool', summary: 'Aiming as a Half Action (Aim dropdown = Half, or a "Half Aim" status). The aim bonus is +10.' },
        { name: 'full_aim', type: 'bool', summary: 'Aiming as a Full Action (Aim dropdown = Full, or a "Full Aim" status). The aim bonus is +20.' },
        { name: 'location', type: 'string', summary: 'The current hit location (e.g. "Head"). Meaningful in the per-hit damage stages.' },
        { name: 'damage_type', type: 'string', summary: 'The weapon damage type: Impact, Energy, Explosive, or Rending.' },
        { name: 'hit_index', type: 'number', summary: 'Zero-based index of the current hit in a multi-hit attack.' },
        { name: 'opposing_present', type: 'bool', summary: 'In a Parry, an opposing (attacking) weapon was supplied (the engagement provides it). Used by Power Field to avoid firing on a bare /api/parry test.' },
        { name: 'dual_wielding', type: 'bool', summary: 'Wielding and firing two weapons this turn (set via combat.dualWielding).' },
        { name: 'firing_offhand', type: 'bool', summary: 'This attack uses the off-hand weapon (set via combat.firingOffhand).' },
        { name: 'firing_both', type: 'bool', summary: 'Firing both weapons this turn (set via combat.firingBoth).' },
    ],

    functions: [
        { signature: 'has_quality("Name")', returns: 'bool', summary: 'Weapon has the named quality. Prefix match — "Proven (3)" matches has_quality("Proven").' },
        { signature: 'has_talent("Name")', returns: 'bool', summary: 'Character has the named talent (from the attack\'s talents[] list). Prefix match.' },
        { signature: 'has_trait("Name")', returns: 'bool', summary: 'Character/creature has the named DH2.0 trait (from traits[]). Prefix match — "Brutal Charge (3)" matches has_trait("Brutal Charge").' },
        { signature: 'target_has_trait("Name")', returns: 'bool', summary: 'The TARGET/defender has the named trait (from the target block\'s traits[]), e.g. target_has_trait("Daemonic"). Used by Sanctified (Holy damage negates a Daemonic target\'s Unnatural Toughness).' },
        { signature: 'opposing_has_quality("Name")', returns: 'bool', summary: 'In a Parry (POST_PARRY), the OPPOSING attacking weapon being parried has the named quality. Used by Power Field (immune if the attacker\'s weapon is Force/Warp/etc.).' },
        { signature: 'has_status("Name")', returns: 'bool', summary: 'Alias of has_condition() (back-compat). A named Condition is active on the character.' },
        { signature: 'has_condition("Name")', returns: 'bool', summary: 'A named Condition is active on the character (from conditions[] / statuses[]), e.g. "On Fire", "Full Aim", "Stunned".' },
        { signature: 'has_circumstance("Name")', returns: 'bool', summary: 'A named environmental Circumstance is in effect (from circumstances[]).' },
        { signature: 'circumstance_severity("Name", default)', returns: 'number', summary: 'Severity of a structured Circumstance in circumstances[] (e.g. the Haywire Field strength 1–5), or default.' },
        { signature: 'configuration("Name")', returns: 'bool', summary: 'A per-character Configuration toggle is on (from configs[] / firingModes[]), e.g. configuration("Maximal").' },
        { signature: 'is_action("Name")', returns: 'bool', summary: 'The current action is the named one (case-insensitive), e.g. is_action("Parry"). Works in every flow including reactions.' },
        { signature: 'is_reaction()', returns: 'bool', summary: 'The current action is a Reaction (Parry, Dodge, …).' },
        { signature: 'action_subtype("Name")', returns: 'bool', summary: 'The current action carries the named subtype (declared via `subtype`/`attack` on the action). `is_attack` is shorthand for action_subtype("attack").' },
        { signature: 'firing_mode("Name")', returns: 'bool', summary: 'Alias of configuration() — reads the same toggle list (configs[] / firingModes[]), e.g. firing_mode("Maximal").' },
        { signature: 'condition_severity("Name", default)', returns: 'number', summary: 'Severity of a structured Condition in conditions[] (e.g. Crippled severity), or default.' },
        { signature: 'condition_duration("Name", default)', returns: 'number', summary: 'Remaining duration (rounds) of a structured Condition in conditions[], or default.' },
        { signature: 'condition_location("Name")', returns: 'string', summary: 'Hit location a structured Condition in conditions[] is bound to, or "".' },
        { signature: 'quality_level("Name", default)', returns: 'number', summary: 'Numeric level parsed from a quality like "Proven (3)" → 3; returns default if absent/unnumbered.' },
        { signature: 'trait_level("Name", default)', returns: 'number', summary: 'Numeric level parsed from a trait like "Brutal Charge (3)" → 3; returns default if absent/unnumbered.' },
        { signature: 'tens(n)', returns: 'number', summary: 'The tens digit of n, i.e. floor(n / 10).' },
        { signature: 'is_natural(n)', returns: 'bool', summary: 'True if the d100 roll equals n exactly.' },
    ],

    actions: [
        { syntax: 'add modifier "key" = <expr>', at: 'MODIFIERS, DAMAGE_MODS', summary: 'Add a named modifier (to-hit or damage) with the given value.' },
        { syntax: 'set modifier "key" = <expr>', at: 'MODIFIERS, DAMAGE_MODS', summary: 'Set/overwrite a named modifier\'s value.' },
        { syntax: 'cancel modifier "key"', at: 'MODIFIERS, DAMAGE_MODS', summary: 'Remove a named modifier entirely.' },
        { syntax: 'add_die <expr>', at: 'DAMAGE_POOL', summary: 'Add N extra dice (same size as the weapon die) to the damage pool.' },
        { syntax: 'keep_highest', at: 'DAMAGE_POOL', summary: 'Keep only the original number of dice, highest values (pairs with add_die for Tearing).' },
        { syntax: 'add_hits <expr>', at: 'HIT_COUNT_BONUS', summary: 'Add N extra hits.' },
        { syntax: 'multiply_hits <expr>', at: 'HIT_COUNT_MULT', summary: 'Multiply the number of extra hits by N.' },
        { syntax: 'set pen += <expr>  /  set pen = <expr>', at: 'PENETRATION', summary: 'Increase (or set) the hit\'s armour penetration. "+= pen" doubles it.' },
        { syntax: 'set rf_threshold = <expr>', at: 'DIE_ADJUST', summary: 'Set the natural die value that triggers Righteous Fury (default 10; e.g. Vengeful lowers it).' },
        { syntax: 'set jam_threshold = <expr>', at: 'POST_ROLL', summary: 'Set the ranged jam threshold (jams on roll > threshold; default 96). Reliable/Unreliable & craftsmanship use this.' },
        { syntax: 'set damage_type = <expr>', at: 'DAMAGE_POOL, DIE_ADJUST', summary: 'Override this hit\'s damage type (e.g. Sanctified → "Holy", Force → "Energy"); surfaced on the damage result. Set it before damage is rolled.' },
        { syntax: 'set scatter = <expr>  /  set scatter += <expr>', at: 'ON_MISS', summary: 'Set the base scatter distance (activates scatter) / add a DSL-alterable distance modifier. Final distance = max(0, base + modifiers); the engine rolls the 1d10 direction.' },
        { syntax: 'floor_die <expr>', at: 'DIE_ADJUST', summary: 'Raise any damage die below N up to N (Proven).' },
        { syntax: 'cap_die <expr>', at: 'DIE_ADJUST', summary: 'Cap any damage die above N at N (Primitive).' },
        { syntax: 'emit "name", "text"', at: 'POST_ROLL', summary: 'Attach a named narrative effect (with optional description) to the result.' },
        { syntax: 'fail', at: 'POST_ROLL', summary: 'Cancel the attack\'s success (e.g. a weapon jam).' },
        { syntax: 'suppress "Rule Name"', at: 'any', summary: 'Skip another rule by name for the rest of this checkpoint run (must run at lower priority than the target). E.g. Overheats suppresses the baseline Jam mechanic.' },
        { syntax: 'prevent_parry', at: 'POST_ROLL', summary: 'Mark the attack as un-Parryable (e.g. Flexible); the engagement refuses a Parry reaction against it and notes it.' },
        { syntax: 'cannot_parry', at: 'PARRY', summary: 'Mark THIS weapon as unable to Parry (e.g. Unwieldy); resolveParry refuses the reaction and notes it (no roll).' },
        { syntax: 'detonate', at: 'ON_MISS', summary: 'Resolve the weapon\'s damage at the scatter point even on a miss (e.g. Blast) — the engine rolls a damage roll for the scattered shot. Pair with `set scatter`.' },
        { syntax: 'require_test "Characteristic" <expr> "on-fail" [=> roll_on "Table" | => apply_status "Cond" [value/duration/location <expr>]]', at: 'ON_HIT', summary: 'Declare a test the target must pass (modifier = expr) or suffer the on-fail consequence. Auto-rolled when enabled. The optional => follow-up on a FAILED test rolls a roll_table (Hallucinogenic) or applies a Condition with optional structured vars (Flame → On Fire duration "until extinguished").' },
        { syntax: 'roll_on "Table Name" [+ <expr>] [area <expr>]', at: 'ON_HIT, ON_MISS', summary: 'Roll on a roll_table (defined with the roll_table block); the engine rolls its die (+ optional modifier), records the matching row, and applies any statuses it carries. Optional `area` surfaces a radius with the result (Haywire field area). Used by Haywire and by Blast (Scatter Diagram).' },
        { syntax: 'apply_status "name" [value <expr>] [duration <expr>] [location <expr>] [, "reason"]', at: 'ON_HIT', summary: 'Apply a Condition to the target (e.g. Prone, Crippled) with optional structured variables — severity value (e.g. Crippling(X) → value X), duration in rounds, and hit location — plus an optional reason shown in the report.' },
        { syntax: 'corrode <expr>', at: 'ON_HIT', summary: 'Corrosive: reduce the struck location\'s Armour Points by <expr> (cumulative across hits); any overflow beyond current AP — or all of it if unarmoured — is dealt to the target as wounds, ignoring Toughness.' },
        { syntax: 'bump_quality "Name" by <expr>', at: 'DAMAGE_POOL, PENETRATION', summary: 'Increase an existing weapon quality\'s rating in place, e.g. Maximal raising Blast (3) → Blast (5). No-op if the weapon lacks the quality.' },
        { syntax: 'add_quality "Name"', at: 'any', summary: 'Grant the weapon a quality this shot (e.g. Maximal granting Recharge), so has_quality("Name") becomes true for later checkpoints. No-op if already present.' },
        { syntax: 'reduce_unnatural_toughness <expr>', at: 'PENETRATION', summary: 'Felling: reduce the target\'s Unnatural Toughness bonus by N for this damage calc (only the Unnatural part, never base TB).' },
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
