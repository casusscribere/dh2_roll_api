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

# ============================ wavelet 1 (2026-07) ==============================
# The first DSL-content sweep from the talent triage: roster-held, DSL-now
# talents, verified against the core/supplement PDF text. GM-flagged
# circumstances ("Hated Foe" pattern) gate the situational ones.

# --- Resistance (X) (tier 1, DH2 core p.131) -----------------------------------
# "Each time he selects this talent, choose one area of resistance. He gains a
# +10 bonus when making tests to resist effects of this type." One branch per
# RAW specialisation (Cold, Fear, Heat, Poisons, Psychic Powers, Radiation,
# Vacuum); the resist test's tag is the specialisation name (is_test is
# spelling-blind). "Other" specialisations are GM territory.
talent "Resistance" tier 1 {
  meta { page 131 }
  on test.MODIFIERS
  when has_talent("Resistance (Cold)")           and is_test("Cold")           then add modifier "resistance" = 10
  when has_talent("Resistance (Fear)")           and is_test("Fear")           then add modifier "resistance" = 10
  when has_talent("Resistance (Heat)")           and is_test("Heat")           then add modifier "resistance" = 10
  when has_talent("Resistance (Poisons)")        and is_test("Poisons")        then add modifier "resistance" = 10
  when has_talent("Resistance (Psychic Powers)") and is_test("Psychic Powers") then add modifier "resistance" = 10
  when has_talent("Resistance (Radiation)")      and is_test("Radiation")      then add modifier "resistance" = 10
  when has_talent("Resistance (Vacuum)")         and is_test("Vacuum")         then add modifier "resistance" = 10
}

# --- Jaded (tier 1, DH2 core p.128) ---------------------------------------------
# "Mundane events, from death's horrific visage to xenos abominations, do not
# force him to gain Insanity points or make Fear tests. Daemons, Warp
# manifestations, and other unnatural effects still affect him normally."
# The GM flags the "Supernatural" circumstance when the Fear source is
# unnatural — unflagged Fear tests are mundane and Jaded voids them (advisory).
talent "Jaded" tier 1 {
  meta { page 128 }
  on test.MODIFIERS
  priority 100
  when has_talent("Jaded") and is_test("Fear") and not has_circumstance("Supernatural")
  then emit "Jaded", "mundane horrors force no Fear test and no Insanity gain — daemons, Warp manifestations, and other unnatural threats still apply (flag the Supernatural circumstance)"
}

# --- Target Selection (tier 3, DH2 core p.132) ----------------------------------
# "He can shoot into melee with no penalty. If he also makes an Aim action
# beforehand, he prevents any chance of hitting friendly targets as well."
# Cancels the -20 injected by the "Firing into Melee" circumstance
# (circumstances.dsl, p.229) at priority 100.
talent "Target Selection" tier 3 {
  meta { page 132 }
  on MODIFIERS
  priority 100
  when has_talent("Target Selection") and is_ranged and has_circumstance("Firing into Melee")
    then cancel modifier "firing_into_melee"
  when has_talent("Target Selection") and is_ranged and has_circumstance("Firing into Melee") and (half_aim or full_aim)
    then emit "Target Selection", "aimed beforehand — no chance of hitting friendly targets in the melee"
}

# --- Peer (X) (tier 1, DH2 core p.130) ------------------------------------------
# "He gains a +10 bonus to all Fellowship and Influence tests when interacting
# with this chosen group." The group is parametric (Peer (Government), …) and
# the engine cannot know who the interaction is with — the GM flags the
# "Peer Group" circumstance (Hatred's "Hated Foe" pattern). Fellowship-based
# skill tags per the core skill table: Charm, Command, Deceive, Inquiry; plus
# bare Fellowship and Influence tests. Stacked awards (Peer (X) → +10×X,
# p.130) are a GM-side adjustment.
talent "Peer" tier 1 {
  meta { page 130 }
  on test.MODIFIERS
  when has_talent("Peer") and has_circumstance("Peer Group")
    and (is_test("Charm") or is_test("Command") or is_test("Deceive") or is_test("Inquiry") or is_test("Fellowship") or is_test("Influence"))
  then add modifier "peer" = 10
}

