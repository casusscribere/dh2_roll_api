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

# On Fire! (DH2 core p.243): a burning creature takes 1d10 E to the body each round,
# must pass a Challenging (+0) Willpower test to act normally, and may spend a Hard
# (-20) Agility Full Action to extinguish itself. Applied by Flame weapons (Agility
# test or catch fire — see weapon-qualities.dsl). This single-attack tool has no
# turn loop, so the per-round damage / WP / extinguish steps are descriptive; the
# attack-time effect modelled here is the -10 a burning attacker suffers (distracted
# by the flames — an approximation of failing the Willpower test to act).
condition "On Fire" {
  on MODIFIERS
  when has_condition("On Fire")
  then add modifier "on_fire" = -10
}

# Toxified (shell — DH2 core p.150, applied by the Toxic (X) weapon quality): the
# character is poisoned. RAW: at the END of each of his turns, if he suffered
# damage (after Armour and Toughness) that round from a Toxic weapon, he must make
# a Toughness test at a penalty of 10×X (the Toxic rating, carried as this
# condition's severity value) or suffer 1d10 additional damage of the toxin's
# type. That recurring end-of-turn test needs a turn loop this single-attack tool
# does not have, so this is a SHELL: it carries the condition (and its severity)
# and documents the effect; it imposes no attack-time modifier. The emit surfaces
# it in the report if a Toxified character later acts. Full implementation (the
# end-of-turn resolution) is planned in POTENTIAL_FEATURES.md.
condition "Toxified" {
  on POST_ROLL
  priority 0
  when has_condition("Toxified")
  then emit "Toxified", "poisoned: at the end of each turn it took damage, a Toughness test (−10×severity) or 1d10 additional damage (DH2 core p.150)"
}
