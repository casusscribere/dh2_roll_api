# DH2.0 traits — innate abilities (like talents, but NOT bought with XP).
# Gated on has_trait("…"). A character/creature's traits are supplied per
# attack via traits: ["Brutal Charge (3)", …].
# Levelled traits read their value with trait_level("Name", default).

# Brutal Charge (X): on a melee Charge, add X to the damage inflicted.
trait "Brutal Charge" {
  on DAMAGE_MODS
  priority 50
  when has_trait("Brutal Charge") and is_melee and action == "Charge"
  then add modifier "brutal charge" = trait_level("Brutal Charge", 0)
}

# Unnatural Characteristic (X) (DH2 core p.139) is NOT a trait rule — it is a
# property of a characteristic, handled by the engine: +X to that characteristic's
# bonus (Unnatural Strength → melee Strength Bonus; Unnatural Toughness → soak TB)
# and ⌈X/2⌉ bonus degrees of success on a successful test with it (WS/BS to-hit,
# WS Parry, Ag Dodge). Supply it via the `unnatural:{ws,bs,s,ag}` object on the
# attacker/defender (and `unnaturalToughness` for soak), exposed in the Roll UI as
# the per-characteristic "Unnatural" inputs — see rollTest()/runToHit() in
# lib/engine.mjs. (Previously a simplified flat-damage trait lived here; it was
# superseded by the characteristic-based implementation.)