# --- Double Tap (tier 2, DH2 core p.125) ----------------------------------------
# "When making a second ranged attack action in the same turn against the same
# target, he gains a +20 bonus to the attack test if his first attack scored
# one or more successful hits." The engine has no attack history — the GM
# flags the "Follow-Up Shot" circumstance when the RAW conditions hold.
talent "Double Tap" tier 2 {
  meta { page 125 }
  on MODIFIERS
  when has_talent("Double Tap") and is_ranged and has_circumstance("Follow-Up Shot")
  then add modifier "double tap" = 20
}

# --- Counter Attack (tier 2, DH2 core p.125) ------------------------------------
# "Once per turn, after successfully Parrying an opponent's attack, this
# character may immediately make a Standard Attack action as a Free Action
# against that opponent using the weapon with which he Parried. The character
# suffers a -20 penalty on the Weapon Skill test for this attack." Advisory at
# POST_PARRY (success known); the follow-up attack is rolled by the player.
talent "Counter Attack" tier 2 {
  meta { page 125 }
  on POST_PARRY
  when has_talent("Counter Attack") and success
  then emit "Counter Attack", "may immediately make one Standard Attack as a Free Action against the parried opponent with this weapon, at -20 Weapon Skill (once per turn)"
}

# --- Mounted Warrior (tier 1, Enemies Within p.58) ------------------------------
# "He then reduces any penalty for making corresponding attacks (Melee or
# Ranged) from a moving vehicle or mount by 10 for each time the talent has
# been purchased in that specialisation." The GM applies the situational
# vehicle/mount penalty and flags the "Mounted" circumstance; this rule offsets
# 10 of it (one purchase — stacked purchases and the cap at the actual penalty
# are GM-side). Specialised entries gate on attack type; a bare entry
# (specialisation not recorded) applies to both — Precision Killer pattern.
talent "Mounted Warrior" tier 1 {
  meta { page 58 source "Dark Heresy 2e Enemies Within" }
  on MODIFIERS
  priority 100
  when has_talent("Mounted Warrior (Ranged)") and is_ranged and has_circumstance("Mounted")
    then add modifier "mounted warrior" = 10
  when has_talent("Mounted Warrior (Melee)") and is_melee and has_circumstance("Mounted")
    then add modifier "mounted warrior" = 10
  when has_talent("Mounted Warrior") and not has_talent("Mounted Warrior (") and has_circumstance("Mounted")
    then add modifier "mounted warrior" = 10
}

# --- Eye of Vengeance (tier 3, DH2 core p.127) ----------------------------------
# "Before making a ranged Standard Attack action, he can spend a Fate point.
# If he does so, he adds the number of degrees of success scored on the attack
# test to both his damage and penetration for the hit." The Fate spend is the
# "Eye of Vengeance" configuration toggle (honor system until Fate tracking
# lands); three blocks — advisory at POST_ROLL, +DoS at DAMAGE_MODS, +DoS at
# PENETRATION.
talent "Eye of Vengeance" tier 3 {
  meta { page 127 }
  on POST_ROLL
  when has_talent("Eye of Vengeance") and configuration("Eye of Vengeance") and is_ranged and action == "Standard Attack" and success
  then emit "Eye of Vengeance", "Fate point spent — the attack's degrees of success are added to damage and penetration for the hit"
}
talent "Eye of Vengeance" tier 3 {
  meta { page 127 }
  on DAMAGE_MODS
  when has_talent("Eye of Vengeance") and configuration("Eye of Vengeance") and is_ranged and action == "Standard Attack"
  then add modifier "eye of vengeance" = dos
}
talent "Eye of Vengeance" tier 3 {
  meta { page 127 }
  on PENETRATION
  when has_talent("Eye of Vengeance") and configuration("Eye of Vengeance") and is_ranged and action == "Standard Attack" and success
  then set pen += dos
}

# --- Grenadier (tier 1, Enemies Without p.62) -----------------------------------
# "When the character misses with a thrown weapon or weapon with the Blast
# quality, he may reduce the distance it scatters by a number of metres up to
# half his BS bonus." Runs after Blast establishes the 1d5 base (priority 0);
# the full reduction is applied ("up to" — reducing less is never better; the
# engine floors the final distance at 0). Thrown weapons without Blast have no
# scatter model yet, so this rides the Blast scatter only.
talent "Grenadier" tier 1 {
  meta { page 62 source "Dark Heresy 2e Enemies Without" }
  on ON_MISS
  priority 10
  when has_talent("Grenadier") and is_ranged and has_quality("Blast") and not success and roll <= jam_threshold
  then set scatter += 0 - half(bs_bonus)
}

