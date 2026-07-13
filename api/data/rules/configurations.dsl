dsl 3
package "dh2.core.configurations" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Configurations — per-character toggles the player chooses for a shot/turn
# (grip, dual-wield, firing modes). Gated on configuration("…") (firing_mode is
# an alias) and supplied per attack via configs: ["…"] (the old firingModes[] is
# still accepted). Eventually set from the character sheet (FOUNDRY_MIGRATION.md).

# --- DualWield grips (replacing the old Off-Hand entry) -----------------------
# Two grip Configurations covering Two-Weapon Fighting (DH2 core p.228):
#   DualWield (main hand) — fighting with two weapons, this attack with the
#     MAIN hand. The Two-Weapon Wielder -20 keys off the dual_wielding fact
#     (talents.dsl); this rule surfaces the RAW talent requirement.
#   DualWield (off-hand)  — this attack uses the OFF hand: -20 unless
#     Ambidextrous (talents.dsl cancels it). Checked ALONE it models a single
#     weapon held in the off hand; checked WITH main-hand it is the off-hand
#     half of a dual-wield turn.
# The dual_wielding / firing_offhand facts read these configs OR the legacy
# combat:{dualWielding, firingOffhand} flags (vocabulary.mjs).
configuration "DualWield (main hand)" {
  meta { page 228 }
  on POST_ROLL
  priority 5
  when configuration("DualWield (main hand)") and not has_talent("Two-Weapon Wielder")
  then emit "DualWield", "RAW a secondary attack with the other weapon requires the Two-Weapon Wielder talent (Two-Weapon Fighting, p.228)"
}
configuration "DualWield (off-hand)" {
  meta { page 228 }
  on MODIFIERS
  priority 10
  when (configuration("DualWield (off-hand)") or firing_offhand) and not dual_wielding
  then add modifier "off_hand" = -20
}

# --- Unbraced heavy weapon (DH2 core p.219) — moved from Circumstances --------
# "If a character fires an unbraced Heavy weapon, he suffers a -30 penalty."
# A per-shot stance toggle (weapon class is not modelled); Auto-Stabilised
# (traits.dsl) cancels it.
configuration "Unbraced" {
  meta { page 219 }
  on MODIFIERS
  when configuration("Unbraced") and is_ranged
  then add modifier "unbraced" = -30
}

# --- Maximal: a high-power firing mode (DH2 core p.146) ----------------------
# Maximal is BOTH a weapon quality and a Configuration: the weapon QUALITY
# "Maximal" (a capability marker on the weapon's qualities list — recognised in
# availableQualities) GATES the Maximal Configuration. The rules below gate on the
# weapon HAVING the Maximal quality AND the Maximal config being toggled on, so the
# UI only offers (and the engine only applies) Maximal when the weapon supports it. Firing on Maximal: +1d10
# damage, +2 penetration, Blast value +2, and (per RAW) +10 m range, x3 ammo,
# gains Recharge — the last three are surfaced as a note (range-in-metres and ammo
# tracking are deferred — see POTENTIAL_FEATURES.md).
configuration "Maximal" {
  meta { page 147 }
  on DAMAGE_MODS
  when has_quality("Maximal") and configuration("Maximal")
  then add modifier "maximal" = 1d10
}
configuration "Maximal" {
  meta { page 147 }
  on PENETRATION
  when has_quality("Maximal") and configuration("Maximal")
  then set pen += 2
}
configuration "Maximal" {
  meta { page 147 }
  on PENETRATION
  priority 5
  when has_quality("Maximal") and configuration("Maximal")
  then bump_quality "Blast" by 2
}
# Firing on Maximal grants the Recharge quality this shot — added early (MODIFIERS)
# so the Recharge quality rule (POST_ROLL) sees it and fires. The note covers the
# range/ammo costs (no range-in-metres or ammo model yet — see POTENTIAL_FEATURES.md).
configuration "Maximal" {
  meta { page 147 }
  on MODIFIERS
  when has_quality("Maximal") and configuration("Maximal")
  then add_quality "Recharge"
}
configuration "Maximal" {
  meta { page 147 }
  on POST_ROLL
  when has_quality("Maximal") and configuration("Maximal")
  then emit "Maximal", "+10 m range and x3 ammunition this shot"
}
