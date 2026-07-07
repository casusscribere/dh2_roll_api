dsl 3
package "dh2.core.talents" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# DH2 TALENTS (XP-bought abilities) that gate on combat state — authored in the DSL.
# This file holds talents ONLY (kind `talent`, gated on has_talent(...)); innate
# DH2.0 traits live separately in traits.dsl (kind `trait`, has_trait(...)). The two
# are distinct categories in the rule taxonomy and the UI.
#
# Talent rules are always present in the registry but only fire when the
# character actually HAS the talent (has_talent(...)) AND the situation is
# right (the activation predicate). This is the activation/effect split that
# lets e.g. Ambidextrous check "am I dual-wielding?" before touching a penalty.
#
# Priorities: penalty injectors at 10, cancellers/reducers at 100 (so they run
# after the penalties they modify are in place).

# (The base off-hand -20 circumstance moved to circumstances.dsl.)

# --- Two-Weapon Wielder ------------------------------------------------------
# Lets a character attack with two weapons; each attack suffers -20.
talent "Two-Weapon Wielder" {
  on MODIFIERS
  priority 10
  when has_talent("Two-Weapon Wielder") and dual_wielding
  then add modifier "two_weapon" = -20
}

# --- Ambidextrous (tier 1) ---------------------------------------------------
# Two branches, each with its own activation:
#  - firing a single off-hand weapon: negate the off-hand penalty;
#  - combined with Two-Weapon Wielder while dual-wielding: reduce the
#    two-weapon penalty -20 -> -10.
talent "Ambidextrous" tier 1 {
  on MODIFIERS
  priority 100
  when has_talent("Ambidextrous") and firing_offhand and not dual_wielding
    then cancel modifier "off_hand"
  when has_talent("Ambidextrous") and has_talent("Two-Weapon Wielder") and dual_wielding
    then set modifier "two_weapon" = -10
}

# --- Two-Weapon Master (tier 3, DH2 core p.132) --------------------------------
# "When armed with two single-handed weapons … he ignores the –20 penalty for
# Two-Weapon Fighting." Priority 110: after Two-Weapon Wielder injects the -20
# (10) and after Ambidextrous halves it (100), the master removes what is left.
talent "Two-Weapon Master" tier 3 {
  meta { page 132 }
  on MODIFIERS
  priority 110
  when has_talent("Two-Weapon Master") and dual_wielding
  then cancel modifier "two_weapon"
}

# --- Marksman (tier 2, DH2 core p.130) ------------------------------------------
# "…suffers no penalties for making Ballistic Skill tests at Long or Extreme
# range." The engine injects the band penalty as the "range" modifier
# (combat-actions.mjs RANGE_BANDS: Long -10, Extreme -30); Marksman cancels it.
# Bonuses (Point Blank/Short) are untouched — only the PENALTY bands gate here.
talent "Marksman" tier 2 {
  meta { page 130 }
  on MODIFIERS
  priority 100
  when has_talent("Marksman") and is_ranged and (range == "Long Range" or range == "Extreme Range")
  then cancel modifier "range"
}

# --- Precision Killer (tier 2, DH2 core p.130) -----------------------------------
# "When making a Called Shot … he does not suffer the usual –20 penalty." The
# Called Shot action's -20 IS the action modifier ("attack"), so cancelling it
# yields the RAW net 0. Specialised entries ("Precision Killer (Ranged)"/
# "(Melee)") gate on the matching attack type; a bare "Precision Killer" entry
# (specialisation not recorded) applies to both.
talent "Precision Killer" tier 2 {
  meta { page 130 }
  on MODIFIERS
  priority 100
  when has_talent("Precision Killer (Ranged)") and is_ranged and action == "Called Shot"
    then cancel modifier "attack"
  when has_talent("Precision Killer (Melee)") and is_melee and action == "Called Shot"
    then cancel modifier "attack"
  when has_talent("Precision Killer") and not has_talent("Precision Killer (") and action == "Called Shot"
    then cancel modifier "attack"
}

# --- Mighty Shot (tier 3, DH2 core p.130) ----------------------------------------
# "He adds half his Ballistic Skill bonus (rounded up) to damage he inflicts
# with ranged weapons." half() rounds up (DH2 p.18 default).
talent "Mighty Shot" tier 3 {
  meta { page 130 }
  on DAMAGE_MODS
  when has_talent("Mighty Shot") and is_ranged
  then add modifier "mighty shot" = half(bs_bonus)
}

# --- Crushing Blow (tier 3, DH2 core p.125) --------------------------------------
# "He adds half his Weapon Skill bonus (rounding up) to damage he inflicts with
# melee attacks."
talent "Crushing Blow" tier 3 {
  meta { page 125 }
  on DAMAGE_MODS
  when has_talent("Crushing Blow") and is_melee
  then add modifier "crushing blow" = half(ws_bonus)
}

# --- Hatred (DH2 core p.128) ------------------------------------------------------
# "When fighting opponents of that group in close combat, the Acolyte gains a
# +10 bonus to all Weapon Skill tests made against them", plus a Willpower test
# to retreat/surrender. The hated group is parametric (Hatred (Mutants), …) and
# the engine cannot know who the current foe is — flag the engagement with the
# "Hated Foe" circumstance when the target belongs to the hated group.
talent "Hatred" {
  meta { page 128 }
  on MODIFIERS
  when has_talent("Hatred") and is_melee and has_circumstance("Hated Foe")
    then add modifier "hatred" = 10
  when has_talent("Hatred") and is_melee and has_circumstance("Hated Foe")
    then emit "Hatred", "must pass a Challenging (+0) Willpower test to retreat or surrender against the hated foe"
}

# --- Iron Jaw (tier 1, DH2 core p.128) --------------------------------------------
# "Whenever this character becomes Stunned, he may make a Challenging (+0)
# Toughness test as a Free Action to ignore the effects." Modelled as upkeep
# policy: at the start of his turn a Stunned character with the talent rolls
# the test (against the encounter-stored Toughness); a pass means the GM clears
# the condition.
talent "Iron Jaw" tier 1 {
  meta { page 128 }
  on upkeep.TURN_START
  when has_talent("Iron Jaw") and has_condition("Stunned")
  then require_test "Toughness" 0 "remains Stunned (Iron Jaw: a pass shakes off the condition — Free Action)"
}

# --- Die Hard (tier 1, DH2 core p.125) --------------------------------------------
# "When this character would suffer a level of Fatigue due to the Blood Loss
# condition, he makes a Challenging (+0) Willpower test; if he succeeds, he does
# not suffer a level of Fatigue." Runtime override of the base Blood Loss upkeep
# rule (conditions.dsl): suppress the automatic Fatigue note and roll the
# Willpower test instead (priority 10, before Blood Loss at 50).
talent "Die Hard" tier 1 {
  meta { page 125 }
  on upkeep.TURN_START
  priority 10
  when has_talent("Die Hard") and has_condition("Blood Loss")
    then suppress "Blood Loss"
  when has_talent("Die Hard") and has_condition("Blood Loss")
    then require_test "Willpower" 0 "suffers 1 level of Fatigue (Blood Loss)"
}
