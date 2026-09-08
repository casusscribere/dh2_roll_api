dsl 3
package "dh2.core.psychic" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# PSYCHIC POWERS (Phase 6) — the content of the power.* pipeline (Chapter VI).
# The engine (resolveFocusPower) owns the mechanism: psy strength and the push
# penalty (p.194), the class push caps (Table 6–1), the Focus Power d100 and
# the doubles test, the opposed resist, the Table 6–2 → 6–3 chain, and the
# attack-mode hit counts (p.198). Everything that VARIES by psyker class,
# circumstance, or talent is authored here as data:
#   - the per-class and sustaining modifiers to the Phenomena roll,
#   - the psychic talents (Favoured by the Warp, Warp Conduit, Warp Lock,
#     Bastion of Iron Will, Strong Minded),
#   - the Warp-tainted condition left by a survived Grand Incursion.
# The Force weapon's Focus Power rider lives with its quality in
# weapon-qualities.dsl. Tables: roll-tables.dsl.

# --- Table 6–1: Psychic Strength — class modifiers to Table 6–2 (p.195) --------
# Bound psykers roll Table 6–2 unmodified. Unbound psykers add +10 on doubles,
# or +5 per point pushed (their cap of +4 yields the printed +20 maximum).
# Daemonic psykers add +10 on doubles, or +10 per point pushed (cap +3 → +30),
# and are not affected by the result unless it is Perils of the Warp.
mechanic "Unbound psyker (Phenomena)" {
  meta { page 195 }
  on power.POST_ROLL
  priority 10
  when psyker_class == "unbound" and not is_pushing then set phenomena_roll += 10
  when psyker_class == "unbound" and is_pushing then set phenomena_roll += 5 * push
}

mechanic "Daemonic psyker (Phenomena)" {
  meta { page 195 }
  on power.POST_ROLL
  priority 10
  when psyker_class == "daemonic" and not is_pushing then set phenomena_roll += 10
  when psyker_class == "daemonic" and is_pushing then set phenomena_roll += 10 * push
  when psyker_class == "daemonic" then emit "Daemonic psyker", "not affected by the Psychic Phenomena unless the result is Perils of the Warp — though those around him might be (Table 6–1)"
}

# --- Sustaining psychic powers (p.198) ------------------------------------------
# "Should the psyker cause Psychic Phenomena while sustaining more than one
# power, he must add +10 to the result rolled on Table 6–2 for every power
# after the first he is sustaining." (The matching psy-rating reduction is
# engine mechanism — see psy.final.)
mechanic "Sustaining powers (Phenomena)" {
  meta { page 198 }
  on power.POST_ROLL
  priority 10
  when sustained >= 2 then set phenomena_roll += 10 * (sustained - 1)
}

# --- Warp-tainted (Perils 91–99, Grand Incursion survived; p.197) --------------
# "…forever adds +10 to all rolls on Table 6–2: Psychic Phenomena and Table
# 6–3: Perils of the Warp, as his polluted body now serves as a Warp conduit."
condition "Warp-Tainted" {
  meta { page 197 }
  on power.POST_ROLL
  priority 10
  when has_condition("Warp-Tainted") then set phenomena_roll += 10; set perils_roll += 10
}

# --- Favoured by the Warp (tier 3, p.130) -----------------------------------------
# "Whenever this character rolls on Table 6–2: Psychic Phenomena, so long as he
# does not receive the Perils of the Warp result, he may roll a second time and
# choose which result he receives." The engine rolls again and keeps the LOWER;
# both rolls are reported so the player can choose the other.
talent "Favoured by the Warp" tier 3 {
  meta { page 130 }
  on power.PHENOMENA
  when has_talent("Favoured by the Warp") and phenomena_roll < 75 then flag reroll_phenomena
}

# --- Warp Conduit (tier 2, p.132) ---------------------------------------------------
# "When Pushing, before rolling his Focus Power test the character may spend one
# Fate Point to add an additional 1d5 to the effective psy rating of the power.
# … he adds +30 to rolls on Table 6–2: Psychic Phenomena when he makes as a
# result of this talent." Spending the Fate point is the per-use
# configuration "Warp Conduit (Fate)"; the 1d5 raises potency only — the −10/pt
# push penalty stays on the rating the psyker chose.
talent "Warp Conduit" tier 2 {
  meta { page 132 }
  on power.MODIFIERS
  when has_talent("Warp Conduit") and configuration("Warp Conduit (Fate)") and is_pushing
  then set effective_psy_rating += 1d5; set phenomena_roll += 30; emit "Warp Conduit", "Fate Point spent: +1d5 effective psy rating for this power; +30 on Table 6–2"
}

# --- Warp Lock (tier 3, p.133) ------------------------------------------------------
# "Once per game session, he may ignore the Psychic Phenomena he has rolled
# (including the Perils of the Warp result …), completely negating its effects.
# … He suffers 1d5 Energy damage to the Head location (not reduced by Armour or
# Toughness) as a result, and cannot make any Focus Power tests or sustain other
# psychic powers until the beginning of his next turn." Used via the
# configuration "Warp Lock" (once per session — the GM tracks it).
talent "Warp Lock" tier 3 {
  meta { page 133 }
  on power.POST_ROLL
  priority 100
  when has_talent("Warp Lock") and configuration("Warp Lock") and phenomena
  then flag no_phenomena; declare damage 1d5, "Warp Lock: Energy damage to the Head, not reduced by Armour or Toughness; no Focus Power tests or sustaining until the beginning of his next turn (once per session)"
}

# --- Resisting psychic powers: the test.* side ---------------------------------------
# An opposed Focus Power runs the resister's Willpower test through the test.*
# pipeline as "Psychic Powers" (the engine adds 2 × psy rating for a resisting
# psyker, p.195). Resistance (Psychic Powers) lives in talents.dsl.

# Bastion of Iron Will (tier 3, p.122): "He adds 5 x his psy rating to any
# Opposed test he makes when defending against psychic powers."
talent "Bastion of Iron Will" tier 3 {
  meta { page 122 }
  on test.MODIFIERS
  when has_talent("Bastion of Iron Will") and is_test("Psychic Powers") and psy_rating > 0
  then add modifier "bastion of iron will" = 5 * psy_rating
}

# Strong Minded (tier 2, p.131): "He can re-roll failed Willpower tests to resist
# any psychic powers that affect his mind. This talent does not affect psychic
# powers that have a physical effect, such as Smite or Assail."
talent "Strong Minded" tier 2 {
  meta { page 131 }
  on test.POST_ROLL
  when has_talent("Strong Minded") and is_test("Psychic Powers") and not success
  then emit "Strong Minded", "may re-roll this failed Willpower test if the power affects his mind (not physical-effect powers such as Smite or Assail)"
}
