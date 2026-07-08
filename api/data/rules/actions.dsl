dsl 3
package "dh2.core.actions" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Actions — every action a character can take (DH2 core p.219+). Each declares a
# `type` (Half | Full | Reaction | Free) and zero or more `subtype` designations;
# `attack` is sugar for `subtype attack` — the KEY subtype many rules read (via
# is_attack / action_subtype("…")), e.g. Defensive's -10 to attacks. Compiled once
# into the actions registry at load ("checked at server startup"); other rules
# hook on the current action via is_action("…"), action_type, is_reaction(),
# is_attack and action_subtype("…"). To-hit modifiers for the attack actions still
# live in the engine (combat-actions); these declarations own the taxonomy.

action "Standard Attack"  { type Half  attack }
action "Semi-Auto Burst"  { type Half  attack  subtype ranged }
action "Full Auto Burst"  { type Half  attack  subtype ranged }
action "All Out Attack"   { type Full  attack  subtype melee }
action "Charge"           { type Full  attack  subtype melee }
action "Called Shot"      { type Full  attack }
# Swift Attack (p.225) and Lightning Attack (p.223) are HALF Actions in DH2 2e
# (Table 7-1, p.222) — the melee multi-attacks, gated by their talents below.
action "Swift Attack"     { type Half  attack  subtype melee }
action "Lightning Attack" { type Half  attack  subtype melee }
# Suppressing Fire (p.224): Full Action, needs a weapon capable of semi- or
# full-automatic fire; the mode picks the kill-zone arc, hit cap, and the
# Pinning difficulty (see the rules below).
action "Suppressing Fire (Semi)" { type Full  attack  subtype ranged }
action "Suppressing Fire (Full)" { type Full  attack  subtype ranged }
action "Defensive Stance" { type Full }
action "Aim"              { type Half }

# Reactions — gate talents/qualities with is_reaction() or is_action("Parry").
action "Parry"            { type Reaction }
action "Dodge"            { type Reaction }

# --- action legality (advisory) ------------------------------------------------
# "This action may only be taken if the attacker has the … talent." The engine
# resolves the roll anyway (the GM may house-rule); these surface the RAW gate
# as a warning effect when the talent is missing.
mechanic "Swift Attack (talent gate)" {
  meta { page 225 }
  on MODIFIERS
  priority 5
  when is_action("Swift Attack") and not has_talent("Swift Attack")
  then emit "Swift Attack", "RAW this action may only be taken if the attacker has the Swift Attack talent (p.131)"
}

mechanic "Lightning Attack (talent gate)" {
  meta { page 223 }
  on MODIFIERS
  priority 5
  when is_action("Lightning Attack") and not has_talent("Lightning Attack")
  then emit "Lightning Attack", "RAW this action may only be taken if the attacker has the Lightning Attack talent (p.129)"
}

# "Unbalanced or Unwieldy melee weapons cannot be used to make a Lightning
# Attack." (p.223)
mechanic "Lightning Attack (weapon restriction)" {
  meta { page 223 }
  on MODIFIERS
  priority 5
  when is_action("Lightning Attack") and (has_quality("Unbalanced") or has_quality("Unwieldy"))
  then emit "Lightning Attack", "Unbalanced or Unwieldy melee weapons cannot be used to make a Lightning Attack"
}

# --- Suppressing Fire (DH2 core p.224) -------------------------------------------
# Full Action: establish a kill zone (30° semi / 45° full arc), fire a burst,
# and force every target in the zone to test Pinning — Difficult (-10) for
# semi-auto, Hard (-20) for full auto — REGARDLESS of whether the Hard (-20)
# BS test hits (the -20 is the action modifier; hits land on random targets,
# one extra per two extra DoS, capped at the mode's rate of fire). The BS test
# jams on 94+ (the Auto-Fire Jam mechanic) and cannot be voluntarily failed.
mechanic "Suppressing Fire" {
  meta { page 224 }
  on POST_ROLL
  priority 40
  when is_action("Suppressing Fire (Semi)")
    then emit "Suppressing Fire", "all targets in the 30 degree kill zone must pass a Difficult (-10) Pinning test or become Pinned (p.230); hits are assigned to RANDOM targets in the zone (the attacker cannot choose to fail the BS test)"
  when is_action("Suppressing Fire (Full)")
    then emit "Suppressing Fire", "all targets in the 45 degree kill zone must pass a Hard (-20) Pinning test or become Pinned (p.230); hits are assigned to RANDOM targets in the zone (the attacker cannot choose to fail the BS test)"
}
