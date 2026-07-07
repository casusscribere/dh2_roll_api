dsl 3
package "dh2.core.weapon-qualities" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

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
  meta { page 150 }
  on DAMAGE_POOL
  priority 10
  when has_quality("Tearing")
  then set extra_dice += 1; flag keep_highest          # roll one extra die, keep the original count highest
}

# --- per-die adjustment + Righteous Fury threshold ---------------------------
quality "Vengeful" {
  meta { page 150 }
  on DIE_ADJUST
  priority 0
  when has_quality("Vengeful")
  then set rf_threshold = quality_level("Vengeful", 9)
}

quality "Proven" {
  meta { page 148 }
  on DIE_ADJUST
  priority 10
  when has_quality("Proven")
  then floor_die quality_level("Proven", 2)
}

quality "Primitive" {
  meta { page 148 }
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
  meta { page 145 }
  on MODIFIERS
  priority 50
  when has_quality("Accurate") and (half_aim or full_aim)
  then add modifier "accurate_aim" = 10
}

quality "Accurate" {
  meta { page 145 }
  on DAMAGE_MODS
  priority 10
  when has_quality("Accurate") and (half_aim or full_aim) and (action == "Standard Attack" or action == "Called Shot") and dos >= 3
    then add modifier "accurate" = 1d10
  when has_quality("Accurate") and (half_aim or full_aim) and (action == "Standard Attack" or action == "Called Shot") and dos >= 5
    then add modifier "accurate x 2" = 1d10
}

# --- Inaccurate (DH2 core p.146) --------------------------------------------
# The opposite of Accurate: the character gains NO benefit from the Aim action
# with this weapon. The aim bonus is injected by the combat-action `aim-modifier`
# effect at MODIFIERS priority 10 (and Accurate adds "accurate_aim" at 50); this
# runs at priority 100 (canceller convention) to strip the aim bonus afterwards.
# Accurate + Inaccurate on the same weapon is a data conflict — see the
# mutual-exclusion check in lib/rules/quality-conflicts.mjs, which surfaces it.
quality "Inaccurate" {
  meta { page 147 }
  on MODIFIERS
  priority 100
  when has_quality("Inaccurate")
  then cancel modifier "aim"
}

# --- hit count ---------------------------------------------------------------
quality "Storm" {
  meta { page 149 }
  on HIT_COUNT_MULT
  priority 10
  when has_quality("Storm")
  then multiply_hits 2
}

quality "Twin-Linked" {
  meta { page 150 }
  on HIT_COUNT_BONUS
  priority 10
  when has_quality("Twin-Linked") and dos > 1
  then set extra_hits += 1
}

# --- penetration -------------------------------------------------------------
# `set pen += pen` adds the base penetration again under the rule-named slot
# ("razor sharp" / "melta"), doubling effective penetration.
# Razor Sharp (DH2 core p.150): at 3+ DoS, double penetration — any attack
# (melee OR ranged), so there is no is_melee gate.
quality "Razor Sharp" {
  meta { page 148 }
  on PENETRATION
  priority 10
  when dos > 2 and has_quality("Razor Sharp")
  then set pen += pen
}

quality "Melta" {
  meta { page 148 }
  on PENETRATION
  priority 20
  when is_ranged and has_quality("Melta") and (range == "Short Range" or range == "Point Blank")
  then set pen += pen
}

# Lance (DH2 core p.147): variable penetration scaling with accuracy. Increase
# penetration by the weapon's BASE value once per degree of success, e.g. base
# pen 5 at 3 DoS adds 3×5=15 → total 20. `pen` reads the base penetration and
# `dos` the to-hit degrees (both live on the context at PENETRATION).
quality "Lance" {
  meta { page 147 }
  on PENETRATION
  priority 15
  when has_quality("Lance") and dos > 0
  then set pen += pen * dos
}

# --- malfunctions (ranged) ---------------------------------------------------
# Overheats on 92+; Best-craftsmanship weapons never overheat (p.149). An Overheats
# weapon OVERRIDES the baseline Jam mechanic — it overheats instead of jamming, so
# the first branch suppresses "Jam" (priority 10, before the Jam mechanic at 50)
# whenever the weapon has Overheats; the second branch emits the overheat on 92+.
quality "Overheats" {
  meta { page 148 }
  on POST_ROLL
  priority 10
  when is_ranged and has_quality("Overheats")
    then suppress "Jam"
  when is_ranged and roll > 91 and has_quality("Overheats") and craftsmanship != "Best"
    then emit "Overheats", "The weapon overheats forcing it to be dropped on the ground!"
}

