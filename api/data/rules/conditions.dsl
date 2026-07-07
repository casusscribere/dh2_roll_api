dsl 3
package "dh2.core.conditions" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Conditions currently applied to the character — transient states such as
# aiming or being on fire (most are listed on DH2 core p.242; others come from
# weapon qualities, e.g. Crippled, Stunned). Gated on has_condition("…") and
# supplied per attack via conditions: ["On Fire", "Full Aim", …]. The old key
# statuses[] and has_status() remain accepted as aliases.

# Aiming as a condition (an alternative to the Aim dropdown). Adds the aim bonus
# to the to-hit modifier set.
condition "Half Aim" {
  on MODIFIERS
  when has_condition("Half Aim")
  then add modifier "aim" = 10
}

condition "Full Aim" {
  on MODIFIERS
  when has_condition("Full Aim")
  then add modifier "aim" = 20
}

# On Fire! (DH2 core p.243): a burning creature takes 1d10 E to the body each round
# (armour does not protect; Toughness Bonus applies), must pass a Challenging (+0)
# Willpower test to act normally, and may spend a Hard (-20) Agility Full Action to
# extinguish itself. Applied by Flame weapons (Agility test or catch fire — see
# weapon-qualities.dsl). Attack-time: a burning attacker suffers -10 (distracted by
# the flames). Per-round: the upkeep tick (Phase 4 — EncounterState) declares the
# 1d10 burn at the start of the actor's turn.
condition "On Fire" {
  meta { page 243 }
  on MODIFIERS
  when has_condition("On Fire")
  then add modifier "on_fire" = -10
}
condition "On Fire" {
  meta { page 243 }
  on upkeep.TURN_START
  when has_condition("On Fire")
  then declare damage 1d10, "burning — Energy to the Body; armour does not protect, Toughness Bonus applies; Hard (-20) Agility Full Action to extinguish"
}

# Toxified (DH2 core p.150, applied by the Toxic (X) weapon quality): the
# character is poisoned. RAW: at the END of each of his turns the victim makes a
# Toughness test at −10×X (the Toxic rating, carried as this condition's
# severity) or suffers 1d10 additional damage. FULLY IMPLEMENTED via the upkeep
# tick (Phase 4 — EncounterState): the end-of-turn test rolls against the
# actor's stored Toughness, and the 1d10 lands only on a failure. The POST_ROLL
# emit still surfaces the condition when a Toxified character acts.
condition "Toxified" {
  meta { page 150 }
  on POST_ROLL
  priority 0
  when has_condition("Toxified")
  then emit "Toxified", "poisoned: at the end of each turn, a Toughness test (−10×severity) or 1d10 additional damage (DH2 core p.150)"
}
condition "Toxified" {
  meta { page 150 }
  on upkeep.TURN_END
  when has_condition("Toxified")
  then require_test "Toughness" (-10 * condition_severity("Toxified", 0)) "1d10 additional damage from the toxin" => damage 1d10
}
