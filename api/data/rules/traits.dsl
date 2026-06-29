# DH2.0 traits — innate abilities (like talents, but NOT bought with XP).
# Gated on has_trait("…"). A character/creature's traits are supplied per
# attack via traits: ["Brutal Charge (3)", "Unnatural Strength (2)", …].
# Levelled traits read their value with trait_level("Name", default).

# Brutal Charge (X): on a melee Charge, add X to the damage inflicted.
trait "Brutal Charge" {
  on DAMAGE_MODS
  priority 50
  when has_trait("Brutal Charge") and is_melee and action == "Charge"
  then add modifier "brutal charge" = trait_level("Brutal Charge", 0)
}

# Unnatural Strength (X): adds X to melee damage. (Simplified — applied as a
# flat damage modifier rather than scaling the Strength Bonus characteristic.)
trait "Unnatural Strength" {
  on DAMAGE_MODS
  priority 50
  when has_trait("Unnatural Strength") and is_melee
  then add modifier "unnatural strength" = trait_level("Unnatural Strength", 0)
}