# Flexible (DH2 core p.145): linked/non-rigid weapons (whips, flails) deny defensive
# counters — an attack from a Flexible weapon CANNOT be Parried (the engine refuses a
# Parry reaction against it and notes it). A Flexible weapon can still itself Parry.
quality "Flexible" {
  meta { page 145 }
  on POST_ROLL
  when has_quality("Flexible")
  then flag no_parry
}

# Graviton (DH2 core p.146): on a hit, inflicts additional damage equal to the
# target's Armour points on the struck location (effectively negating armour). The
# vehicle interaction (facing armour + always rolling Motive Systems Critical
# Effects) is deferred — see POTENTIAL_FEATURES.md.
quality "Graviton" {
  meta { page 146 }
  on DAMAGE_MODS
  when has_quality("Graviton")
  then add modifier "graviton" = target.armour
}

# Jam is a base weapon MECHANIC (see mechanics.dsl), not a quality. These two
# qualities adjust the jam threshold (default 96 → jams on 97+):
#   Reliable → jams only on 100; Unreliable → jams on 91+.
quality "Reliable" {
  meta { page 148 }
  on POST_ROLL
  priority 10
  when is_ranged and has_quality("Reliable")
  then set jam_threshold = 99
}

quality "Unreliable" {
  meta { page 150 }
  on POST_ROLL
  priority 10
  when is_ranged and has_quality("Unreliable")
  then set jam_threshold = 90
}

# --- Scatter (DH2 core p.148) — the weapon QUALITY (distinct from the scatter
# game mechanic / Scatter Diagram used by Blast on a miss). Spreading shot: deadly
# up close, weak at range. Point Blank: +10 to hit and +3 damage; Short Range:
# +10 to hit; any longer range (Normal/Long/Extreme): −3 damage.
quality "Scatter" {
  meta { page 148 }
  on MODIFIERS
  priority 50
  when has_quality("Scatter") and (range == "Point Blank" or range == "Short Range")
  then add modifier "scatter (close)" = 10
}
quality "Scatter" {
  meta { page 148 }
  on DAMAGE_MODS
  priority 50
  when has_quality("Scatter") and range == "Point Blank"
    then add modifier "scatter" = 3
  when has_quality("Scatter") and (range == "Normal Range" or range == "Long Range" or range == "Extreme Range")
    then add modifier "scatter" = -3
}

# (Maximal — the high-power firing mode — moved to configurations.dsl, the
#  Configurations category.)

# --- on-hit target effects (DH2 core p.150) ---------------------------------
# Concussive (X): the target makes a Toughness test at -10*X; on a fail it is
# Stunned (1 round per DoF). If damage dealt exceeds the target's SB, Prone.
quality "Concussive" {
  meta { page 145 }
  on ON_HIT
  when has_quality("Concussive")
    then require_test "Toughness" (-10 * quality_level("Concussive", 0)) "Stunned for 1 round per degree of failure"
  when has_quality("Concussive") and damage_dealt > target.sb
    then apply_status "Prone", "damage dealt exceeds the target's Strength Bonus"
}

# Crippling (X): if the target takes at least one wound, it is Crippled for the
# encounter. This is automatic on a wound — there is no defender test to resist
# it (DH2 RAW). The status carries a severity value of X — the Rending damage the
# Crippled target suffers to that location each time it takes more than a Half
# Action (default 1 if the quality has no rating).
quality "Crippling" {
  meta { page 145 }
  on ON_HIT
  when has_quality("Crippling") and wounds > 0
  then apply_status "Crippled" value quality_level("Crippling", 1) location location, "the hit inflicted at least one wound (automatic, no test)"
}

# Corrosive (DH2 core p.145): the caustic hit corrodes the struck location's
# armour by 1d10 Armour Points (permanent until repaired, cumulative across
# hits). Any amount beyond the current AP — or the whole amount if the target is
# unarmoured there — is dealt to the target as wounds, ignoring Toughness. The
# engine resolves the AP loss and overflow (see resolveCorrosion); the report
# shows the new AP so it can be carried to the next encounter.
quality "Corrosive" {
  meta { page 145 }
  on ON_HIT
  when has_quality("Corrosive")
  then corrode 1d10
}

# Haywire (X) (DH2 core p.146): on a hit, roll 1d10 on the Haywire Field Effects
# table to determine the strength of the disruptive field.
quality "Haywire" {
  meta { page 147 }
  on ON_HIT
  when has_quality("Haywire")
  then roll_on "Haywire Field Effects" area quality_level("Haywire", 1)
}

