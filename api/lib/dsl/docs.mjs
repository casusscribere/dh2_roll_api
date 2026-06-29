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
        { name: 'PARRY', group: 'Defensive reaction', summary: 'Modifiers for a Parry (a WS test made to negate an incoming melee attack). Runs in the separate Parry flow (POST /api/parry).', use: 'Balanced (+10), Defensive (+15).' },
    ],

    // Read-only variables usable in `when` predicates and action expressions.
    facts: [
        { name: 'is_melee', type: 'bool', summary: 'The attack is a melee attack.' },
        { name: 'is_ranged', type: 'bool', summary: 'The attack is a ranged attack.' },
        { name: 'pen', type: 'number', summary: 'The hit\'s base armour penetration. Meaningful at PENETRATION.' },
        { name: 'sb', type: 'number', summary: 'Attacker Strength Bonus (tens digit of Strength).' },
        { name: 'tb', type: 'number', summary: 'Toughness Bonus (tens digit of Toughness).' },
        { name: 'bs_bonus', type: 'number', summary: 'Ballistic Skill bonus (tens digit of BS). Used e.g. to reduce Blast scatter.' },
        { name: 'ws_bonus', type: 'number', summary: 'Weapon Skill bonus (tens digit of WS).' },
        { name: 'roll', type: 'number', summary: 'The d100 to-hit roll (1–100). Available from POST_ROLL onward.' },
        { name: 'dos', type: 'number', summary: 'Degrees of Success on the to-hit test (0 on a miss).' },
        { name: 'dof', type: 'number', summary: 'Degrees of Failure on the to-hit test (0 on a hit).' },
        { name: 'success', type: 'bool', summary: 'Whether the to-hit test passed. Available from POST_ROLL onward.' },
        { name: 'action', type: 'string', summary: 'The combat action name, e.g. "Standard Attack", "Called Shot".' },
        { name: 'range', type: 'string', summary: 'The range band, e.g. "Short Range", "Point Blank", "Melee".' },
        { name: 'aim', type: 'number', summary: 'Aim bonus value applied (0 = none, 10 = half, 20 = full).' },
        { name: 'half_aim', type: 'bool', summary: 'Aiming as a Half Action (Aim dropdown = Half, or a "Half Aim" status). The aim bonus is +10.' },
        { name: 'full_aim', type: 'bool', summary: 'Aiming as a Full Action (Aim dropdown = Full, or a "Full Aim" status). The aim bonus is +20.' },
        { name: 'location', type: 'string', summary: 'The current hit location (e.g. "Head"). Meaningful in the per-hit damage stages.' },
        { name: 'damage_type', type: 'string', summary: 'The weapon damage type: Impact, Energy, Explosive, or Rending.' },
        { name: 'hit_index', type: 'number', summary: 'Zero-based index of the current hit in a multi-hit attack.' },
        { name: 'dual_wielding', type: 'bool', summary: 'Wielding and firing two weapons this turn (set via combat.dualWielding).' },
        { name: 'firing_offhand', type: 'bool', summary: 'This attack uses the off-hand weapon (set via combat.firingOffhand).' },
        { name: 'firing_both', type: 'bool', summary: 'Firing both weapons this turn (set via combat.firingBoth).' },
    ],

    functions: [
        { signature: 'has_quality("Name")', returns: 'bool', summary: 'Weapon has the named quality. Prefix match — "Proven (3)" matches has_quality("Proven").' },
        { signature: 'has_talent("Name")', returns: 'bool', summary: 'Character has the named talent (from the attack\'s talents[] list). Prefix match.' },
        { signature: 'has_trait("Name")', returns: 'bool', summary: 'Character/creature has the named DH2.0 trait (from traits[]). Prefix match — "Brutal Charge (3)" matches has_trait("Brutal Charge").' },
        { signature: 'has_status("Name")', returns: 'bool', summary: 'A named status condition is active on the character (from statuses[]), e.g. "On Fire", "Full Aim".' },
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
        { syntax: 'set scatter = <expr>  /  set scatter += <expr>', at: 'ON_MISS', summary: 'Set the base scatter distance (activates scatter) / add a DSL-alterable distance modifier. Final distance = max(0, base + modifiers); the engine rolls the 1d10 direction.' },
        { syntax: 'floor_die <expr>', at: 'DIE_ADJUST', summary: 'Raise any damage die below N up to N (Proven).' },
        { syntax: 'cap_die <expr>', at: 'DIE_ADJUST', summary: 'Cap any damage die above N at N (Primitive).' },
        { syntax: 'emit "name", "text"', at: 'POST_ROLL', summary: 'Attach a named narrative effect (with optional description) to the result.' },
        { syntax: 'fail', at: 'POST_ROLL', summary: 'Cancel the attack\'s success (e.g. a weapon jam).' },
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
