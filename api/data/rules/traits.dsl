dsl 3
package "dh2.core.traits" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

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

# --- Auto-Stabilised (DH2 core p.134) ------------------------------------------
# "These beings always count as braced when firing heavy weapons … and not
# suffer any penalties to hit." Cancels the Unbraced configuration penalty
# (configurations.dsl, -30 per p.219).
trait "Auto-Stabilised" {
  meta { page 134 }
  on MODIFIERS
  priority 100
  when has_trait("Auto-Stabilised") and configuration("Unbraced")
  then cancel modifier "unbraced"
}

# --- Fear (X) (DH2 core p.136, Table 4-5) ---------------------------------------
# A character who encounters a Fear creature makes a Willpower test with a
# penalty by rating: Disturbing (1) +0, Frightening (2) -10, Horrifying (3) -20,
# Terrifying (4) -30. Runs in the GENERIC test pipeline: roll the Willpower test
# via /api/test with testName "Fear" and the creature as `foe`
# ({ foe: { traits: ["Fear (3)"] } }); on a failure the character rolls on
# Table 8-11: Shock (p.287), +10 per degree of failure.
trait "Fear" {
  meta { page 136 }
  on test.MODIFIERS
  when test_name == "Fear" and target.has_trait("Fear")
  then add modifier "fear rating" = -10 * (target.trait_level("Fear", 1) - 1)
}

# --- From Beyond (DH2 core p.136) ------------------------------------------------
# "Such a creature is immune to Fear, Pinning, Insanity points, and psychic
# powers used to cloud, control, or delude its mind." Surfaces the immunity when
# a Fear or Pinning test is rolled FOR the creature — no test is actually needed.
trait "From Beyond" {
  meta { page 136 }
  on test.MODIFIERS
  priority 100
  when (test_name == "Fear" or test_name == "Pinning") and has_trait("From Beyond")
  then emit "From Beyond", "immune to Fear, Pinning, Insanity points, and mind-clouding psychic powers — no test is needed"
}

# --- Regeneration (X) (DH2 core p.137) --------------------------------------------
# "Each round, at the start of its turn, the creature can make a Toughness test
# to remove an amount of damage indicated in the parentheses." Upkeep policy:
# the tick rolls the Toughness test against the encounter-stored stats; on a
# pass the GM removes trait-rating damage (healing is advisory — wounds.taken
# is not auto-reduced).
trait "Regeneration" {
  meta { page 137 }
  on upkeep.TURN_START
  when has_trait("Regeneration")
  then require_test "Toughness" 0 "no regeneration this round (a pass removes damage equal to the trait rating)"
}

# --- Sturdy (DH2 core p.138) --------------------------------------------------------
# "Sturdy creatures … gain a +20 bonus to tests made to resist Grappling and
# Knock Down actions, and uses of the Takedown talent." Generic test pipeline:
# tag the resistance roll with the matching testName.
trait "Sturdy" {
  meta { page 138 }
  on test.MODIFIERS
  when has_trait("Sturdy") and (test_name == "Grapple" or test_name == "Knock Down" or test_name == "Takedown")
  then add modifier "sturdy" = 20
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