# Hallucinogenic (X) (DH2 core p.145): the target makes a Toughness test at -10*X;
# on a failure it suffers a delusion — roll 1d10 on the Hallucinogenic Effects
# table (some results impose conditions on the target).
quality "Hallucinogenic" {
  meta { page 146 }
  on ON_HIT
  when has_quality("Hallucinogenic")
  then require_test "Toughness" (-10 * quality_level("Hallucinogenic", 1)) "delusion (roll on Hallucinogenic Effects)" => roll_on "Hallucinogenic Effects"
}

# Recharge (DH2 core p.146): the weapon must spend a turn recharging before it can
# fire again. No turn loop in this single-attack tool, so it is surfaced as a note;
# it is also added dynamically by firing on Maximal (see configurations.dsl).
quality "Recharge" {
  meta { page 148 }
  on POST_ROLL
  when has_quality("Recharge")
  then emit "Recharge", "must spend a turn recharging before it can fire again"
}

# Felling (X) (DH2 core p.145): when calculating damage, reduce the target's
# Unnatural Toughness BONUS by X — only Unnatural Toughness, never the base
# Toughness Bonus, and only for this damage calculation. Runs at PENETRATION (the
# defence-reduction seam) so the soak step applies the reduced Unnatural Toughness.
quality "Felling" {
  meta { page 145 }
  on PENETRATION
  when has_quality("Felling")
  then set unnatural_toughness_reduction += quality_level("Felling", 1)
}

# Flame (DH2 core p.145): whenever a target is struck by a Flame attack (even if it
# suffers no damage), it must make an Agility test or be set On Fire (p.243).
# Modelled as a per-hit Agility test that applies the On Fire condition on failure.
# (RAW Flame is an area attack that doesn't use BS — that targeting is out of scope;
# the test and its effect are modelled.)
quality "Flame" {
  meta { page 145 }
  on ON_HIT
  when has_quality("Flame")
  then require_test "Agility" 0 "set on fire (gains the On Fire condition)" => apply_status "On Fire" duration "until extinguished"
}

# Shocking (DH2 core p.148): a target that takes at least 1 wound (after Armour
# and Toughness) must pass a Challenging (+0) Toughness test or suffer 1 level of
# Fatigue and be Stunned for rounds equal to half its DoF (rounding up). Modelled
# as a Toughness test gated on wounds > 0; the Stunned condition lands on a fail
# (the Fatigue level is descriptive — no fatigue track in this single-attack tool).
quality "Shocking" {
  meta { page 149 }
  on ON_HIT
  when has_quality("Shocking") and wounds > 0
  then require_test "Toughness" 0 "1 level of Fatigue and Stunned for rounds equal to half the degrees of failure" => apply_status "Stunned"
}

# Snare (X) (DH2 core p.148): on a hit, the target makes an Agility test at −10×X
# or is Immobilised (and counts as Helpless until it escapes — a Full Action
# Challenging Strength/Agility test at −10×X). The Immobilised condition lands on
# a failed Agility test; escaping is descriptive (no turn loop here).
quality "Snare" {
  meta { page 149 }
  on ON_HIT
  when has_quality("Snare")
  then require_test "Agility" (-10 * quality_level("Snare", 0)) "Immobilised (Helpless until it escapes)" => apply_status "Immobilised"
}

# Toxic (X) (DH2 core p.150): a target that suffers damage (after Armour and
# Toughness) from a Toxic weapon is poisoned — it gains the Toxified condition,
# which (at the end of each of its turns it took damage that round) forces a
# Toughness test at −10×X or 1d10 extra damage. The recurring test needs a turn
# loop this tool lacks, so it is carried as the Toxified condition (value X) and
# documented there (conditions.dsl); here we just inflict it on a wounding hit.
quality "Toxic" {
  meta { page 150 }
  on ON_HIT
  when has_quality("Toxic") and wounds > 0
  then apply_status "Toxified" value quality_level("Toxic", 0), "took damage from a Toxic weapon (end-of-turn Toughness test or 1d10 additional damage)"
}

