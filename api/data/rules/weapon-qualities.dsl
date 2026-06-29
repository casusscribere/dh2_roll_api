# DH2 weapon qualities — authored in the trait DSL.
#
# This file IS the interpretation of the DH2 weapon special qualities; it is
# data, fully separated from the roll engine. It is compiled to checkpoint
# effects at load time (see lib/rules/index.mjs) and was previously the native
# module lib/rules/weapon-qualities.mjs — re-authoring it here dogfoods the DSL.
#
# Priorities mirror the original native ordering.

# --- dice pool ---------------------------------------------------------------
quality "Tearing" {
  on DAMAGE_POOL
  priority 10
  when has_quality("Tearing")
  then add_die 1; keep_highest          # roll one extra die, keep the original count highest
}

# --- per-die adjustment + Righteous Fury threshold ---------------------------
quality "Vengeful" {
  on DIE_ADJUST
  priority 0
  when has_quality("Vengeful")
  then set rf_threshold = quality_level("Vengeful", 9)
}

quality "Proven" {
  on DIE_ADJUST
  priority 10
  when has_quality("Proven")
  then floor_die quality_level("Proven", 2)
}

quality "Primitive" {
  on DIE_ADJUST
  priority 20
  when has_quality("Primitive")
  then cap_die quality_level("Primitive", 7)
}

# --- Accurate (DH2 core p.150) ----------------------------------------------
# Requires the Aim action. Two rules share the name "Accurate" so a single
# toggle controls both halves of the quality:
#   1) +10 to hit while aiming (on top of the aim bonus);
#   2) +1d10 damage per two DoS (max +2d10) on an aimed single shot.
quality "Accurate" {
  on MODIFIERS
  priority 50
  when has_quality("Accurate") and (half_aim or full_aim)
  then add modifier "accurate_aim" = 10
}

quality "Accurate" {
  on DAMAGE_MODS
  priority 10
  when has_quality("Accurate") and (half_aim or full_aim) and (action == "Standard Attack" or action == "Called Shot") and dos >= 3
    then add modifier "accurate" = 1d10
  when has_quality("Accurate") and (half_aim or full_aim) and (action == "Standard Attack" or action == "Called Shot") and dos >= 5
    then add modifier "accurate x 2" = 1d10
}

# --- hit count ---------------------------------------------------------------
quality "Storm" {
  on HIT_COUNT_MULT
  priority 10
  when has_quality("Storm")
  then multiply_hits 2
}

quality "Twin-Linked" {
  on HIT_COUNT_BONUS
  priority 10
  when has_quality("Twin-Linked") and dos > 1
  then add_hits 1
}

# --- penetration -------------------------------------------------------------
# `set pen += pen` adds the base penetration again under the rule-named slot
# ("razor sharp" / "melta"), doubling effective penetration.
quality "Razor Sharp" {
  on PENETRATION
  priority 10
  when is_melee and dos > 2 and has_quality("Razor Sharp")
  then set pen += pen
}

quality "Melta" {
  on PENETRATION
  priority 20
  when is_ranged and has_quality("Melta") and (range == "Short Range" or range == "Point Blank")
  then set pen += pen
}

# --- malfunctions (ranged) ---------------------------------------------------
quality "Overheats" {
  on POST_ROLL
  priority 10
  when is_ranged and roll > 91 and has_quality("Overheats")
  then emit "Overheats", "The weapon overheats forcing it to be dropped on the ground!"
}

# Base ranged jam (97+), suppressed below 100 by Reliable.
quality "Jam" {
  on POST_ROLL
  priority 20
  when is_ranged and ((not has_quality("Reliable") and roll > 96) or roll == 100)
  then emit "Jam", "The weapon jams!"; fail
}

# --- defensive / parry qualities (DH2 core p.150) ---------------------------
# Balanced grants +10 to Weapon Skill tests made to Parry (only once even with
# two Balanced weapons — it is keyed by the modifier name, so it can't stack).
quality "Balanced" {
  on PARRY
  when has_quality("Balanced")
  then add modifier "balanced" = 10
}

# Defensive (e.g. a shield): +15 to Parry, but -10 to attacks made with it.
quality "Defensive" {
  on PARRY
  when has_quality("Defensive")
  then add modifier "defensive" = 15
}
quality "Defensive" {
  on MODIFIERS
  when has_quality("Defensive")
  then add modifier "defensive" = -10
}

# --- Blast (X) scatter on a miss (DH2 core p.150 / scatter p.230) ------------
# A Blast weapon scatters when the firer misses. Set a base scatter distance
# (1d10 m) and reduce it by the firer's BS bonus (min 0, applied by the engine).
# The `set scatter += …` modifier is fully DSL-alterable, so other rules can
# tighten or worsen the scatter.
quality "Blast" {
  on ON_MISS
  when is_ranged and has_quality("Blast") and not success
  then set scatter = 1d10; set scatter += -bs_bonus
}
