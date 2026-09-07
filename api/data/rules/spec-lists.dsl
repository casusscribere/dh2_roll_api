dsl 3
package "dh2.core.spec-lists" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Specialization sets for SPECIALIST talents — the rulebook's own
# "Specialisations:" lines from Chapter IV (Talents & Traits), transcribed as
# data so the Builder offers a dropdown instead of a blank, and the DSL stays
# the single authorable home for them. `open` = the book itself leaves the set
# extensible ("Other", "…at the GM's discretion"): consumers offer the options
# PLUS a write-in. Same-named spec_list declarations in campaign rule layers
# MERGE (union), so a campaign can add a weapon group without restating these.
#
# Open-ended specialist talents (Peer, Enemy, Exotic Weapon Training, Mastery)
# deliberately have NO list here — their specializations are user-supplied
# (Powers-of-Askellon groups, specific exotic weapons, any skill).

# Weapon Training talent (core rulebook, Chapter IV)
spec_list "Weapon Training" {
  "Bolt", "Chain", "Flame", "Heavy", "Las", "Launcher",
  "Melta", "Plasma", "Power", "Low-Tech", "Shock", "Solid Projectile"
}

# Resistance talent — the book's list ends in "Other": open by RAW
spec_list "Resistance" open {
  "Cold", "Fear", "Heat", "Poisons", "Psychic Powers", "Radiation", "Vacuum"
}

# Hatred talent — listed groups "and others including groups from the sidebar"
spec_list "Hatred" open {
  "Chaos Space Marines", "Daemons", "Mutants", "Psykers", "Xenos (specific)"
}

spec_list "Constant Vigilance" {
  "Intelligence", "Perception"
}

# The ranged/melee pair shared by several combat talents
spec_list "Inescapable Attack" { "Ranged", "Melee" }
spec_list "Precision Killer" { "Ranged", "Melee" }
spec_list "Deathdealer" { "Ranged", "Melee" }
spec_list "Two-Weapon Wielder" { "Ranged", "Melee" }

# Mechadendrite Use — "two broad categories" (core rulebook, Chapter IV)
spec_list "Mechadendrite Use" {
  "Weapon", "Utility"
}
