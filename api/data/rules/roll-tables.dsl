dsl 3
package "dh2.core.roll-tables" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

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

# --- Psychic Phenomena (DH2 core p.196, Table 6–2) ---------------------------
# Rolled by the power.* pipeline (Phase 6) when a Focus Power test triggers
# Phenomena: doubles normally, anything BUT doubles when pushing (p.194). The
# psyker's class, sustaining, and talents add to the roll (`set phenomena_roll
# += …`); a result of 75+ chains into Table 6–3: Perils of the Warp.
roll_table "Psychic Phenomena" {
  die 1d100
  1-3:   "Dark Foreboding: A faint breeze blows past the psyker and those near him, and everyone gets the feeling that somewhere in the galaxy something unfortunate just happened."
  4-5:   "Warp Echo: For a few moments, all noises cause echoes, regardless of the surroundings."
  6-8:   "Unholy Stench: The air around the psyker becomes permeated with a bizarre and foul smell."
  9-11:  "Mind Warp: The psyker suffers a –5 penalty to Willpower tests until the start of his next turn as his own inherent phobias, suspicions, and hatreds surge to the surface of his mind in a wave of unbound emotion."
  12-14: "Hoarfrost: The temperature plummets for an instant, and a thin coating of frost forms to cover everything within 3d10 metres."
  15-17: "Aura of Taint: All animals within 1d100 metres become spooked and agitated; characters can use the Psyniscience skill to pinpoint the psyker as the cause."
  18-20: "Memory Worm: All people within line of sight of the psyker forget some trivial fact or minor personal memory."
  21-23: "Spoilage: Food and drink go bad in a 5d10 metre radius."
  24-26: "Haunting Breeze: Winds whip up around the psyker for a few moments, blowing light objects around and guttering fires within 3d10 metres."
  27-29: "Veil of Darkness: For a brief moment (effectively, until the end of the round), the area within 3d10 metres is plunged into immediate and impenetrable darkness."
  30-32: "Distorted Reflections: Mirrors and other reflective surfaces within a radius of 5d10 metres distort or shatter."
  33-35: "Breath Leech: Each character (including the psyker) within a 3d10 metre radius becomes short of breath for one round and cannot make any Run or Charge actions."
  36-38: "Daemonic Mask: For a fleeting moment, the psyker takes on a daemonic appearance and gains the Fear (1) trait until the start of the next turn. However, he also gains 1 Corruption point."
  39-41: "Unnatural Decay: All plant life within 3d10 metres of the psyker withers and dies."
  42-44: "Spectral Gale: Howling winds erupt around the psyker, requiring each character (including the psyker) within 4d10 metres to make an Easy (+30) Agility or Strength test to avoid being knocked Prone."
  45-47: "Bloody Tears: Blood weeps from stone and wood within 3d10 metres of the psyker. If there are any paintings, pict-displays, statues, or other representations of people inside this area, they appear to be crying blood."
  48-50: "The Earth Protests: The ground suddenly shakes, and each character (including the psyker) within a 5d10 metre radius must make an Ordinary (+10) Agility test or be knocked down."
  51-53: "Actinic Discharge: Static electricity fills the air within 5d10 metres causing hair to stand on end and unprotected electronics to short out, while the psyker is wreathed in eldritch lightning. The GM is free to resolve the specifics as needed, perhaps using Table 5–4: Haywire Field Effects (see page 147) to provide guidance."
  54-56: "Warp Ghosts: Ghostly apparitions fill the air within 3d10 metres around the psyker, flying about and howling in pain for a few brief moments. Each character in the radius (except the psyker himself) must test against Fear (1)."
  57-59: "Falling Upwards: Everything within 2d10 metres of the psyker (including the psyker himself) rises 1d10 metres into the air as gravity briefly ceases. Almost immediately, everything crashes back to earth, suffering falling damage as appropriate for the distances fallen."
  60-62: "Banshee Howl: A shrill keening rings out across the immediate area, shattering glass and forcing each living creature able to hear it (including the psyker) to pass a Challenging (+0) Toughness test or be deafened for 1d10 rounds."
  63-65: "The Furies: The Psyker is assailed by unseen horrors. He is slammed to the ground and suffers 1d5 Impact damage (ignoring Armour, but not Toughness bonus) and he must test against Fear (2)." => "Prone"
  66-68: "Shadow of the Warp: For a split second, the world changes in appearance, and everyone within 1d100 metres has a brief but horrific glimpse of the shadow of the Warp. Each character in the area (including the psyker) must make a Difficult (–10) Willpower test or gain 1d5 Corruption points."
  69-71: "Tech Scorn: The machine spirits reject these unnatural ways. All un-warded technology within 5d10 metres malfunctions momentarily, and all ranged weapons jam (see page 224). Each character (including the psyker) withing that range with cybernetic implants must pass an Ordinary (+10) Toughness test or suffer 1d5 Rending damage, ignoring Toughness bonus and Armour."
  72-74: "Warp Madness: A violent ripple of tainted discord causes all characters (except the psyker) within 2d10 metres to make a Difficult (–10) Willpower test; each character who fails gains 1d5 Corruption points and becomes Frenzied for 1 round (see page 127)."
  75-100: "Perils of the Warp: The Warp opens in a wild maelstrom of unnatural energy. Roll on Table 6–3: Perils of the Warp (page 197)."
}

