# Configurations — per-character toggles the player chooses for a shot/turn
# (grip, dual-wield, firing modes). Gated on configuration("…") (firing_mode is
# an alias) and supplied per attack via configs: ["…"] (the old firingModes[] is
# still accepted). Eventually set from the character sheet (FOUNDRY_MIGRATION.md).

# --- Off-Hand (grip configuration) ------------------------------------------
# Wielding a weapon in the off hand incurs -20 (cancelled by Ambidextrous). A
# per-character grip Configuration (moved here from Circumstances), driven by the
# firing_offhand combat flag — set via combat: { firingOffhand: true }.
configuration "Off-Hand" {
  on MODIFIERS
  priority 10
  when firing_offhand and not dual_wielding
  then add modifier "off_hand" = -20
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
  on DAMAGE_MODS
  when has_quality("Maximal") and configuration("Maximal")
  then add modifier "maximal" = 1d10
}
configuration "Maximal" {
  on PENETRATION
  when has_quality("Maximal") and configuration("Maximal")
  then set pen += 2
}
configuration "Maximal" {
  on PENETRATION
  priority 5
  when has_quality("Maximal") and configuration("Maximal")
  then bump_quality "Blast" by 2
}
# Firing on Maximal grants the Recharge quality this shot — added early (MODIFIERS)
# so the Recharge quality rule (POST_ROLL) sees it and fires. The note covers the
# range/ammo costs (no range-in-metres or ammo model yet — see POTENTIAL_FEATURES.md).
configuration "Maximal" {
  on MODIFIERS
  when has_quality("Maximal") and configuration("Maximal")
  then add_quality "Recharge"
}
configuration "Maximal" {
  on POST_ROLL
  when has_quality("Maximal") and configuration("Maximal")
  then emit "Maximal", "+10 m range and x3 ammunition this shot"
}
