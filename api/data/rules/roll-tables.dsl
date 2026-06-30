# DH2 roll tables — data for the `roll_on` action.
#
# A roll_table names a die and a set of <lo>[-<hi>]: "outcome" rows; an optional
# `=> "Status", …` applies those statuses to the target when that row comes up.
# Rules invoke a table with `roll_on "Table Name"`; the engine rolls the die,
# finds the row, records the result, and applies any statuses. These tables are
# pure data — the scatter direction, Haywire field, and Hallucinogenic delusion
# all live here instead of being hard-coded in the engine.

# --- Scatter Diagram (DH2 core p.230) ---------------------------------------
# Invoked by Blast (and any scattering weapon) to determine WHICH WAY a missed
# shot lands. The engine uses the rolled value as the scatter direction.
roll_table "Scatter Diagram" {
  die 1d10
  1:  "directly beyond the target (overshoot)"
  2:  "beyond and to the right"
  3:  "to the right"
  4:  "short and to the right"
  5:  "directly short — back toward the firer"
  6:  "short and to the left"
  7:  "to the left"
  8:  "beyond and to the left"
  9:  "wide of the mark"
  10: "wildly off-axis"
}

# --- Haywire Field Effects (DH2 core p.146, Table 5–4) ----------------------
# Invoked on a hit by a Haywire weapon to determine the field strength.
roll_table "Haywire Field Effects" {
  die 1d10
  1-2:  "Insignificant — some machine spirits are unsettled, but no noticeable effect on nearby technology."
  3-4:  "Minor Disruption — powered actions (non-Primitive ranged attacks, Tech-Use, power-armour/cybernetic actions) suffer -10; power-armour move -1."
  5-6:  "Major Disruption — those actions suffer -20; power-armour move -3; technological melee weapons function as Primitive."
  7-8:  "Dead Zone — technology ceases; power armour unpowered (move 1); cybernetic organs cause 1 level of Fatigue per round."
  9-10: "Prolonged Dead Zone — as Dead Zone for 1d5 rounds, then lessens to Major Disruption."
}

# --- Hallucinogenic Effects (DH2 core p.145, Table 5–3) ----------------------
# Rolled when a target FAILS the Toughness test forced by a Hallucinogenic
# weapon. Some delusions impose conditions on the target (=> statuses).
roll_table "Hallucinogenic Effects" {
  die 1d10
  1:  "Bugsbugsbugs! He drops to the floor clawing at imaginary insects devouring his flesh." => "Prone", "Stunned"
  2:  "My hands…! He drops everything and spends the duration staring at his hands, screaming." => "Stunned"
  3:  "They're coming through the walls! Each turn he fires at a random piece of terrain in sight."
  4:  "Nobody can see me! He wanders aimlessly, using a Full Action to move (retains Reactions)."
  5:  "I can fly! He flaps his arms; if above ground level he may hurl himself off in a random direction."
  6:  "They've got it in for me! Paranoid, he moves to cover out of line of sight and stays hidden."
  7:  "They got me! He collapses as if dead and counts as Helpless." => "Helpless"
  8:  "I'll take you all on! Filled with rage, he becomes Frenzied and attacks the closest opponent." => "Frenzied"
  9:  "I'm only little! He believes he has shrunk; all others count as having the Fear (3) trait to him."
  10: "The worms! Convinced a worm crawls up his leg, he attacks his own leg (1 hit, 1d5 DoS, normal damage)."
}

# --- Power Field weapon destruction (DH2 core p.148) ------------------------
# Rolled when a Power Field weapon SUCCESSFULLY Parries an attack made with a
# weapon that lacks Power Field (and is not Force / Warp / a Natural Weapon). On
# a 26 or higher, the attacker's weapon is destroyed.
roll_table "Power Field Destruction" {
  die 1d100
  1-25:   "The blow is turned aside; the attacker's weapon survives."
  26-100: "The power field shears clean through — the attacker's weapon is DESTROYED."
}