# --- Perils of the Warp (DH2 core p.197, Table 6–3) --------------------------
# Chained from a Psychic Phenomena result of 75+. Modifiers accumulate under
# `set perils_roll += …` (a Warp-tainted psyker's permanent +10, p.197).
roll_table "Perils of the Warp" {
  die 1d100
  1-5:   "The Gibbering: The psyker screams in pain as uncontrolled Warp energies surge through his unprepared mind. He must make a Challenging (+0) Willpower test or be Stunned for 1d5 rounds."
  6-9:   "Warp Burn: A violent burst of energy from the Warp smashes into the psyker’s mind, sending him reeling. He suffers 2d5 Energy damage, ignoring Toughness bonus and Armour, and is Stunned for 1d5 rounds." => "Stunned"
  10-13: "Psychic Concussion: With a crack of energy, the psyker is knocked unconscious for 1d5 rounds, and everyone within 3d10 metres must make an Ordinary (+10) Willpower test or be Stunned for one round." => "Unconscious"
  14-18: "Psy Blast: There is an explosion of power and the psyker is thrown 3d10 metres into the air, plummeting to the ground moments later (see page 243 for rules concerning falling damage)."
  19-24: "Soul Sear: Warp power courses through the psyker’s body, scorching his soul. The psyker cannot use any psychic powers for the next hour, and gains 2d5 Corruption points."
  25-30: "Locked In: The power cages the psyker’s mind in an ethereal prison, tormented by visions of the Warp. The psyker falls to the ground Prone and Unconscious. At the beginning of each of his turns until he breaks free, he must spend a Full Action to make a Difficult (–10) Willpower test. If he succeeds, his mind is freed and restored to his body, haunted by his experiences but otherwise unharmed." => "Prone", "Unconscious"
  31-38: "Chronological Incontinence: Time warps around the psyker. He winks out of existence and reappears in 1d10 rounds (or one minute in narrative time) in the exact location. He suffers one point of permanent Toughness and Intelligence damage as his body and mind rebel against the experience, and gains 1d5 Corruption points."
  39-46: "Psychic Mirror: The psyker’s power is turned back on him. Resolve the power’s effects, but the power targets the psyker instead. If the power is beneficial, it deals 1d10+5 Energy damage (ignoring Armour) to the psyker’s Body instead of having its normal effect."
  47-55: "Warp Whispers: The voices of Daemons fill the air within 4d10 metres of the psyker, whispering terrible secrets and shocking truths. Each character in range (including the psyker) must make a Hard (–20) Willpower test or gain 1d5 Corruption points and suffer an equal amount of Willpower damage. Whether or not the psyker passes the Willpower test, he suffers an additional 1d5+5 Willpower damage."
  56-58: "Vice Versa: The psyker’s mind is thrown out of his body and into another nearby creature or person. The psyker and a random living creature (friend or foe, but not a Daemon, machine, or other “soulless” entity) within 50 metres swap consciousness for 1d10 rounds. Each creature retains its Weapon Skill, Ballistic Skill, Intelligence, Perception, Willpower, and Fellowship during the swap, but uses the other characteristics of the host body. If either body is slain, the effect ends immediately and both parties return to their original bodies. Both suffer 1d5 Intelligence damage from the experience. If there are no creatures within range, the psyker becomes catatonic for 1d5 rounds while his mind wanders the Warp. This journey inflicts 1d10 Willpower damage, 1d10 Intelligence damage, and 1d10 Corruption points."
  59-67: "Dark Summoning: The Empyrean buckles and tears at the arrogance of the psyker, and a Plaguebearer (see page 415) or another lesser Daemon at the GM’s discretion rips its way into existence. The pestilent fiend appears within 3d10 metres of the psyker, for a number of rounds equal to 1d5 plus the psyker’s Toughness bonus. The psyker’s turn immediately ends, and the Daemon takes its turn immediately. It detests the psyker and focuses all of its attacks upon the fool who unwittingly summoned it. It does not attack anyone else, even if others attack it; if the psyker is slain, it returns back to the Warp, satisfied with its kill."
  68-72: "Rending the Veil: The air vibrates with images of cackling Daemons and the kaleidoscopic fabric of the Warp is rendered visible to mortal eyes. All sentient creatures within 1d100 metres must test against Fear (2). The psyker must test against Fear (4) instead. This effect lasts for 1d5 rounds."
  73-78: "Blood Rain: A psychic storm erupts, covering an area of 5d10 metres. Each character in range (including the psyker) must make a Challenging (+0) Strength test or be knocked Prone. In addition to howling winds and rains of blood, any psychic powers used in the area for 1d5 rounds automatically invoke Perils of the Warp, in addition to any Psychic Phenomena caused. The psyker gains 1d5+1 Corruption points."
  79-82: "Cataclysmic Blast: The psyker’s power overloads, arcing out in great bolts of Warp energy. Each character within 1d10 metres (including the psyker) takes 1d10 Energy damage with a Pen of 5. The psyker may not Dodge this, or stop the attack with a force field (see page 168). In addition, all of the psyker’s clothing, armour, and gear is destroyed, leaving him naked and smoking on the ground, and he cannot use further powers for 1d5 hours after the event."
  83-86: "Mass Incursion: Chaos Furies (page 417) emerge from the Warp, hungry for souls. Each character within 1d100 metres of the psyker (including himself) must make a Hard (–20) Willpower test or gain 1d10 Corruption and Insanity points, and suffer 1d10 Willpower damage. Each character who succeeds is attacked physically by a Fury, which departs after 1d5 rounds."
  87-90: "Reality Quake: Reality buckles around the psyker, and an area radiating out 3d10 metres from him is sundered: solid objects alternately rot, burn, and freeze, and everyone and everything in the area suffers a single hit for 2d10 Rending damage that ignores Armour and cannot be Dodged. Warded objects, Daemons, and Untouchables halve the damage they would suffer."
  91-99: "Grand Incursion: A great and terrible Warp entity takes an interest in the psyker's flesh. Use the profile for Putricifex, Herald of Nurgle from page 416 (or another suitably powerful Daemon) to represent the attacker, who instantly makes an Opposed Very Hard (–20) Willpower test against the psyker. If the Daemon wins, it possesses the psyker's body for 1 hour per degree by which it won the test. The psyker gains 2d10 Insanity and Corruption points and is controlled by the Daemon until the effect ends. If he dies while possessed, the Daemon physically manifests for the remainder of the effect's duration. If the psyker wins the test, he suffers 2d10 Toughness damage, and forever adds +10 to all rolls on Table 6–2: Psychic Phenomena and Table 6–3: Perils of the Warp, as his polluted body now serves as a Warp conduit."
  100-100: "Annihilation: The psyker is immediately burned to ashes by the screaming fires of the Immaterium or dragged into the deepest maelstrom of the Warp. He cannot burn Fate to avert this death and is irrevocably destroyed. There is a chance that a daemonic entity of some sort appears in his place—the type of Daemon is determined by the GM, based on how powerful the psyker was, as more powerful psykers draw more powerful Daemons. The percentage chance that the Daemon appears is equal to the psyker’s Willpower characteristic (roll a 1d100, if the result is equal to or under the characteristic, the Daemon appears)."
}
