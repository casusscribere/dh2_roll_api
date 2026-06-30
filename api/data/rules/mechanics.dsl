# Weapon mechanics & craftsmanship — authored in the DSL.
#
# Jam is a base MECHANIC (not a weapon quality): a ranged weapon jams when the
# attack roll exceeds the jam threshold (default 96 → jams on 97+). Qualities
# (Reliable/Unreliable) and craftsmanship adjust `jam_threshold` BEFORE this
# check runs (lower priority), so they compose. A threshold of 100 never jams.

mechanic "Jam" {
  on POST_ROLL
  priority 50
  when is_ranged and roll > jam_threshold
  then emit "Jam", "The weapon jams!"; fail
}

# ===== Weapon craftsmanship (DH2 core p.149) =================================
# craftsmanship fact is "Poor" | "Common" | "Good" | "Best" (weapon.craftsmanship).

# --- melee: WS modifier applies to every WS test made with the weapon, i.e.
#     both attacks (MODIFIERS) and parries (PARRY). Best also adds +1 damage. ---
mechanic "Poor Craftsmanship (melee)" {
  on MODIFIERS  when is_melee and craftsmanship == "Poor"  then add modifier "craftsmanship" = -10
}
mechanic "Poor Craftsmanship (melee)" {
  on PARRY  when craftsmanship == "Poor"  then add modifier "craftsmanship" = -10
}
mechanic "Good Craftsmanship (melee)" {
  on MODIFIERS  when is_melee and craftsmanship == "Good"  then add modifier "craftsmanship" = 5
}
mechanic "Good Craftsmanship (melee)" {
  on PARRY  when craftsmanship == "Good"  then add modifier "craftsmanship" = 5
}
mechanic "Best Craftsmanship (melee)" {
  on MODIFIERS  when is_melee and craftsmanship == "Best"  then add modifier "craftsmanship" = 10
}
mechanic "Best Craftsmanship (melee)" {
  on PARRY  when craftsmanship == "Best"  then add modifier "craftsmanship" = 10
}
mechanic "Best Craftsmanship (melee)" {
  on DAMAGE_MODS  when is_melee and craftsmanship == "Best"  then add modifier "craftsmanship" = 1
}

# --- ranged: craftsmanship adjusts the jam threshold (priority 5, before the
#     Reliable/Unreliable qualities at 10 and the base Jam mechanic at 50). ---
mechanic "Poor Craftsmanship (ranged)" {
  on POST_ROLL  priority 5  when is_ranged and craftsmanship == "Poor"  then set jam_threshold = 90
}
mechanic "Good Craftsmanship (ranged)" {
  on POST_ROLL  priority 5  when is_ranged and craftsmanship == "Good"  then set jam_threshold = 99
}
mechanic "Best Craftsmanship (ranged)" {
  on POST_ROLL  priority 5  when is_ranged and craftsmanship == "Best"  then set jam_threshold = 100
}
