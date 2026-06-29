# Status conditions currently applied to the character — transient states such
# as aiming or being on fire. Gated on has_status("…"); supplied per attack via
# statuses: ["On Fire", "Full Aim", …].

# Aiming as a status (an alternative to the Aim dropdown). Adds the aim bonus
# to the to-hit modifier set.
status "Half Aim" {
  on MODIFIERS
  when has_status("Half Aim")
  then add modifier "aim" = 10
}

status "Full Aim" {
  on MODIFIERS
  when has_status("Full Aim")
  then add modifier "aim" = 20
}

# Ablaze / On Fire: the character is distracted fighting the flames.
# (Illustrative -10 to the attack; the fire's damage is handled at the table.)
status "On Fire" {
  on MODIFIERS
  when has_status("On Fire")
  then add modifier "on_fire" = -10
}
