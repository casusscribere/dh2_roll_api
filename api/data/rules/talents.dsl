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
