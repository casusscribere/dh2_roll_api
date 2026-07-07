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
action "Semi-Auto Burst"  { type Half  attack }
action "Full Auto Burst"  { type Half  attack }
action "All Out Attack"   { type Full  attack }
action "Charge"           { type Full  attack }
action "Called Shot"      { type Full  attack }
action "Swift Attack"     { type Full  attack }
action "Lightning Attack" { type Full  attack }
action "Defensive Stance" { type Full }
action "Aim"              { type Half }

# Reactions — gate talents/qualities with is_reaction() or is_action("Parry").
action "Parry"            { type Reaction }
action "Dodge"            { type Reaction }