# Sanctified (DH2 core p.148): the weapon is blessed — its damage counts as Holy,
# which has unique effects against denizens of the Warp. The concrete interaction
# in this engine: a Daemonic creature's Toughness-bonus increase (its Unnatural
# Toughness) "is negated by damage inflicted from … holy attacks" (p.135), so vs a
# Daemonic target Sanctified strips the target's Unnatural Toughness for this hit
# (reusing Felling's reduction). The Holy damage type is surfaced on the result.
# (Daemonic / From Beyond traits themselves are planned — see POTENTIAL_FEATURES.md.)
quality "Sanctified" {
  meta { page 148 }
  on DAMAGE_POOL
  priority 0
  when has_quality("Sanctified")
  then set damage_type = "Holy"
}
quality "Sanctified" {
  meta { page 148 }
  on PENETRATION
  priority 30
  when has_quality("Sanctified") and target.has_trait("Daemonic")
  then set unnatural_toughness_reduction += target.unnatural_toughness
}

# --- defensive / parry qualities (DH2 core p.150) ---------------------------
# Balanced grants +10 to Weapon Skill tests made to Parry (only once even with
# two Balanced weapons — it is keyed by the modifier name, so it can't stack).
quality "Balanced" {
  meta { page 145 }
  on PARRY
  when has_quality("Balanced")
  then add modifier "balanced" = 10
}

# Defensive (e.g. a shield): +15 to Parry, but -10 to attacks made with it.
quality "Defensive" {
  meta { page 145 }
  on PARRY
  when has_quality("Defensive")
  then add modifier "defensive" = 15
}
quality "Defensive" {
  meta { page 145 }
  on MODIFIERS
  when has_quality("Defensive") and is_attack
  then add modifier "defensive" = -10
}

# Unbalanced (DH2 core p.150): cumbersome offensively-strong weapons. −10 to Parry
# tests, and they cannot be used to make Lightning Attack actions (surfaced as a
# note — the tool does not hard-block action choice).
quality "Unbalanced" {
  meta { page 150 }
  on PARRY
  when has_quality("Unbalanced")
  then add modifier "unbalanced" = -10
}
quality "Unbalanced" {
  meta { page 150 }
  on POST_ROLL
  when has_quality("Unbalanced") and is_action("Lightning Attack")
  then emit "Unbalanced", "cannot be used to make Lightning Attack actions"
}

# Unwieldy (DH2 core p.150): huge, top-heavy weapons. They CANNOT be used to Parry
# (the parry flow refuses the reaction — see resolveParry) and cannot make
# Lightning Attack actions.
quality "Unwieldy" {
  meta { page 150 }
  on PARRY
  when has_quality("Unwieldy")
  then flag cannot_parry
}
quality "Unwieldy" {
  meta { page 150 }
  on POST_ROLL
  when has_quality("Unwieldy") and is_action("Lightning Attack")
  then emit "Unwieldy", "cannot be used to make Lightning Attack actions"
}

# Power Field (DH2 core p.148): a disruptive energy field. When this weapon
# SUCCESSFULLY Parries an attack made with a weapon that lacks Power Field, roll
# 1d100 on Power Field Destruction; on 26+ the attacker's weapon is destroyed.
# Weapons with the Force or Warp Weapon quality, and Natural Weapons, are immune.
# Runs at POST_PARRY (success known); `opposing_has_quality` reads the parried
# (attacking) weapon, `opposing_present` guards the bare /api/parry test.
quality "Power Field" {
  meta { page 148 }
  on POST_PARRY
  when has_quality("Power Field") and success and opposing_weapon.present
    and not opposing_weapon.has_quality("Power Field") and not opposing_weapon.has_quality("Force")
    and not opposing_weapon.has_quality("Warp Weapon") and not opposing_weapon.has_quality("Natural Weapon")
  then roll_on "Power Field Destruction"
}

# --- Blast (X) scatter on a miss (DH2 core p.150 / scatter p.230) ------------
# A Blast weapon scatters when the firer misses. The scatter distance defaults
# to 1d5 metres (p.230); the engine rolls the 1d10 direction on the Scatter
# Diagram. This runs at priority 0 so the 1d5 base is established BEFORE any
# other rules — which may increase or decrease it via `set scatter += …`
# (modifiers accumulate separately and are summed onto the base at the end).
#
# `detonate` makes the weapon still resolve its damage at the scatter point even
# though the shot missed — a blast goes off wherever it lands and may catch other
# targets in the area. The `roll <= jam_threshold` gate means a *jam* (which also
# fails the to-hit) does NOT detonate: a jammed weapon never fired.
quality "Blast" {
  meta { page 145 }
  on ON_MISS
  priority 0
  when is_ranged and has_quality("Blast") and not success and roll <= jam_threshold
  then set scatter = 1d5; flag detonate; roll_on "Scatter Diagram"
}
