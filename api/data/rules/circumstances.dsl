dsl 3
package "dh2.core.circumstances" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Circumstances — situational modifiers derived from the environment or the
# framing of an action (not purchasable talents, not active conditions, not
# per-character configurations). Gated on has_circumstance("…") (or a fact);
# eventually hook into a map/scene-aware system (see FOUNDRY_MIGRATION.md).
# Supplied per attack via circumstances: ["…"] (entries may be structured objects
# { name, severity } for circumstances that carry a strength, e.g. Haywire Field).

# --- Darkness (DH2 core p.229) ----------------------------------------------
# Fighting in darkness: Weapon Skill tests suffer -20, Ballistic Skill tests -30.
circumstance "Darkness" {
  meta { page 229 }
  on MODIFIERS
  when has_circumstance("Darkness") and is_melee  then add modifier "darkness" = -20
  when has_circumstance("Darkness") and is_ranged then add modifier "darkness" = -30
}

# --- Haywire Field (DH2 core p.146, Table 5-4) ------------------------------
# An ENVIRONMENTAL field left by a Haywire weapon (see weapon-qualities.dsl). It is
# ONE circumstance carrying a severity (1-5 = Insignificant / Minor Disruption /
# Major Disruption / Dead Zone / Prolonged Dead Zone) rather than five separate
# conditions — RAW the field "lessens one step in severity each round", so a single
# severity that degrades models it cleanly. The Haywire roll establishes the field
# strength; set it via circumstances: [{ name: "Haywire Field", severity: N }].
# Powered ranged attacks (non-Primitive) suffer the field penalty, worsening by
# severity threshold: 2 Minor = -10, 3 Major = -20, 4-5 Dead Zone = -60 (technology
# ceases — powered weapons effectively cannot fire). Primitive weapons are exempt.
# --- Unbraced heavy weapon (DH2 core p.219) ----------------------------------
# "If a character fires an unbraced Heavy weapon, he suffers a -30 penalty to
# his [attack test]." Weapon class is not modelled, so flag the shot with the
# "Unbraced" circumstance; Auto-Stabilised (traits.dsl) cancels it.
circumstance "Unbraced" {
  meta { page 219 }
  on MODIFIERS
  when has_circumstance("Unbraced") and is_ranged
  then add modifier "unbraced" = -30
}

circumstance "Haywire Field" {
  meta { page 147 }
  on MODIFIERS
  when has_circumstance("Haywire Field") and is_ranged and not has_quality("Primitive") and circumstance_severity("Haywire Field", 0) == 2
    then add modifier "haywire field" = -10
  when has_circumstance("Haywire Field") and is_ranged and not has_quality("Primitive") and circumstance_severity("Haywire Field", 0) == 3
    then add modifier "haywire field" = -20
  when has_circumstance("Haywire Field") and is_ranged and not has_quality("Primitive") and circumstance_severity("Haywire Field", 0) >= 4
    then add modifier "haywire field" = -60
}
