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
# (Unbraced moved to configurations.dsl — it is a per-shot stance the PLAYER
#  chooses, not an environmental circumstance.)

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

# --- Firing into Melee (DH2 core p.229) --------------------------------------
# "Ballistic Skill tests made to hit a target engaged in melee combat suffer a
# -20 penalty. If one or more characters engaged in the melee are Stunned,
# Helpless, or Unaware, this penalty is ignored." The exemption is GM-side:
# simply do not flag the circumstance when it applies. Injected at priority 10
# so the Target Selection talent (talents.dsl) can cancel it at 100.
circumstance "Firing into Melee" {
  meta { page 229 }
  on MODIFIERS
  priority 10
  when has_circumstance("Firing into Melee") and is_ranged
  then add modifier "firing_into_melee" = -20
}

# --- Baneful Presence (X) (DH2 core p.135) -----------------------------------
# A TRAIT of a daemonic foe, modelled as a circumstance on the SUFFERER's tests
# because the engine has no aura/range model: "All characters suffer a -10
# penalty to Willpower tests taken while within X metres of the creature."
# The GM flags the circumstance on Willpower-based tests rolled inside the
# radius — the Willpower-based test tags in use are "Willpower", "Fear",
# "Pinning". Cancelled outright by Iron Faith (talents.dsl, Enemies Beyond p.61).
circumstance "Baneful Presence" {
  meta { page 135 }
  on test.MODIFIERS
  priority 10
  when has_circumstance("Baneful Presence") and (is_test("Willpower") or is_test("Fear") or is_test("Pinning"))
  then add modifier "baneful presence" = -10
}