# --- Push the Limit (tier 3, Enemies Without p.63) -------------------------------
# "Once per round, the character may add +20 to an Operate test (or Survival
# test in the case of living steeds); however, if he fails the test by 4 or
# more degrees of failure, immediately roll 1d5 on Table 7-32: Motive Systems
# Critical Hit Effects … If he is riding a living mount, roll 1d5 on Table
# 7-18: Impact Critical Effects - Leg". Activation is the "Push the Limit"
# condition (a per-roll player declaration, like Half/Full Aim — the test
# pipeline has no configuration channel); once-per-round is honor-system.
talent "Push the Limit" tier 3 {
  meta { page 63 source "Dark Heresy 2e Enemies Without" }
  on test.MODIFIERS
  when has_talent("Push the Limit") and has_condition("Push the Limit") and (is_test("Operate") or is_test("Survival"))
  then add modifier "push the limit" = 20
}
talent "Push the Limit" tier 3 {
  meta { page 63 source "Dark Heresy 2e Enemies Without" }
  on test.POST_ROLL
  when has_talent("Push the Limit") and has_condition("Push the Limit") and (is_test("Operate") or is_test("Survival")) and dof >= 4
  then emit "Push the Limit", "failed by 4+ degrees — roll 1d5 on Motive Systems Critical Hit Effects (vehicle) or Impact Critical Effects - Leg (living mount)"
}

# --- Superior Chirurgeon (tier 3, DH2 core p.131) -------------------------------
# "He gains a +20 bonus on all Medicae skill tests. When providing first aid,
# he ignores the penalties for Heavily Damaged patients and only suffers a -10
# penalty for those suffering Critical damage." The first-aid penalty relief is
# advisory (those penalties are GM-applied inputs).
talent "Superior Chirurgeon" tier 3 {
  meta { page 131 }
  on test.MODIFIERS
  when has_talent("Superior Chirurgeon") and is_test("Medicae")
  then add modifier "superior chirurgeon" = 20; emit "Superior Chirurgeon", "first aid: ignore the Heavily Damaged penalty; Critical-damage patients are only -10"
}

# --- Coordinated Interrogation (tier 2, DH2 core p.124) --------------------------
# "He gains a +10 bonus to all Interrogation tests, and gains an additional +5
# for each other character participating in the interrogation who also has
# Coordinated Interrogation." The co-interrogator count is off-sheet — the +5s
# are surfaced as an advisory.
talent "Coordinated Interrogation" tier 2 {
  meta { page 124 }
  on test.MODIFIERS
  when has_talent("Coordinated Interrogation") and is_test("Interrogation")
  then add modifier "coordinated interrogation" = 10; emit "Coordinated Interrogation", "+5 more for each other participant who also has Coordinated Interrogation (counts as test assistance)"
}

# --- Divine Protection (tier 3, Enemies Within p.57) -----------------------------
# "When the Acolyte attacks using a weapon with the Spray quality, it only
# strikes enemies within the area of effect; the attack does not harm allies."
# Advisory — the engine models one representative Spray target.
talent "Divine Protection" tier 3 {
  meta { page 57 source "Dark Heresy 2e Enemies Within" }
  on POST_ROLL
  when has_talent("Divine Protection") and has_quality("Spray")
  then emit "Divine Protection", "the spray strikes only enemies in the area of effect — allies are unharmed"
}

# --- Iron Faith (tier 3, Enemies Beyond p.61) ------------------------------------
# "The character is immune to the effects of the Baneful Presence trait."
# Cancels the -10 injected by the Baneful Presence circumstance
# (circumstances.dsl, core p.135) at priority 100.
talent "Iron Faith" tier 3 {
  meta { page 61 source "Dark Heresy 2e Enemies Beyond" }
  on test.MODIFIERS
  priority 100
  when has_talent("Iron Faith") and has_circumstance("Baneful Presence")
  then cancel modifier "baneful presence"
}
