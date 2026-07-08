// api/lib/dice.mjs
var d = (sides, rng = Math.random, label = "") => Math.floor(rng(sides, label) * sides) + 1;
function rollScript(forced = [], base = Math.random) {
  const trace = [];
  const fn = (sides = 100, label = "") => {
    const index = trace.length;
    const f = forced[index];
    const want = f !== null && f !== void 0 && f !== "" && Number.isFinite(+f) ? +f : null;
    const value = want !== null ? Math.min(sides, Math.max(1, Math.floor(want))) : Math.floor(base() * sides) + 1;
    trace.push({ index, sides, label, value, forced: want !== null });
    return (value - 0.5) / sides;
  };
  fn.trace = trace;
  return fn;
}
function parseDamageFormula(formula) {
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(formula));
  if (!m) return null;
  return {
    count: parseInt(m[1]),
    sides: parseInt(m[2]),
    flat: m[3] ? (m[3] === "-" ? -1 : 1) * parseInt(m[4]) : 0
  };
}
var getDegree = (a, b) => Math.floor(a / 10) - Math.floor(b / 10);

// api/lib/hit-locations.mjs
function getHitLocationForRoll(roll) {
  const reversed = parseInt(String(roll).split("").reverse().join(""));
  const table = [
    { name: "Head", min: 0, max: 10 },
    { name: "Right Arm", min: 11, max: 20 },
    { name: "Left Arm", min: 21, max: 30 },
    { name: "Body", min: 31, max: 70 },
    { name: "Right Leg", min: 71, max: 85 },
    { name: "Left Leg", min: 86, max: 100 }
  ];
  return table.find((i) => reversed >= i.min && reversed <= i.max)?.name ?? "Body";
}
var ADDITIONAL_HIT_LOCATIONS = {
  "Head": ["Head", "Head", "Right Arm", "Body", "Left Arm", "Body"],
  "Right Arm": ["Right Arm", "Right Arm", "Body", "Head", "Body", "Right Arm"],
  "Left Arm": ["Left Arm", "Left Arm", "Body", "Head", "Body", "Left Arm"],
  "Body": ["Body", "Body", "Left Arm", "Head", "Right Arm", "Body"],
  "Right Leg": ["Right Leg", "Right Leg", "Body", "Right Arm", "Head", "Body"],
  "Left Leg": ["Left Leg", "Left Leg", "Body", "Left Arm", "Head", "Body"]
};

// api/lib/critical-damage.mjs
function criticalDamage() {
  return {
    "Energy": {
      "Arm": {
        1: "The attack grazes the target\u2019s arm, causing it to spasm uncontrollably with pain. All tests involving that arm suffer a \u201330 penalty for [[1d5]] rounds",
        2: "The attack smashes into the arm, sending currents of energy crackling down to the fingers and up to the shoulder. The target suffers 1 level of Fatigue, and that arm is Useless for [[1d5]] rounds.",
        3: "The arm suffers superficial burns inflicting no small amount of pain on the target. The target suffers [[1d5]] levels of Fatigue, and can take only a Half Action during his next turn.",
        4: "The shock of the attack causes the character to temporarily lose control of his autonomous functions. He is Stunned for 1 round and is knocked Prone. The arm is Useless for [[1d10]] rounds.",
        5: "The attack causes energy to course through the target\u2019s arm. He is Stunned for 1 round, and the arm is Useless until the target receives medical treatment.",
        6: "The attack wreathes the arm in flame, scorching clothing and armour, and temporarily fusing together the target\u2019s fingers. The target suffers [[1d5]] levels of Fatigue and [[1d5]] Weapon Skill and Ballistic Skill damage, and he must make a Challenging (+0) Toughness test for suffer the Lost Hand condition.",
        7: "With a terrible snapping sound, the heat of the attack boils the marrow in the target\u2019s arm, causing it to crack or even shatter. The target suffers [[1d5]] levels of Fatigue and is Stunned for 1 round. His arm is Useless until it is repaired.",
        8: "Energy ripples across the target\u2019s arm, causing skin and muscle to slough disgustingly from the target\u2019s limb, revealing a sticky red mess of sinew and bone. The target suffers [[1d10]] levels of Fatigue and must make a Challenging (+0) Toughness test or be Stunned for [[1d5]] rounds. He now suffers from the Lost Arm condition.",
        9: "Fire consumes the target\u2019s arm, burning the flesh to a crisp right down to the bone. The target must make an immediate Challenging (+0) Toughness test or die from shock. If he survives, the target suffers [[1d10]] levels of Fatigue and is Stunned for 1 round. The target now suffers from the Lost Arm condition.",
        10: "The attack reduces the arm to a cloud of crimson ash and sends the target crumbling to the ground. He immediately dies from shock, clutching his smoking stump."
      },
      "Body": {
        1: "A blow to the target\u2019s body steals the air from his lungs. The target can take only a Half Action on his next turn.",
        2: "The blast punches the air from the target\u2019s body. He must make a Challenging (+0) Toughness test or be knocked Prone.",
        3: "The attack cooks the flesh on the chest and abdomen. He suffers 2 levels of Fatigue and [[1d5]] Toughness damage.",
        4: "The energy ripples all over the character, scorching his body with horrid third-degree burns. The target suffers [[1d10]] levels of Fatigue, and can only take a Half Action on his next turn.",
        5: "The fury of the attack forces the target to the ground, helplessly covering his face and keening in agony. The target is knocked Prone and must make a Challenging (+0) Agility test or catch fire. The target must also make a Challenging (+0) Toughness test or be Stunned for 1 round.",
        6: "Struck by the full force of the attack, the target is sent reeling to the ground; smoke spiraling out from the wound. The target suffers [[1d5]] levels of Fatigue, is knocked Prone, and is Stunned for [[1d10]] rounds. In addition, he must make a Challenging (+0) Agility test or catch fire.",
        7: "The intense power of the energy attack cooks the target\u2019s organs, burning his lungs and heart with intense heat. The target is Stunned for [[2d10]] rounds, and his Toughness characteristic is permanently reduced by [[1d10]].",
        8: "As the attack washes over the target, his skin turns black and peels off, while melted fat seeps from his clothing and armour. The target is Stunned for [[2d10]] rounds. His Strength, Toughness, and Agility characteristics are reduced by half (rounding up) until he receives medical treatment. Permanently reduce the character\u2019s Fellowship characteristic by [[2d5]].",
        9: "The target is completely encased in fire, melting his skin and bursting his eyes like superheated eggs. He falls to the ground a lifeless corpse, blackened and charred with horrid burns.",
        10: "The target is completely encased in fire, melting his skin and bursting his eyes like superheated eggs. He falls to the ground a lifeless corpse, blackened and charred with horrid burns. If the target is carrying any ammunition, roll [[1d10]]: on a result of 6 or higher, it explodes. Each target within [[1d5]] metres suffers a single hit for [[1d10+5]] Explosive damage to a randomly determined Hit Location. If the target carried any grenades or missiles, these detonate on the character\u2019s corpse with their normal effects one round after his demise."
      },
      "Head": {
        1: "A grazing blow to the head disorientates the target. He suffers a -10 penalty to all tests (except Toughness tests) for 1 round.",
        2: "The blast of energy dazzles the target. He is Blinded for 1 round.",
        3: "The attack cooks off the target's ear, leaving him with a partially burned stump of cartilage. He is Deafened for [[1d5]] hours (or until he receives medical attention).",
        4: "The energy attack burns away all of the hairs on the target's head, as well as leaving him reeling from the injury. The target suffers 2 levels of Fatigue and the target is Blinded for [[1d5]] rounds.",
        5: "A blast of energy envelops the target's head, burning his face and hair, crisping his skin, and causing him to scream like a stuck grox. In addition to losing all hair on his scalp and face, he is Blinded for [[1d10]] rounds and Stunned for 1 round. Permanently reduce the target's Fellowship characteristic by 1.",
        6: "The attack cooks the target's face, melting his features and damaging his eyes. The target suffers [[1d5]] levels of Fatigue and is Blinded for [[1d10]] hours. Permanently reduce his Fellowship and Perception characteristics by [[1d5]].",
        7: "In a gruesome display, the flesh is burned from the target's head, exposing charred bone and muscle underneath. The target suffers [[1d10]] levels of Fatigue. He is Blinded permanently. Roll [[1d10]]; this is the target's new Fellowship characteristic value. If his Fellowship value is already 10 or lower, this can be skipped as no one would notice any difference in his behaviour and demeanour.",
        8: "The target's head is destroyed in a conflagration of fiery death. He does not survive.",
        9: "Superheated by the attack, the target's brain explodes, tearing apart his skull and sending flaming chunks of meat flying at those nearby. The target is very, very dead.",
        10: "Superheated by the attack, the target's brain explodes, tearing apart his skull and sending flaming chunks of meat flying at those nearby. The target is very, very dead. The target's entire body catches fire and runs off headless [[2d10]] metres in a random direction (use the Scatter Diagram on page 230). Anything flammable it passes, including characters, must make a Challenging (+0) Agility test or catch fire (see page 243)."
      },
      "Leg": {
        1: "The blast of energy sears the flesh and bone of the target's leg, leaving a nasty burn scar. The target cannot use the Run or Charge actions for 2 rounds.",
        2: "The attack flash-fries the target's leg, cooking chunks of flesh into char. The target must pass a Challenging (+0) Toughness test or suffer 1 level of Fatigue.",
        3: "A solid blow to the leg sends currents of agony coursing through the target. The target suffers 1 level of Fatigue and is knocked Prone. Reduce his Movement by half (rounding up) for [[1d10]] rounds.",
        4: "The blast causes a nasty compound fracture in the target's leg. Until the target receives medical attention, reduce his Movement by half (rounding up), and he cannot use the Run or Charge actions.",
        5: "The target's leg endures horrific burn damage, fusing clothing and armour with flesh and bone. The target suffers 1 level of Fatigue and is knocked Prone. Reduce his Movement by half (rounding up) for [[2d10]] rounds.",
        6: "The attack burns the target's foot, charring the flesh and emitting a foul aroma. The target suffers 2 levels of Fatigue. He must also make a Challenging (+0) Toughness test. If he succeeds, reduce his Movement by half (rounding up) until he receives medical attention; if he fails, he suffers the Lost Foot condition (see page 243).",
        7: "The energy attack fries the leg, leaving it a mess of blackened flesh. The leg is broken and until repaired, the target counts as having lost the leg. He suffers [[1d5]] levels of Fatigue. He must also make a Challenging (+0) Toughness test or be Stunned for 1 round. He now suffers the Lost Leg condition (see page 243).",
        8: "Energy sears through the bone, causing the leg to be severed. The target suffers [[1d10]] levels of Fatigue and suffers Blood Loss. He must also make a Challenging (+0) Toughness test or be Stunned for 1 round. He now suffers the Lost Leg condition (see page 243).",
        9: "The force of the attack reduces the leg to little more than a chunk of sizzling gristle. The target must make a Challenging (+0) Toughness test or die from shock. He now suffers the Lost Leg condition (see page 243).",
        10: "In a terrifying display of power, the leg immolates and thick fire consumes the target completely. He dies in a matter of agonizing seconds, his scorched corpse surrounded with smoke and flames."
      }
    },
    "Explosive": {
      "Arm": {
        1: "The attack throws the limb backwards, painfully jerking it away from the body. The target suffers 1 level of Fatigue.",
        2: "The force of the blast snaps the bones of the arm in half. The target drops anything held in that hand and must pass a Challenging (+0) Toughness test or be Stunned for 1 round.",
        3: "The explosion removes 1 finger (and the tips from up to [[1d5]] others) from the target's hand. The target suffers [[1d10]] Weapon Skill and [[1d10]] Ballistic Skill damage, and anything he was carrying in that hand is destroyed. If this is an explosive such as a grenade, it detonates; immediately resolve the 9 effect on this table upon the target.",
        4: "The blast rips the sinew of the arm straight from the bone. The target is Stunned for 1 round and must make a Challenging (+0) Toughness test or suffer Blood Loss. The limb is Useless until the target receives medical attention.",
        5: "Fragments from the explosion tear into the target's hand, ripping away flesh and muscle alike. He must immediately make an Ordinary (+10) Toughness test. If he succeeds, permanently reduce his Weapon Skill and Ballistic Skill characteristics by 1; if he fails, he suffers the Lost Hand condition (see page 242).",
        6: "The explosive attack shatters the bone and mangles the flesh, turning the target's arm into a red ruin. The target suffers Blood Loss and [[1d5]] levels of Fatigue. The arm is Useless until he receives medical attention",
        7: "In a violent hail of flesh, the arm is blown apart. The target must immediately make a Challenging (+0) Toughness test or die from shock. If he survives, he suffers [[1d10]] levels of Fatigue, is Stunned for [[1d10]] rounds, and suffers Blood Loss. The target now suffers from the Lost Arm condition (see page 242).",
        8: "The arm disintegrates under the force of the explosion, taking a good portion of the shoulder and chest with it. The target is sent screaming to the ground, where he dies in a pool of his own blood and organs.",
        9: "With a mighty bang the arm is blasted from the target's body, killing the target instantly in a rain of blood droplets. In addition, if the target was carrying a weapon with a power source in his hand (such as a power sword or chainsword), then it violently explodes, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location upon each target to anyone within two metres.",
        10: "With a mighty bang the arm is blasted from the target's body, killing the target instantly in a rain of blood droplets. In addition, if the target was carrying a weapon with a power source in his hand (such as a power sword or chainsword), then it violently explodes, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location upon each target to anyone within two metres. If the target is carrying any ammunition it explodes, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location upon each target within [[1d10]] metres (in addition to the hit noted above). If the target is carrying any grenades or missiles, these also detonate immediately with their normal effects."
      },
      "Body": {
        1: "The explosion flings the target backwards [[1d5]] metres. The target is knocked Prone.",
        2: "The target is blown backwards [[1d5]] metres by a terrific explosion, suffering 1 level of Fatigue per metre travelled. The target is knocked Prone.",
        3: "The force of the blast sends the target sprawling to the ground. The target is knocked backwards [[1d5]] metres, Stunned for 1 round, and is knocked Prone.",
        4: "The power of the explosion rends flesh and bone with horrific results. The target must make a Challenging (+0) Toughness test or suffer from Blood Loss and be Stunned for 1 round.",
        5: "Concussion from the explosion knocks the target to the ground and turns his innards into so much ground meat. The target suffers [[1d5]] levels of Fatigue and is knocked Prone. He must immediately make a Challenging (+0) Toughness test; if he fails, he suffers Blood Loss and his Toughness characteristic is permanently reduced by 1.",
        6: "Chunks of the target's flesh are ripped free by the force of the attack leaving large, weeping wounds. The target is Stunned for 1 round and suffers Blood Loss.",
        7: "The explosive force of the attack ruptures the target's flesh and scrambles his nervous system, knocking him to the ground. The target is Stunned for [[1d10]] rounds and is knocked Prone He also suffers Blood Loss, and must make a Challenging (+0) Toughness test or fall Unconscious.",
        8: "The target's chest explodes outward, disgorging a river of partially cooked organs onto the ground, killing him instantly.",
        9: "Pieces of the target's body fly in all directions as he is torn into bloody gobbets. If the target is carrying any ammunition, it explodes, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location upon each target within [[1d10]] metres. If the target is carrying any grenades or missiles, these detonate immediately.",
        10: "Pieces of the target's body fly in all directions as he is torn into bloody gobbets. If the target is carrying any ammunition, it explodes, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location upon each target within [[1d10]] metres. If the target is carrying any grenades or missiles, these detonate immediately. Anyone within [[1d10]] metres of the target is drenched in gore. Each affected character must make a Challenging (+0) Agility test or suffer a -10 penalty to Weapon Skill and Ballistic Skill tests for 1 round, as blood fouls his sight."
      },
      "Head": {
        1: "The explosion leaves the target confused. He can take only a Half Action on his next turn as he recovers his senses.",
        2: "The flash and noise leaves the target Blinded and Deafened for 1 round.",
        3: "The detonation leaves the target's face a bloody ruin from scores of cuts. Permanent scarring is very likely. The target suffers 2 levels of Fatigue and must make a Challenging (+0) Toughness test or suffer [[1d10]] points of Perception and Fellowship damage.",
        4: "The force of the blast knocks the target to the ground and leaves him senseless. The target suffers [[1d10]] Intelligence damage and is knocked Prone. He must also pass a Challenging (+0) Toughness test; if he fails, he is Stunned for 2 rounds and his Intelligence characteristic is permanently reduced by 1.",
        5: "The explosion flays the flesh from the target's face and bursts his eardrums with its force. The target is Stunned for [[1d10]] rounds and is permanently Deafened. Permanently reduce his Fellowship characteristic by 1d5.",
        6: "The target's head explodes under the force of the attack, leaving his headless corpse to spurt blood from the neck for the next few minutes. Needless to say, this is instantly and messily fatal.",
        7: "Both head and body are blown into a mangled mess, instantly killing the target. If he is carrying any ammunition, it explodes, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location on each target within [[1d5]] metres. If the target was carrying any grenades or missiles, these also detonate immediately with their normal effects.",
        8: "In a series of unpleasant explosions the target's head and torso peel apart, leaving a gory mess on the ground. For the rest of the fight, anyone moving over this spot must make a Challenging (+0) Agility test or fall Prone.",
        9: "The target ceases to exist in any tangible way, entirely turning into a kind of bright red mist that spreads through the surrounding area. He cannot get much deader than this, except...",
        10: "The target ceases to exist in any tangible way, entirely turning into a kind of bright red mist that spreads through the surrounding area. Such is the unspeakably appalling manner in which the target was killed that each of the target's allies within two metres of where the target stood must make an immediate Challenging (+0) Willpower test. If an ally fails the test, he must spend his next turn fleeing from the attacker."
      },
      "Leg": {
        1: "A glancing blast sends the character backwards one metre. The target must make a Challenging (+0) Toughness test or be knocked Prone.",
        2: "The force of the explosion takes the target's feet out from under him. He is knocked Prone and cannot use any Movement action except for the Half Move action for [[1d5]] rounds.",
        3: "The concussion causes the target's leg to fracture. The target suffers [[2d10]] Agility damage.",
        4: "The explosion sends the target spinning through the air. He is flung [[1d5]] metres away in a random direction using the Scatter Diagram. It takes the target a Full Action to regain his feet, and his Movement is reduced by half (rounding up) for [[1d10]] rounds.",
        5: "Explosive force removes part of the target's foot and scatters the ragged remnants over a wide area. The target must make a Difficult (-10) Toughness test or suffer [[1d5]] levels of Fatigue. Permanently reduce his Agility characteristic by 1d5.",
        6: "The concussive force of the blast shatters the target's leg bones and splits apart flesh. The target suffers [[1d10]] levels of Fatigue. The leg is Useless until he receives medical attention. The target must make a Challenging (+0) Toughness test; if he fails, he suffers the Lost Foot condition (see page 198).",
        7: "The explosion reduces the target's leg into a hunk of smoking meat. The target must immediately make a Challenging (+0) Toughness test or die from shock. If he survives, he suffers [[1d10]] levels of Fatigue, is Stunned for [[1d10]] rounds, and suffers Blood Loss. He now suffers the Lost Leg condition (see page 198).",
        8: "The blast tears the leg from the body in a geyser of gore, sending him crashing to the ground, blood pumping from the ragged stump. This grievous wound is instantly fatal.",
        9: "The leg explodes in an eruption of blood, killing the target immediately and sending tiny fragments of bone, clothing, and armour hurtling off in all directions. Each target within 2 metres suffers a single hit for 1d10+2 Impact damage to a randomly determined Hit Location.",
        10: "The leg explodes in an eruption of blood, killing the target immediately and sending tiny fragments of bone, clothing, and armour hurtling off in all directions. Each target within 2 metres suffers a single hit for 1d10+2 Impact damage to a randomly determined Hit Location. If the target is carrying any ammunition it detonates, inflicting a single hit for [[1d10+5]] Impact damage to a randomly determined Hit Location upon each target within [[1d10]] metres (in addition to the hit noted above). If the target is carrying any grenades or missiles, these detonate immediately with their normal effects."
      }
    },
    "Impact": {
      "Arm": {
        1: "The attack strikes the target's limb with a powerful blow. He drops anything he was holding in that hand.",
        2: "The strike leaves a deep bruise, possibly causing minor fractures in the arm. The target suffers 1 level of Fatigue.",
        3: "The impact smashes into the arm or whatever the target is holding, ripping it away and leaving the target reeling from the pain. He is Stunned for 1 round and drops anything he was holding in that hand. Roll 1d10; on a result of 1, anything the target was holding in that hand is badly damaged and unusable until repaired.",
        4: "The impact crushes flesh and bone. The target drops anything he was holding in that hand, and must make a Challenging (+0) Toughness test or suffer [[1d10]] Weapon Skill and [[1d10]] Ballistic Skill damage.",
        5: "Muscle and bone take a pounding as the attack rips into the arm. The limb is Useless until the target receives medical attention.",
        6: "The attack pulverises the target's hand, crushing and breaking [[1d5]] fingers. The target suffers 1 level of Fatigue. He must make a Challenging (+0) Toughness test; if he fails, permanently reduce his Weapon Skill and Ballistic Skill characteristics by 2.",
        7: "With a loud snap, the arm bone is shattered and left hanging limply at the target's side, dribbling blood onto the ground. The target suffers Blood Loss. The arm is Useless until the target receives medical attention.",
        8: "The force of the attack takes the arm off just below the shoulder, showering blood and gore across the ground. The target must immediately make a Challenging (+0) Toughness test or die from shock. If he survives, he suffers [[1d5]] levels of Fatigue, is Stunned for [[1d10]] rounds, and suffers Blood Loss. He also now suffers from the Lost Arm condition (see page 242).",
        9: "In a rain of blood, gore, and meat, the target's arm is removed from his body. Screaming incoherently, he twists about in agony for a few seconds before collapsing to the ground and dying.",
        10: "In a rain of blood, gore, and meat, the target's arm is removed from his body. Screaming incoherently, he twists about in agony for a few seconds before collapsing to the ground and dying. As the arm is removed by the force of the attack, bone, chunks of flesh, clothing, and armour fragments fly about like blood-soaked shrapnel. Each target within 2 metres suffers a single hit for 1d5-3 Impact damage to a randomly determined Hit Location."
      },
      "Body": {
        1: "A blow to the target's body steals the breath from his lungs. The target can take only a Half Action on his next turn.",
        2: "The impact punches the air from the target's body. He suffers 1 level of Fatigue and is knocked Prone.",
        3: "The attack breaks a rib with a resounding crunch. The target is Stunned for 1 round and knocked Prone.",
        4: "The blow batters the target, shattering a rib. The target suffers [[1d10]] Toughness damage and must make a Challenging (+0) Agility test or be knocked Prone.",
        5: "A solid blow to the chest pulverises the target's innards, and he momentarily doubles over in pain, clutching himself and crying in agony. The target is Stunned for 2 rounds and must make a Challenging (+0) Toughness test or suffer [[1d5]] levels of Fatigue.",
        6: "The attack knocks the target sprawling on the ground. The target suffers [[1d5]] levels of Fatigue, is flung [[1d5]] metres away from the attacker (stopping if he hits a solid object), and falls Prone. He is Stunned for 2 rounds.",
        7: "With an audible crack, [[1d5]] of the target's ribs break. Permanently reduce the target's Toughness characteristic by 1d5. Until he receives medical attention, at the end of each round in which this character took an action, roll 1d10. On a result of 1 or 2, the character dies instantly as a shattered rib pierces a vital organ.",
        8: "The force of the attack ruptures several of the target's organs and knocks him down, gasping in wretched pain. The target suffers Blood Loss. Permanently reduce his Toughness characteristic by 1d10.",
        9: "The target jerks back from the force of the attack, throwing back his head and spewing out a jet of blood before crumpling to the ground dead.",
        10: "The target jerks back from the force of the attack, throwing back his head and spewing out a jet of blood before crumpling to the ground dead. The target's lifeless form is thrown [[1d10]] metres directly away from the attack. Any target in the corpse's path must make a Challenging (+0) Agility test or be knocked Prone."
      },
      "Head": {
        1: "The impact fills the target's head with a terrible ringing noise. The target must make a Challenging (+0) Toughness test or suffer 1 level of Fatigue.",
        2: "The hit causes the target's sight to blur and his head to spin. The target suffers a -10 penalty to Perception and Intelligence tests for [[1d5]] rounds.",
        3: "The target's nose breaks in a torrent of blood, blinding him for 1 round. The target must make a Challenging (+0) Toughness test or be Stunned for 1 round.",
        4: "The concussive strike staggers the target. The target must make a Challenging (+0) Toughness test or be Stunned for 1 round and knocked Prone.",
        5: "The force of the blow sends the target reeling in pain. The target suffers 1 level of Fatigue, is Stunned for 1 round, and staggers backwards [[1d5]] metres. Permanently reduce his Intelligence characteristic by 1.",
        6: "The target's head is snapped back by the attack, leaving him staggering around trying to control mind-numbing pain. The target is Stunned for [[1d5]] rounds, is knocked backwards [[1d5]] metres, and must make a Challenging (+0) Agility test or be knocked Prone.",
        7: "The attack slams into the target's head, fracturing his skull and opening a long tear in his scalp. The target is Stunned for [[1d10]] rounds. His Movement is halved (rounding up) for [[1d10]] hours.",
        8: "With a sickening crunch, the target's head snaps around to face the opposite direction. The twisted vertebrae immediately sever every connection within the target's neck, and his death is instantaneous.",
        9: "The target's head bursts like an overripe fruit and sprays blood, bone, and brains in all directions. Each target within 4 metres of the deceased must make a Challenging (+0) Agility test or suffer a -10 penalty to his Weapon Skill and Ballistic Skill tests on his next turn, as gore gets in his eyes or obscures his visor.",
        10: "The target's head bursts like an overripe fruit and sprays blood, bone, and brains in all directions. Each target within 4 metres of the deceased must make a Challenging (+0) Agility test or suffer a -10 penalty to his Weapon Skill and Ballistic Skill tests on his next turn, as gore gets in his eyes or obscures his visor. The attack was so powerful that it passes through the target and strikes another target nearby. If the hit was from a melee weapon, the attacker may immediately make another attack (with the same weapon) against any other target he can reach without moving. If the hit was from a ranged weapon, he may immediately make another attack (with the same weapon) against any target standing directly behind the original target and within range of his weapon."
      },
      "Leg": {
        1: "A blow to the leg results in deep bruises and teeth-clenching pain. The target suffers 1 level of Fatigue.",
        2: "A grazing strike against the leg slows the target. The target's Movement is reduced by half (rounding up) for 1 round. He must make a Challenging (+0) Toughness test or be Stunned for 1 round and fall Prone.",
        3: "A solid blow to the leg sends lightning agony coursing through the target. He is knocked Prone and suffers [[1d10]] Agility damage.",
        4: "A powerful impact causes micro-fractures in the target's bones, inflicting considerable agony. The target is knocked Prone and suffers [[2d10]] Agility damage.",
        5: "The blow breaks the target's leg with an agonising snap. He is Stunned for 1 round and knocked Prone. Reduce his Movement to 1 metre until he receives medical attention.",
        6: "With a sharp cracking noise, several of the tiny bones in the target's foot snap like twigs. The target suffers 2 levels of Fatigue, and his Movement is halved (rounded up) until he receives medical attention. He must make a Challenging (+0) Toughness test or suffer the Lost Foot condition (see page 243).",
        7: "With a nasty crunch, the leg is broken and the target is left mewling in pain. He is Stunned for 2 round and falls Prone. The leg is Useless until the target receives medical attention.",
        8: "The force of the attack rips the lower half of the leg away in a stream of blood. The target must immediately make a Challenging (+0) Toughness test or die from shock. If he survives, he suffers Blood Loss and suffers the Lost Leg condition (see page 243). Permanently reduce his Agility Characteristic by 1d5.",
        9: "The hit rips apart the flesh of the leg, causing blood to spray out in all directions. Even as the target tries futilely to stop the sudden flood of vital fluid, he falls to the ground and dies in a spreading pool of gore.",
        10: "The hit rips apart the flesh of the leg, causing blood to spray out in all directions. Even as the target tries futilely to stop the sudden flood of vital fluid, he falls to the ground and dies in a spreading pool of gore. Such is the agony of the target's death that his terrible screams drown out all conversation within [[2d10]] metres for the rest of the round."
      }
    },
    "Rending": {
      "Arm": {
        1: "The slashing attack tears free whatever the target was carrying. He drops anything he was holding in that hand.",
        2: "Deep cuts cause the target to drop his arm. He suffers 1 level of Fatigue and releases anything he was holding in that hand.",
        3: "The attack shreds the target's arm into ribbons, causing the target to scream in pain. He drops anything he was holding in that hand, and must make a successful Challenging (+0) Toughness test or suffer Blood Loss.",
        4: "The attack flays the skin from the limb, filling the air with blood and the sounds of his screaming. The target suffers 2 levels of Fatigue and falls Prone. The arm is Useless for [[1d10]] rounds.",
        5: "A bloody and very painful-looking furrow is opened up in the target's arm. He suffers Blood Loss and drops anything he was holding in that hand. The arm is Useless until the target receives medical attention.",
        6: "The blow mangles flesh and muscle as it hacks into the target's hand, liberating [[1d5]] fingers in the process (a roll of a 5 means that the thumb has been sheared off as well). The target is Stunned for 1 round and must immediately make a Challenging (+0) Toughness test or suffers the Lost Hand condition (see page 242).",
        7: "The attack rips apart skin, muscle, bone, and sinew with ease, turning the target's arm into a dangling ruin of severed veins and spurting blood. He suffers Blood Loss and [[1d10]] Strength damage. The arm is Useless until the target receives medical attention.",
        8: "With an assortment of unnatural, wet, ripping sounds, the arm flies free of the body trailing blood behind it in a crimson arc. The target must immediately make a Challenging (+0) Toughness test or die from shock. If he survives, he is Stunned for [[1d10]] rounds and suffers Blood Loss. He suffers from the Lost Arm condition (see page 242).",
        9: "The attack slices clean through the arm and into the torso, drenching the ground in blood and gore. The target is killed instantly, leaving a ruined corpse on the ground.",
        10: "The attack slices clean through the arm and into the torso, drenching the ground in blood and gore. The target is killed instantly, leaving a ruined corpse on the ground. As the arm falls to the ground its fingers spasm uncontrollably, pulling the trigger of any held weapon. If the target was carrying a ranged weapon, roll 1d100. On a result of 96 or higher, a single randomly determined target within [[2d10]] metres is hit struck by a single hit from that weapon on a randomly determined Hit Location."
      },
      "Body": {
        1: "If the target is not wearing armour on this location, he suffers 1 level of Fatigue from a painful laceration. If he is wearing armour, there is no effect, and he thanks the Emperor for his foresight.",
        2: "A powerful slash opens a painful rent in the target's body. He suffers 1 level of Fatigue and must make a Challenging (+0) Toughness test or be Stunned for 1 round.",
        3: "The attack rips a large patch of skin from the target's torso, leaving him gasping in pain. The target is Stunned for 1 round and must make a Challenging (+0) Toughness test or suffer Blood Loss.",
        4: "The blow opens up a long wound in the target's torso, causing him to double over in terrible pain. The target is Stunned for 1 round and suffers Blood Loss.",
        5: "A torrent of blood spills from the deep cuts, making the ground slick with gore. The target suffers Blood Loss and suffers [[1d10]] Toughness damage. Any character attempting to move through this pool of blood must make a Challenging (+0) Agility test or fall Prone.",
        6: "The mighty attack takes a sizeable chunk out of the target and knocks him to the ground as he clutches the oozing wound, shrieking in pain. The target is knocked Prone, suffers Blood Loss, and suffers [[1d10]] Toughness damage.",
        7: "The attack cuts open the target's abdomen, threatening to expose his entrails. The target suffers Blood Loss. Permanently reduce his Toughness characteristic by 1d5. Until he receives medical attention, at the end of each round, if he took any actions (besides holding his guts in and waiting for a medic), roll 1d10. On a result of 1 or 2, he suffers an additional [[2d10]] Rending damage.",
        8: "With a vile tearing noise, the skin on the target's chest comes away revealing a red ruin of muscle. He must succeed on a Challenging (+0) Toughness test or perish. If he survives, he is Stunned for 1 round and suffers Blood Loss. Permanently reduce his Toughness characteristic by 1d10.",
        9: "The powerful blow cleaves the target from gullet to groin, revealing his internal organs and spilling them on to the ground before him. The target is now quite dead.",
        10: "The powerful blow cleaves the target from gullet to groin, revealing his internal organs and spilling them on to the ground before him. The target is now quite dead. The area and the target are awash with slippery gore. For the rest of the fight, any character who moves within four metres of the target's corpse must make a Challenging (+0) Agility test or fall Prone."
      },
      "Head": {
        1: "The attack tears a painful rent in the target's face. If he is wearing a helmet, he suffers no ill effects; otherwise, he suffers 1 level of Fatigue.",
        2: "The attack slices open the target's scalp, which immediately begins to bleed profusely, spilling into his eyes. The target suffers a -10 penalty to Weapon Skill and Ballistic Skill tests for the next [[1d10]] rounds. He must pass a Challenging (+0) Toughness test or suffer Blood Loss.",
        3: "The attack rips open the target's face with a vicious shredding sound. He is Stunned for 1 round and suffers Blood Loss. If he is wearing a helmet, it is torn off.",
        4: "The attack slices across one of the target's eye sockets, possibly scooping out the eye. The target suffers [[1d10]] Perception damage. He must make a Routine (+20) Toughness; test if he fails, he suffers the Lost Eye condition (see page 242).",
        5: "The attack tears the target's helmet from his head. If he is not wearing a helmet, the target instead loses an ear and is Deafened until he receives medical attention. If he loses an ear, he must also must pass a Challenging (+0) Toughness test or have his Fellowship characteristic permanently reduced by 1. The target is Stunned for [[1d5]] rounds.",
        6: "The blow rips violently across the target's face, taking with it an important feature. He suffers [[1d5]] levels of Fatigue and suffers Blood Loss. Roll [[1d10]] to see what the target has lost.\n1-3: Eye (see the Lost Eye condition on page 242),\n4-7: Nose (permanently reduce his Fellowship characteristic by [[1d10]]),\n8-10: Ear (the target is Deafened until he receives medical attention).",
        7: "In a splatter of skin and teeth, the attack removes most of the target's face. The strike might not have slain him, but the target's words are forever slurred as a result of this vicious injury. The target is Stunned for 1 round and suffers Blood Loss. He is permanently Blinded. Permanently reduce his Fellowship characteristic by 1d10.",
        8: "The blow slices into the side of the target's head causing his eyes to pop out and his brain to ooze down his cheek like spilled jelly. He is dead before he hits the ground.",
        9: "With a sound not unlike a wet sponge being torn in half, the target's head flies free of its body and sails through the air, landing harmlessly [[2d10]] metres away with a soggy thud. The target is instantly slain.",
        10: "With a sound not unlike a wet sponge being torn in half, the target's head flies free of its body and sails through the air, landing harmlessly [[2d10]] metres away with a soggy thud. The target is instantly slain. The target's neck spews blood in a torrent, drenching all those within [[1d5]] metres and forcing each effected target to make a Challenging (+0) Agility test. Each character who fails the Test suffers a -10 penalty to Weapon Skill and Ballistic Skill tests for 1 round, as gore fills his eyes or fouls his visor."
      },
      "Leg": {
        1: "The attack knocks the limb backwards, painfully twisting it awkwardly. The target suffers 1 level of Fatigue.",
        2: "The target's kneecap splits open. He must make a Challenging (+0) Agility test or fall Prone and suffer Blood Loss as the injured extremity hits the ground.",
        3: "The attack rips a length of flesh from the leg. The target suffers Blood Loss and suffers [[1d5]] Agility damage.",
        4: "The attack rips the kneecap free from the target's leg, and he collapses to the ground. The target is knocked Prone and suffers [[1d10]] Agility Damage. His Movement values are halved (rounding up) until he receives medical attention.",
        5: "In a spray of blood, the target's leg is deeply slashed, exposing bone, sinew, and muscle. The target suffers Blood Loss. He must make a Challenging (+0) Toughness test; if he fails, permanently reduce his Agility characteristic by 1.",
        6: "The blow slices a couple of centimetres off the end of the target's foot. The target suffers Blood Loss. He must make a Challenging (+0) Toughness test. If he succeeds, his Movement is halved (rounding up) until he receives medical attention. If he fails, he suffers the Lost Foot condition (see page 243).",
        7: "The force of the blow cuts deep into the leg, grinding against bone and tearing ligaments apart. The target is Stunned for 1 round, is knocked Prone, and suffers Blood Loss. The leg is Useless until the target receives medical attention.",
        8: "In a single bloody hack the target's leg is lopped off, spurting its vital fluids across the ground. The target must immediately make a Challenging (+0) Toughness test or die from shock. If he survives, he is Stunned for [[1d10]] rounds and suffers Blood Loss. He suffers the Lost Leg condition (see page 243).",
        9: "With a meaty chop, the leg comes away at the hip. The target pitches to the ground howling in agony before dying.",
        10: "With a meaty chop, the leg comes away at the hip. The target pitches to the ground howling in agony before dying. The tide of blood is so intense that, for the remainder of the encounter, any character who makes a Run or Charge action within 6 metres of the corpse must make a Challenging (+0) Agility test or be knocked Prone."
      }
    }
  };
}
function getFuzzy(obj, term) {
  if (term.toUpperCase() === "LEFT LEG" || term.toUpperCase() === "RIGHT LEG") {
    term = "Leg";
  }
  if (term.toUpperCase() === "LEFT ARM" || term.toUpperCase() === "RIGHT ARM") {
    term = "Arm";
  }
  if (obj[term]) return obj[term];
  for (const [name, entry] of Object.entries(obj)) {
    if (term.toUpperCase() === name.toUpperCase()) {
      return entry;
    }
  }
}
function getCriticalDamage(type, location, amount) {
  const criticalDamageMap = criticalDamage();
  const damageMap = getFuzzy(criticalDamageMap, type);
  if (!damageMap) return null;
  const locationMap = getFuzzy(damageMap, location);
  if (!locationMap) return null;
  return locationMap[amount > 10 ? 10 : amount];
}

// api/lib/pipeline.mjs
var CHECKPOINTS = Object.freeze({
  // --- attack pipeline (default namespace) — to-hit test ---
  MODIFIERS: "MODIFIERS",
  // accumulate to-hit modifiers before the d100
  POST_ROLL: "POST_ROLL",
  // after the d100: jam / overheat / all-out, may cancel success
  ON_MISS: "ON_MISS",
  // after a missed attack (e.g. Blast scatter)
  // --- hit count ---
  HIT_COUNT_MULT: "HIT_COUNT_MULT",
  // multiply extra hits (runs before the RoF cap)
  HIT_COUNT_BONUS: "HIT_COUNT_BONUS",
  // add flat extra hits (runs after the RoF cap)
  // --- per hit ---
  PENETRATION: "PENETRATION",
  // adjust penetration
  // --- per-hit damage roll ---
  DAMAGE_POOL: "DAMAGE_POOL",
  // shape the dice pool (extra dice, keep-highest)
  DIE_ADJUST: "DIE_ADJUST",
  // per-die transforms + Righteous Fury threshold
  DAMAGE_MODS: "DAMAGE_MODS",
  // add flat / bonus-dice damage modifiers
  ON_HIT: "ON_HIT",
  // per hit, after soak: on-hit target effects (Concussive, Crippling)
  // --- defensive reaction ---
  PARRY: "PARRY",
  // modifiers for a Parry (WS) test
  POST_PARRY: "POST_PARRY",
  // after the Parry test, once success is known (Power Field weapon destruction)
  EVASION: "EVASION",
  // modifiers for a Dodge (Ag) evasion test
  // --- test pipeline: generic characteristic / skill tests (d100 box, Fear,
  //     acquisition, …). Rules gate on test_name / has_talent / conditions. ---
  TEST_MODIFIERS: "test.MODIFIERS",
  // accumulate modifiers before a generic test
  TEST_POST_ROLL: "test.POST_ROLL",
  // after a generic test resolves (narrative effects, may cancel)
  // --- upkeep pipeline (Phase 4): per-actor ticks against the EncounterState.
  //     Rules read the actor's active conditions and declare damage / tests;
  //     the engine owns duration decrement, severity decay, and cooldowns. ---
  UPKEEP_TURN_START: "upkeep.TURN_START",
  // start of the actor's turn (On Fire burns, …)
  UPKEEP_TURN_END: "upkeep.TURN_END",
  // end of the actor's turn (Toxified test, cooldowns clear)
  UPKEEP_ROUND_END: "upkeep.ROUND_END"
  // end of the round (Haywire decay, durations tick)
});
var PIPELINES = Object.freeze({
  attack: Object.values(CHECKPOINTS).filter((c) => !c.includes(".")),
  test: Object.values(CHECKPOINTS).filter((c) => c.startsWith("test.")),
  upkeep: Object.values(CHECKPOINTS).filter((c) => c.startsWith("upkeep."))
});
var CHECKPOINT_SET = new Set(Object.values(CHECKPOINTS));
var Registry = class {
  constructor() {
    this._buckets = /* @__PURE__ */ new Map();
    this._seq = 0;
    this._tables = /* @__PURE__ */ new Map();
  }
  /** Register a compiled roll_table (keyed case-insensitively by name). */
  addTable(table) {
    if (table && table.name) this._tables.set(String(table.name).toLowerCase(), table);
    return this;
  }
  addTables(tables = []) {
    for (const t of tables) this.addTable(t);
    return this;
  }
  /** Look up a roll_table by name (case-insensitive), or undefined. */
  table(name) {
    return this._tables.get(String(name ?? "").toLowerCase());
  }
  tables() {
    return [...this._tables.values()];
  }
  add(effect) {
    if (!effect || typeof effect.apply !== "function" || !CHECKPOINT_SET.has(effect.checkpoint)) {
      throw new Error(`Invalid effect: needs a known checkpoint and an apply() (got ${effect?.id ?? effect})`);
    }
    const e = { priority: 0, ...effect, _seq: this._seq++ };
    if (!this._buckets.has(e.checkpoint)) this._buckets.set(e.checkpoint, []);
    this._buckets.get(e.checkpoint).push(e);
    return this;
  }
  addAll(effects = []) {
    for (const e of effects) this.add(e);
    return this;
  }
  /** Effects bound to a checkpoint, ordered by (priority, insertion). */
  at(checkpoint) {
    const list = this._buckets.get(checkpoint) ?? [];
    return [...list].sort((a, b) => a.priority - b.priority || a._seq - b._seq);
  }
  all() {
    return [...this._buckets.values()].flat();
  }
};
function runCheckpoint(registry, checkpoint, ctx) {
  for (const eff of registry.at(checkpoint)) {
    if (ctx?.suppressed?.has(eff.name)) continue;
    if (eff.when && !eff.when(ctx)) continue;
    eff.apply(ctx);
    if (ctx && Array.isArray(ctx.log)) {
      ctx.log.push({ checkpoint, effect: eff.id ?? "(anonymous)", source: eff.source });
    }
  }
}

// api/lib/context.mjs
var RollContext = class {
  constructor(init = {}) {
    this.log = [];
    Object.assign(this, init);
  }
};

// api/lib/rules/_util.mjs
var entryName = (x) => x && typeof x === "object" ? String(x.name ?? "") : String(x ?? "");
var canonEntry = (x) => {
  if (x && typeof x === "object") {
    return { name: String(x.name ?? ""), level: x.level ?? null };
  }
  const s = String(x ?? "").trim();
  const m = /\((\d+)\)\s*$/.exec(s) ?? /\s(\d+)$/.exec(s);
  return m ? { name: s.slice(0, m.index).trim(), level: parseInt(m[1]) } : { name: s, level: null };
};
var canonList = (list) => (list ?? []).map(canonEntry);
var entryLevel = (x) => {
  if (x && typeof x === "object") return x.level ?? null;
  const m = /\((\d+)\)/.exec(String(x ?? "")) ?? /\s(\d+)$/.exec(String(x ?? ""));
  return m ? parseInt(m[1]) : null;
};
var normName = (s) => String(s ?? "").toLowerCase().replace(/[\s_-]+/g, "");
var hasQuality = (qualities, name) => (qualities ?? []).some((q) => normName(entryName(q)).startsWith(normName(name)));
var qualityLevel = (qualities, name, fallback) => {
  const q = (qualities ?? []).find((x) => normName(entryName(x)).startsWith(normName(name)));
  if (q === void 0) return fallback;
  return entryLevel(q) ?? fallback;
};

// api/lib/dsl/tokenizer.mjs
var DslError = class extends Error {
  constructor(message, line, col) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = "DslError";
    this.rawMessage = message;
    this.line = line;
    this.col = col;
  }
};
var isDigit = (ch) => ch >= "0" && ch <= "9";
var isIdentStart = (ch) => ch === "_" || ch >= "A" && ch <= "Z" || ch >= "a" && ch <= "z";
var isIdentPart = (ch) => isIdentStart(ch) || isDigit(ch);
var TWO_CHAR_OPS = /* @__PURE__ */ new Set(["==", "!=", ">=", "<=", "+=", "=>"]);
var ONE_CHAR_OPS = /* @__PURE__ */ new Set([">", "<", "=", "+", "-", "*", "/"]);
var PUNCT = /* @__PURE__ */ new Set(["{", "}", "(", ")", ",", ";", ":", "."]);
function tokenize(src) {
  const s = String(src);
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (s[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "	" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }
    if (ch === "/" && s[i + 1] === "/" || ch === "#") {
      while (i < s.length && s[i] !== "\n") advance();
      continue;
    }
    const startLine = line, startCol = col;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      advance();
      let value = "";
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\" && i + 1 < s.length) {
          advance();
          value += s[i];
          advance();
        } else {
          value += s[i];
          advance();
        }
      }
      if (i >= s.length) throw new DslError("Unterminated string", startLine, startCol);
      advance();
      tokens.push({ type: "string", value, line: startLine, col: startCol });
      continue;
    }
    if (isDigit(ch)) {
      let intPart = "";
      while (i < s.length && isDigit(s[i])) {
        intPart += s[i];
        advance();
      }
      if ((s[i] === "d" || s[i] === "D") && isDigit(s[i + 1])) {
        advance();
        let sides = "";
        while (i < s.length && isDigit(s[i])) {
          sides += s[i];
          advance();
        }
        tokens.push({ type: "dice", count: parseInt(intPart), sides: parseInt(sides), line: startLine, col: startCol });
      } else {
        tokens.push({ type: "number", value: parseInt(intPart), line: startLine, col: startCol });
      }
      continue;
    }
    if (isIdentStart(ch)) {
      let value = "";
      while (i < s.length && isIdentPart(s[i])) {
        value += s[i];
        advance();
      }
      tokens.push({ type: "ident", value, line: startLine, col: startCol });
      continue;
    }
    if (PUNCT.has(ch)) {
      advance();
      tokens.push({ type: "punct", value: ch, line: startLine, col: startCol });
      continue;
    }
    const two = s.substr(i, 2);
    if (TWO_CHAR_OPS.has(two)) {
      advance(2);
      tokens.push({ type: "op", value: two, line: startLine, col: startCol });
      continue;
    }
    if (ONE_CHAR_OPS.has(ch)) {
      advance();
      tokens.push({ type: "op", value: ch, line: startLine, col: startCol });
      continue;
    }
    throw new DslError(`Unexpected character '${ch}'`, startLine, startCol);
  }
  tokens.push({ type: "eof", value: null, line, col });
  return tokens;
}

// api/lib/dsl/parser.mjs
var RULE_KINDS = /* @__PURE__ */ new Set([
  "quality",
  "talent",
  "trait",
  "circumstance",
  "condition",
  "configuration",
  "mechanic",
  "miscellaneous"
]);
var ACTION_TYPES = /* @__PURE__ */ new Set(["Half", "Full", "Reaction", "Free"]);
var CURRENT_DSL_VERSION = 3;
var COMPARE_OPS = /* @__PURE__ */ new Set(["==", "!=", ">=", "<=", ">", "<"]);
var Parser = class {
  constructor(tokens) {
    this.toks = tokens;
    this.pos = 0;
  }
  peek(offset = 0) {
    return this.toks[this.pos + offset];
  }
  next() {
    return this.toks[this.pos++];
  }
  atEof() {
    return this.peek().type === "eof";
  }
  err(message, tok = this.peek()) {
    return new DslError(message, tok.line, tok.col);
  }
  isKw(value, offset = 0) {
    const t = this.peek(offset);
    return t.type === "ident" && t.value === value;
  }
  isPunct(value, offset = 0) {
    const t = this.peek(offset);
    return t.type === "punct" && t.value === value;
  }
  isOp(value, offset = 0) {
    const t = this.peek(offset);
    return t.type === "op" && t.value === value;
  }
  expectPunct(value) {
    if (!this.isPunct(value)) throw this.err(`Expected '${value}'`);
    return this.next();
  }
  expectKw(value) {
    if (!this.isKw(value)) throw this.err(`Expected '${value}'`);
    return this.next();
  }
  expectString(what = "a quoted string") {
    const t = this.peek();
    if (t.type !== "string") throw this.err(`Expected ${what}`);
    return this.next().value;
  }
  // --- program / rule ------------------------------------------------------
  parseProgram() {
    const rules = [], tables = [], actions = [], packages = [];
    let dslVersion = null;
    while (!this.atEof()) {
      if (this.isKw("dsl") && this.peek(1)?.type === "number") {
        const tok = this.peek();
        this.next();
        const v = this.next().value;
        if (v < CURRENT_DSL_VERSION) {
          throw new DslError(`dsl ${v} is no longer supported (current: dsl ${CURRENT_DSL_VERSION}) \u2014 run \`node tools/migrate-dsl.mjs <file> --write\` to upgrade`, tok.line, tok.col);
        }
        if (dslVersion === null) dslVersion = v;
      } else if (this.isKw("roll_table")) tables.push(this.parseTable());
      else if (this.isKw("action")) actions.push(this.parseActionDecl());
      else if (this.isKw("package")) packages.push(this.parsePackage());
      else rules.push(this.parseRule());
    }
    return { type: "Program", rules, tables, actions, dslVersion: dslVersion ?? CURRENT_DSL_VERSION, package: packages[0] ?? null, packages };
  }
  // package "dh2.core.weapon-qualities" { system "dh2"  source "Book"  [requires "pkg"]* }
  // File-level provenance: the rule system this content belongs to, the source
  // book, and (future — layered registries) package dependencies.
  parsePackage() {
    const kw = this.expectKw("package");
    const name = this.expectString("a quoted package name");
    this.expectPunct("{");
    let system = null, source = null;
    const requires = [];
    while (!this.isPunct("}")) {
      if (this.atEof()) throw this.err("Unterminated package (expected '}')");
      if (this.isKw("system")) {
        this.next();
        system = this.expectString('a system id (e.g. "dh2")');
      } else if (this.isKw("source")) {
        this.next();
        source = this.expectString("a source book name");
      } else if (this.isKw("requires")) {
        this.next();
        requires.push(this.expectString("a package name"));
      } else throw this.err("Unexpected clause in package body (expected 'system', 'source' or 'requires')");
    }
    this.expectPunct("}");
    return { type: "Package", name, system, source, requires, line: kw.line, col: kw.col };
  }
  // action "Name" { type Half|Full|Reaction|Free  [attack] [subtype <name>]* }
  //   `attack` is sugar for `subtype attack` — the key subtype many rules read.
  parseActionDecl() {
    const kw = this.expectKw("action");
    const name = this.expectString("a quoted action name");
    this.expectPunct("{");
    let actionType2 = null;
    const subtypes = [];
    const addSub = (s) => {
      if (!subtypes.includes(s)) subtypes.push(s);
    };
    while (!this.isPunct("}")) {
      if (this.atEof()) throw this.err("Unterminated action (expected '}')");
      if (this.isKw("type")) {
        this.next();
        const t = this.peek();
        if (t.type !== "ident" || !ACTION_TYPES.has(t.value)) throw this.err("Expected an action type (Half | Full | Reaction | Free)");
        this.next();
        actionType2 = t.value;
      } else if (this.isKw("attack")) {
        this.next();
        addSub("attack");
      } else if (this.isKw("subtype")) {
        this.next();
        const t = this.peek();
        if (t.type !== "ident" && t.type !== "string") throw this.err("Expected a subtype name after subtype");
        this.next();
        addSub(t.value);
      } else {
        throw this.err("Unexpected clause in action body (expected 'type', 'attack' or 'subtype')");
      }
    }
    this.expectPunct("}");
    if (!actionType2) throw new DslError(`Action "${name}" is missing a 'type' clause`, kw.line, kw.col);
    return { type: "ActionDecl", name, actionType: actionType2, subtypes, line: kw.line, col: kw.col };
  }
  // roll_table "Name" { die 1d10  <lo>[-<hi>]: "text" [=> "Status", …]  … }
  parseTable() {
    const kw = this.expectKw("roll_table");
    const name = this.expectString("a quoted table name");
    this.expectPunct("{");
    this.expectKw("die");
    const dieTok = this.peek();
    if (dieTok.type !== "dice") throw this.err("Expected a dice literal (e.g. 1d10) after die");
    this.next();
    const rows = [];
    while (!this.isPunct("}")) {
      if (this.atEof()) throw this.err("Unterminated roll_table (expected '}')");
      rows.push(this.parseTableRow());
    }
    this.expectPunct("}");
    return { type: "Table", name, die: { count: dieTok.count, sides: dieTok.sides }, rows, line: kw.line, col: kw.col };
  }
  parseTableRow() {
    const lo = this.peek();
    if (lo.type !== "number") throw this.err("Expected a roll value (e.g. 1 or 1-2) for a table row");
    this.next();
    let hi = lo.value;
    if (this.isOp("-")) {
      this.next();
      const h = this.peek();
      if (h.type !== "number") throw this.err("Expected the end of a roll range after -");
      this.next();
      hi = h.value;
    }
    this.expectPunct(":");
    const text = this.expectString("the row outcome text");
    const statuses = [];
    if (this.isOp("=>")) {
      this.next();
      statuses.push(this.expectString("a status name"));
      while (this.isPunct(",")) {
        this.next();
        statuses.push(this.expectString("a status name"));
      }
    }
    if (this.isPunct(";")) this.next();
    return { lo: lo.value, hi, text, statuses };
  }
  parseRule() {
    const kindTok = this.peek();
    if (kindTok.type !== "ident" || !RULE_KINDS.has(kindTok.value)) {
      throw this.err("Expected a rule kind (quality | talent | trait | circumstance | condition | configuration | mechanic | miscellaneous)");
    }
    this.next();
    const name = this.expectString("a quoted rule name");
    const rule = {
      type: "Rule",
      kind: kindTok.value,
      name,
      tier: null,
      on: null,
      priority: null,
      meta: null,
      replaces: null,
      branches: [],
      line: kindTok.line,
      col: kindTok.col
    };
    if (this.isKw("tier")) {
      this.next();
      const n = this.peek();
      if (n.type !== "number") throw this.err("Expected an integer after tier");
      this.next();
      rule.tier = n.value;
    }
    this.expectPunct("{");
    while (!this.isPunct("}")) {
      if (this.atEof()) throw this.err("Unterminated rule body (expected '}')");
      this.parseClause(rule);
    }
    this.expectPunct("}");
    if (!rule.on) throw new DslError(`Rule "${name}" is missing an 'on <checkpoint>' clause`, rule.line, rule.col);
    if (!rule.branches.length) throw new DslError(`Rule "${name}" is missing a 'then ...' clause`, rule.line, rule.col);
    if (rule.branches.length === 1) {
      rule.when = rule.branches[0].when;
      rule.actions = rule.branches[0].actions;
    }
    return rule;
  }
  // Rule-level clauses (`on`, `priority`) and `when …? then …` branches.
  parseClause(rule) {
    const t = this.peek();
    if (this.isKw("on")) {
      this.next();
      const cp = this.peek();
      if (cp.type !== "ident") throw this.err("Expected a checkpoint name after on");
      this.next();
      if (rule.on) throw this.err("Duplicate 'on' clause", t);
      let name = cp.value;
      if (this.isPunct(".") && this.peek(1)?.type === "ident") {
        this.next();
        name = `${name}.${this.next().value}`;
      }
      rule.on = name;
    } else if (this.isKw("replaces")) {
      this.next();
      (rule.replaces ?? (rule.replaces = [])).push(this.expectString('a qualified rule id (e.g. "dh2.core.mechanics/jam")'));
    } else if (this.isKw("priority")) {
      this.next();
      const n = this.peek();
      if (n.type !== "number") throw this.err("Expected an integer after priority");
      this.next();
      rule.priority = n.value;
    } else if (this.isKw("meta")) {
      this.next();
      this.expectPunct("{");
      const meta = { page: null, ref: null, source: null };
      while (!this.isPunct("}")) {
        if (this.atEof()) throw this.err("Unterminated meta (expected '}')");
        if (this.isKw("page")) {
          this.next();
          const n = this.peek();
          if (n.type !== "number") throw this.err("Expected a page number after page");
          this.next();
          meta.page = n.value;
        } else if (this.isKw("ref")) {
          this.next();
          meta.ref = this.expectString("a reference string");
        } else if (this.isKw("source")) {
          this.next();
          meta.source = this.expectString("a source book name");
        } else throw this.err("Unexpected clause in meta body (expected 'page', 'ref' or 'source')");
      }
      this.expectPunct("}");
      rule.meta = meta;
    } else if (this.isKw("when")) {
      this.next();
      const when = this.parsePredicate();
      if (!this.isKw("then")) throw this.err("Expected 'then' after a 'when' condition");
      this.next();
      rule.branches.push({ when, actions: this.parseActionList() });
    } else if (this.isKw("then")) {
      this.next();
      rule.branches.push({ when: null, actions: this.parseActionList() });
    } else {
      throw this.err(`Unexpected '${t.value ?? t.type}' in rule body (expected on | priority | meta | replaces | when | then)`);
    }
  }
  parseActionList() {
    const actions = [this.parseAction()];
    while (this.isPunct(";")) {
      this.next();
      if (this.isPunct("}") || this.atClauseKeyword()) break;
      actions.push(this.parseAction());
    }
    return actions;
  }
  atClauseKeyword() {
    return this.isKw("on") || this.isKw("priority") || this.isKw("when") || this.isKw("then");
  }
  // --- predicates (boolean) ------------------------------------------------
  parsePredicate() {
    return this.parseOr();
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.isKw("or")) {
      this.next();
      left = { type: "Logical", op: "or", left, right: this.parseAnd() };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.isKw("and")) {
      this.next();
      left = { type: "Logical", op: "and", left, right: this.parseNot() };
    }
    return left;
  }
  parseNot() {
    if (this.isKw("not")) {
      this.next();
      return { type: "Unary", op: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }
  parseComparison() {
    const left = this.parseAtomPred();
    const t = this.peek();
    if (t.type === "op" && COMPARE_OPS.has(t.value)) {
      this.next();
      return { type: "Comparison", op: t.value, left, right: this.parseValue() };
    }
    return left;
  }
  parseAtomPred() {
    if (this.isPunct("(")) {
      this.next();
      const inner = this.parsePredicate();
      this.expectPunct(")");
      return inner;
    }
    return this.parseValue();
  }
  // --- arithmetic expressions (action values) ------------------------------
  parseExpr() {
    return this.parseAdd();
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().value;
      left = { type: "Binary", op, left, right: this.parseMul() };
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = this.next().value;
      left = { type: "Binary", op, left, right: this.parseUnary() };
    }
    return left;
  }
  parseUnary() {
    if (this.isOp("-")) {
      this.next();
      return { type: "Unary", op: "neg", operand: this.parseUnary() };
    }
    return this.parseFactor();
  }
  parseFactor() {
    if (this.isPunct("(")) {
      this.next();
      const e = this.parseExpr();
      this.expectPunct(")");
      return e;
    }
    return this.parseValue();
  }
  // --- shared value/atom ---------------------------------------------------
  parseValue() {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return { type: "Number", value: t.value };
    }
    if (t.type === "string") {
      this.next();
      return { type: "String", value: t.value };
    }
    if (t.type === "dice") {
      this.next();
      return { type: "Dice", count: t.count, sides: t.sides };
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { type: "Boolean", value: t.value === "true" };
      }
      this.next();
      let scope = null, name = t.value;
      if (this.isPunct(".") && this.peek(1)?.type === "ident") {
        this.next();
        scope = name;
        name = this.next().value;
      }
      if (this.isPunct("(")) {
        this.next();
        const args = [];
        if (!this.isPunct(")")) {
          args.push(this.parseExpr());
          while (this.isPunct(",")) {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.expectPunct(")");
        return scope ? { type: "Call", scope, name, args } : { type: "Call", name, args };
      }
      return scope ? { type: "Identifier", scope, name } : { type: "Identifier", name };
    }
    throw this.err(`Expected a value, got '${t.value ?? t.type}'`);
  }
  // --- actions -------------------------------------------------------------
  parseAction() {
    const t = this.peek();
    if (t.type !== "ident") throw this.err("Expected an action");
    const kw = t.value;
    switch (kw) {
      case "add": {
        this.next();
        this.expectKw("modifier");
        const name = this.expectString("a modifier name");
        if (!this.isOp("=")) throw this.err("Expected '=' after modifier name");
        this.next();
        return { type: "Action", action: "add_modifier", name, value: this.parseExpr() };
      }
      case "set": {
        this.next();
        if (this.isKw("modifier")) {
          this.next();
          const name = this.expectString("a modifier name");
          if (!this.isOp("=")) throw this.err("Expected '=' after modifier name");
          this.next();
          return { type: "Action", action: "set_modifier", name, value: this.parseExpr() };
        }
        const slotTok = this.peek();
        if (slotTok.type !== "ident") throw this.err("Expected 'modifier' or a slot name after 'set'");
        this.next();
        let op;
        if (this.isOp("+=")) op = "+=";
        else if (this.isOp("=")) op = "=";
        else throw this.err(`Expected '=' or '+=' after slot '${slotTok.value}'`);
        this.next();
        return { type: "Action", action: "set_slot", slot: slotTok.value, op, value: this.parseExpr() };
      }
      case "cancel": {
        this.next();
        this.expectKw("modifier");
        return { type: "Action", action: "cancel_modifier", name: this.expectString("a modifier name") };
      }
      case "multiply_hits": {
        this.next();
        return { type: "Action", action: "multiply_hits", value: this.parseExpr() };
      }
      case "floor_die": {
        this.next();
        return { type: "Action", action: "floor_die", value: this.parseExpr() };
      }
      case "cap_die": {
        this.next();
        return { type: "Action", action: "cap_die", value: this.parseExpr() };
      }
      case "emit": {
        this.next();
        const name = this.expectString("an effect name");
        let text = null;
        if (this.isPunct(",")) {
          this.next();
          text = this.expectString("effect description text");
        }
        return { type: "Action", action: "emit", name, text };
      }
      case "suppress": {
        this.next();
        return { type: "Action", action: "suppress", name: this.expectString("the name of a rule to suppress") };
      }
      case "flag": {
        this.next();
        const t2 = this.peek();
        if (t2.type !== "ident") throw this.err("Expected a flag name after flag");
        this.next();
        return { type: "Action", action: "set_flag", flag: t2.value };
      }
      case "corrode": {
        this.next();
        return { type: "Action", action: "corrode", value: this.parseExpr() };
      }
      case "declare": {
        this.next();
        if (this.isKw("test")) {
          this.next();
          return this.parseRequireTest();
        }
        if (this.isKw("status")) {
          this.next();
          return this.parseApplyStatus();
        }
        if (this.isKw("table_roll")) {
          this.next();
          return this.parseRollOn();
        }
        if (this.isKw("armour_damage")) {
          this.next();
          return { type: "Action", action: "corrode", value: this.parseExpr() };
        }
        if (this.isKw("damage")) {
          this.next();
          const value = this.parseExpr();
          let reason = null;
          if (this.isPunct(",")) {
            this.next();
            reason = this.expectString("a reason");
          }
          return { type: "Action", action: "declare_damage", value, reason };
        }
        if (this.isKw("smoke")) {
          this.next();
          const radius = this.parseExpr();
          let duration = null;
          if (this.isKw("duration")) {
            this.next();
            duration = this.parseExpr();
          }
          return { type: "Action", action: "declare_smoke", radius, duration };
        }
        if (this.isKw("scatter_hit")) {
          this.next();
          return { type: "Action", action: "declare_scatter_hit", value: this.parseExpr() };
        }
        if (this.isKw("event")) {
          this.next();
          const name = this.expectString("an event name");
          let text = null;
          if (this.isPunct(",")) {
            this.next();
            text = this.expectString("event description text");
          }
          return { type: "Action", action: "emit", name, text };
        }
        throw this.err("Expected 'test', 'status', 'table_roll', 'armour_damage', 'damage', 'smoke', 'scatter_hit' or 'event' after declare");
      }
      case "bump_quality": {
        this.next();
        const name = this.expectString("a quality name");
        this.expectKw("by");
        return { type: "Action", action: "bump_quality", name, value: this.parseExpr() };
      }
      case "add_quality": {
        this.next();
        return { type: "Action", action: "add_quality", name: this.expectString("a quality name") };
      }
      case "require_test": {
        this.next();
        return this.parseRequireTest();
      }
      case "roll_on": {
        this.next();
        return this.parseRollOn();
      }
      case "apply_status": {
        this.next();
        return this.parseApplyStatus();
      }
      default:
        throw this.err(`Unknown action '${kw}'`);
    }
  }
  // --- declaration bodies (shared by the legacy verbs and `declare …`) ------
  // require_test "Char" <modifier-expr> "on-fail" [avoids_hit] [=> roll_on "T" | apply_status … | damage e]
  parseRequireTest() {
    const characteristic = this.expectString('a characteristic name (e.g. "Toughness")');
    const value = this.parseExpr();
    const onFail = this.expectString("the on-fail consequence text");
    let avoidsHit = false;
    if (this.isKw("avoids_hit")) {
      this.next();
      avoidsHit = true;
    }
    let onFailRollTable = null, onFailApply = null, onFailDamage = null;
    if (this.isOp("=>")) {
      this.next();
      if (this.isKw("damage")) {
        this.next();
        onFailDamage = this.parseExpr();
      } else if (this.isKw("roll_on") || this.isKw("table_roll")) {
        this.next();
        onFailRollTable = this.expectString("a roll_table name");
      } else if (this.isKw("apply_status") || this.isKw("status")) {
        this.next();
        const name = this.expectString("a condition name");
        let value2 = null, duration = null, location = null;
        while (this.isKw("value") || this.isKw("duration") || this.isKw("location")) {
          if (this.isKw("value")) {
            this.next();
            value2 = this.parseExpr();
          } else if (this.isKw("duration")) {
            this.next();
            duration = this.parseExpr();
          } else {
            this.next();
            location = this.parseExpr();
          }
        }
        onFailApply = { name, value: value2, duration, location };
      } else throw this.err("Expected 'roll_on', 'apply_status' or 'damage' after =>");
    }
    return { type: "Action", action: "require_test", characteristic, value, onFail, onFailRollTable, onFailApply, onFailDamage, avoidsHit };
  }
  // roll_on "Table" [+ <modifier>] [area <expr>]
  parseRollOn() {
    const table = this.expectString("a roll_table name");
    let value = null, area = null;
    if (this.isOp("+")) {
      this.next();
      value = this.parseExpr();
    }
    if (this.isKw("area")) {
      this.next();
      area = this.parseExpr();
    }
    return { type: "Action", action: "roll_on", table, value, area };
  }
  // apply_status "Name" [value e] [duration e] [location e] [, "reason"]
  parseApplyStatus() {
    const name = this.expectString("a status name");
    let value = null, duration = null, location = null, reason = null;
    while (this.isKw("value") || this.isKw("duration") || this.isKw("location")) {
      if (this.isKw("value")) {
        this.next();
        value = this.parseExpr();
      } else if (this.isKw("duration")) {
        this.next();
        duration = this.parseExpr();
      } else {
        this.next();
        location = this.parseExpr();
      }
    }
    if (this.isPunct(",")) {
      this.next();
      reason = this.expectString("a reason");
    }
    return { type: "Action", action: "apply_status", name, value, duration, location, reason };
  }
};
function parse(src) {
  return new Parser(tokenize(src)).parseProgram();
}

// api/lib/actions.mjs
var ACTIONS = {
  "Standard Attack": { type: "Half", subtypes: ["attack"] },
  "Semi-Auto Burst": { type: "Half", subtypes: ["attack", "ranged"] },
  "Full Auto Burst": { type: "Half", subtypes: ["attack", "ranged"] },
  "All Out Attack": { type: "Full", subtypes: ["attack", "melee"] },
  "Charge": { type: "Full", subtypes: ["attack", "melee"] },
  "Called Shot": { type: "Full", subtypes: ["attack"] },
  // Half Actions in DH2 2e (Table 7-1 p.222; Swift p.225, Lightning p.223)
  "Swift Attack": { type: "Half", subtypes: ["attack", "melee"] },
  "Lightning Attack": { type: "Half", subtypes: ["attack", "melee"] },
  "Suppressing Fire (Semi)": { type: "Full", subtypes: ["attack", "ranged"] },
  "Suppressing Fire (Full)": { type: "Full", subtypes: ["attack", "ranged"] },
  "Defensive Stance": { type: "Full", subtypes: [] },
  "Aim": { type: "Half", subtypes: [] },
  "Parry": { type: "Reaction", subtypes: [] },
  "Dodge": { type: "Reaction", subtypes: [] }
};
var norm = (name) => String(name ?? "").toLowerCase().replace(/[\s_-]+/g, "");
var byName = (name) => {
  const k = norm(name);
  for (const [n, meta] of Object.entries(ACTIONS)) if (norm(n) === k) return meta;
  return null;
};
function registerActions(list = []) {
  for (const a of list) if (a && a.name) ACTIONS[a.name] = { type: a.type, subtypes: a.subtypes ?? [] };
}
var availableActions = () => Object.keys(ACTIONS).sort();
var actionType = (name) => byName(name)?.type ?? "";
var isReaction = (name) => byName(name)?.type === "Reaction";
var actionSubtypes = (name) => byName(name)?.subtypes ?? [];
var actionHasSubtype = (name, subtype) => actionSubtypes(name).some((s) => norm(s) === norm(subtype));
var isAction = (current, name) => norm(current) === norm(name);

// api/lib/dsl/vocabulary.mjs
var num = (x) => Number(x) || 0;
var nameOf = (x) => x && typeof x === "object" ? String(x.name ?? "") : String(x ?? "");
var hasNamed = (list, name) => (list ?? []).some((x) => normName(nameOf(x)).startsWith(normName(name)));
var findNamed = (list, name) => (list ?? []).find((x) => normName(nameOf(x)).startsWith(normName(name)));
var SCOPE_NAMES = ["attacker", "target", "weapon", "opposing_weapon"];
var FACT_DEFS = [
  // --- weapon / actor ------------------------------------------------------
  { name: "is_melee", type: "bool", summary: "The attack is a melee attack.", scopes: {
    attacker: (c) => !!c.isMelee,
    weapon: (c) => !!c.isMelee
  } },
  { name: "is_ranged", type: "bool", summary: "The attack is a ranged attack.", scopes: {
    attacker: (c) => c.isMelee === void 0 ? true : !c.isMelee,
    weapon: (c) => c.isMelee === void 0 ? true : !c.isMelee
  } },
  { name: "pen", type: "number", summary: "The hit's base armour penetration. Meaningful at PENETRATION.", scopes: {
    attacker: (c) => c.pen ?? 0,
    weapon: (c) => c.pen ?? 0
  } },
  { name: "sb", type: "number", summary: "Strength Bonus (tens digit of Strength). Scoped: attacker (default) or target.", scopes: {
    attacker: (c) => c.strengthBonus ?? Math.floor(num(c.characteristics?.s) / 10),
    target: (c) => c.target?.strengthBonus ?? Math.floor(num(c.target?.strength) / 10)
  } },
  { name: "tb", type: "number", summary: "Toughness Bonus (tens digit of Toughness). Scoped: attacker (default) or target.", scopes: {
    attacker: (c) => c.toughnessBonus ?? Math.floor(num(c.characteristics?.t) / 10),
    target: (c) => c.target?.toughnessBonus ?? Math.floor(num(c.target?.toughness) / 10)
  } },
  { name: "bs_bonus", type: "number", summary: "Ballistic Skill bonus (tens digit of BS).", scopes: {
    attacker: (c) => Math.floor(num(c.characteristics?.bs) / 10)
  } },
  { name: "ws_bonus", type: "number", summary: "Weapon Skill bonus (tens digit of WS).", scopes: {
    attacker: (c) => Math.floor(num(c.characteristics?.ws) / 10)
  } },
  // --- test / outcome ------------------------------------------------------
  { name: "roll", type: "number", summary: "The d100 to-hit roll (1\u2013100). Available from POST_ROLL onward.", scopes: {
    attacker: (c) => c.test?.roll ?? c.roll ?? 0
  } },
  { name: "dos", type: "number", summary: "Degrees of Success on the to-hit test (0 on a miss).", scopes: {
    attacker: (c) => c.test?.dos ?? c.dos ?? 0
  } },
  { name: "dof", type: "number", summary: "Degrees of Failure on the to-hit test (0 on a hit).", scopes: {
    attacker: (c) => c.test?.dof ?? c.dof ?? 0
  } },
  { name: "success", type: "bool", summary: "Whether the to-hit test passed. Available from POST_ROLL onward.", scopes: {
    attacker: (c) => c.test?.success ?? c.success ?? false
  } },
  // --- weapon mechanic / craftsmanship -------------------------------------
  { name: "jam_threshold", type: "number", summary: "A ranged weapon jams on a roll greater than this (default 96 \u2192 jams on 97+). Adjusted by Reliable/Unreliable and craftsmanship; 100 = never jams.", scopes: {
    attacker: (c) => c.jamThreshold ?? 96,
    weapon: (c) => c.jamThreshold ?? 96
  } },
  { name: "craftsmanship", type: "string", summary: `The weapon's craftsmanship: "Poor", "Common", "Good", or "Best".`, scopes: {
    attacker: (c) => c.craftsmanship ?? "Common",
    weapon: (c) => c.craftsmanship ?? "Common"
  } },
  // --- action context -------------------------------------------------------
  { name: "action", type: "string", summary: 'The current action name, e.g. "Standard Attack", "Called Shot", "Parry", "Dodge" \u2014 set in every flow including reactions.', scopes: {
    attacker: (c) => c.action ?? ""
  } },
  { name: "test_name", type: "string", summary: `The generic test's name/tag in the test.* pipeline (e.g. "Fear", "Athletics", "Acquisition") \u2014 "" outside it. Gate test-affecting rules on it: when test_name == "Fear" \u2026`, scopes: {
    attacker: (c) => c.testName ?? ""
  } },
  { name: "action_type", type: "string", summary: `The current action's type: "Half" | "Full" | "Reaction" | "Free" (from the Actions taxonomy), or "" if unknown.`, scopes: {
    attacker: (c) => actionType(c.action)
  } },
  { name: "is_attack", type: "bool", summary: 'The current action carries the "attack" subtype (the key designation, e.g. Standard Attack, Charge). Used by Defensive (-10 to attacks) and many others.', scopes: {
    attacker: (c) => actionHasSubtype(c.action, "attack")
  } },
  { name: "range", type: "string", summary: 'The range band, e.g. "Short Range", "Point Blank", "Melee".', scopes: {
    attacker: (c) => c.rangeBand ?? ""
  } },
  { name: "aim", type: "number", summary: "Aim bonus value applied (0 = none, 10 = half, 20 = full).", scopes: {
    attacker: (c) => c.aimValue ?? 0
  } },
  { name: "half_aim", type: "bool", summary: 'Aiming as a Half Action (Aim dropdown = Half, or a "Half Aim" status). The aim bonus is +10.', scopes: {
    attacker: (c) => c.aimValue === 10 || hasNamed(c.statuses, "Half Aim")
  } },
  { name: "full_aim", type: "bool", summary: 'Aiming as a Full Action (Aim dropdown = Full, or a "Full Aim" status). The aim bonus is +20.', scopes: {
    attacker: (c) => c.aimValue === 20 || hasNamed(c.statuses, "Full Aim")
  } },
  { name: "location", type: "string", summary: 'The current hit location (e.g. "Head"). Meaningful in the per-hit damage stages.', scopes: {
    attacker: (c) => c.location ?? ""
  } },
  { name: "damage_type", type: "string", summary: "The weapon damage type: Impact, Energy, Explosive, or Rending (rules may override it, e.g. Sanctified \u2192 Holy).", scopes: {
    attacker: (c) => c.damageType ?? "",
    weapon: (c) => c.damageType ?? ""
  } },
  { name: "hit_index", type: "number", summary: "Zero-based index of the current hit in a multi-hit attack.", scopes: {
    attacker: (c) => c.hitIndex ?? 0
  } },
  // --- per-hit target outcome (ON_HIT) --------------------------------------
  { name: "damage_dealt", type: "number", summary: "This hit's total damage (before soak). Meaningful at ON_HIT.", scopes: {
    attacker: (c) => c.damageDealt ?? 0
  } },
  { name: "wounds", type: "number", summary: "Wounds this hit inflicted after soak. Meaningful at ON_HIT.", scopes: {
    attacker: (c) => c.woundsInflicted ?? 0
  } },
  // --- target-only bases (reachable via target.* or the legacy aliases) -----
  { name: "armour", type: "number", summary: "The struck location's current Armour Points (base AP minus any already corroded this attack; 0 if unarmoured). Read at ON_HIT. Scope: target.", scopes: {
    target: (c) => c.targetArmour ?? num(c.target?.armour)
  } },
  { name: "unnatural_toughness", type: "number", summary: "The target's Unnatural Toughness bonus (added to TB when soaking; Felling reduces it). 0 if none. Scope: target.", scopes: {
    target: (c) => num(c.target?.unnaturalToughness)
  } },
  // --- opposing weapon (Parry context) --------------------------------------
  { name: "present", type: "bool", summary: "In a Parry, an opposing (attacking) weapon was supplied (the engagement provides it). Scope: opposing_weapon. Guards Power Field on a bare /api/parry test.", scopes: {
    opposing_weapon: (c) => !!c.opposingProvided
  } },
  // --- psyker (Force weapons — static half; the Focus Power rider is Phase 6) --
  { name: "psy_rating", type: "number", summary: "The attacker's psy rating (from attacker.psyRating; 0 = not a psyker). Force weapons add it to damage and penetration in a psyker's hands (p.145).", scopes: {
    attacker: (c) => Number(c.psyRating) || 0
  } },
  { name: "is_psyker", type: "bool", summary: "The attacker has a psy rating > 0.", scopes: {
    attacker: (c) => (Number(c.psyRating) || 0) > 0
  } },
  // --- combat state ----------------------------------------------------------
  { name: "dual_wielding", type: "bool", summary: "Wielding and firing two weapons this turn (set via combat.dualWielding).", scopes: {
    attacker: (c) => !!c.combat?.dualWielding
  } },
  { name: "firing_offhand", type: "bool", summary: "This attack uses the off-hand weapon (set via combat.firingOffhand).", scopes: {
    attacker: (c) => !!c.combat?.firingOffhand
  } },
  { name: "firing_both", type: "bool", summary: "Firing both weapons this turn (set via combat.firingBoth).", scopes: {
    attacker: (c) => !!c.combat?.firingBoth
  } }
];
var FACT_ALIASES = {};
var FUNCTION_DEFS = [
  { name: "has_quality", signature: 'has_quality("Name")', returns: "bool", summary: 'Weapon has the named quality. Prefix match \u2014 "Proven (3)" matches has_quality("Proven"). Scopes: attacker/weapon (default) or opposing_weapon (the parried weapon).', scopes: {
    attacker: (c, [n]) => hasQuality(c.qualities, String(n)),
    weapon: (c, [n]) => hasQuality(c.qualities, String(n)),
    opposing_weapon: (c, [n]) => hasQuality(c.opposingQualities, String(n))
  } },
  { name: "quality_level", signature: 'quality_level("Name", default)', returns: "number", summary: 'Numeric level parsed from a quality like "Proven (3)" \u2192 3; returns default if absent/unnumbered.', scopes: {
    attacker: (c, [n, d2]) => qualityLevel(c.qualities, String(n), d2),
    weapon: (c, [n, d2]) => qualityLevel(c.qualities, String(n), d2),
    opposing_weapon: (c, [n, d2]) => qualityLevel(c.opposingQualities, String(n), d2)
  } },
  { name: "has_talent", signature: 'has_talent("Name")', returns: "bool", summary: "Character has the named talent (from the attack's talents[] list). Prefix match.", scopes: {
    attacker: (c, [n]) => hasNamed(c.talents ?? c.actor?.talents, n)
  } },
  { name: "has_trait", signature: 'has_trait("Name")', returns: "bool", summary: 'Character/creature has the named DH2.0 trait (from traits[]). Prefix match \u2014 "Brutal Charge (3)" matches has_trait("Brutal Charge"). Scopes: attacker (default) or target (e.g. target.has_trait("Daemonic") \u2014 Sanctified).', scopes: {
    attacker: (c, [n]) => hasNamed(c.traits ?? c.actor?.traits, n),
    target: (c, [n]) => hasNamed(c.target?.traits, n)
  } },
  { name: "trait_level", signature: 'trait_level("Name", default)', returns: "number", summary: 'Numeric level parsed from a trait like "Brutal Charge (3)" \u2192 3; returns default if absent/unnumbered. Scopes: attacker (default) or target.', scopes: {
    attacker: (c, [n, d2]) => qualityLevel(c.traits, String(n), d2),
    target: (c, [n, d2]) => qualityLevel(c.target?.traits, String(n), d2)
  } },
  { name: "has_condition", signature: 'has_condition("Name")', returns: "bool", summary: 'A named Condition is active on the character (from conditions[] / statuses[]), e.g. "On Fire", "Full Aim", "Stunned".', scopes: {
    attacker: (c, [n]) => hasNamed(c.statuses ?? c.actor?.statuses, n)
  } },
  { name: "has_circumstance", signature: 'has_circumstance("Name")', returns: "bool", summary: "A named environmental Circumstance is in effect (from circumstances[]).", scopes: {
    attacker: (c, [n]) => hasNamed(c.circumstances ?? c.actor?.circumstances, n)
  } },
  { name: "circumstance_severity", signature: 'circumstance_severity("Name", default)', returns: "number", summary: "Severity of a structured Circumstance in circumstances[] (e.g. the Haywire Field strength 1\u20135), or default.", scopes: {
    attacker: (c, [n, d2]) => findNamed(c.circumstances ?? c.actor?.circumstances, n)?.severity ?? num(d2)
  } },
  { name: "configuration", signature: 'configuration("Name")', returns: "bool", summary: 'A per-character Configuration toggle is on (from configs[] / firingModes[]), e.g. configuration("Maximal").', scopes: {
    attacker: (c, [n]) => hasNamed(c.configs ?? c.firingModes, n)
  } },
  { name: "is_action", signature: 'is_action("Name")', returns: "bool", summary: 'The current action is the named one (case-insensitive), e.g. is_action("Parry"). Works in every flow including reactions.', scopes: {
    attacker: (c, [n]) => isAction(c.action, n)
  } },
  { name: "is_reaction", signature: "is_reaction()", returns: "bool", summary: "The current action is a Reaction (Parry, Dodge, \u2026).", scopes: {
    attacker: (c) => isReaction(c.action)
  } },
  { name: "action_subtype", signature: 'action_subtype("Name")', returns: "bool", summary: 'The current action carries the named subtype (declared via `subtype`/`attack` on the action). `is_attack` is shorthand for action_subtype("attack").', scopes: {
    attacker: (c, [n]) => actionHasSubtype(c.action, n)
  } },
  { name: "condition_severity", signature: 'condition_severity("Name", default)', returns: "number", summary: "Severity of a structured Condition in conditions[] (e.g. Crippled severity), or default.", scopes: {
    attacker: (c, [n, d2]) => findNamed(c.statuses ?? c.actor?.statuses, n)?.severity ?? num(d2)
  } },
  { name: "condition_duration", signature: 'condition_duration("Name", default)', returns: "number", summary: "Remaining duration (rounds) of a structured Condition in conditions[], or default.", scopes: {
    attacker: (c, [n, d2]) => findNamed(c.statuses ?? c.actor?.statuses, n)?.duration ?? num(d2)
  } },
  { name: "condition_location", signature: 'condition_location("Name")', returns: "string", summary: 'Hit location a structured Condition in conditions[] is bound to, or "".', scopes: {
    attacker: (c, [n]) => findNamed(c.statuses ?? c.actor?.statuses, n)?.location ?? ""
  } },
  { name: "tens", signature: "tens(n)", returns: "number", summary: "The tens digit of n, i.e. floor(n / 10).", scopes: {
    attacker: (c, [n]) => Math.floor(num(n) / 10)
  } },
  { name: "is_natural", signature: "is_natural(n)", returns: "bool", summary: "True if the d100 roll equals n exactly.", scopes: {
    attacker: (c, [n]) => (c.test?.roll ?? c.roll) === n
  } },
  // --- arithmetic helpers (Stage 3 — DH2 p.18: fractions round UP by default) ---
  { name: "ceil", signature: "ceil(n)", returns: "number", summary: "Round n up to the nearest integer.", scopes: {
    attacker: (c, [n]) => Math.ceil(Number(n) || 0)
  } },
  { name: "floor", signature: "floor(n)", returns: "number", summary: "Round n down to the nearest integer.", scopes: {
    attacker: (c, [n]) => Math.floor(Number(n) || 0)
  } },
  { name: "half", signature: "half(n)", returns: "number", summary: "Half of n, rounded UP \u2014 the DH2 default rounding (p.18), e.g. half(3) = 2.", scopes: {
    attacker: (c, [n]) => Math.ceil((Number(n) || 0) / 2)
  } }
];
var FUNCTION_ALIASES = {};
var SLOT_DEFS = {
  pen: {
    modes: ["=", "+="],
    at: "PENETRATION",
    summary: 'Armour penetration. `+=` accumulates under the rule\'s named modifier slot ("+= pen" doubles it); `=` overwrites the base.',
    apply: (ctx, op, v, meta) => {
      if (op === "+=") {
        const key = meta?.penKey ?? "penetration";
        ctx.penModifiers[key] = (ctx.penModifiers[key] || 0) + v;
      } else ctx.pen = v;
    }
  },
  rf_threshold: {
    modes: ["="],
    at: "DIE_ADJUST",
    summary: "The natural die value that triggers Righteous Fury (default 10; e.g. Vengeful lowers it).",
    apply: (ctx, op, v) => {
      ctx.rfThreshold = v;
    }
  },
  jam_threshold: {
    modes: ["="],
    at: "POST_ROLL",
    summary: "A ranged weapon jams on a roll greater than this (default 96). Reliable/Unreliable & craftsmanship set it.",
    apply: (ctx, op, v) => {
      ctx.jamThreshold = v;
    }
  },
  scatter: {
    modes: ["=", "+="],
    at: "ON_MISS",
    summary: "Scatter distance: `=` sets the base and activates scatter; `+=` adds a rule-named distance modifier. Final distance = max(0, base + modifiers).",
    apply: (ctx, op, v, meta) => {
      if (op === "+=") {
        const key = meta?.penKey ?? "scatter";
        ctx.scatterModifiers[key] = (ctx.scatterModifiers[key] || 0) + v;
      } else ctx.scatter = { active: true, base: v };
    }
  },
  damage_type: {
    modes: ["="],
    at: "DAMAGE_POOL, DIE_ADJUST",
    summary: `Override this hit's damage type (e.g. Sanctified \u2192 "Holy"); surfaced on the damage result.`,
    apply: (ctx, op, v) => {
      ctx.damageType = v;
    }
  },
  extra_dice: {
    modes: ["+="],
    at: "DAMAGE_POOL",
    summary: "Extra dice added to the damage pool (same size as the weapon die). `add_die N` is sugar for `set extra_dice += N`.",
    apply: (ctx, op, v) => {
      ctx.extraDice = (ctx.extraDice || 0) + v;
    }
  },
  extra_hits: {
    modes: ["+="],
    at: "HIT_COUNT_BONUS",
    summary: "Additional hits. `add_hits N` is sugar for `set extra_hits += N`.",
    apply: (ctx, op, v) => {
      ctx.additionalHits = (ctx.additionalHits || 0) + v;
    }
  },
  unnatural_toughness_reduction: {
    modes: ["+="],
    at: "PENETRATION",
    summary: "Reduce the target's Unnatural Toughness for this damage calc (Felling; Sanctified vs Daemonic). `reduce_unnatural_toughness N` is sugar.",
    apply: (ctx, op, v) => {
      ctx.unnaturalToughnessReduction = (ctx.unnaturalToughnessReduction || 0) + v;
    }
  }
};
var FLAG_DEFS = {
  no_parry: {
    at: "POST_ROLL",
    summary: "The attack cannot be Parried (Flexible); the engagement refuses a Parry reaction and notes it. `prevent_parry` is sugar.",
    apply: (ctx) => {
      ctx.preventParry = true;
    }
  },
  cannot_parry: {
    at: "PARRY",
    summary: "THIS weapon cannot be used to Parry (Unwieldy); resolveParry refuses the reaction. `cannot_parry` (verb) is sugar.",
    apply: (ctx) => {
      ctx.cannotParry = true;
    }
  },
  detonate: {
    at: "ON_MISS",
    summary: "Resolve the weapon's damage at the scatter point even on a miss (Blast). `detonate` (verb) is sugar.",
    apply: (ctx) => {
      ctx.detonate = true;
    }
  },
  attack_failed: {
    at: "POST_ROLL",
    summary: "Cancel the attack's success (a jam). `fail` is sugar.",
    apply: (ctx) => {
      ctx.success = false;
    }
  },
  keep_highest: {
    at: "DAMAGE_POOL",
    summary: "Keep only the original number of damage dice, highest values (pairs with extra dice \u2014 Tearing). `keep_highest` (verb) is sugar.",
    apply: (ctx) => {
      ctx.keepHighest = ctx.parsed.count;
      ctx.tearing = true;
    }
  }
};
var SLOT_DOCS = Object.entries(SLOT_DEFS).map(([name, s]) => ({
  name,
  modes: s.modes,
  at: s.at,
  summary: s.summary
}));
var FLAG_DOCS = Object.entries(FLAG_DEFS).map(([name, f]) => ({
  name,
  at: f.at,
  summary: f.summary
}));
var buildFlat = (defs, aliases) => {
  const flat = {};
  for (const d2 of defs) if (d2.scopes.attacker) flat[d2.name] = d2.scopes.attacker;
  for (const [alias, [scope, base]] of Object.entries(aliases)) {
    const def = defs.find((x) => x.name === base);
    if (def?.scopes[scope]) flat[alias] = def.scopes[scope];
  }
  return flat;
};
var buildScoped = (defs) => {
  const out = {};
  for (const s of SCOPE_NAMES) out[s] = {};
  for (const d2 of defs) for (const [s, get] of Object.entries(d2.scopes)) out[s][d2.name] = get;
  return out;
};
var FLAT_FACTS = buildFlat(FACT_DEFS, FACT_ALIASES);
var FLAT_FUNCTIONS = buildFlat(FUNCTION_DEFS, FUNCTION_ALIASES);
var SCOPED_FACTS = buildScoped(FACT_DEFS);
var SCOPED_FUNCTIONS = buildScoped(FUNCTION_DEFS);
var FACT_DOCS = [
  ...FACT_DEFS.filter((d2) => d2.scopes.attacker).map((d2) => ({
    name: d2.name,
    type: d2.type,
    summary: d2.summary,
    scopes: Object.keys(d2.scopes)
  })),
  ...Object.entries(FACT_ALIASES).map(([alias, [scope, base]]) => ({
    name: alias,
    type: FACT_DEFS.find((d2) => d2.name === base)?.type ?? "unknown",
    summary: `Alias of ${scope}.${base} (legacy prefixed name).`,
    scopes: [scope]
  }))
];
var FUNCTION_DOCS = [
  ...FUNCTION_DEFS.filter((d2) => d2.scopes.attacker).map((d2) => ({
    name: d2.name,
    signature: d2.signature,
    returns: d2.returns,
    summary: d2.summary,
    scopes: Object.keys(d2.scopes)
  })),
  ...Object.entries(FUNCTION_ALIASES).map(([alias, [scope, base]]) => {
    const def = FUNCTION_DEFS.find((d2) => d2.name === base);
    return {
      name: alias,
      signature: def ? def.signature.replace(def.name, alias) : `${alias}(\u2026)`,
      returns: def?.returns ?? "unknown",
      summary: `Alias of ${scope}.${base}(\u2026) (legacy prefixed name).`,
      scopes: [scope]
    };
  })
];
var SCOPED_ONLY_DOCS = FACT_DEFS.filter((d2) => !d2.scopes.attacker).map((d2) => ({
  name: d2.name,
  type: d2.type,
  summary: d2.summary,
  scopes: Object.keys(d2.scopes)
}));

// api/lib/dsl/interpreter.mjs
var FACTS = FLAT_FACTS;
var FUNCTIONS = FLAT_FUNCTIONS;
var factGetter = (scope, name) => {
  const get = scope ? SCOPED_FACTS[scope]?.[name] : FACTS[name];
  if (!get) {
    throw new DslError(scope ? `Unknown fact '${scope}.${name}'${SCOPE_NAMES.includes(scope) ? "" : ` (unknown scope '${scope}')`}` : `Unknown fact '${name}'`, 0, 0);
  }
  return get;
};
var fnGetter = (scope, name) => {
  const fn = scope ? SCOPED_FUNCTIONS[scope]?.[name] : FUNCTIONS[name];
  if (!fn) {
    throw new DslError(scope ? `Unknown function '${scope}.${name}()'${SCOPE_NAMES.includes(scope) ? "" : ` (unknown scope '${scope}')`}` : `Unknown function '${name}()'`, 0, 0);
  }
  return fn;
};
function evalNode(node, ctx) {
  switch (node.type) {
    case "Number":
    case "String":
    case "Boolean":
      return node.value;
    case "Dice": {
      let sum = 0;
      for (let k = 0; k < node.count; k++) sum += d(node.sides, ctx.rng, ctx.rollLabel ?? "dsl");
      return sum;
    }
    case "Identifier":
      return factGetter(node.scope ?? null, node.name)(ctx);
    case "Call":
      return fnGetter(node.scope ?? null, node.name)(ctx, node.args.map((a) => evalNode(a, ctx)));
    case "Unary":
      return node.op === "neg" ? -evalNode(node.operand, ctx) : !evalNode(node.operand, ctx);
    case "Logical":
      return node.op === "and" ? Boolean(evalNode(node.left, ctx)) && Boolean(evalNode(node.right, ctx)) : Boolean(evalNode(node.left, ctx)) || Boolean(evalNode(node.right, ctx));
    case "Comparison": {
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        case ">":
          return l > r;
        case "<":
          return l < r;
        case ">=":
          return l >= r;
        case "<=":
          return l <= r;
      }
      break;
    }
    case "Binary": {
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        // Integer semantics (Stage 3): division rounds UP — the DH2
        // global rounding rule (p.18). Use floor(a / b) for the rare
        // round-down case; half(n) is ceil(n/2).
        case "/":
          return Math.ceil(l / r);
      }
      break;
    }
  }
  throw new DslError(`Cannot evaluate node '${node.type}'`, 0, 0);
}
function applyAction(action, ctx, meta = {}) {
  var _a;
  ctx.rollLabel = meta.ruleName ?? action.name ?? action.action;
  switch (action.action) {
    case "add_modifier":
    case "set_modifier":
      ctx.modifiers[action.name] = evalNode(action.value, ctx);
      break;
    case "cancel_modifier":
      delete ctx.modifiers[action.name];
      break;
    case "set_slot": {
      const slot = SLOT_DEFS[action.slot];
      if (!slot) throw new DslError(`Unknown slot '${action.slot}'`, 0, 0);
      slot.apply(ctx, action.op ?? "=", evalNode(action.value, ctx), meta);
      break;
    }
    case "set_flag": {
      const flag = FLAG_DEFS[action.flag];
      if (!flag) throw new DslError(`Unknown flag '${action.flag}'`, 0, 0);
      flag.apply(ctx);
      break;
    }
    case "multiply_hits":
      ctx.additionalHits = (ctx.additionalHits || 0) * evalNode(action.value, ctx);
      break;
    case "floor_die": {
      const n = evalNode(action.value, ctx);
      ctx.proven = n;
      ctx.dieTransforms.push((v) => v < n ? n : v);
      break;
    }
    case "cap_die": {
      const n = evalNode(action.value, ctx);
      ctx.primitive = n;
      ctx.dieTransforms.push((v) => v > n ? n : v);
      break;
    }
    case "emit":
      ctx.effects.push({ name: action.name, effect: action.text ?? "" });
      break;
    case "suppress":
      (ctx.suppressed ?? (ctx.suppressed = /* @__PURE__ */ new Set())).add(action.name);
      break;
    case "bump_quality": {
      const by = evalNode(action.value, ctx);
      const list = ctx.qualities ?? [];
      const idx = list.findIndex((q) => nameOf(q).toLowerCase().startsWith(String(action.name).toLowerCase()));
      if (idx >= 0) {
        const cur = qualityLevel([list[idx]], action.name, 0);
        ctx.qualities = list.map((q, i) => i === idx ? { name: action.name, level: cur + by } : q);
        (ctx.effects ?? (ctx.effects = [])).push({ name: `${action.name} \u2191`, effect: `${action.name} (${cur}) \u2192 (${cur + by})` });
      }
      break;
    }
    case "add_quality": {
      const list = ctx.qualities ?? [];
      if (!list.some((q) => nameOf(q).toLowerCase().startsWith(String(action.name).toLowerCase()))) {
        ctx.qualities = [...list, { name: action.name, level: null }];
      }
      break;
    }
    case "require_test":
      ctx.targetEffects.tests.push({
        source: meta.ruleName ?? meta.penKey,
        characteristic: action.characteristic,
        modifier: evalNode(action.value, ctx),
        onFail: action.onFail,
        onFailRollTable: action.onFailRollTable ?? null,
        // evaluate the on-fail condition's structured vars now (e.g. Flame
        // → On Fire with a duration), so the engine just attaches them.
        onFailApply: action.onFailApply ? {
          name: action.onFailApply.name,
          value: action.onFailApply.value != null ? evalNode(action.onFailApply.value, ctx) : null,
          duration: action.onFailApply.duration != null ? evalNode(action.onFailApply.duration, ctx) : null,
          location: action.onFailApply.location != null ? evalNode(action.onFailApply.location, ctx) : null
        } : null,
        // LAZY: dice roll only if the test actually fails (Toxified's 1d10)
        onFailDamage: action.onFailDamage ? () => evalNode(action.onFailDamage, ctx) : null,
        // a PASSED test negates the hit entirely (Spray, p.149)
        avoidsHit: !!action.avoidsHit
      });
      break;
    case "declare_damage":
      (ctx.declaredDamage ?? (ctx.declaredDamage = [])).push({
        source: meta.ruleName ?? meta.penKey,
        amount: evalNode(action.value, ctx),
        reason: action.reason ?? null
      });
      break;
    case "declare_smoke":
      (ctx.smokeScreens ?? (ctx.smokeScreens = [])).push({
        source: meta.ruleName ?? meta.penKey,
        radius: evalNode(action.radius, ctx),
        duration: action.duration != null ? evalNode(action.duration, ctx) : null
      });
      break;
    case "declare_scatter_hit":
      ctx.hitScatterDistance = Math.max(0, evalNode(action.value, ctx));
      break;
    case "roll_on":
      (ctx.tableRolls ?? (ctx.tableRolls = [])).push({
        source: meta.ruleName ?? meta.penKey,
        table: action.table,
        modifier: action.value != null ? evalNode(action.value, ctx) : 0,
        area: action.area != null ? evalNode(action.area, ctx) : null
      });
      break;
    case "corrode":
      ((_a = ctx.targetEffects).armour ?? (_a.armour = [])).push({ source: meta.ruleName ?? meta.penKey, amount: evalNode(action.value, ctx) });
      break;
    case "apply_status":
      ctx.targetEffects.statuses.push({
        source: meta.ruleName ?? meta.penKey,
        status: action.name,
        value: action.value != null ? evalNode(action.value, ctx) : null,
        duration: action.duration != null ? evalNode(action.duration, ctx) : null,
        location: action.location != null ? evalNode(action.location, ctx) : null,
        reason: action.reason ?? null
      });
      break;
    default:
      throw new DslError(`Unknown action '${action.action}'`, 0, 0);
  }
}
function collectNames(node, acc = { facts: /* @__PURE__ */ new Set(), calls: /* @__PURE__ */ new Set(), scopedFacts: /* @__PURE__ */ new Set(), scopedCalls: /* @__PURE__ */ new Set() }) {
  if (!node || typeof node !== "object") return acc;
  switch (node.type) {
    case "Identifier":
      if (node.scope) acc.scopedFacts.add(`${node.scope}.${node.name}`);
      else acc.facts.add(node.name);
      break;
    case "Call":
      if (node.scope) acc.scopedCalls.add(`${node.scope}.${node.name}`);
      else acc.calls.add(node.name);
      node.args.forEach((a) => collectNames(a, acc));
      break;
    case "Logical":
    case "Comparison":
    case "Binary":
      collectNames(node.left, acc);
      collectNames(node.right, acc);
      break;
    case "Unary":
      collectNames(node.operand, acc);
      break;
  }
  return acc;
}

// api/lib/dsl/compiler.mjs
var KNOWN_CHECKPOINTS = new Set(Object.values(CHECKPOINTS));
var slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function compileRule(rule, pkg = null) {
  const checkpoint = rule.on?.startsWith("attack.") ? rule.on.slice("attack.".length) : rule.on;
  if (!KNOWN_CHECKPOINTS.has(checkpoint)) {
    throw new DslError(`Unknown checkpoint '${rule.on}' in rule "${rule.name}"`, rule.line, rule.col);
  }
  const names = { facts: /* @__PURE__ */ new Set(), calls: /* @__PURE__ */ new Set(), scopedFacts: /* @__PURE__ */ new Set(), scopedCalls: /* @__PURE__ */ new Set() };
  for (const br of rule.branches) {
    if (br.when) collectNames(br.when, names);
    for (const a of br.actions) if (a.value) collectNames(a.value, names);
  }
  for (const f of names.facts) {
    if (!(f in FACTS)) throw new DslError(`Unknown fact '${f}' in rule "${rule.name}"`, rule.line, rule.col);
  }
  for (const c of names.calls) {
    if (!(c in FUNCTIONS)) throw new DslError(`Unknown function '${c}()' in rule "${rule.name}"`, rule.line, rule.col);
  }
  for (const sf of names.scopedFacts) {
    const [scope, f] = sf.split(".");
    if (!SCOPE_NAMES.includes(scope)) throw new DslError(`Unknown scope '${scope}' in rule "${rule.name}" (scopes: ${SCOPE_NAMES.join(", ")})`, rule.line, rule.col);
    if (!(f in SCOPED_FACTS[scope])) throw new DslError(`Fact '${f}' is not available in scope '${scope}' in rule "${rule.name}"`, rule.line, rule.col);
  }
  for (const sc of names.scopedCalls) {
    const [scope, c] = sc.split(".");
    if (!SCOPE_NAMES.includes(scope)) throw new DslError(`Unknown scope '${scope}' in rule "${rule.name}" (scopes: ${SCOPE_NAMES.join(", ")})`, rule.line, rule.col);
    if (!(c in SCOPED_FUNCTIONS[scope])) throw new DslError(`Function '${c}()' is not available in scope '${scope}' in rule "${rule.name}"`, rule.line, rule.col);
  }
  for (const br of rule.branches) {
    for (const a of br.actions) {
      if (a.action === "set_slot") {
        const slot = SLOT_DEFS[a.slot];
        if (!slot) throw new DslError(`Unknown slot '${a.slot}' in rule "${rule.name}" (slots: ${Object.keys(SLOT_DEFS).join(", ")})`, rule.line, rule.col);
        if (!slot.modes.includes(a.op ?? "=")) throw new DslError(`Slot '${a.slot}' does not support '${a.op}' in rule "${rule.name}" (modes: ${slot.modes.join(", ")})`, rule.line, rule.col);
      } else if (a.action === "set_flag" && !FLAG_DEFS[a.flag]) {
        throw new DslError(`Unknown flag '${a.flag}' in rule "${rule.name}" (flags: ${Object.keys(FLAG_DEFS).join(", ")})`, rule.line, rule.col);
      }
    }
  }
  const ruleId = slug(rule.name);
  const meta = { penKey: ruleId.replace(/-/g, " "), ruleName: rule.name };
  const multi = rule.branches.length > 1;
  return rule.branches.map((br, i) => ({
    id: multi ? `${ruleId}#${i + 1}` : ruleId,
    ruleId,
    // Stable qualified id — unique across packages (Stage 5 layering keys on
    // this; ruleId stays the toggle key for back-compat).
    qualifiedId: pkg?.name ? `${pkg.name}/${ruleId}` : ruleId,
    name: rule.name,
    tier: rule.tier ?? null,
    source: rule.kind,
    checkpoint,
    priority: rule.priority ?? 0,
    // branch order preserved by insertion order
    // layered-registry override (Phase 3): qualified/rule ids this rule replaces
    replaces: rule.replaces ?? null,
    // Provenance (Stage 0): rule meta + the file's package header.
    page: rule.meta?.page ?? null,
    ref: rule.meta?.ref ?? null,
    package: pkg?.name ?? null,
    system: pkg?.system ?? null,
    sourceBook: rule.meta?.source ?? pkg?.source ?? null,
    when: br.when ? (ctx) => Boolean(evalNode(br.when, ctx)) : void 0,
    apply: (ctx) => {
      for (const a of br.actions) applyAction(a, ctx, meta);
    }
  }));
}
function compile(src) {
  const program = typeof src === "string" ? parse(src) : src;
  return program.rules.flatMap((r) => compileRule(r, program.package ?? null));
}
function programInfo(src) {
  const program = typeof src === "string" ? parse(src) : src;
  return {
    dslVersion: program.dslVersion ?? 1,
    package: program.package ? { name: program.package.name, system: program.package.system, source: program.package.source, requires: program.package.requires ?? [] } : null
  };
}
function compileTable(table) {
  const rows = [...table.rows].sort((a, b) => a.lo - b.lo);
  for (const r of rows) {
    if (r.hi < r.lo) throw new DslError(`Table "${table.name}" has a reversed range ${r.lo}-${r.hi}`, table.line, table.col);
  }
  return { name: table.name, die: table.die, rows };
}
function compileTables(src) {
  const program = typeof src === "string" ? parse(src) : src;
  return (program.tables ?? []).map(compileTable);
}
function compileActions(src) {
  const program = typeof src === "string" ? parse(src) : src;
  return (program.actions ?? []).map((a) => ({ name: a.name, type: a.actionType, subtypes: a.subtypes ?? [] }));
}
function referencedNames(src) {
  const program = typeof src === "string" ? parse(src) : src;
  const buckets = { talents: /* @__PURE__ */ new Set(), traits: /* @__PURE__ */ new Set(), qualities: /* @__PURE__ */ new Set(), conditions: /* @__PURE__ */ new Set(), circumstances: /* @__PURE__ */ new Set(), configurations: /* @__PURE__ */ new Set() };
  const byFn = {
    has_talent: "talents",
    has_trait: "traits",
    has_quality: "qualities",
    has_condition: "conditions",
    has_status: "conditions",
    has_circumstance: "circumstances",
    configuration: "configurations",
    firing_mode: "configurations"
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Call") {
      const lit = node.args[0]?.type === "String" ? node.args[0].value : null;
      const bucket = byFn[node.name];
      if (lit && bucket) buckets[bucket].add(lit);
      node.args.forEach(visit);
    } else {
      for (const k of ["left", "right", "operand"]) if (node[k]) visit(node[k]);
    }
  };
  for (const rule of program.rules) {
    for (const br of rule.branches) {
      if (br.when) visit(br.when);
      for (const a of br.actions) if (a.value) visit(a.value);
    }
  }
  return {
    talents: [...buckets.talents].sort(),
    traits: [...buckets.traits].sort(),
    qualities: [...buckets.qualities].sort(),
    conditions: [...buckets.conditions].sort(),
    circumstances: [...buckets.circumstances].sort(),
    configurations: [...buckets.configurations].sort()
  };
}
function valuedNames(src) {
  const program = typeof src === "string" ? parse(src) : src;
  const LEVEL_FNS = /* @__PURE__ */ new Set(["quality_level", "trait_level", "circumstance_severity", "condition_severity"]);
  const valued = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Call") {
      if (LEVEL_FNS.has(node.name)) {
        const lit = node.args[0]?.type === "String" ? node.args[0].value : null;
        if (lit) valued.add(lit);
      }
      node.args.forEach(visit);
    } else {
      for (const k of ["left", "right", "operand"]) if (node[k]) visit(node[k]);
    }
  };
  for (const rule of program.rules) {
    for (const br of rule.branches) {
      if (br.when) visit(br.when);
      for (const a of br.actions) if (a.value) visit(a.value);
    }
  }
  return [...valued].sort();
}

// api/lib/rules/combat-actions.mjs
var COMBAT_ACTIONS = {
  "Standard Attack": { modifier: 10, rate: "single", melee: true, ranged: true },
  "All Out Attack": { modifier: 30, rate: "single", melee: true, ranged: false },
  "Charge": { modifier: 20, rate: "single", melee: true, ranged: false },
  "Called Shot": { modifier: -20, rate: "single", melee: true, ranged: true },
  "Swift Attack": { modifier: 0, rate: "semi", melee: true, ranged: false, cap: "wsb", talent: "Swift Attack" },
  "Lightning Attack": { modifier: -10, rate: "full", melee: true, ranged: false, cap: "wsb", talent: "Lightning Attack" },
  "Semi-Auto Burst": { modifier: 0, rate: "semi", melee: false, ranged: true },
  "Full Auto Burst": { modifier: -10, rate: "full", melee: false, ranged: true },
  "Suppressing Fire (Semi)": { modifier: -20, rate: "semi", melee: false, ranged: true },
  "Suppressing Fire (Full)": { modifier: -20, rate: "full", melee: false, ranged: true, hitAccrual: "semi" }
};
var RANGE_BANDS = {
  "Melee": 0,
  "Point Blank": 30,
  "Short Range": 10,
  "Normal Range": 0,
  "Long Range": -10,
  "Extreme Range": -30
};
var AIM_MODES = { "None": 0, "Half": 10, "Full": 20 };
var normKey = (s) => String(s ?? "").toLowerCase().replace(/[\s_-]+/g, "");
var canonicalAction = (name) => {
  const k = normKey(name);
  for (const key of Object.keys(COMBAT_ACTIONS)) if (normKey(key) === k) return key;
  return null;
};
var combatActionEffects = [
  {
    id: "action-modifier",
    source: "combat-action",
    checkpoint: CHECKPOINTS.MODIFIERS,
    priority: 0,
    apply: (ctx) => {
      ctx.modifiers.attack = ctx.actionInfo.modifier;
    }
  },
  {
    id: "aim-modifier",
    source: "combat-action",
    checkpoint: CHECKPOINTS.MODIFIERS,
    priority: 10,
    // Aim only helps if you actually aimed, and is cancelled by All Out Attack.
    when: (ctx) => ctx.aimValue > 0 && ctx.action !== "All Out Attack",
    apply: (ctx) => {
      ctx.modifiers.aim = ctx.aimValue;
    }
  },
  {
    id: "range-modifier",
    source: "combat-action",
    checkpoint: CHECKPOINTS.MODIFIERS,
    priority: 20,
    // Only a non-zero band shifts the target (Normal Range / Melee are 0).
    when: (ctx) => !!RANGE_BANDS[ctx.rangeBand],
    apply: (ctx) => {
      ctx.modifiers.range = RANGE_BANDS[ctx.rangeBand];
    }
  },
  {
    id: "custom-modifier",
    source: "combat-action",
    checkpoint: CHECKPOINTS.MODIFIERS,
    priority: 30,
    when: (ctx) => !!ctx.input.customModifier,
    apply: (ctx) => {
      ctx.modifiers.modifier = Number(ctx.input.customModifier) || 0;
    }
  },
  {
    id: "all-out-attack",
    source: "combat-action",
    checkpoint: CHECKPOINTS.POST_ROLL,
    priority: 30,
    when: (ctx) => ctx.action === "All Out Attack",
    apply: (ctx) => ctx.effects.push({
      name: "All Out Attack",
      effect: "The character cannot attempt Evasion reactions until the beginning of his next turn."
    })
  }
];

// api/lib/rules/quality-conflicts.mjs
var EXCLUSION_GROUPS = [
  { axis: "accuracy", members: ["Accurate", "Inaccurate"] },
  { axis: "reliability", members: ["Reliable", "Unreliable"] },
  { axis: "wieldiness", members: ["Unwieldy", "Unbalanced", "Balanced"] }
];
function findQualityConflicts(qualities = []) {
  const out = [];
  for (const g of EXCLUSION_GROUPS) {
    const present = g.members.filter((m) => hasQuality(qualities, m));
    if (present.length > 1) out.push({ axis: g.axis, members: present });
  }
  return out;
}
var qualityConflictEffects = [
  {
    id: "quality-conflict-check",
    source: "mechanic",
    name: "Quality conflict check",
    checkpoint: CHECKPOINTS.POST_ROLL,
    priority: -100,
    when: (ctx) => findQualityConflicts(ctx.qualities).length > 0,
    apply: (ctx) => {
      for (const c of findQualityConflicts(ctx.qualities)) {
        (ctx.effects ?? (ctx.effects = [])).push({
          name: "Quality conflict",
          effect: `Mutually-exclusive ${c.axis} qualities on one weapon: ${c.members.join(" + ")}. These are opposed in DH2 RAW \u2014 a weapon should carry at most one. Their rules will both fire and may compound; correct the weapon data.`
        });
      }
    }
  }
];

// .build/sources.browser.mjs
var ruleSources = { "weapon-qualities.dsl": 'dsl 3\npackage "dh2.core.weapon-qualities" {\n  system "dh2"\n  source "Dark Heresy 2e Core Rulebook"\n}\n\n# DH2 weapon qualities \u2014 authored in the trait DSL.\n#\n# This file IS the interpretation of the DH2 weapon special qualities; it is\n# data, fully separated from the roll engine. It is compiled to checkpoint\n# effects at load time (see lib/rules/index.mjs) and was previously the native\n# module lib/rules/weapon-qualities.mjs \u2014 re-authoring it here dogfoods the DSL.\n#\n# Priorities mirror the original native ordering.\n\n# --- dice pool ---------------------------------------------------------------\nquality "Tearing" {\n  meta { page 150 }\n  on DAMAGE_POOL\n  priority 10\n  when has_quality("Tearing")\n  then set extra_dice += 1; flag keep_highest          # roll one extra die, keep the original count highest\n}\n\n# --- per-die adjustment + Righteous Fury threshold ---------------------------\nquality "Vengeful" {\n  meta { page 150 }\n  on DIE_ADJUST\n  priority 0\n  when has_quality("Vengeful")\n  then set rf_threshold = quality_level("Vengeful", 9)\n}\n\nquality "Proven" {\n  meta { page 148 }\n  on DIE_ADJUST\n  priority 10\n  when has_quality("Proven")\n  then floor_die quality_level("Proven", 2)\n}\n\nquality "Primitive" {\n  meta { page 148 }\n  on DIE_ADJUST\n  priority 20\n  when has_quality("Primitive")\n  then cap_die quality_level("Primitive", 7)\n}\n\n# --- Accurate (DH2 core p.150) ----------------------------------------------\n# Requires the Aim action. Two rules share the name "Accurate" so a single\n# toggle controls both halves of the quality:\n#   1) +10 to hit while aiming (on top of the aim bonus);\n#   2) +1d10 damage per two DoS (max +2d10) on an aimed single shot.\nquality "Accurate" {\n  meta { page 145 }\n  on MODIFIERS\n  priority 50\n  when has_quality("Accurate") and (half_aim or full_aim)\n  then add modifier "accurate_aim" = 10\n}\n\nquality "Accurate" {\n  meta { page 145 }\n  on DAMAGE_MODS\n  priority 10\n  when has_quality("Accurate") and (half_aim or full_aim) and (action == "Standard Attack" or action == "Called Shot") and dos >= 3\n    then add modifier "accurate" = 1d10\n  when has_quality("Accurate") and (half_aim or full_aim) and (action == "Standard Attack" or action == "Called Shot") and dos >= 5\n    then add modifier "accurate x 2" = 1d10\n}\n\n# --- Inaccurate (DH2 core p.146) --------------------------------------------\n# The opposite of Accurate: the character gains NO benefit from the Aim action\n# with this weapon. The aim bonus is injected by the combat-action `aim-modifier`\n# effect at MODIFIERS priority 10 (and Accurate adds "accurate_aim" at 50); this\n# runs at priority 100 (canceller convention) to strip the aim bonus afterwards.\n# Accurate + Inaccurate on the same weapon is a data conflict \u2014 see the\n# mutual-exclusion check in lib/rules/quality-conflicts.mjs, which surfaces it.\nquality "Inaccurate" {\n  meta { page 147 }\n  on MODIFIERS\n  priority 100\n  when has_quality("Inaccurate")\n  then cancel modifier "aim"\n}\n\n# --- hit count ---------------------------------------------------------------\nquality "Storm" {\n  meta { page 149 }\n  on HIT_COUNT_MULT\n  priority 10\n  when has_quality("Storm")\n  then multiply_hits 2\n}\n\nquality "Twin-Linked" {\n  meta { page 150 }\n  on HIT_COUNT_BONUS\n  priority 10\n  when has_quality("Twin-Linked") and dos > 1\n  then set extra_hits += 1\n}\n\n# --- penetration -------------------------------------------------------------\n# `set pen += pen` adds the base penetration again under the rule-named slot\n# ("razor sharp" / "melta"), doubling effective penetration.\n# Razor Sharp (DH2 core p.150): at 3+ DoS, double penetration \u2014 any attack\n# (melee OR ranged), so there is no is_melee gate.\nquality "Razor Sharp" {\n  meta { page 148 }\n  on PENETRATION\n  priority 10\n  when dos > 2 and has_quality("Razor Sharp")\n  then set pen += pen\n}\n\nquality "Melta" {\n  meta { page 148 }\n  on PENETRATION\n  priority 20\n  when is_ranged and has_quality("Melta") and (range == "Short Range" or range == "Point Blank")\n  then set pen += pen\n}\n\n# Lance (DH2 core p.147): variable penetration scaling with accuracy. Increase\n# penetration by the weapon\'s BASE value once per degree of success, e.g. base\n# pen 5 at 3 DoS adds 3\xD75=15 \u2192 total 20. `pen` reads the base penetration and\n# `dos` the to-hit degrees (both live on the context at PENETRATION).\nquality "Lance" {\n  meta { page 147 }\n  on PENETRATION\n  priority 15\n  when has_quality("Lance") and dos > 0\n  then set pen += pen * dos\n}\n\n# --- malfunctions (ranged) ---------------------------------------------------\n# Overheats on 92+; Best-craftsmanship weapons never overheat (p.149). An Overheats\n# weapon OVERRIDES the baseline Jam mechanic \u2014 it overheats instead of jamming, so\n# the first branch suppresses "Jam" (priority 10, before the Jam mechanic at 50)\n# whenever the weapon has Overheats; the second branch emits the overheat on 92+.\nquality "Overheats" {\n  meta { page 148 }\n  on POST_ROLL\n  priority 10\n  when is_ranged and has_quality("Overheats")\n    then suppress "Jam"\n  when is_ranged and roll > 91 and has_quality("Overheats") and craftsmanship != "Best"\n    then emit "Overheats", "The weapon overheats forcing it to be dropped on the ground!"\n}\n\n# Flexible (DH2 core p.145): linked/non-rigid weapons (whips, flails) deny defensive\n# counters \u2014 an attack from a Flexible weapon CANNOT be Parried (the engine refuses a\n# Parry reaction against it and notes it). A Flexible weapon can still itself Parry.\nquality "Flexible" {\n  meta { page 145 }\n  on POST_ROLL\n  when has_quality("Flexible")\n  then flag no_parry\n}\n\n# Graviton (DH2 core p.146): on a hit, inflicts additional damage equal to the\n# target\'s Armour points on the struck location (effectively negating armour). The\n# vehicle interaction (facing armour + always rolling Motive Systems Critical\n# Effects) is deferred \u2014 see POTENTIAL_FEATURES.md.\nquality "Graviton" {\n  meta { page 146 }\n  on DAMAGE_MODS\n  when has_quality("Graviton")\n  then add modifier "graviton" = target.armour\n}\n\n# Jam is a base weapon MECHANIC (see mechanics.dsl), not a quality. These two\n# qualities adjust the jam threshold (default 96 \u2192 jams on 97+):\n#   Reliable \u2192 jams only on 100; Unreliable \u2192 jams on 91+.\nquality "Reliable" {\n  meta { page 148 }\n  on POST_ROLL\n  priority 10\n  when is_ranged and has_quality("Reliable")\n  then set jam_threshold = 99\n}\n\nquality "Unreliable" {\n  meta { page 150 }\n  on POST_ROLL\n  priority 10\n  when is_ranged and has_quality("Unreliable")\n  then set jam_threshold = 90\n}\n\n# --- Scatter (DH2 core p.148) \u2014 the weapon QUALITY (distinct from the scatter\n# game mechanic / Scatter Diagram used by Blast on a miss). Spreading shot: deadly\n# up close, weak at range. Point Blank: +10 to hit and +3 damage; Short Range:\n# +10 to hit; any longer range (Normal/Long/Extreme): \u22123 damage.\nquality "Scatter" {\n  meta { page 148 }\n  on MODIFIERS\n  priority 50\n  when has_quality("Scatter") and (range == "Point Blank" or range == "Short Range")\n  then add modifier "scatter (close)" = 10\n}\nquality "Scatter" {\n  meta { page 148 }\n  on DAMAGE_MODS\n  priority 50\n  when has_quality("Scatter") and range == "Point Blank"\n    then add modifier "scatter" = 3\n  when has_quality("Scatter") and (range == "Normal Range" or range == "Long Range" or range == "Extreme Range")\n    then add modifier "scatter" = -3\n}\n\n# --- Force (DH2 core p.145) \u2014 the STATIC half ---------------------------------\n# In a psyker\'s hands (psy_rating > 0) a Force weapon deals +psy-rating damage,\n# gains +psy-rating penetration, and its damage type becomes Energy. The Focus\n# Power rider (+1d10 per DoS ignoring Armour and Toughness, Opposed Willpower)\n# needs the psychic subsystem \u2014 Phase 6. Force weapons are immune to Power Field\n# (already checked by that rule).\nquality "Force" {\n  meta { page 145 }\n  on DAMAGE_POOL\n  priority 0\n  when has_quality("Force") and is_psyker\n  then set damage_type = "Energy"\n}\nquality "Force" {\n  meta { page 145 }\n  on DAMAGE_MODS\n  when has_quality("Force") and is_psyker\n  then add modifier "force (psy rating)" = psy_rating\n}\nquality "Force" {\n  meta { page 145 }\n  on PENETRATION\n  when has_quality("Force") and is_psyker\n  then set pen += psy_rating\n}\n\n# --- Indirect (X) (DH2 core p.147) --------------------------------------------\n# Fired in a high arc without line of sight: \u221210 to the attack and a Full Action\n# (surfaced as a note \u2014 the tool does not hard-block action economy). EVERY HIT\n# scatters \u2014 it strikes the ground 1d10 \u2212 BS-bonus metres (min 0) from the\n# intended target, direction from the Scatter Diagram (declare scatter_hit).\n# On a miss the shot scatters X\xD71d10 metres (approximation of Xd10 \u2014 noted).\nquality "Indirect" {\n  meta { page 147 }\n  on MODIFIERS\n  when has_quality("Indirect")\n  then add modifier "indirect" = -10\n}\nquality "Indirect" {\n  meta { page 147 }\n  on POST_ROLL\n  when has_quality("Indirect")\n  then emit "Indirect", "fired without line of sight \u2014 requires a Full Action; the GM may add penalties for poor target awareness (p.147)"\n}\nquality "Indirect" {\n  meta { page 147 }\n  on ON_HIT\n  when has_quality("Indirect")\n  then declare scatter_hit 1d10 - bs_bonus\n}\nquality "Indirect" {\n  meta { page 147 }\n  on ON_MISS\n  priority 5\n  when is_ranged and has_quality("Indirect") and not success and roll <= jam_threshold\n  then set scatter = quality_level("Indirect", 1) * 1d10; roll_on "Scatter Diagram"\n}\n\n# --- Smoke (X) (DH2 core p.149) -------------------------------------------------\n# No damage: a hit creates a smokescreen with an X-metre radius at the impact\n# point, lasting 1d10+10 rounds. Like Blast, a Smoke weapon SCATTERS on a miss \u2014\n# the screen still forms at the scatter point, but only Blast also detonates its\n# damage there (the two compose: a Smoke+Blast weapon scatters once, detonates\n# via Blast\'s rule, and smokes via this one).\nquality "Smoke" {\n  meta { page 149 }\n  on ON_HIT\n  when has_quality("Smoke")\n  then declare smoke quality_level("Smoke", 1) duration 1d10 + 10\n}\nquality "Smoke" {\n  meta { page 149 }\n  on ON_MISS\n  priority 1\n  when is_ranged and has_quality("Smoke") and not success and roll <= jam_threshold and not has_quality("Blast")\n    then set scatter = 1d5; roll_on "Scatter Diagram"; declare smoke quality_level("Smoke", 1) duration 1d10 + 10\n  when is_ranged and has_quality("Smoke") and not success and roll <= jam_threshold and has_quality("Blast")\n    then declare smoke quality_level("Smoke", 1) duration 1d10 + 10\n}\n\n# --- Spray (DH2 core p.149) ------------------------------------------------------\n# The no-attack-roll cone: the ENGINE skips the BS test entirely for a Spray\n# weapon (auto-hit, always the Body, Called Shots impossible \u2014 see runToHit) and\n# this rule gives the struck target its Challenging (+0) Agility test; a PASSED\n# test AVOIDS the hit (avoids_hit). Untrained-wielder bonuses (+20/+30) are GM\n# adjustments via the test note. A natural 9 on any damage die jams the weapon\n# (engine \u2014 surfaced as a Jam effect). Cone multi-targeting is out of scope\n# (single representative target).\nquality "Spray" {\n  meta { page 149 }\n  on ON_HIT\n  when has_quality("Spray")\n  then require_test "Agility" 0 "struck by the spray" avoids_hit\n}\n\n# (Maximal \u2014 the high-power firing mode \u2014 moved to configurations.dsl, the\n#  Configurations category.)\n\n# --- on-hit target effects (DH2 core p.150) ---------------------------------\n# Concussive (X): the target makes a Toughness test at -10*X; on a fail it is\n# Stunned (1 round per DoF). If damage dealt exceeds the target\'s SB, Prone.\nquality "Concussive" {\n  meta { page 145 }\n  on ON_HIT\n  when has_quality("Concussive")\n    then require_test "Toughness" (-10 * quality_level("Concussive", 0)) "Stunned for 1 round per degree of failure"\n  when has_quality("Concussive") and damage_dealt > target.sb\n    then apply_status "Prone", "damage dealt exceeds the target\'s Strength Bonus"\n}\n\n# Crippling (X): if the target takes at least one wound, it is Crippled for the\n# encounter. This is automatic on a wound \u2014 there is no defender test to resist\n# it (DH2 RAW). The status carries a severity value of X \u2014 the Rending damage the\n# Crippled target suffers to that location each time it takes more than a Half\n# Action (default 1 if the quality has no rating).\nquality "Crippling" {\n  meta { page 145 }\n  on ON_HIT\n  when has_quality("Crippling") and wounds > 0\n  then apply_status "Crippled" value quality_level("Crippling", 1) location location, "the hit inflicted at least one wound (automatic, no test)"\n}\n\n# Corrosive (DH2 core p.145): the caustic hit corrodes the struck location\'s\n# armour by 1d10 Armour Points (permanent until repaired, cumulative across\n# hits). Any amount beyond the current AP \u2014 or the whole amount if the target is\n# unarmoured there \u2014 is dealt to the target as wounds, ignoring Toughness. The\n# engine resolves the AP loss and overflow (see resolveCorrosion); the report\n# shows the new AP so it can be carried to the next encounter.\nquality "Corrosive" {\n  meta { page 145 }\n  on ON_HIT\n  when has_quality("Corrosive")\n  then corrode 1d10\n}\n\n# Haywire (X) (DH2 core p.146): on a hit, roll 1d10 on the Haywire Field Effects\n# table to determine the strength of the disruptive field.\nquality "Haywire" {\n  meta { page 147 }\n  on ON_HIT\n  when has_quality("Haywire")\n  then roll_on "Haywire Field Effects" area quality_level("Haywire", 1)\n}\n\n# Hallucinogenic (X) (DH2 core p.145): the target makes a Toughness test at -10*X;\n# on a failure it suffers a delusion \u2014 roll 1d10 on the Hallucinogenic Effects\n# table (some results impose conditions on the target).\nquality "Hallucinogenic" {\n  meta { page 146 }\n  on ON_HIT\n  when has_quality("Hallucinogenic")\n  then require_test "Toughness" (-10 * quality_level("Hallucinogenic", 1)) "delusion (roll on Hallucinogenic Effects)" => roll_on "Hallucinogenic Effects"\n}\n\n# Recharge (DH2 core p.146): the weapon must spend a turn recharging before it can\n# fire again. No turn loop in this single-attack tool, so it is surfaced as a note;\n# it is also added dynamically by firing on Maximal (see configurations.dsl).\nquality "Recharge" {\n  meta { page 148 }\n  on POST_ROLL\n  when has_quality("Recharge")\n  then emit "Recharge", "must spend a turn recharging before it can fire again"\n}\n\n# Felling (X) (DH2 core p.145): when calculating damage, reduce the target\'s\n# Unnatural Toughness BONUS by X \u2014 only Unnatural Toughness, never the base\n# Toughness Bonus, and only for this damage calculation. Runs at PENETRATION (the\n# defence-reduction seam) so the soak step applies the reduced Unnatural Toughness.\nquality "Felling" {\n  meta { page 145 }\n  on PENETRATION\n  when has_quality("Felling")\n  then set unnatural_toughness_reduction += quality_level("Felling", 1)\n}\n\n# Flame (DH2 core p.145): whenever a target is struck by a Flame attack (even if it\n# suffers no damage), it must make an Agility test or be set On Fire (p.243).\n# Modelled as a per-hit Agility test that applies the On Fire condition on failure.\n# (RAW Flame is an area attack that doesn\'t use BS \u2014 that targeting is out of scope;\n# the test and its effect are modelled.)\nquality "Flame" {\n  meta { page 145 }\n  on ON_HIT\n  when has_quality("Flame")\n  then require_test "Agility" 0 "set on fire (gains the On Fire condition)" => apply_status "On Fire" duration "until extinguished"\n}\n\n# Shocking (DH2 core p.148): a target that takes at least 1 wound (after Armour\n# and Toughness) must pass a Challenging (+0) Toughness test or suffer 1 level of\n# Fatigue and be Stunned for rounds equal to half its DoF (rounding up). Modelled\n# as a Toughness test gated on wounds > 0; the Stunned condition lands on a fail\n# (the Fatigue level is descriptive \u2014 no fatigue track in this single-attack tool).\nquality "Shocking" {\n  meta { page 149 }\n  on ON_HIT\n  when has_quality("Shocking") and wounds > 0\n  then require_test "Toughness" 0 "1 level of Fatigue and Stunned for rounds equal to half the degrees of failure" => apply_status "Stunned"\n}\n\n# Snare (X) (DH2 core p.148): on a hit, the target makes an Agility test at \u221210\xD7X\n# or is Immobilised (and counts as Helpless until it escapes \u2014 a Full Action\n# Challenging Strength/Agility test at \u221210\xD7X). The Immobilised condition lands on\n# a failed Agility test; escaping is descriptive (no turn loop here).\nquality "Snare" {\n  meta { page 149 }\n  on ON_HIT\n  when has_quality("Snare")\n  then require_test "Agility" (-10 * quality_level("Snare", 0)) "Immobilised (Helpless until it escapes)" => apply_status "Immobilised"\n}\n\n# Toxic (X) (DH2 core p.150): a target that suffers damage (after Armour and\n# Toughness) from a Toxic weapon is poisoned \u2014 it gains the Toxified condition,\n# which (at the end of each of its turns it took damage that round) forces a\n# Toughness test at \u221210\xD7X or 1d10 extra damage. The recurring test needs a turn\n# loop this tool lacks, so it is carried as the Toxified condition (value X) and\n# documented there (conditions.dsl); here we just inflict it on a wounding hit.\nquality "Toxic" {\n  meta { page 150 }\n  on ON_HIT\n  when has_quality("Toxic") and wounds > 0\n  then apply_status "Toxified" value quality_level("Toxic", 0), "took damage from a Toxic weapon (end-of-turn Toughness test or 1d10 additional damage)"\n}\n\n# Sanctified (DH2 core p.148): the weapon is blessed \u2014 its damage counts as Holy,\n# which has unique effects against denizens of the Warp. The concrete interaction\n# in this engine: a Daemonic creature\'s Toughness-bonus increase (its Unnatural\n# Toughness) "is negated by damage inflicted from \u2026 holy attacks" (p.135), so vs a\n# Daemonic target Sanctified strips the target\'s Unnatural Toughness for this hit\n# (reusing Felling\'s reduction). The Holy damage type is surfaced on the result.\n# (Daemonic / From Beyond traits themselves are planned \u2014 see POTENTIAL_FEATURES.md.)\nquality "Sanctified" {\n  meta { page 148 }\n  on DAMAGE_POOL\n  priority 0\n  when has_quality("Sanctified")\n  then set damage_type = "Holy"\n}\nquality "Sanctified" {\n  meta { page 148 }\n  on PENETRATION\n  priority 30\n  when has_quality("Sanctified") and target.has_trait("Daemonic")\n  then set unnatural_toughness_reduction += target.unnatural_toughness\n}\n\n# --- defensive / parry qualities (DH2 core p.150) ---------------------------\n# Balanced grants +10 to Weapon Skill tests made to Parry (only once even with\n# two Balanced weapons \u2014 it is keyed by the modifier name, so it can\'t stack).\nquality "Balanced" {\n  meta { page 145 }\n  on PARRY\n  when has_quality("Balanced")\n  then add modifier "balanced" = 10\n}\n\n# Defensive (e.g. a shield): +15 to Parry, but -10 to attacks made with it.\nquality "Defensive" {\n  meta { page 145 }\n  on PARRY\n  when has_quality("Defensive")\n  then add modifier "defensive" = 15\n}\nquality "Defensive" {\n  meta { page 145 }\n  on MODIFIERS\n  when has_quality("Defensive") and is_attack\n  then add modifier "defensive" = -10\n}\n\n# Unbalanced (DH2 core p.150): cumbersome offensively-strong weapons. \u221210 to Parry\n# tests, and they cannot be used to make Lightning Attack actions (surfaced as a\n# note \u2014 the tool does not hard-block action choice).\nquality "Unbalanced" {\n  meta { page 150 }\n  on PARRY\n  when has_quality("Unbalanced")\n  then add modifier "unbalanced" = -10\n}\nquality "Unbalanced" {\n  meta { page 150 }\n  on POST_ROLL\n  when has_quality("Unbalanced") and is_action("Lightning Attack")\n  then emit "Unbalanced", "cannot be used to make Lightning Attack actions"\n}\n\n# Unwieldy (DH2 core p.150): huge, top-heavy weapons. They CANNOT be used to Parry\n# (the parry flow refuses the reaction \u2014 see resolveParry) and cannot make\n# Lightning Attack actions.\nquality "Unwieldy" {\n  meta { page 150 }\n  on PARRY\n  when has_quality("Unwieldy")\n  then flag cannot_parry\n}\nquality "Unwieldy" {\n  meta { page 150 }\n  on POST_ROLL\n  when has_quality("Unwieldy") and is_action("Lightning Attack")\n  then emit "Unwieldy", "cannot be used to make Lightning Attack actions"\n}\n\n# Power Field (DH2 core p.148): a disruptive energy field. When this weapon\n# SUCCESSFULLY Parries an attack made with a weapon that lacks Power Field, roll\n# 1d100 on Power Field Destruction; on 26+ the attacker\'s weapon is destroyed.\n# Weapons with the Force or Warp Weapon quality, and Natural Weapons, are immune.\n# Runs at POST_PARRY (success known); `opposing_has_quality` reads the parried\n# (attacking) weapon, `opposing_present` guards the bare /api/parry test.\nquality "Power Field" {\n  meta { page 148 }\n  on POST_PARRY\n  when has_quality("Power Field") and success and opposing_weapon.present\n    and not opposing_weapon.has_quality("Power Field") and not opposing_weapon.has_quality("Force")\n    and not opposing_weapon.has_quality("Warp Weapon") and not opposing_weapon.has_quality("Natural Weapon")\n  then roll_on "Power Field Destruction"\n}\n\n# --- Blast (X) scatter on a miss (DH2 core p.150 / scatter p.230) ------------\n# A Blast weapon scatters when the firer misses. The scatter distance defaults\n# to 1d5 metres (p.230); the engine rolls the 1d10 direction on the Scatter\n# Diagram. This runs at priority 0 so the 1d5 base is established BEFORE any\n# other rules \u2014 which may increase or decrease it via `set scatter += \u2026`\n# (modifiers accumulate separately and are summed onto the base at the end).\n#\n# `detonate` makes the weapon still resolve its damage at the scatter point even\n# though the shot missed \u2014 a blast goes off wherever it lands and may catch other\n# targets in the area. The `roll <= jam_threshold` gate means a *jam* (which also\n# fails the to-hit) does NOT detonate: a jammed weapon never fired.\nquality "Blast" {\n  meta { page 145 }\n  on ON_MISS\n  priority 0\n  when is_ranged and has_quality("Blast") and not success and roll <= jam_threshold\n  then set scatter = 1d5; flag detonate; roll_on "Scatter Diagram"\n}\n', "talents.dsl": 'dsl 3\npackage "dh2.core.talents" {\n  system "dh2"\n  source "Dark Heresy 2e Core Rulebook"\n}\n\n# DH2 TALENTS (XP-bought abilities) that gate on combat state \u2014 authored in the DSL.\n# This file holds talents ONLY (kind `talent`, gated on has_talent(...)); innate\n# DH2.0 traits live separately in traits.dsl (kind `trait`, has_trait(...)). The two\n# are distinct categories in the rule taxonomy and the UI.\n#\n# Talent rules are always present in the registry but only fire when the\n# character actually HAS the talent (has_talent(...)) AND the situation is\n# right (the activation predicate). This is the activation/effect split that\n# lets e.g. Ambidextrous check "am I dual-wielding?" before touching a penalty.\n#\n# Priorities: penalty injectors at 10, cancellers/reducers at 100 (so they run\n# after the penalties they modify are in place).\n\n# (The base off-hand -20 circumstance moved to circumstances.dsl.)\n\n# --- Two-Weapon Wielder ------------------------------------------------------\n# Lets a character attack with two weapons; each attack suffers -20.\ntalent "Two-Weapon Wielder" {\n  on MODIFIERS\n  priority 10\n  when has_talent("Two-Weapon Wielder") and dual_wielding\n  then add modifier "two_weapon" = -20\n}\n\n# --- Ambidextrous (tier 1) ---------------------------------------------------\n# Two branches, each with its own activation:\n#  - firing a single off-hand weapon: negate the off-hand penalty;\n#  - combined with Two-Weapon Wielder while dual-wielding: reduce the\n#    two-weapon penalty -20 -> -10.\ntalent "Ambidextrous" tier 1 {\n  on MODIFIERS\n  priority 100\n  when has_talent("Ambidextrous") and firing_offhand and not dual_wielding\n    then cancel modifier "off_hand"\n  when has_talent("Ambidextrous") and has_talent("Two-Weapon Wielder") and dual_wielding\n    then set modifier "two_weapon" = -10\n}\n\n# --- Two-Weapon Master (tier 3, DH2 core p.132) --------------------------------\n# "When armed with two single-handed weapons \u2026 he ignores the \u201320 penalty for\n# Two-Weapon Fighting." Priority 110: after Two-Weapon Wielder injects the -20\n# (10) and after Ambidextrous halves it (100), the master removes what is left.\ntalent "Two-Weapon Master" tier 3 {\n  meta { page 132 }\n  on MODIFIERS\n  priority 110\n  when has_talent("Two-Weapon Master") and dual_wielding\n  then cancel modifier "two_weapon"\n}\n\n# --- Marksman (tier 2, DH2 core p.130) ------------------------------------------\n# "\u2026suffers no penalties for making Ballistic Skill tests at Long or Extreme\n# range." The engine injects the band penalty as the "range" modifier\n# (combat-actions.mjs RANGE_BANDS: Long -10, Extreme -30); Marksman cancels it.\n# Bonuses (Point Blank/Short) are untouched \u2014 only the PENALTY bands gate here.\ntalent "Marksman" tier 2 {\n  meta { page 130 }\n  on MODIFIERS\n  priority 100\n  when has_talent("Marksman") and is_ranged and (range == "Long Range" or range == "Extreme Range")\n  then cancel modifier "range"\n}\n\n# --- Precision Killer (tier 2, DH2 core p.130) -----------------------------------\n# "When making a Called Shot \u2026 he does not suffer the usual \u201320 penalty." The\n# Called Shot action\'s -20 IS the action modifier ("attack"), so cancelling it\n# yields the RAW net 0. Specialised entries ("Precision Killer (Ranged)"/\n# "(Melee)") gate on the matching attack type; a bare "Precision Killer" entry\n# (specialisation not recorded) applies to both.\ntalent "Precision Killer" tier 2 {\n  meta { page 130 }\n  on MODIFIERS\n  priority 100\n  when has_talent("Precision Killer (Ranged)") and is_ranged and action == "Called Shot"\n    then cancel modifier "attack"\n  when has_talent("Precision Killer (Melee)") and is_melee and action == "Called Shot"\n    then cancel modifier "attack"\n  when has_talent("Precision Killer") and not has_talent("Precision Killer (") and action == "Called Shot"\n    then cancel modifier "attack"\n}\n\n# --- Mighty Shot (tier 3, DH2 core p.130) ----------------------------------------\n# "He adds half his Ballistic Skill bonus (rounded up) to damage he inflicts\n# with ranged weapons." half() rounds up (DH2 p.18 default).\ntalent "Mighty Shot" tier 3 {\n  meta { page 130 }\n  on DAMAGE_MODS\n  when has_talent("Mighty Shot") and is_ranged\n  then add modifier "mighty shot" = half(bs_bonus)\n}\n\n# --- Crushing Blow (tier 3, DH2 core p.125) --------------------------------------\n# "He adds half his Weapon Skill bonus (rounding up) to damage he inflicts with\n# melee attacks."\ntalent "Crushing Blow" tier 3 {\n  meta { page 125 }\n  on DAMAGE_MODS\n  when has_talent("Crushing Blow") and is_melee\n  then add modifier "crushing blow" = half(ws_bonus)\n}\n\n# --- Hatred (DH2 core p.128) ------------------------------------------------------\n# "When fighting opponents of that group in close combat, the Acolyte gains a\n# +10 bonus to all Weapon Skill tests made against them", plus a Willpower test\n# to retreat/surrender. The hated group is parametric (Hatred (Mutants), \u2026) and\n# the engine cannot know who the current foe is \u2014 flag the engagement with the\n# "Hated Foe" circumstance when the target belongs to the hated group.\ntalent "Hatred" {\n  meta { page 128 }\n  on MODIFIERS\n  when has_talent("Hatred") and is_melee and has_circumstance("Hated Foe")\n    then add modifier "hatred" = 10\n  when has_talent("Hatred") and is_melee and has_circumstance("Hated Foe")\n    then emit "Hatred", "must pass a Challenging (+0) Willpower test to retreat or surrender against the hated foe"\n}\n\n# --- Iron Jaw (tier 1, DH2 core p.128) --------------------------------------------\n# "Whenever this character becomes Stunned, he may make a Challenging (+0)\n# Toughness test as a Free Action to ignore the effects." Modelled as upkeep\n# policy: at the start of his turn a Stunned character with the talent rolls\n# the test (against the encounter-stored Toughness); a pass means the GM clears\n# the condition.\ntalent "Iron Jaw" tier 1 {\n  meta { page 128 }\n  on upkeep.TURN_START\n  when has_talent("Iron Jaw") and has_condition("Stunned")\n  then require_test "Toughness" 0 "remains Stunned (Iron Jaw: a pass shakes off the condition \u2014 Free Action)"\n}\n\n# --- Die Hard (tier 1, DH2 core p.125) --------------------------------------------\n# "When this character would suffer a level of Fatigue due to the Blood Loss\n# condition, he makes a Challenging (+0) Willpower test; if he succeeds, he does\n# not suffer a level of Fatigue." Runtime override of the base Blood Loss upkeep\n# rule (conditions.dsl): suppress the automatic Fatigue note and roll the\n# Willpower test instead (priority 10, before Blood Loss at 50).\ntalent "Die Hard" tier 1 {\n  meta { page 125 }\n  on upkeep.TURN_START\n  priority 10\n  when has_talent("Die Hard") and has_condition("Blood Loss")\n    then suppress "Blood Loss"\n  when has_talent("Die Hard") and has_condition("Blood Loss")\n    then require_test "Willpower" 0 "suffers 1 level of Fatigue (Blood Loss)"\n}\n', "traits.dsl": 'dsl 3\npackage "dh2.core.traits" {\n  system "dh2"\n  source "Dark Heresy 2e Core Rulebook"\n}\n\n# DH2.0 traits \u2014 innate abilities (like talents, but NOT bought with XP).\n# Gated on has_trait("\u2026"). A character/creature\'s traits are supplied per\n# attack via traits: ["Brutal Charge (3)", \u2026].\n# Levelled traits read their value with trait_level("Name", default).\n\n# Brutal Charge (X): on a melee Charge, add X to the damage inflicted.\ntrait "Brutal Charge" {\n  on DAMAGE_MODS\n  priority 50\n  when has_trait("Brutal Charge") and is_melee and action == "Charge"\n  then add modifier "brutal charge" = trait_level("Brutal Charge", 0)\n}\n\n# --- Auto-Stabilised (DH2 core p.134) ------------------------------------------\n# "These beings always count as braced when firing heavy weapons \u2026 and not\n# suffer any penalties to hit." Cancels the Unbraced circumstance penalty\n# (circumstances.dsl, -30 per p.219).\ntrait "Auto-Stabilised" {\n  meta { page 134 }\n  on MODIFIERS\n  priority 100\n  when has_trait("Auto-Stabilised") and has_circumstance("Unbraced")\n  then cancel modifier "unbraced"\n}\n\n# --- Fear (X) (DH2 core p.136, Table 4-5) ---------------------------------------\n# A character who encounters a Fear creature makes a Willpower test with a\n# penalty by rating: Disturbing (1) +0, Frightening (2) -10, Horrifying (3) -20,\n# Terrifying (4) -30. Runs in the GENERIC test pipeline: roll the Willpower test\n# via /api/test with testName "Fear" and the creature as `foe`\n# ({ foe: { traits: ["Fear (3)"] } }); on a failure the character rolls on\n# Table 8-11: Shock (p.287), +10 per degree of failure.\ntrait "Fear" {\n  meta { page 136 }\n  on test.MODIFIERS\n  when test_name == "Fear" and target.has_trait("Fear")\n  then add modifier "fear rating" = -10 * (target.trait_level("Fear", 1) - 1)\n}\n\n# --- From Beyond (DH2 core p.136) ------------------------------------------------\n# "Such a creature is immune to Fear, Pinning, Insanity points, and psychic\n# powers used to cloud, control, or delude its mind." Surfaces the immunity when\n# a Fear or Pinning test is rolled FOR the creature \u2014 no test is actually needed.\ntrait "From Beyond" {\n  meta { page 136 }\n  on test.MODIFIERS\n  priority 100\n  when (test_name == "Fear" or test_name == "Pinning") and has_trait("From Beyond")\n  then emit "From Beyond", "immune to Fear, Pinning, Insanity points, and mind-clouding psychic powers \u2014 no test is needed"\n}\n\n# --- Regeneration (X) (DH2 core p.137) --------------------------------------------\n# "Each round, at the start of its turn, the creature can make a Toughness test\n# to remove an amount of damage indicated in the parentheses." Upkeep policy:\n# the tick rolls the Toughness test against the encounter-stored stats; on a\n# pass the GM removes trait-rating damage (healing is advisory \u2014 wounds.taken\n# is not auto-reduced).\ntrait "Regeneration" {\n  meta { page 137 }\n  on upkeep.TURN_START\n  when has_trait("Regeneration")\n  then require_test "Toughness" 0 "no regeneration this round (a pass removes damage equal to the trait rating)"\n}\n\n# --- Sturdy (DH2 core p.138) --------------------------------------------------------\n# "Sturdy creatures \u2026 gain a +20 bonus to tests made to resist Grappling and\n# Knock Down actions, and uses of the Takedown talent." Generic test pipeline:\n# tag the resistance roll with the matching testName.\ntrait "Sturdy" {\n  meta { page 138 }\n  on test.MODIFIERS\n  when has_trait("Sturdy") and (test_name == "Grapple" or test_name == "Knock Down" or test_name == "Takedown")\n  then add modifier "sturdy" = 20\n}\n\n# Unnatural Characteristic (X) (DH2 core p.139) is NOT a trait rule \u2014 it is a\n# property of a characteristic, handled by the engine: +X to that characteristic\'s\n# bonus (Unnatural Strength \u2192 melee Strength Bonus; Unnatural Toughness \u2192 soak TB)\n# and \u2308X/2\u2309 bonus degrees of success on a successful test with it (WS/BS to-hit,\n# WS Parry, Ag Dodge). Supply it via the `unnatural:{ws,bs,s,ag}` object on the\n# attacker/defender (and `unnaturalToughness` for soak), exposed in the Roll UI as\n# the per-characteristic "Unnatural" inputs \u2014 see rollTest()/runToHit() in\n# lib/engine.mjs. (Previously a simplified flat-damage trait lived here; it was\n# superseded by the characteristic-based implementation.)\n', "conditions.dsl": `dsl 3
package "dh2.core.conditions" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Conditions currently applied to the character \u2014 transient states such as
# aiming or being on fire (most are listed on DH2 core p.242; others come from
# weapon qualities, e.g. Crippled, Stunned). Gated on has_condition("\u2026") and
# supplied per attack via conditions: ["On Fire", "Full Aim", \u2026]. The old key
# statuses[] and has_status() remain accepted as aliases.

# Aiming as a condition (an alternative to the Aim dropdown). Adds the aim bonus
# to the to-hit modifier set.
condition "Half Aim" {
  on MODIFIERS
  when has_condition("Half Aim")
  then add modifier "aim" = 10
}

condition "Full Aim" {
  on MODIFIERS
  when has_condition("Full Aim")
  then add modifier "aim" = 20
}

# On Fire! (DH2 core p.243): a burning creature takes 1d10 E to the body each round
# (armour does not protect; Toughness Bonus applies), must pass a Challenging (+0)
# Willpower test to act normally, and may spend a Hard (-20) Agility Full Action to
# extinguish itself. Applied by Flame weapons (Agility test or catch fire \u2014 see
# weapon-qualities.dsl). Attack-time: a burning attacker suffers -10 (distracted by
# the flames). Per-round: the upkeep tick (Phase 4 \u2014 EncounterState) declares the
# 1d10 burn at the start of the actor's turn.
condition "On Fire" {
  meta { page 243 }
  on MODIFIERS
  when has_condition("On Fire")
  then add modifier "on_fire" = -10
}
condition "On Fire" {
  meta { page 243 }
  on upkeep.TURN_START
  when has_condition("On Fire")
  then declare damage 1d10, "burning \u2014 Energy to the Body; armour does not protect, Toughness Bonus applies; Hard (-20) Agility Full Action to extinguish"
}

# Toxified (DH2 core p.150, applied by the Toxic (X) weapon quality): the
# character is poisoned. RAW: at the END of each of his turns the victim makes a
# Toughness test at \u221210\xD7X (the Toxic rating, carried as this condition's
# severity) or suffers 1d10 additional damage. FULLY IMPLEMENTED via the upkeep
# tick (Phase 4 \u2014 EncounterState): the end-of-turn test rolls against the
# actor's stored Toughness, and the 1d10 lands only on a failure. The POST_ROLL
# emit still surfaces the condition when a Toxified character acts.
condition "Toxified" {
  meta { page 150 }
  on POST_ROLL
  priority 0
  when has_condition("Toxified")
  then emit "Toxified", "poisoned: at the end of each turn, a Toughness test (\u221210\xD7severity) or 1d10 additional damage (DH2 core p.150)"
}
condition "Toxified" {
  meta { page 150 }
  on upkeep.TURN_END
  when has_condition("Toxified")
  then require_test "Toughness" (-10 * condition_severity("Toxified", 0)) "1d10 additional damage from the toxin" => damage 1d10
}

# Blood Loss (DH2 core p.244): "At the start of his turn, an affected character
# suffers 1 level of Fatigue. Once per round as a Free Action, he (or another
# character who can reach him) can attempt a Difficult (-10) Medicae test to
# remove this condition. \u2026 multiple Blood Loss conditions do not stack."
# Fatigue is not yet a tracked stat \u2014 the tick surfaces the level as an event.
# Die Hard (talents.dsl) suppresses this rule and rolls a Willpower test instead.
condition "Blood Loss" {
  meta { page 244 }
  on upkeep.TURN_START
  priority 50
  when has_condition("Blood Loss")
  then emit "Blood Loss", "suffers 1 level of Fatigue; a Difficult (-10) Medicae test (Free Action, once per round) removes the condition"
}
`, "circumstances.dsl": 'dsl 3\npackage "dh2.core.circumstances" {\n  system "dh2"\n  source "Dark Heresy 2e Core Rulebook"\n}\n\n# Circumstances \u2014 situational modifiers derived from the environment or the\n# framing of an action (not purchasable talents, not active conditions, not\n# per-character configurations). Gated on has_circumstance("\u2026") (or a fact);\n# eventually hook into a map/scene-aware system (see FOUNDRY_MIGRATION.md).\n# Supplied per attack via circumstances: ["\u2026"] (entries may be structured objects\n# { name, severity } for circumstances that carry a strength, e.g. Haywire Field).\n\n# --- Darkness (DH2 core p.229) ----------------------------------------------\n# Fighting in darkness: Weapon Skill tests suffer -20, Ballistic Skill tests -30.\ncircumstance "Darkness" {\n  meta { page 229 }\n  on MODIFIERS\n  when has_circumstance("Darkness") and is_melee  then add modifier "darkness" = -20\n  when has_circumstance("Darkness") and is_ranged then add modifier "darkness" = -30\n}\n\n# --- Haywire Field (DH2 core p.146, Table 5-4) ------------------------------\n# An ENVIRONMENTAL field left by a Haywire weapon (see weapon-qualities.dsl). It is\n# ONE circumstance carrying a severity (1-5 = Insignificant / Minor Disruption /\n# Major Disruption / Dead Zone / Prolonged Dead Zone) rather than five separate\n# conditions \u2014 RAW the field "lessens one step in severity each round", so a single\n# severity that degrades models it cleanly. The Haywire roll establishes the field\n# strength; set it via circumstances: [{ name: "Haywire Field", severity: N }].\n# Powered ranged attacks (non-Primitive) suffer the field penalty, worsening by\n# severity threshold: 2 Minor = -10, 3 Major = -20, 4-5 Dead Zone = -60 (technology\n# ceases \u2014 powered weapons effectively cannot fire). Primitive weapons are exempt.\n# --- Unbraced heavy weapon (DH2 core p.219) ----------------------------------\n# "If a character fires an unbraced Heavy weapon, he suffers a -30 penalty to\n# his [attack test]." Weapon class is not modelled, so flag the shot with the\n# "Unbraced" circumstance; Auto-Stabilised (traits.dsl) cancels it.\ncircumstance "Unbraced" {\n  meta { page 219 }\n  on MODIFIERS\n  when has_circumstance("Unbraced") and is_ranged\n  then add modifier "unbraced" = -30\n}\n\ncircumstance "Haywire Field" {\n  meta { page 147 }\n  on MODIFIERS\n  when has_circumstance("Haywire Field") and is_ranged and not has_quality("Primitive") and circumstance_severity("Haywire Field", 0) == 2\n    then add modifier "haywire field" = -10\n  when has_circumstance("Haywire Field") and is_ranged and not has_quality("Primitive") and circumstance_severity("Haywire Field", 0) == 3\n    then add modifier "haywire field" = -20\n  when has_circumstance("Haywire Field") and is_ranged and not has_quality("Primitive") and circumstance_severity("Haywire Field", 0) >= 4\n    then add modifier "haywire field" = -60\n}\n', "configurations.dsl": `dsl 3
package "dh2.core.configurations" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# Configurations \u2014 per-character toggles the player chooses for a shot/turn
# (grip, dual-wield, firing modes). Gated on configuration("\u2026") (firing_mode is
# an alias) and supplied per attack via configs: ["\u2026"] (the old firingModes[] is
# still accepted). Eventually set from the character sheet (FOUNDRY_MIGRATION.md).

# --- Off-Hand (grip configuration) ------------------------------------------
# Wielding a weapon in the off hand incurs -20 (cancelled by Ambidextrous). A
# per-character grip Configuration (moved here from Circumstances), driven by the
# firing_offhand combat flag \u2014 set via combat: { firingOffhand: true }.
configuration "Off-Hand" {
  on MODIFIERS
  priority 10
  when firing_offhand and not dual_wielding
  then add modifier "off_hand" = -20
}

# --- Maximal: a high-power firing mode (DH2 core p.146) ----------------------
# Maximal is BOTH a weapon quality and a Configuration: the weapon QUALITY
# "Maximal" (a capability marker on the weapon's qualities list \u2014 recognised in
# availableQualities) GATES the Maximal Configuration. The rules below gate on the
# weapon HAVING the Maximal quality AND the Maximal config being toggled on, so the
# UI only offers (and the engine only applies) Maximal when the weapon supports it. Firing on Maximal: +1d10
# damage, +2 penetration, Blast value +2, and (per RAW) +10 m range, x3 ammo,
# gains Recharge \u2014 the last three are surfaced as a note (range-in-metres and ammo
# tracking are deferred \u2014 see POTENTIAL_FEATURES.md).
configuration "Maximal" {
  meta { page 147 }
  on DAMAGE_MODS
  when has_quality("Maximal") and configuration("Maximal")
  then add modifier "maximal" = 1d10
}
configuration "Maximal" {
  meta { page 147 }
  on PENETRATION
  when has_quality("Maximal") and configuration("Maximal")
  then set pen += 2
}
configuration "Maximal" {
  meta { page 147 }
  on PENETRATION
  priority 5
  when has_quality("Maximal") and configuration("Maximal")
  then bump_quality "Blast" by 2
}
# Firing on Maximal grants the Recharge quality this shot \u2014 added early (MODIFIERS)
# so the Recharge quality rule (POST_ROLL) sees it and fires. The note covers the
# range/ammo costs (no range-in-metres or ammo model yet \u2014 see POTENTIAL_FEATURES.md).
configuration "Maximal" {
  meta { page 147 }
  on MODIFIERS
  when has_quality("Maximal") and configuration("Maximal")
  then add_quality "Recharge"
}
configuration "Maximal" {
  meta { page 147 }
  on POST_ROLL
  when has_quality("Maximal") and configuration("Maximal")
  then emit "Maximal", "+10 m range and x3 ammunition this shot"
}
`, "mechanics.dsl": 'dsl 3\npackage "dh2.core.mechanics" {\n  system "dh2"\n  source "Dark Heresy 2e Core Rulebook"\n}\n\n# Weapon mechanics & craftsmanship \u2014 authored in the DSL.\n#\n# Jam is a base MECHANIC (not a weapon quality): a ranged weapon jams when the\n# attack roll exceeds the jam threshold (default 96 \u2192 jams on 97+). Qualities\n# (Reliable/Unreliable) and craftsmanship adjust `jam_threshold` BEFORE this\n# check runs (lower priority), so they compose. A threshold of 100 never jams.\n\nmechanic "Jam" {\n  on POST_ROLL\n  priority 50\n  when is_ranged and roll > jam_threshold\n  then emit "Jam", "The weapon jams!"; flag attack_failed\n}\n\n# ===== Weapon craftsmanship (DH2 core p.149) =================================\n# craftsmanship fact is "Poor" | "Common" | "Good" | "Best" (weapon.craftsmanship).\n\n# --- melee: WS modifier applies to every WS test made with the weapon, i.e.\n#     both attacks (MODIFIERS) and parries (PARRY). Best also adds +1 damage. ---\nmechanic "Poor Craftsmanship (melee)" {\n  on MODIFIERS  when is_melee and craftsmanship == "Poor"  then add modifier "craftsmanship" = -10\n}\nmechanic "Poor Craftsmanship (melee)" {\n  on PARRY  when craftsmanship == "Poor"  then add modifier "craftsmanship" = -10\n}\nmechanic "Good Craftsmanship (melee)" {\n  on MODIFIERS  when is_melee and craftsmanship == "Good"  then add modifier "craftsmanship" = 5\n}\nmechanic "Good Craftsmanship (melee)" {\n  on PARRY  when craftsmanship == "Good"  then add modifier "craftsmanship" = 5\n}\nmechanic "Best Craftsmanship (melee)" {\n  on MODIFIERS  when is_melee and craftsmanship == "Best"  then add modifier "craftsmanship" = 10\n}\nmechanic "Best Craftsmanship (melee)" {\n  on PARRY  when craftsmanship == "Best"  then add modifier "craftsmanship" = 10\n}\nmechanic "Best Craftsmanship (melee)" {\n  on DAMAGE_MODS  when is_melee and craftsmanship == "Best"  then add modifier "craftsmanship" = 1\n}\n\n# --- ranged: craftsmanship adjusts the jam threshold (priority 5, before the\n#     Reliable/Unreliable qualities at 10 and the base Jam mechanic at 50). ---\nmechanic "Poor Craftsmanship (ranged)" {\n  on POST_ROLL  priority 5  when is_ranged and craftsmanship == "Poor"  then set jam_threshold = 90\n}\nmechanic "Good Craftsmanship (ranged)" {\n  on POST_ROLL  priority 5  when is_ranged and craftsmanship == "Good"  then set jam_threshold = 99\n}\nmechanic "Best Craftsmanship (ranged)" {\n  on POST_ROLL  priority 5  when is_ranged and craftsmanship == "Best"  then set jam_threshold = 100\n}\n\n# --- auto-fire raises the jam chance: 94+ jams on Semi-Auto, Full Auto, and\n#     Suppressing Fire (p.223-224). Priority 15 (after craftsmanship at 5 and\n#     Reliable/Unreliable at 10): only ever LOWERS the threshold (a Poor weapon\n#     keeps its 90), and defers to Best craftsmanship ("never jams") and\n#     Reliable (jams only on very high rolls) rather than stomping them. ---\nmechanic "Auto-Fire Jam" {\n  meta { page 223 }\n  on POST_ROLL\n  priority 15\n  when is_ranged and jam_threshold > 93 and craftsmanship != "Best" and not has_quality("Reliable")\n   and (is_action("Semi-Auto Burst") or is_action("Full Auto Burst")\n        or is_action("Suppressing Fire (Semi)") or is_action("Suppressing Fire (Full)"))\n  then set jam_threshold = 93\n}\n', "roll-tables.dsl": `dsl 3
package "dh2.core.roll-tables" {
  system "dh2"
  source "Dark Heresy 2e Core Rulebook"
}

# DH2 roll tables \u2014 data for the \`roll_on\` action.
#
# A roll_table names a die and a set of <lo>[-<hi>]: "outcome" rows; an optional
# \`=> "Status", \u2026\` applies those statuses to the target when that row comes up.
# Rules invoke a table with \`roll_on "Table Name"\`; the engine rolls the die,
# finds the row, records the result, and applies any statuses. These tables are
# pure data \u2014 the scatter direction, Haywire field, and Hallucinogenic delusion
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
  5:  "directly short \u2014 back toward the firer"
  6:  "short and to the left"
  7:  "to the left"
  8:  "beyond and to the left"
  9:  "wide of the mark"
  10: "wildly off-axis"
}

# --- Haywire Field Effects (DH2 core p.146, Table 5\u20134) ----------------------
# Invoked on a hit by a Haywire weapon to determine the field strength.
roll_table "Haywire Field Effects" {
  die 1d10
  1-2:  "Insignificant \u2014 some machine spirits are unsettled, but no noticeable effect on nearby technology."
  3-4:  "Minor Disruption \u2014 powered actions (non-Primitive ranged attacks, Tech-Use, power-armour/cybernetic actions) suffer -10; power-armour move -1."
  5-6:  "Major Disruption \u2014 those actions suffer -20; power-armour move -3; technological melee weapons function as Primitive."
  7-8:  "Dead Zone \u2014 technology ceases; power armour unpowered (move 1); cybernetic organs cause 1 level of Fatigue per round."
  9-10: "Prolonged Dead Zone \u2014 as Dead Zone for 1d5 rounds, then lessens to Major Disruption."
}

# --- Hallucinogenic Effects (DH2 core p.145, Table 5\u20133) ----------------------
# Rolled when a target FAILS the Toughness test forced by a Hallucinogenic
# weapon. Some delusions impose conditions on the target (=> statuses).
roll_table "Hallucinogenic Effects" {
  die 1d10
  1:  "Bugsbugsbugs! He drops to the floor clawing at imaginary insects devouring his flesh." => "Prone", "Stunned"
  2:  "My hands\u2026! He drops everything and spends the duration staring at his hands, screaming." => "Stunned"
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
  26-100: "The power field shears clean through \u2014 the attacker's weapon is DESTROYED."
}
`, "actions.dsl": 'dsl 3\npackage "dh2.core.actions" {\n  system "dh2"\n  source "Dark Heresy 2e Core Rulebook"\n}\n\n# Actions \u2014 every action a character can take (DH2 core p.219+). Each declares a\n# `type` (Half | Full | Reaction | Free) and zero or more `subtype` designations;\n# `attack` is sugar for `subtype attack` \u2014 the KEY subtype many rules read (via\n# is_attack / action_subtype("\u2026")), e.g. Defensive\'s -10 to attacks. Compiled once\n# into the actions registry at load ("checked at server startup"); other rules\n# hook on the current action via is_action("\u2026"), action_type, is_reaction(),\n# is_attack and action_subtype("\u2026"). To-hit modifiers for the attack actions still\n# live in the engine (combat-actions); these declarations own the taxonomy.\n\naction "Standard Attack"  { type Half  attack }\naction "Semi-Auto Burst"  { type Half  attack  subtype ranged }\naction "Full Auto Burst"  { type Half  attack  subtype ranged }\naction "All Out Attack"   { type Full  attack  subtype melee }\naction "Charge"           { type Full  attack  subtype melee }\naction "Called Shot"      { type Full  attack }\n# Swift Attack (p.225) and Lightning Attack (p.223) are HALF Actions in DH2 2e\n# (Table 7-1, p.222) \u2014 the melee multi-attacks, gated by their talents below.\naction "Swift Attack"     { type Half  attack  subtype melee }\naction "Lightning Attack" { type Half  attack  subtype melee }\n# Suppressing Fire (p.224): Full Action, needs a weapon capable of semi- or\n# full-automatic fire; the mode picks the kill-zone arc, hit cap, and the\n# Pinning difficulty (see the rules below).\naction "Suppressing Fire (Semi)" { type Full  attack  subtype ranged }\naction "Suppressing Fire (Full)" { type Full  attack  subtype ranged }\naction "Defensive Stance" { type Full }\naction "Aim"              { type Half }\n\n# Reactions \u2014 gate talents/qualities with is_reaction() or is_action("Parry").\naction "Parry"            { type Reaction }\naction "Dodge"            { type Reaction }\n\n# --- action legality (advisory) ------------------------------------------------\n# "This action may only be taken if the attacker has the \u2026 talent." The engine\n# resolves the roll anyway (the GM may house-rule); these surface the RAW gate\n# as a warning effect when the talent is missing.\nmechanic "Swift Attack (talent gate)" {\n  meta { page 225 }\n  on MODIFIERS\n  priority 5\n  when is_action("Swift Attack") and not has_talent("Swift Attack")\n  then emit "Swift Attack", "RAW this action may only be taken if the attacker has the Swift Attack talent (p.131)"\n}\n\nmechanic "Lightning Attack (talent gate)" {\n  meta { page 223 }\n  on MODIFIERS\n  priority 5\n  when is_action("Lightning Attack") and not has_talent("Lightning Attack")\n  then emit "Lightning Attack", "RAW this action may only be taken if the attacker has the Lightning Attack talent (p.129)"\n}\n\n# "Unbalanced or Unwieldy melee weapons cannot be used to make a Lightning\n# Attack." (p.223)\nmechanic "Lightning Attack (weapon restriction)" {\n  meta { page 223 }\n  on MODIFIERS\n  priority 5\n  when is_action("Lightning Attack") and (has_quality("Unbalanced") or has_quality("Unwieldy"))\n  then emit "Lightning Attack", "Unbalanced or Unwieldy melee weapons cannot be used to make a Lightning Attack"\n}\n\n# --- Suppressing Fire (DH2 core p.224) -------------------------------------------\n# Full Action: establish a kill zone (30\xB0 semi / 45\xB0 full arc), fire a burst,\n# and force every target in the zone to test Pinning \u2014 Difficult (-10) for\n# semi-auto, Hard (-20) for full auto \u2014 REGARDLESS of whether the Hard (-20)\n# BS test hits (the -20 is the action modifier; hits land on random targets,\n# one extra per two extra DoS, capped at the mode\'s rate of fire). The BS test\n# jams on 94+ (the Auto-Fire Jam mechanic) and cannot be voluntarily failed.\nmechanic "Suppressing Fire" {\n  meta { page 224 }\n  on POST_ROLL\n  priority 40\n  when is_action("Suppressing Fire (Semi)")\n    then emit "Suppressing Fire", "all targets in the 30 degree kill zone must pass a Difficult (-10) Pinning test or become Pinned (p.230); hits are assigned to RANDOM targets in the zone (the attacker cannot choose to fail the BS test)"\n  when is_action("Suppressing Fire (Full)")\n    then emit "Suppressing Fire", "all targets in the 45 degree kill zone must pass a Hard (-20) Pinning test or become Pinned (p.230); hits are assigned to RANDOM targets in the zone (the attacker cannot choose to fail the BS test)"\n}\n' };

// api/lib/rules/index.mjs
var readRule = (name) => ruleSources[name];
var qualitiesSrc = readRule("weapon-qualities.dsl");
var talentsSrc = readRule("talents.dsl");
var traitsSrc = readRule("traits.dsl");
var conditionsSrc = readRule("conditions.dsl");
var circumstancesSrc = readRule("circumstances.dsl");
var configurationsSrc = readRule("configurations.dsl");
var mechanicsSrc = readRule("mechanics.dsl");
var rollTablesSrc = readRule("roll-tables.dsl");
var actionsSrc = readRule("actions.dsl");
registerActions(compileActions(actionsSrc));
var availableActionNames = availableActions();
var weaponQualityEffects = compile(qualitiesSrc);
var talentEffects = compile(talentsSrc);
var traitEffects = compile(traitsSrc);
var conditionEffects = compile(conditionsSrc);
var circumstanceEffects = compile(circumstancesSrc);
var configurationEffects = compile(configurationsSrc);
var mechanicEffects = compile(mechanicsSrc);
var actionRuleEffects = compile(actionsSrc);
var rollTables = compileTables(rollTablesSrc);
var availableTables = rollTables.map((t) => ({ name: t.name, die: `${t.die.count}d${t.die.sides}`, rows: t.rows.length }));
var availableQualities = referencedNames(
  [qualitiesSrc, talentsSrc, traitsSrc, conditionsSrc, circumstancesSrc, configurationsSrc, mechanicsSrc].join("\n\n")
).qualities;
var availableTalents = referencedNames([talentsSrc, actionsSrc].join("\n\n")).talents;
var availableTraits = referencedNames(traitsSrc).traits;
var availableConditions = referencedNames(conditionsSrc).conditions;
var availableCircumstances = referencedNames(circumstancesSrc).circumstances;
var availableConfigurations = referencedNames(configurationsSrc).configurations;
var availableValued = valuedNames(
  [qualitiesSrc, talentsSrc, traitsSrc, conditionsSrc, circumstancesSrc, configurationsSrc, mechanicsSrc].join("\n\n")
);
var withInfo = (entry, src) => ({ ...entry, source: src, ...programInfo(src) });
var builtinSources = [
  withInfo({ category: "Weapon qualities", file: "weapon-qualities.dsl" }, qualitiesSrc),
  withInfo({ category: "Talents", file: "talents.dsl" }, talentsSrc),
  withInfo({ category: "Traits", file: "traits.dsl" }, traitsSrc),
  withInfo({ category: "Conditions", file: "conditions.dsl" }, conditionsSrc),
  withInfo({ category: "Circumstances", file: "circumstances.dsl" }, circumstancesSrc),
  withInfo({ category: "Configurations", file: "configurations.dsl" }, configurationsSrc),
  withInfo({ category: "Mechanical", file: "mechanics.dsl" }, mechanicsSrc),
  withInfo({ category: "Actions", file: "actions.dsl" }, actionsSrc),
  withInfo({ category: "Roll tables", file: "roll-tables.dsl" }, rollTablesSrc)
];
var KIND_GROUP = {
  quality: "Weapon qualities",
  talent: "Talents",
  trait: "Traits",
  circumstance: "Circumstances",
  condition: "Conditions",
  action: "Actions",
  configuration: "Configurations",
  mechanic: "Mechanical",
  miscellaneous: "Miscellaneous"
};
var GROUP_ORDER = [
  "Weapon qualities",
  "Talents",
  "Traits",
  "Circumstances",
  "Conditions",
  "Actions",
  "Configurations",
  "Mechanical",
  "Miscellaneous"
];
var builtinRules = (() => {
  const all = [...weaponQualityEffects, ...talentEffects, ...traitEffects, ...conditionEffects, ...circumstanceEffects, ...configurationEffects, ...mechanicEffects, ...actionRuleEffects];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const e of all) {
    if (seen.has(e.ruleId)) continue;
    seen.add(e.ruleId);
    out.push({
      id: e.ruleId,
      name: e.name,
      kind: e.source,
      checkpoint: e.checkpoint,
      category: KIND_GROUP[e.source] ?? "Other",
      // provenance (Stage 0)
      qualifiedId: e.qualifiedId ?? e.ruleId,
      page: e.page ?? null,
      package: e.package ?? null,
      system: e.system ?? null,
      sourceBook: e.sourceBook ?? null
    });
  }
  out.sort((a, b) => GROUP_ORDER.indexOf(a.category) - GROUP_ORDER.indexOf(b.category));
  return out;
})();
function buildDefaultRegistry() {
  return new Registry().addAll(combatActionEffects).addAll(qualityConflictEffects).addAll(weaponQualityEffects).addAll(talentEffects).addAll(traitEffects).addAll(conditionEffects).addAll(circumstanceEffects).addAll(configurationEffects).addAll(mechanicEffects).addTables(rollTables);
}
function buildRegistry(customRules, disabledIds = []) {
  const disabled = new Set(disabledIds);
  const custom = customRules && String(customRules).trim() ? compile(customRules) : [];
  const replaced = new Set(custom.flatMap((e) => e.replaces ?? []));
  const keep = (effects) => effects.filter((e) => !disabled.has(e.ruleId) && !disabled.has(e.id) && !replaced.has(e.qualifiedId) && !replaced.has(e.ruleId));
  const registry = new Registry().addAll(combatActionEffects).addAll(qualityConflictEffects).addAll(keep(weaponQualityEffects)).addAll(keep(talentEffects)).addAll(keep(traitEffects)).addAll(keep(conditionEffects)).addAll(keep(circumstanceEffects)).addAll(keep(configurationEffects)).addAll(keep(mechanicEffects)).addAll(keep(actionRuleEffects)).addTables(rollTables);
  if (custom.length) {
    registry.addAll(custom);
    registry.addTables(compileTables(customRules));
  }
  return registry;
}
var defaultRegistry = buildDefaultRegistry();

// api/lib/engine.mjs
function rollTest({ target = 0, modifiers = {}, label = "test", unnatural = 0 }, rng = Math.random, forcedRoll = null) {
  let modifierTotal = Object.values(modifiers).reduce((a, b) => a + (Number(b) || 0), 0);
  if (modifierTotal > 60) modifierTotal = 60;
  if (modifierTotal < -60) modifierTotal = -60;
  const modifiedTarget = Number(target) + modifierTotal;
  const roll = forcedRoll ?? d(100, rng, label);
  const success = roll === 1 || roll <= modifiedTarget && roll !== 100;
  const unnaturalValue = Number(unnatural) || 0;
  const bonusDos = success && unnaturalValue > 0 ? Math.ceil(unnaturalValue / 2) : 0;
  return {
    roll,
    target: Number(target),
    modifiers,
    modifierTotal,
    modifiedTarget,
    success,
    dos: success ? 1 + getDegree(modifiedTarget, roll) + bonusDos : 0,
    dof: success ? 0 : 1 + getDegree(roll, modifiedTarget),
    unnatural: unnaturalValue,
    bonusDos,
    autoFailure: roll === 100,
    autoSuccess: roll === 1
  };
}
function rollDamage(opts, rng = Math.random, registry = defaultRegistry) {
  const {
    formula,
    qualities = [],
    sbTimes = 0,
    strengthBonus = 0,
    dos = 1,
    action = "Standard Attack",
    location = "Body",
    damageType = "Impact",
    rangeBand = "Normal Range",
    // so range-gated damage rules (e.g. Scatter) can read `range`
    // Character-side facts so talent/trait/status rules can gate at the
    // per-hit damage checkpoints (e.g. Brutal Charge at DAMAGE_MODS, or
    // Accurate which requires aiming).
    talents = [],
    traits = [],
    statuses = [],
    firingModes = [],
    configs = [],
    isMelee = false,
    aimValue = 0,
    craftsmanship = "Common",
    targetArmour = 0,
    // the target's AP at the struck location, for Graviton (+damage = armour)
    target = null,
    // the (normalised) target block, so target.* scoped facts work at the damage checkpoints
    psyRating = 0,
    // Force weapons (p.145): +psy rating damage/pen in a psyker's hands
    characteristics = {}
    // so ws_bonus/bs_bonus work at the damage checkpoints (Mighty Shot, Crushing Blow)
  } = opts;
  const parsed = parseDamageFormula(formula);
  if (!parsed) return { error: `Cannot parse damage formula "${formula}"` };
  const ctx = new RollContext({
    parsed,
    formula,
    qualities: canonList(qualities),
    sbTimes,
    strengthBonus,
    dos,
    action,
    location,
    damageType,
    rangeBand,
    rng,
    talents: canonList(talents),
    traits: canonList(traits),
    statuses,
    firingModes,
    configs,
    isMelee,
    aimValue,
    craftsmanship,
    targetArmour,
    target,
    psyRating,
    characteristics,
    // accumulators the effects mutate:
    extraDice: 0,
    keepHighest: null,
    tearing: false,
    rfThreshold: 10,
    dieTransforms: [],
    proven: null,
    primitive: null,
    modifiers: {}
  });
  runCheckpoint(registry, CHECKPOINTS.DAMAGE_POOL, ctx);
  const rolled = [];
  const diceToRoll = parsed.count + ctx.extraDice;
  for (let i = 0; i < diceToRoll; i++) rolled.push(d(parsed.sides, rng, `damage die ${i + 1}`));
  let kept = [...rolled];
  let discarded = [];
  if (ctx.keepHighest != null) {
    kept = [...rolled].sort((a, b) => b - a).slice(0, ctx.keepHighest);
    const pool = [...rolled];
    kept.forEach((k) => pool.splice(pool.indexOf(k), 1));
    discarded = pool;
  }
  ctx.kept = kept;
  ctx.discarded = discarded;
  runCheckpoint(registry, CHECKPOINTS.DIE_ADJUST, ctx);
  const righteousFury = [];
  const adjusted = kept.map((die) => {
    if (die >= ctx.rfThreshold) {
      const rfRoll = d(5, rng, "Righteous Fury crit");
      righteousFury.push({
        naturalRoll: die,
        rfRoll,
        effect: getCriticalDamage(damageType, location, rfRoll) ?? ""
      });
    }
    let v = die;
    for (const transform of ctx.dieTransforms) v = transform(v);
    return v;
  });
  if (parsed.flat) ctx.modifiers["weapon"] = parsed.flat;
  if (sbTimes > 0) ctx.modifiers["strength bonus"] = strengthBonus * sbTimes;
  runCheckpoint(registry, CHECKPOINTS.DAMAGE_MODS, ctx);
  const diceTotal = adjusted.reduce((a, b) => a + b, 0);
  const total = diceTotal + Object.values(ctx.modifiers).reduce((a, b) => a + b, 0);
  const result = {
    formula,
    tearing: ctx.tearing,
    dice: { rolled, kept, adjusted, discarded },
    modifiers: ctx.modifiers,
    righteousFury,
    proven: ctx.proven,
    primitive: ctx.primitive,
    // the (possibly overridden) damage type — a DAMAGE_POOL rule may change it
    // (Sanctified → "Holy"); defaults to the weapon's type.
    damageType: ctx.damageType ?? damageType,
    total
  };
  if (hasQuality(ctx.qualities, "Spray") && rolled.includes(9)) result.sprayJam = true;
  return result;
}
function applySoak({ damage, penetration = 0, armour = 0, toughnessBonus = 0, unnaturalToughness = 0, felling = 0 }) {
  const usableArmour = Math.max(0, armour - penetration);
  const effUnnatural = Math.max(0, unnaturalToughness - felling);
  const reduction = usableArmour + toughnessBonus + effUnnatural;
  return {
    armour,
    penetration,
    usableArmour,
    toughnessBonus,
    unnaturalToughness,
    felling,
    effectiveUnnatural: effUnnatural,
    reduction,
    woundsInflicted: Math.max(0, damage - reduction)
  };
}
function strengthBonusMultiple(weapon = {}, isMelee = false) {
  return isMelee || weapon.thrown === true ? weapon.sbMultiplier || 1 : 0;
}
function runToHit(input, rng, registry) {
  const { characteristics = {}, weapon = {}, target } = input;
  const action = canonicalAction(input.action) ?? input.action ?? "Standard Attack";
  const actionInfo = COMBAT_ACTIONS[action] ?? COMBAT_ACTIONS["Standard Attack"];
  const isMelee = !!weapon.isMelee;
  const qualities = canonList(weapon.qualities);
  const baseTarget = isMelee ? characteristics.ws ?? 0 : characteristics.bs ?? 0;
  const rangeBand = isMelee ? "Melee" : input.rangeBand ?? "Normal Range";
  const aimValue = AIM_MODES[input.aim ?? "None"] ?? 0;
  const unnatural = input.unnatural ?? {};
  const unnaturalToHit = isMelee ? Number(unnatural.ws) || 0 : Number(unnatural.bs) || 0;
  const unnaturalStrength = Number(unnatural.s) || 0;
  const ctx = new RollContext({
    input,
    characteristics,
    weapon,
    target,
    action,
    actionInfo,
    isMelee,
    qualities,
    rangeBand,
    aimValue,
    rng,
    talents: canonList(input.talents),
    traits: canonList(input.traits),
    statuses: input.conditions ?? input.statuses ?? [],
    circumstances: input.circumstances ?? [],
    firingModes: input.firingModes ?? [],
    configs: input.configs ?? input.firingModes ?? [],
    craftsmanship: weapon.craftsmanship ?? "Common",
    psyRating: Number(input.psyRating) || 0,
    // Force weapons (p.145)
    combat: {
      dualWielding: !!(input.combat?.dualWielding ?? input.dualWielding),
      firingOffhand: !!(input.combat?.firingOffhand ?? input.firingOffhand),
      firingBoth: !!(input.combat?.firingBoth ?? input.firingBoth)
    },
    modifiers: {},
    effects: []
    // effects exists from MODIFIERS on (emit is legal there)
  });
  runCheckpoint(registry, CHECKPOINTS.MODIFIERS, ctx);
  const isSpray = hasQuality(qualities, "Spray");
  let test;
  if (isSpray) {
    test = {
      roll: 0,
      target: baseTarget,
      modifiers: {},
      modifierTotal: 0,
      modifiedTarget: baseTarget,
      success: true,
      dos: 1,
      dof: 0,
      unnatural: 0,
      bonusDos: 0,
      autoFailure: false,
      autoSuccess: false,
      autoHit: true
    };
  } else {
    test = rollTest({ target: baseTarget, modifiers: ctx.modifiers, label: "to-hit", unnatural: unnaturalToHit }, rng);
  }
  test.characteristic = isMelee ? "WS" : "BS";
  ctx.test = test;
  ctx.success = test.success;
  if (isSpray) {
    ctx.effects.push({ name: "Spray", effect: "no attack roll \u2014 everyone in the 30\xB0 cone is struck unless they pass a Challenging (+0) Agility test; always hits the Body; cannot make Called Shots" });
  }
  runCheckpoint(registry, CHECKPOINTS.POST_ROLL, ctx);
  const base = {
    weapon: weapon.name ?? "Unnamed weapon",
    action,
    rangeBand,
    test: { ...test, success: ctx.success },
    effects: ctx.effects,
    log: ctx.log,
    preventsParry: !!ctx.preventParry
    // Flexible: the defender cannot Parry this attack
  };
  if (!ctx.success) {
    ctx.scatterModifiers = {};
    runCheckpoint(registry, CHECKPOINTS.ON_MISS, ctx);
    let scatter;
    if (ctx.scatter?.active) {
      const modTotal = Object.values(ctx.scatterModifiers).reduce((a, b) => a + b, 0);
      const declared = (ctx.tableRolls ?? [])[0];
      const dirTable = declared && registry.table(declared.table);
      let direction, directionText = null;
      if (dirTable) {
        const res = resolveTable(dirTable, rng, declared.modifier);
        direction = res.roll;
        directionText = res.text;
      } else direction = d(10, rng, "scatter direction");
      scatter = {
        direction,
        baseDistance: ctx.scatter.base,
        modifiers: ctx.scatterModifiers,
        distance: Math.max(0, ctx.scatter.base + modTotal)
      };
      if (directionText) scatter.directionText = directionText;
      if (ctx.detonate) {
        const sb2 = Math.floor((characteristics.s ?? 0) / 10) + unnaturalStrength;
        const sbTimes2 = strengthBonusMultiple(weapon, isMelee);
        ctx.pen = Number(weapon.pen) || 0;
        ctx.penModifiers = {};
        ctx.firstLocation = "Body";
        runCheckpoint(registry, CHECKPOINTS.PENETRATION, ctx);
        const totalPen2 = ctx.pen + Object.values(ctx.penModifiers).reduce((a, b) => a + b, 0);
        const damage = rollHitDamage(weapon, action, { sb: sb2, sbTimes: sbTimes2 }, "Body", test.dos ?? 0, input, rng, registry);
        scatter.hit = {
          location: "Body",
          damageType: damage.damageType ?? weapon.damageType ?? "Impact",
          damage,
          penetration: ctx.pen,
          penetrationModifiers: ctx.penModifiers,
          totalPenetration: totalPen2
        };
      }
      if (ctx.smokeScreens?.length) scatter.smoke = ctx.smokeScreens;
    }
    return { ctx, base, success: false, scatter, hitMeta: null };
  }
  const accrual = actionInfo.hitAccrual ?? actionInfo.rate;
  const fireRate = actionInfo.cap === "wsb" ? Math.max(1, Math.floor((characteristics.ws ?? 0) / 10) + (Number(unnatural.ws) || 0)) : actionInfo.rate === "semi" ? Math.max(1, weapon.rof?.burst ?? 1) : actionInfo.rate === "full" ? Math.max(1, weapon.rof?.full ?? 1) : 1;
  if (accrual === "semi") ctx.additionalHits = Math.floor((test.dos - 1) / 2);
  else if (accrual === "full") ctx.additionalHits = test.dos - 1;
  else ctx.additionalHits = 0;
  ctx.fireRate = fireRate;
  runCheckpoint(registry, CHECKPOINTS.HIT_COUNT_MULT, ctx);
  if (actionInfo.rate !== "single" && ctx.additionalHits > fireRate - 1) ctx.additionalHits = fireRate - 1;
  if (ctx.additionalHits < 0) ctx.additionalHits = 0;
  runCheckpoint(registry, CHECKPOINTS.HIT_COUNT_BONUS, ctx);
  const additionalHits = ctx.additionalHits;
  const sb = Math.floor((characteristics.s ?? 0) / 10) + unnaturalStrength;
  const sbTimes = strengthBonusMultiple(weapon, isMelee);
  const firstLocation = isSpray ? "Body" : action === "Called Shot" && input.calledShotLocation ? input.calledShotLocation : getHitLocationForRoll(test.roll);
  const pen = Number(weapon.pen) || 0;
  ctx.pen = pen;
  ctx.penModifiers = {};
  ctx.firstLocation = firstLocation;
  runCheckpoint(registry, CHECKPOINTS.PENETRATION, ctx);
  const penModifiers = ctx.penModifiers;
  const totalPen = pen + Object.values(penModifiers).reduce((a, b) => a + b, 0);
  const locations = [];
  for (let i = 0; i <= additionalHits; i++) {
    locations.push(!isSpray && action === "Called Shot" && input.calledShotLocation ? input.calledShotLocation : ADDITIONAL_HIT_LOCATIONS[firstLocation][Math.min(i, 5)]);
  }
  const fellingReduction = ctx.unnaturalToughnessReduction || 0;
  return { ctx, base, success: true, scatter: void 0, hitMeta: { locations, sb, sbTimes, pen, penModifiers, totalPen, fellingReduction } };
}
function rollHitDamage(weapon, action, hitMeta, location, dos, src, rng, registry, targetArmour = 0) {
  return rollDamage({
    formula: weapon.damage,
    qualities: weapon.qualities ?? [],
    sbTimes: hitMeta.sbTimes,
    strengthBonus: hitMeta.sb,
    dos,
    action,
    location,
    damageType: weapon.damageType ?? "Impact",
    talents: src.talents ?? [],
    traits: src.traits ?? [],
    statuses: src.conditions ?? src.statuses ?? [],
    circumstances: src.circumstances ?? [],
    firingModes: src.firingModes ?? [],
    configs: src.configs ?? src.firingModes ?? [],
    isMelee: !!weapon.isMelee,
    aimValue: AIM_MODES[src.aim ?? "None"] ?? 0,
    rangeBand: weapon.isMelee ? "Melee" : src.rangeBand ?? "Normal Range",
    craftsmanship: weapon.craftsmanship ?? "Common",
    targetArmour,
    target: src.target ?? null,
    // target.* scoped facts at the damage checkpoints
    psyRating: Number(src.psyRating) || 0,
    // Force (p.145)
    characteristics: src.characteristics ?? {}
    // ws_bonus/bs_bonus (Mighty Shot, Crushing Blow)
  }, rng, registry);
}
function applyOnHit(hit, attacker, target, dmg, registry, rng, autoRoll, reduced = /* @__PURE__ */ new Map(), effArmour = null) {
  const ctx = new RollContext({
    qualities: canonList(attacker.weapon?.qualities),
    target,
    location: hit.location,
    rng,
    targetArmour: effArmour ?? (Number(target?.armour) || 0),
    characteristics: attacker.characteristics ?? {},
    // bs_bonus etc. for ON_HIT expressions (Indirect's 1d10 − bs_bonus)
    isMelee: !!attacker.weapon?.isMelee,
    action: attacker.action ?? "Standard Attack",
    talents: canonList(attacker.talents),
    traits: canonList(attacker.traits),
    statuses: attacker.conditions ?? attacker.statuses ?? [],
    circumstances: attacker.circumstances ?? [],
    damageDealt: dmg.error ? 0 : dmg.total,
    woundsInflicted: hit.soak?.woundsInflicted ?? null,
    targetEffects: { tests: [], statuses: [], armour: [] }
  });
  runCheckpoint(registry, CHECKPOINTS.ON_HIT, ctx);
  const te = ctx.targetEffects;
  if (te.armour.length && target) resolveCorrosion(te.armour, hit, target, reduced);
  const tableRolls = [];
  for (const tr of ctx.tableRolls ?? []) {
    const tbl = registry.table(tr.table);
    if (!tbl) {
      tableRolls.push({ table: tr.table, error: "unknown roll_table", source: tr.source });
      continue;
    }
    const res = resolveTable(tbl, rng, tr.modifier);
    res.source = tr.source;
    if (tr.area != null) res.area = tr.area;
    tableRolls.push(res);
    for (const st of res.statuses) te.statuses.push({ source: res.table, status: st, value: null, reason: `rolled ${res.roll} on ${res.table}` });
  }
  if (target) resolveTargetTests(te.tests, target, rng, autoRoll, registry);
  for (const t of te.tests) {
    for (const st of t.resolved?.tableRoll?.statuses ?? [])
      te.statuses.push({ source: t.resolved.tableRoll.table, status: st, value: null, reason: `failed ${t.characteristic} test \u2192 rolled ${t.resolved.tableRoll.roll}` });
    if (t.resolved?.appliedCondition) {
      const ac = t.resolved.appliedCondition;
      te.statuses.push({ source: t.source, status: ac.name, value: ac.value ?? null, duration: ac.duration ?? null, location: ac.location ?? null, reason: `failed ${t.characteristic} test` });
    }
  }
  if (te.tests.some((t) => t.avoidsHit && t.resolved?.success)) {
    hit.avoided = true;
    hit.avoidedBy = te.tests.find((t) => t.avoidsHit && t.resolved?.success)?.characteristic;
  }
  if (ctx.smokeScreens?.length) hit.smoke = ctx.smokeScreens;
  if (ctx.hitScatterDistance != null) {
    const dirTable = registry.table("Scatter Diagram");
    const dir = dirTable ? resolveTable(dirTable, rng) : { roll: d(10, rng, "scatter direction") };
    hit.scatter = { direction: dir.roll, distance: ctx.hitScatterDistance };
    if (dir.text) hit.scatter.directionText = dir.text;
  }
  if (te.tests.length || te.statuses.length || te.armour.length || tableRolls.length) {
    if (tableRolls.length) te.tableRolls = tableRolls;
    hit.targetEffects = te;
  }
}
function resolveCorrosion(declarations, hit, target, reduced) {
  const baseArmour = Number(target.armour) || 0;
  for (const dec of declarations) {
    const already = reduced.get(hit.location) || 0;
    const apBefore = Math.max(0, baseArmour - already);
    dec.rolled = dec.amount;
    dec.apBefore = apBefore;
    dec.apAfter = Math.max(0, apBefore - dec.amount);
    dec.excessToWounds = Math.max(0, dec.amount - apBefore);
    reduced.set(hit.location, already + dec.amount);
    hit.corrosiveWounds = (hit.corrosiveWounds || 0) + dec.excessToWounds;
  }
}
function resolveAttack(input, rng = Math.random, registry = defaultRegistry) {
  const { weapon = {}, target, characteristics = {} } = input;
  const autoResolveTests = !!input.autoResolveTests;
  const action = canonicalAction(input.action) ?? input.action ?? "Standard Attack";
  const { ctx, base, success, scatter, hitMeta } = runToHit(input, rng, registry);
  const result = { ...base, hits: [] };
  if (!success) {
    if (scatter) result.scatter = scatter;
    return result;
  }
  const reduced = /* @__PURE__ */ new Map();
  for (let i = 0; i < hitMeta.locations.length; i++) {
    const location = hitMeta.locations[i];
    const dmg = rollHitDamage(weapon, action, hitMeta, location, ctx.test.dos, input, rng, registry, Number(target?.armour) || 0);
    const hit = {
      hitNumber: i + 1,
      location,
      damageType: dmg.damageType ?? weapon.damageType ?? "Impact",
      damage: dmg,
      penetration: hitMeta.pen,
      penetrationModifiers: hitMeta.penModifiers,
      totalPenetration: hitMeta.totalPen
    };
    const effArmour = Math.max(0, (Number(target?.armour) || 0) - (reduced.get(location) || 0));
    if (target && !dmg.error) {
      hit.soak = applySoak({
        damage: dmg.total,
        penetration: hitMeta.totalPen,
        armour: effArmour,
        toughnessBonus: target.toughnessBonus ?? Math.floor((characteristics.t ?? 0) / 10),
        unnaturalToughness: Number(target.unnaturalToughness) || 0,
        felling: hitMeta.fellingReduction || 0
      });
    }
    applyOnHit(hit, input, target, dmg, registry, rng, autoResolveTests, reduced, effArmour);
    if (dmg.sprayJam && !result.effects.some((e) => e.name === "Jam")) {
      result.effects.push({ name: "Jam", effect: "Spray: a natural 9 was rolled on a damage die \u2014 the weapon jams after this attack (p.149)" });
    }
    result.hits.push(hit);
  }
  result.totalWounds = target ? result.hits.reduce((a, h) => a + (h.avoided ? 0 : (h.soak?.woundsInflicted ?? 0) + (h.corrosiveWounds ?? 0)), 0) : void 0;
  return result;
}
var CHARACTERISTIC_KEY = { toughness: "toughness", agility: "agility", strength: "strength", willpower: "willpower" };
function resolveTable(table, rng, modifier = 0) {
  let natural = 0;
  for (let k = 0; k < table.die.count; k++) natural += d(table.die.sides, rng, table.name);
  const roll = natural + modifier;
  const max = table.die.count * table.die.sides;
  const lookup = Math.min(max, Math.max(table.die.count, roll));
  const row = table.rows.find((r) => lookup >= r.lo && lookup <= r.hi);
  return { table: table.name, roll, modifier, text: row?.text ?? "(no matching row)", statuses: row?.statuses ?? [] };
}
function resolveTargetTests(tests, target, rng, autoRoll = true, registry = null) {
  for (const t of tests) {
    const key = CHARACTERISTIC_KEY[String(t.characteristic).toLowerCase()];
    const charVal = key ? target?.[key] : void 0;
    if (charVal == null) {
      t.note = `no defender ${t.characteristic} supplied`;
      continue;
    }
    t.characteristicValue = charVal;
    t.threshold = charVal + t.modifier;
    if (autoRoll) {
      const tt = rollTest({ target: charVal, modifiers: { test: t.modifier }, label: `${t.characteristic} test` }, rng);
      t.resolved = {
        roll: tt.roll,
        modifiedTarget: tt.modifiedTarget,
        success: tt.success,
        dof: tt.dof,
        outcome: tt.success ? "resisted" : t.onFail
      };
      if (!tt.success && t.onFailRollTable) {
        const tbl = registry?.table(t.onFailRollTable);
        t.resolved.tableRoll = tbl ? resolveTable(tbl, rng) : { table: t.onFailRollTable, error: "unknown roll_table" };
      }
      if (!tt.success && t.onFailApply) t.resolved.appliedCondition = t.onFailApply;
      if (!tt.success && typeof t.onFailDamage === "function") t.resolved.damage = t.onFailDamage();
    } else if (t.onFailApply) {
      t.appliedConditionOnFail = t.onFailApply;
    }
    if (typeof t.onFailDamage === "function") t.onFailDamage = "rolled on failure";
  }
}
function resolveParry(input, rng = Math.random, registry = defaultRegistry) {
  const { characteristics = {}, weapon = {} } = input;
  const qualities = canonList(weapon.qualities);
  const opposing = input.against ?? null;
  const ctx = new RollContext({
    input,
    characteristics,
    weapon,
    qualities,
    opposingProvided: !!opposing,
    opposingQualities: canonList(opposing?.qualities),
    action: "Parry",
    isMelee: true,
    rangeBand: "Melee",
    aimValue: 0,
    rng,
    craftsmanship: weapon.craftsmanship ?? "Common",
    talents: canonList(input.talents),
    traits: canonList(input.traits),
    statuses: input.conditions ?? input.statuses ?? [],
    circumstances: input.circumstances ?? [],
    combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
    effects: [],
    modifiers: {}
  });
  if (input.customModifier) ctx.modifiers.modifier = Number(input.customModifier) || 0;
  runCheckpoint(registry, CHECKPOINTS.PARRY, ctx);
  if (ctx.cannotParry) {
    return {
      weapon: weapon.name ?? "Unnamed weapon",
      action: "Parry",
      prevented: true,
      note: "Parry impossible \u2014 the weapon is Unwieldy (cannot be used to Parry)",
      test: { success: false, characteristic: "WS", cannotParry: true },
      effects: ctx.effects,
      log: ctx.log
    };
  }
  const test = rollTest({ target: characteristics.ws ?? 0, modifiers: ctx.modifiers, label: "parry (WS)", unnatural: Number(input.unnatural?.ws) || 0 }, rng);
  test.characteristic = "WS";
  ctx.test = test;
  ctx.success = test.success;
  ctx.tableRolls = [];
  runCheckpoint(registry, CHECKPOINTS.POST_PARRY, ctx);
  const tableRolls = [];
  for (const tr of ctx.tableRolls) {
    const tbl = registry.table(tr.table);
    if (!tbl) {
      tableRolls.push({ table: tr.table, error: "unknown roll_table", source: tr.source });
      continue;
    }
    const res = resolveTable(tbl, rng, tr.modifier);
    res.source = tr.source;
    tableRolls.push(res);
  }
  const out = {
    weapon: weapon.name ?? "Unnamed weapon",
    action: "Parry",
    test,
    effects: ctx.effects,
    log: ctx.log
  };
  if (tableRolls.length) out.tableRolls = tableRolls;
  return out;
}
function resolveDodge(defender, rng, registry) {
  const c = defender.characteristics ?? {};
  const ctx = new RollContext({
    input: defender,
    characteristics: c,
    weapon: {},
    qualities: [],
    action: "Dodge",
    isMelee: false,
    rangeBand: "Melee",
    aimValue: 0,
    rng,
    craftsmanship: "Common",
    talents: canonList(defender.talents),
    traits: canonList(defender.traits),
    statuses: defender.conditions ?? defender.statuses ?? [],
    circumstances: defender.circumstances ?? [],
    combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
    modifiers: {}
  });
  if (defender.evasion?.modifier) ctx.modifiers.modifier = Number(defender.evasion.modifier) || 0;
  runCheckpoint(registry, CHECKPOINTS.EVASION, ctx);
  const test = rollTest({ target: c.agility ?? c.ag ?? 0, modifiers: ctx.modifiers, label: "dodge (Ag)", unnatural: Number(defender.unnatural?.ag) || 0 }, rng);
  test.characteristic = "Ag";
  return { mode: "dodge", test, log: ctx.log };
}
var defenderTarget = (d2) => ({
  armour: Number(d2.armour) || 0,
  toughnessBonus: d2.toughnessBonus ?? Math.floor((d2.characteristics?.t ?? 0) / 10),
  unnaturalToughness: Number(d2.unnaturalToughness) || 0,
  toughness: d2.characteristics?.t ?? 0,
  strength: d2.characteristics?.s ?? 0,
  agility: d2.characteristics?.ag ?? d2.characteristics?.agility ?? 0,
  willpower: d2.characteristics?.wp ?? d2.characteristics?.willpower ?? 0,
  traits: canonList(d2.traits)
  // so target_has_trait() works (Sanctified vs Daemonic)
});
function engageAttackRoll(attacker, registry = defaultRegistry, rng = Math.random, defender = null) {
  const input = defender ? { ...attacker, target: defenderTarget(defender) } : attacker;
  const { base, success, scatter, hitMeta } = runToHit(input, rng, registry);
  const out = { ...base, success, hits: [] };
  if (scatter) out.scatter = scatter;
  if (success) {
    out.hits = hitMeta.locations.map((location, i) => ({ hitNumber: i + 1, location }));
    out.meta = { dos: out.test.dos, sb: hitMeta.sb, sbTimes: hitMeta.sbTimes, pen: hitMeta.pen, penModifiers: hitMeta.penModifiers, totalPen: hitMeta.totalPen, fellingReduction: hitMeta.fellingReduction };
  }
  return out;
}
function engageDamage(attacker, attackState, registry = defaultRegistry, rng = Math.random, defender = null) {
  const weapon = attacker.weapon ?? {};
  const action = attacker.action ?? "Standard Attack";
  const meta = attackState.meta ?? {};
  const targetArmour = Number(defender?.armour) || 0;
  const src = defender ? { ...attacker, target: defenderTarget(defender) } : attacker;
  const hits = (attackState.hits ?? []).map((h) => {
    const dmg = rollHitDamage(weapon, action, meta, h.location, meta.dos, src, rng, registry, targetArmour);
    return { hitNumber: h.hitNumber, location: h.location, damageType: dmg.damageType ?? weapon.damageType ?? "Impact", damage: dmg, penetration: meta.pen, penetrationModifiers: meta.penModifiers, totalPenetration: meta.totalPen, fellingReduction: meta.fellingReduction || 0 };
  });
  return { hits };
}
function engageEvasion(defender, attackDos, registry = defaultRegistry, rng = Math.random, attackPreventsParry = false, attackerWeapon = null) {
  const mode = defender.evasion?.mode;
  if (mode !== "dodge" && mode !== "parry") return { reaction: null, evaded: 0 };
  if (mode === "parry" && attackPreventsParry) {
    return { reaction: { mode: "parry", prevented: true, note: "Parry prevented \u2014 the attacking weapon is Flexible (cannot be Parried)" }, evaded: 0 };
  }
  const reaction = mode === "parry" ? { mode: "parry", ...resolveParry({ characteristics: { ws: defender.characteristics?.ws ?? 0 }, weapon: defender.weapon ?? {}, against: attackerWeapon, customModifier: defender.evasion?.modifier, unnatural: defender.unnatural, talents: defender.talents, traits: defender.traits, statuses: defender.conditions ?? defender.statuses, circumstances: defender.circumstances }, rng, registry) } : resolveDodge(defender, rng, registry);
  if (reaction.prevented) return { reaction, evaded: 0 };
  const evaded = reaction.test.success ? mode === "parry" ? 1 : 1 + Math.floor(reaction.test.dos / 2) : 0;
  return { reaction, evaded };
}
function engageOnHit(attacker, defender, damageHits, evaded, options = {}, registry = defaultRegistry, rng = Math.random) {
  const target = defenderTarget(defender);
  const field = defender.field;
  let fieldDown = false;
  const reduced = /* @__PURE__ */ new Map();
  for (const [loc, n] of Object.entries(options.armourDamage ?? {})) reduced.set(loc, Number(n) || 0);
  const hits = damageHits.map((h, i) => {
    const hit = { ...h };
    if (i < evaded) {
      hit.evaded = true;
      return hit;
    }
    if (field && field.rating > 0 && !fieldDown) {
      const roll = d(100, rng, `force field (hit ${i + 1})`);
      const absorbed = roll <= field.rating;
      const overloaded = field.overloadMax > 0 && roll <= field.overloadMax;
      hit.field = { roll, rating: field.rating, absorbed, overloaded };
      if (overloaded) fieldDown = true;
      if (absorbed) {
        hit.fieldAbsorbed = true;
        return hit;
      }
    }
    const effArmour = Math.max(0, (Number(target.armour) || 0) - (reduced.get(hit.location) || 0));
    if (!hit.damage.error) {
      hit.soak = applySoak({ damage: hit.damage.total, penetration: hit.totalPenetration, armour: effArmour, toughnessBonus: target.toughnessBonus, unnaturalToughness: target.unnaturalToughness, felling: hit.fellingReduction || 0 });
    }
    applyOnHit(hit, attacker, target, hit.damage, registry, rng, options.autoResolveTests, reduced, effArmour);
    return hit;
  });
  const totalWounds = hits.reduce((a, h) => a + (h.evaded || h.fieldAbsorbed || h.avoided ? 0 : (h.soak?.woundsInflicted ?? 0) + (h.corrosiveWounds ?? 0)), 0);
  return { hits, totalWounds, fieldDown };
}
function resolveEngagement(input, rng = Math.random, registry = defaultRegistry) {
  const { attacker = {}, defender = {}, options = {} } = input;
  const attack = engageAttackRoll(attacker, registry, rng, defender);
  const result = { attack, reaction: null, defender: { evaded: 0, fieldDown: false } };
  if (!attack.success || !attack.hits.length) return result;
  attack.hits = engageDamage(attacker, attack, registry, rng, defender).hits;
  const ev = engageEvasion(defender, attack.test.dos, registry, rng, attack.preventsParry, attacker.weapon ?? null);
  result.reaction = ev.reaction;
  const evaded = Math.min(ev.evaded, attack.hits.length);
  result.defender.evaded = evaded;
  const onhit = engageOnHit(attacker, defender, attack.hits, evaded, options, registry, rng);
  attack.hits = onhit.hits;
  attack.totalWounds = onhit.totalWounds;
  result.defender.fieldDown = onhit.fieldDown;
  return result;
}

// api/lib/dsl/docs.mjs
var DSL_DOCS = {
  structure: {
    template: `dsl 3                             // version pragma (dsl 1/2 text is rejected \u2014 tools/migrate-dsl.mjs upgrades it)
package "dh2.core.example" {      // optional, one per file \u2014 provenance for every rule in it
  system "dh2"                    // rule system id
  source "Dark Heresy 2e Core Rulebook"
}

<kind> "<name>" [tier N] {
  meta { page <N> [ref "\u2026"] }     // optional \u2014 rule provenance (book page / cross-ref)
  on <PIPELINE.>CHECKPOINT        // required \u2014 where the rule fires (bare = attack pipeline)
  priority <N>                    // optional \u2014 order within a checkpoint (default 0)
  replaces "<pkg>/<rule-id>"      // optional \u2014 layered override: drop the named rule
  [when <predicate>] then <action> [; <action> ...]   // one or more branches
  [when <predicate>] then <action> [; <action> ...]
}`,
    kinds: [
      { name: "quality", note: 'A weapon quality. Usually gated on has_quality("\u2026").' },
      { name: "talent", note: 'A character talent (bought with XP). Usually gated on has_talent("\u2026").' },
      { name: "trait", note: 'A DH2.0 trait \u2014 innate ability, like a talent but not purchasable with XP. Usually gated on has_trait("\u2026").' },
      { name: "circumstance", note: 'An environmental/situational modifier (Darkness, Haywire Field). Gated on has_circumstance("\u2026").' },
      { name: "condition", note: 'An active state on the character (On Fire, Stunned, Aiming). Gated on has_condition("\u2026").' },
      { name: "configuration", note: 'A per-character toggle for a shot/turn (Maximal, grip). Gated on configuration("\u2026").' },
      { name: "mechanic", note: "A base weapon/system mechanic (Jam, craftsmanship tiers)." },
      { name: "miscellaneous", note: "A generic/custom rule with no particular source semantics." }
    ],
    notes: [
      "The kind is a label/grouping; it does not change execution. Gate a rule with the matching function: talent\u2192has_talent, trait\u2192has_trait, condition\u2192has_condition, quality\u2192has_quality. (The v1 kind aliases status/generic/rule were removed in dsl 3.)",
      'Name matching is spelling-blind: case, spaces, underscores, and hyphens are ignored on both sides, so has_quality("razor_sharp"), has_quality("RazorSharp"), and has_quality("Razor Sharp") all match a weapon carrying any of those spellings (prefix semantics unchanged \u2014 "Proven" still matches "Proven (3)"). The same applies to action names ("swift_attack" \u2261 "Swift Attack").',
      "Character inputs to an attack: talents[], traits[], statuses[] (and the weapon's qualities[]).",
      "priority: lower runs first within a checkpoint. Convention \u2014 injectors 0\u201349, additive bonuses 50\u201399, cancellers/clamps 100+.",
      "tier N is optional metadata (e.g. talent tier); it does not affect execution.",
      "Comments run from // or # to end of line.",
      'Provenance (Stage 0): a file may open with a `dsl 2` pragma and one `package "name" { system "\u2026" source "\u2026" }` block; rules may carry `meta { page N }`. Compiled effects then expose page/package/system/sourceBook and a stable qualifiedId ("pkg/rule-id").',
      "Pipelines (Phase 3): `on` takes `pipeline.CHECKPOINT`. A bare checkpoint is the default `attack` pipeline; the generic-test pipeline is `test.MODIFIERS` / `test.POST_ROLL` (behind /api/test \u2014 gate on test_name).",
      "Layered overrides (Phase 3): `replaces \"<package>/<rule-id>\"` drops the named rule's effects entirely when this rule's layer (custom rules) is active \u2014 the static, id-based successor to the runtime `suppress` (which remains for same-layer overrides like Overheats\u2192Jam).",
      'Levelled entries (Stage 1): qualities/talents/traits are canonically { name, level } objects internally; strings like "Proven (3)" or "Vengeful 9" are accepted at the API boundary and parsed once. Both forms work everywhere (has_quality, quality_level, bump_quality, \u2026).',
      'A rule may have several "when \u2026 then \u2026" branches; each is evaluated independently (compiles to its own effect, in order). A branch with no "when" is unconditional. Use this for stepped effects \u2014 e.g. Accurate adds one die at DoS\u22653 and a second only at DoS\u22655.',
      'Within a branch, several actions may be separated by ";". Multiple rules may share a file/snippet.'
    ]
  },
  // Ordered by the sequence in which they fire during an attack.
  checkpoints: [
    { name: "MODIFIERS", group: "To-hit test", summary: "Accumulate to-hit modifiers before the d100 is rolled. Modifiers are summed and capped at \xB160.", use: "Attack bonuses/penalties (talents, off-hand, custom buffs)." },
    { name: "POST_ROLL", group: "To-hit test", summary: "Immediately after the d100, once roll / success / DoS / DoF are known, before hits are counted.", use: "Jams, overheats; emit narrative effects or fail (cancel) the attack." },
    { name: "ON_MISS", group: "To-hit test", summary: "After a missed attack. A rule sets a base scatter distance (set scatter = \u2026) and may alter it (set scatter += \u2026); the engine rolls the 1d10 direction.", use: "Blast (X) scatter on a miss (p.230)." },
    { name: "HIT_COUNT_MULT", group: "Hit count", summary: "Multiply the number of extra hits \u2014 runs BEFORE the weapon Rate-of-Fire cap.", use: "Storm (doubles extra hits)." },
    { name: "HIT_COUNT_BONUS", group: "Hit count", summary: "Add flat extra hits \u2014 runs AFTER the Rate-of-Fire cap.", use: "Twin-Linked (+1 hit at DoS \u2265 2)." },
    { name: "PENETRATION", group: "Per hit", summary: "Adjust the hit's armour penetration, before damage is rolled.", use: "Razor Sharp / Melta (double penetration)." },
    { name: "DAMAGE_POOL", group: "Per hit", summary: "Shape the damage dice pool before it is rolled (extra dice, keep-highest).", use: "Tearing (extra die, keep highest)." },
    { name: "DIE_ADJUST", group: "Per hit", summary: "After dice are rolled: per-die transforms and the Righteous Fury threshold.", use: "Proven (floor_die), Primitive (cap_die), Vengeful (rf_threshold)." },
    { name: "DAMAGE_MODS", group: "Per hit", summary: "Add flat or bonus-dice modifiers to the damage total.", use: "Accurate (+1d10 by DoS), flat blessings." },
    { name: "ON_HIT", group: "Per hit", summary: "After a hit's damage and soak. Declare target tests (require_test) or statuses (apply_status); auto-resolved when the toggle is on and target stats are supplied.", use: "Concussive (Toughness test \u2192 Stunned/Prone), Crippling (Crippled)." },
    { name: "PARRY", group: "Defensive reaction", summary: "Modifiers for a Parry (a WS test made to negate an incoming melee attack). Runs in the Parry flow and in Engagement (parry evasion).", use: "Balanced (+10), Defensive (+15), Unbalanced (\u221210), Unwieldy (cannot_parry)." },
    { name: "POST_PARRY", group: "Defensive reaction", summary: "After the Parry test, once its success is known. The opposing (attacking) weapon's qualities are readable via opposing_has_quality().", use: "Power Field (roll to destroy the attacker's weapon on a successful parry)." },
    { name: "EVASION", group: "Defensive reaction", summary: "Modifiers for a Dodge (Agility) evasion test in an Engagement (POST /api/resolve).", use: "Dodge bonuses from defender talents/conditions." },
    { name: "test.MODIFIERS", group: "Generic test pipeline", summary: "Accumulate modifiers before a GENERIC characteristic/skill test (the test.* pipeline behind /api/test). Gate on test_name, talents, conditions, circumstances.", use: "Test-affecting talents (e.g. Resistance), condition penalties on any test." },
    { name: "test.POST_ROLL", group: "Generic test pipeline", summary: "After a generic test resolves (roll/success/DoS known). May emit narrative effects or fail the result.", use: "Narrative riders on generic tests." },
    { name: "upkeep.TURN_START", group: "Upkeep pipeline", summary: "Start of an actor's turn, run against the EncounterState (Phase 4). Rules read the actor's active conditions and declare damage/tests; the engine owns duration/decay/cooldown mechanics.", use: "On Fire (declare damage 1d10 per round)." },
    { name: "upkeep.TURN_END", group: "Upkeep pipeline", summary: "End of an actor's turn. The Recharge cooldown clears here (mechanism).", use: "Toxified (Toughness test \u2192 1d10 damage on failure)." },
    { name: "upkeep.ROUND_END", group: "Upkeep pipeline", summary: "End of the round. Durations tick down and expire; severities with `decay` reduce (Haywire Field) \u2014 engine mechanism.", use: "Round-scale condition riders." }
  ],
  // Read-only variables usable in `when` predicates and action expressions.
  // DERIVED from vocabulary.mjs (Stage 2 — single source): the unscoped facts
  // plus legacy scoped aliases. Each entry lists the scopes it is available in.
  facts: FACT_DOCS,
  // Scoped-only bases (no unscoped form): reach them via <scope>.<name>.
  scopes: {
    names: SCOPE_NAMES,
    summary: 'A fact/function may be read through a scope path \u2014 target.tb, weapon.pen, opposing_weapon.has_quality("Force"). The unscoped name is the attacker scope. Legacy prefixed names (target_sb, opposing_has_quality, \u2026) remain as aliases.',
    scopedOnly: SCOPED_ONLY_DOCS
  },
  // DERIVED from vocabulary.mjs (Stage 2 — single source), incl. legacy aliases.
  functions: FUNCTION_DOCS,
  // Registered mutation targets (Stage 3): `set <slot> (=|+=) <expr>` and
  // `flag <name>` — the primitives every set-verb/flag-verb is sugar for.
  // DERIVED from vocabulary.mjs.
  slots: SLOT_DOCS,
  flags: FLAG_DOCS,
  actions: [
    { syntax: "set <slot> (= | +=) <expr>", at: "per slot", summary: "THE generic mutation (Stage 3): write a registered slot \u2014 see the slots table. The specific set-verbs below (set pen, add_die, reduce_unnatural_toughness, \u2026) are sugar for this." },
    { syntax: "flag <name>", at: "per flag", summary: "THE generic boolean state (Stage 3): raise a registered flag \u2014 see the flags table. prevent_parry/cannot_parry/detonate/fail/keep_highest are sugar for this." },
    { syntax: "declare test|status|table_roll|armour_damage|damage|event \u2026", at: "ON_HIT, POST_ROLL, upkeep.*, \u2026", summary: 'THE generic declaration namespace (Stage 3): alternative surface syntax for require_test / apply_status / roll_on / corrode / emit \u2014 plus `declare damage <expr> [, "reason"]` (Phase 4): direct damage against the actor, used by upkeep ticks (On Fire\'s 1d10/round).' },
    { syntax: "require_test \u2026 => damage <expr>", at: "ON_HIT, upkeep.*", summary: "On-fail damage follow-up (Phase 4): the expression (e.g. 1d10) rolls ONLY when the test fails \u2014 Toxified's end-of-turn Toughness test." },
    { syntax: 'require_test "Char" <expr> "text" avoids_hit', at: "ON_HIT", summary: "INVERTED stakes (Phase 5): a PASSED test negates the hit entirely (wounds voided) \u2014 Spray's Challenging (+0) Agility test." },
    { syntax: "declare smoke <radius> [duration <expr>]", at: "ON_HIT, ON_MISS", summary: "A smokescreen at the impact/scatter point (Smoke (X), p.149): radius in metres, duration in rounds (1d10+10). On a miss it lands at the scatter point without damage unless the weapon also detonates (Blast)." },
    { syntax: "declare scatter_hit <distance-expr>", at: "ON_HIT", summary: "This HIT scatters (Indirect (X), p.147): the engine rolls the Scatter Diagram direction and attaches {direction, distance} to the hit (distance clamped at 0, e.g. 1d10 \u2212 bs_bonus)." },
    { syntax: 'add modifier "key" = <expr>', at: "MODIFIERS, DAMAGE_MODS", summary: "Add a named modifier (to-hit or damage) with the given value." },
    { syntax: 'set modifier "key" = <expr>', at: "MODIFIERS, DAMAGE_MODS", summary: "Set/overwrite a named modifier's value." },
    { syntax: 'cancel modifier "key"', at: "MODIFIERS, DAMAGE_MODS", summary: "Remove a named modifier entirely." },
    { syntax: "multiply_hits <expr>", at: "HIT_COUNT_MULT", summary: "Multiply the number of extra hits by N." },
    { syntax: "set pen += <expr>  /  set pen = <expr>", at: "PENETRATION", summary: `Increase (or set) the hit's armour penetration. "+= pen" doubles it.` },
    { syntax: "set rf_threshold = <expr>", at: "DIE_ADJUST", summary: "Set the natural die value that triggers Righteous Fury (default 10; e.g. Vengeful lowers it)." },
    { syntax: "set jam_threshold = <expr>", at: "POST_ROLL", summary: "Set the ranged jam threshold (jams on roll > threshold; default 96). Reliable/Unreliable & craftsmanship use this." },
    { syntax: "set damage_type = <expr>", at: "DAMAGE_POOL, DIE_ADJUST", summary: `Override this hit's damage type (e.g. Sanctified \u2192 "Holy", Force \u2192 "Energy"); surfaced on the damage result. Set it before damage is rolled.` },
    { syntax: "set scatter = <expr>  /  set scatter += <expr>", at: "ON_MISS", summary: "Set the base scatter distance (activates scatter) / add a DSL-alterable distance modifier. Final distance = max(0, base + modifiers); the engine rolls the 1d10 direction." },
    { syntax: "floor_die <expr>", at: "DIE_ADJUST", summary: "Raise any damage die below N up to N (Proven)." },
    { syntax: "cap_die <expr>", at: "DIE_ADJUST", summary: "Cap any damage die above N at N (Primitive)." },
    { syntax: 'emit "name", "text"', at: "POST_ROLL", summary: "Attach a named narrative effect (with optional description) to the result." },
    { syntax: 'suppress "Rule Name"', at: "any", summary: "Skip another rule by name for the rest of this checkpoint run (must run at lower priority than the target). E.g. Overheats suppresses the baseline Jam mechanic." },
    { syntax: 'require_test "Characteristic" <expr> "on-fail" [=> roll_on "Table" | => apply_status "Cond" [value/duration/location <expr>]]', at: "ON_HIT", summary: 'Declare a test the target must pass (modifier = expr) or suffer the on-fail consequence. Auto-rolled when enabled. The optional => follow-up on a FAILED test rolls a roll_table (Hallucinogenic) or applies a Condition with optional structured vars (Flame \u2192 On Fire duration "until extinguished").' },
    { syntax: 'roll_on "Table Name" [+ <expr>] [area <expr>]', at: "ON_HIT, ON_MISS", summary: "Roll on a roll_table (defined with the roll_table block); the engine rolls its die (+ optional modifier), records the matching row, and applies any statuses it carries. Optional `area` surfaces a radius with the result (Haywire field area). Used by Haywire and by Blast (Scatter Diagram)." },
    { syntax: 'apply_status "name" [value <expr>] [duration <expr>] [location <expr>] [, "reason"]', at: "ON_HIT", summary: "Apply a Condition to the target (e.g. Prone, Crippled) with optional structured variables \u2014 severity value (e.g. Crippling(X) \u2192 value X), duration in rounds, and hit location \u2014 plus an optional reason shown in the report." },
    { syntax: "corrode <expr>", at: "ON_HIT", summary: "Corrosive: reduce the struck location's Armour Points by <expr> (cumulative across hits); any overflow beyond current AP \u2014 or all of it if unarmoured \u2014 is dealt to the target as wounds, ignoring Toughness." },
    { syntax: 'bump_quality "Name" by <expr>', at: "DAMAGE_POOL, PENETRATION", summary: "Increase an existing weapon quality's rating in place, e.g. Maximal raising Blast (3) \u2192 Blast (5). No-op if the weapon lacks the quality." },
    { syntax: 'add_quality "Name"', at: "any", summary: 'Grant the weapon a quality this shot (e.g. Maximal granting Recharge), so has_quality("Name") becomes true for later checkpoints. No-op if already present.' }
  ],
  expressions: [
    "Numbers: 10, 0, etc. Negatives via unary minus: -20.",
    "Dice literals: 1d10, 2d6 \u2014 rolled when the action runs, using the engine RNG.",
    "Arithmetic: + - * / with parentheses, e.g. (sb * 2) + 1.",
    'Facts and functions may appear in expressions, e.g. quality_level("Proven", 2).',
    "Strings use double or single quotes; booleans are true / false."
  ],
  operators: {
    logical: ["and", "or", "not"],
    comparison: ["==", "!=", ">", "<", ">=", "<="],
    arithmetic: ["+", "-", "*", "/"],
    grouping: ["( )"]
  }
};
var DOCUMENTED_CHECKPOINTS = DSL_DOCS.checkpoints.map((c) => c.name);
var DOCUMENTED_FACTS = DSL_DOCS.facts.map((f) => f.name);
var DOCUMENTED_FUNCTIONS = DSL_DOCS.functions.map((f) => f.signature.split("(")[0]);

// api/lib/character-schema.mjs
var CHARACTER_SCHEMA_VERSION = 1;
var CHARACTERISTIC_KEYS = ["ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel"];
var UNNATURAL_KEYS = ["ws", "bs", "s", "t", "ag"];
var ARMOUR_KEYS = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];
var DAMAGE_TYPES = ["Impact", "Energy", "Explosive", "Rending"];
var WEAPON_CLASSES = ["melee", "pistol", "basic", "heavy", "thrown"];
var CRAFTSMANSHIP = ["Poor", "Common", "Good", "Best"];
var CHARACTER_FIELDS = [
  { path: "schemaVersion", type: "int", required: true, summary: `Document schema version (current: ${CHARACTER_SCHEMA_VERSION}). Migrations keep old documents loadable.` },
  { path: "kind", type: '"dh2.character"', required: true, summary: "Document discriminator." },
  { path: "name", type: "string", required: true, summary: "Character name." },
  { path: "system", type: "string", required: false, summary: 'Rule system id (default "dh2").' },
  { path: "characteristics.<ws|bs|s|t|ag|int|per|wp|fel>", type: "int 0\u2013200", required: true, summary: "The nine DH2 characteristics (percentile values)." },
  { path: "unnatural.<ws|bs|s|t|ag>", type: "int \u2265 0", required: false, summary: "Unnatural Characteristic values (p.139): +X to the bonus, \u2308X/2\u2309 bonus DoS on successful tests." },
  { path: "armour.<head|body|leftArm|rightArm|leftLeg|rightLeg>", type: "int \u2265 0", required: false, summary: "Armour points by hit location." },
  { path: "wounds", type: "{ max, current }", required: false, summary: "Wound track (carried, not yet consumed by the attack loop)." },
  { path: "fate", type: "{ max, current }", required: false, summary: "Fate points (carried, not yet consumed)." },
  { path: "talents", type: "(string | {name, level})[]", required: false, summary: 'Talent list. "Name (X)" strings or {name, level} objects.' },
  { path: "traits", type: "(string | {name, level})[]", required: false, summary: "Trait list (innate DH2.0 traits, e.g. Brutal Charge (3), Daemonic (4))." },
  { path: "conditions", type: "(string | {name, severity, duration, location})[]", required: false, summary: "Active Conditions (Stunned, On Fire, \u2026)." },
  { path: "circumstances", type: "(string | {name, severity})[]", required: false, summary: "Environmental Circumstances (Darkness, Haywire Field, \u2026)." },
  { path: "weapons[]", type: "weapon", required: false, summary: "Weapon profiles (see weapon fields)." },
  { path: "weapons[].name", type: "string", required: true, summary: "Weapon name." },
  { path: "weapons[].class", type: WEAPON_CLASSES.join(" | "), required: false, summary: 'Weapon class; "melee" and "thrown" drive Strength-Bonus damage.' },
  { path: "weapons[].damage", type: 'string "XdY+Z"', required: true, summary: "Damage formula." },
  { path: "weapons[].pen", type: "int \u2265 0", required: false, summary: "Penetration." },
  { path: "weapons[].damageType", type: DAMAGE_TYPES.join(" | "), required: false, summary: "Damage type." },
  { path: "weapons[].rof", type: "{ single, burst, full }", required: false, summary: "Rate of fire (burst/full as ints)." },
  { path: "weapons[].qualities", type: "(string | {name, level})[]", required: false, summary: "Weapon qualities." },
  { path: "weapons[].craftsmanship", type: CRAFTSMANSHIP.join(" | "), required: false, summary: "Craftsmanship tier." },
  { path: "weapons[].sbMultiplier", type: "int 0\u20132", required: false, summary: "Strength-Bonus multiple added to damage for melee/thrown (default 1 for melee)." },
  { path: "field", type: "{ rating, overloadMax }", required: false, summary: "Force field (absorbs on roll \u2264 rating; overloads on roll \u2264 overloadMax)." },
  { path: "source", type: "{ adapter, ... }", required: false, summary: "Import provenance (adapter name, source identifiers, timestamp)." }
];
var isInt = (v) => Number.isInteger(v);
var isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
var isNamedEntry = (v) => typeof v === "string" || v && typeof v === "object" && typeof v.name === "string";
function validateCharacter(doc) {
  const errors = [], warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });
  if (!doc || typeof doc !== "object") return { ok: false, errors: [{ path: "", message: "Not an object" }], warnings };
  if (!isInt(doc.schemaVersion)) err("schemaVersion", "Required integer");
  else if (doc.schemaVersion > CHARACTER_SCHEMA_VERSION) warn("schemaVersion", `Document is v${doc.schemaVersion}; this build knows v${CHARACTER_SCHEMA_VERSION} \u2014 fields may be ignored`);
  if (doc.kind !== "dh2.character") err("kind", 'Must be "dh2.character"');
  if (typeof doc.name !== "string" || !doc.name.trim()) err("name", "Required non-empty string");
  if (doc.system !== void 0 && typeof doc.system !== "string") err("system", "Must be a string");
  if (!doc.characteristics || typeof doc.characteristics !== "object") err("characteristics", "Required object");
  else {
    for (const k of CHARACTERISTIC_KEYS) {
      const v = doc.characteristics[k];
      if (v === void 0) err(`characteristics.${k}`, "Required");
      else if (!isInt(v) || v < 0 || v > 200) err(`characteristics.${k}`, "Integer 0\u2013200 required");
    }
    for (const k of Object.keys(doc.characteristics)) if (!CHARACTERISTIC_KEYS.includes(k)) warn(`characteristics.${k}`, "Unknown characteristic (ignored)");
  }
  if (doc.unnatural !== void 0) {
    if (typeof doc.unnatural !== "object") err("unnatural", "Must be an object");
    else for (const [k, v] of Object.entries(doc.unnatural)) {
      if (!UNNATURAL_KEYS.includes(k)) warn(`unnatural.${k}`, "Unknown/unsupported unnatural characteristic (ignored)");
      else if (!isNonNegInt(v)) err(`unnatural.${k}`, "Non-negative integer required");
    }
  }
  if (doc.armour !== void 0) {
    if (typeof doc.armour !== "object") err("armour", "Must be an object");
    else for (const [k, v] of Object.entries(doc.armour)) {
      if (!ARMOUR_KEYS.includes(k)) warn(`armour.${k}`, "Unknown hit location (ignored)");
      else if (!isNonNegInt(v)) err(`armour.${k}`, "Non-negative integer required");
    }
  }
  for (const trackName of ["wounds", "fate"]) {
    const track = doc[trackName];
    if (track === void 0) continue;
    if (typeof track !== "object") {
      err(trackName, "Must be { max, current }");
      continue;
    }
    for (const p of ["max", "current"]) if (track[p] !== void 0 && !isInt(track[p])) err(`${trackName}.${p}`, "Integer required");
  }
  for (const listName of ["talents", "traits", "conditions", "circumstances"]) {
    const list = doc[listName];
    if (list === void 0) continue;
    if (!Array.isArray(list)) {
      err(listName, "Must be an array");
      continue;
    }
    list.forEach((entry, i) => {
      if (!isNamedEntry(entry)) err(`${listName}[${i}]`, "Must be a string or { name, \u2026 } object");
    });
  }
  if (doc.weapons !== void 0) {
    if (!Array.isArray(doc.weapons)) err("weapons", "Must be an array");
    else doc.weapons.forEach((w, i) => {
      const at = (p) => `weapons[${i}].${p}`;
      if (!w || typeof w !== "object") {
        err(`weapons[${i}]`, "Must be an object");
        return;
      }
      if (typeof w.name !== "string" || !w.name.trim()) err(at("name"), "Required non-empty string");
      if (typeof w.damage !== "string" || !/^\s*\d+\s*d\s*\d+\s*([+-]\s*\d+)?\s*$/i.test(w.damage)) err(at("damage"), 'Damage formula "XdY[+Z]" required');
      if (w.class !== void 0 && !WEAPON_CLASSES.includes(w.class)) err(at("class"), `One of: ${WEAPON_CLASSES.join(", ")}`);
      if (w.pen !== void 0 && !isNonNegInt(w.pen)) err(at("pen"), "Non-negative integer required");
      if (w.damageType !== void 0 && !DAMAGE_TYPES.includes(w.damageType)) err(at("damageType"), `One of: ${DAMAGE_TYPES.join(", ")}`);
      if (w.craftsmanship !== void 0 && !CRAFTSMANSHIP.includes(w.craftsmanship)) err(at("craftsmanship"), `One of: ${CRAFTSMANSHIP.join(", ")}`);
      if (w.qualities !== void 0) {
        if (!Array.isArray(w.qualities)) err(at("qualities"), "Must be an array");
        else w.qualities.forEach((q, qi) => {
          if (!isNamedEntry(q)) err(at(`qualities[${qi}]`), "Must be a string or { name, level }");
        });
      }
      if (w.rof !== void 0 && (typeof w.rof !== "object" || w.rof === null)) err(at("rof"), "Must be { single, burst, full }");
      if (w.sbMultiplier !== void 0 && (!isInt(w.sbMultiplier) || w.sbMultiplier < 0 || w.sbMultiplier > 2)) err(at("sbMultiplier"), "Integer 0\u20132 required");
    });
  }
  if (doc.field !== void 0) {
    if (typeof doc.field !== "object") err("field", "Must be { rating, overloadMax }");
    else for (const p of ["rating", "overloadMax"]) if (doc.field[p] !== void 0 && !isNonNegInt(doc.field[p])) err(`field.${p}`, "Non-negative integer required");
  }
  return { ok: errors.length === 0, errors, warnings };
}
function migrateCharacter(doc) {
  const d2 = { ...doc };
  switch (d2.schemaVersion) {
    case void 0:
    case 0:
      d2.schemaVersion = 1;
      d2.kind = d2.kind ?? "dh2.character";
    // fallthrough for future versions:
    case 1:
      break;
    default:
      break;
  }
  return d2;
}
function characterToCombatant(doc, { weaponIndex = 0, location = "body" } = {}) {
  const c = doc.characteristics ?? {};
  const w = (doc.weapons ?? [])[weaponIndex];
  return {
    name: doc.name,
    characteristics: { ws: c.ws ?? 0, bs: c.bs ?? 0, s: c.s ?? 0, t: c.t ?? 0, ag: c.ag ?? 0, wp: c.wp ?? 0 },
    unnatural: { ...doc.unnatural ?? {} },
    weapon: w ? {
      name: w.name,
      isMelee: w.class === "melee",
      thrown: w.class === "thrown" || void 0,
      damage: w.damage,
      pen: w.pen ?? 0,
      damageType: w.damageType ?? "Impact",
      rof: { single: true, burst: Number(w.rof?.burst) || 0, full: Number(w.rof?.full) || 0 },
      qualities: canonList(w.qualities),
      craftsmanship: w.craftsmanship ?? "Common",
      sbMultiplier: w.sbMultiplier ?? (w.class === "melee" || w.class === "thrown" ? 1 : 0)
    } : void 0,
    talents: canonList(doc.talents),
    traits: canonList(doc.traits),
    conditions: doc.conditions ?? [],
    circumstances: doc.circumstances ?? [],
    // defender-side extras (harmless on the attacker side):
    armour: (doc.armour ?? {})[location] ?? 0,
    toughnessBonus: Math.floor((c.t ?? 0) / 10),
    unnaturalToughness: doc.unnatural?.t ?? 0,
    field: doc.field ?? { rating: 0, overloadMax: 0 }
  };
}

// api/lib/encounter.mjs
var ENCOUNTER_SCHEMA_VERSION = 1;
function emptyEncounter() {
  return { schemaVersion: ENCOUNTER_SCHEMA_VERSION, kind: "dh2.encounter", round: 1, actors: {} };
}
function encounterActor(encounter, key, name = key) {
  if (!encounter.actors[key]) {
    encounter.actors[key] = {
      name,
      stats: { characteristics: {}, unnatural: {}, talents: [], traits: [] },
      conditions: [],
      armourDamage: {},
      cooldowns: {},
      wounds: { taken: 0 }
    };
  }
  return encounter.actors[key];
}
var clone = (x) => JSON.parse(JSON.stringify(x));
var PHASE_TO_CHECKPOINT = {
  TURN_START: CHECKPOINTS.UPKEEP_TURN_START,
  TURN_END: CHECKPOINTS.UPKEEP_TURN_END,
  ROUND_END: CHECKPOINTS.UPKEEP_ROUND_END
};
function tickEncounter(encounter, phase, registry = defaultRegistry, rng = Math.random, actorKey = null) {
  const checkpoint = PHASE_TO_CHECKPOINT[phase];
  if (!checkpoint) throw new Error(`Unknown upkeep phase '${phase}' (TURN_START | TURN_END | ROUND_END)`);
  const out = clone(encounter);
  const events = [];
  const keys = actorKey ? [actorKey] : Object.keys(out.actors);
  for (const key of keys) {
    const actor = out.actors[key];
    if (!actor) continue;
    const ctx = new RollContext({
      action: "Upkeep",
      isMelee: false,
      rangeBand: "",
      aimValue: 0,
      rng,
      qualities: [],
      craftsmanship: "Common",
      talents: actor.stats?.talents ?? [],
      traits: actor.stats?.traits ?? [],
      statuses: actor.conditions,
      circumstances: [],
      combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
      modifiers: {},
      effects: [],
      targetEffects: { tests: [], statuses: [], armour: [] },
      declaredDamage: []
    });
    runCheckpoint(registry, checkpoint, ctx);
    for (const d2 of ctx.declaredDamage ?? []) {
      actor.wounds.taken += d2.amount;
      events.push({ actor: key, type: "damage", source: d2.source, amount: d2.amount, reason: d2.reason });
    }
    for (const t of ctx.targetEffects.tests) {
      const charKey = t.characteristic?.toLowerCase().startsWith("t") ? "t" : t.characteristic?.toLowerCase().startsWith("a") ? "ag" : t.characteristic?.toLowerCase().startsWith("w") ? "wp" : null;
      const target = charKey != null ? actor.stats.characteristics?.[charKey] ?? 0 : 0;
      const unnatural = charKey != null ? actor.stats.unnatural?.[charKey] ?? 0 : 0;
      const tt = rollTest({ target, modifiers: { test: t.modifier }, label: `${t.characteristic} test (upkeep)`, unnatural }, rng);
      const ev = { actor: key, type: "test", source: t.source, characteristic: t.characteristic, roll: tt.roll, threshold: tt.modifiedTarget, success: tt.success };
      if (!tt.success) {
        ev.outcome = t.onFail;
        if (typeof t.onFailDamage === "function") {
          ev.damage = t.onFailDamage();
          actor.wounds.taken += ev.damage;
        }
        if (t.onFailApply) {
          actor.conditions.push({ name: t.onFailApply.name, severity: t.onFailApply.value ?? null, duration: t.onFailApply.duration ?? null, location: t.onFailApply.location ?? null });
          ev.applied = t.onFailApply.name;
        }
      }
      events.push(ev);
    }
    for (const e of ctx.effects ?? []) events.push({ actor: key, type: "note", source: e.name, reason: e.effect });
    if (phase === "TURN_END" && actor.cooldowns?.recharge) {
      actor.cooldowns.recharge = false;
      events.push({ actor: key, type: "cooldown", source: "Recharge", reason: "weapon recharged \u2014 may fire again" });
    }
    if (phase === "ROUND_END") {
      const kept = [];
      for (const c of actor.conditions) {
        let keep = true;
        if (typeof c.duration === "number") {
          c.duration -= 1;
          if (c.duration <= 0) {
            keep = false;
            events.push({ actor: key, type: "expired", source: c.name, reason: "duration elapsed" });
          }
        }
        if (keep && typeof c.decay === "number" && typeof c.severity === "number") {
          c.severity -= c.decay;
          if (c.severity <= 0) {
            keep = false;
            events.push({ actor: key, type: "expired", source: c.name, reason: "decayed to nothing" });
          } else {
            events.push({ actor: key, type: "decay", source: c.name, reason: `severity \u2192 ${c.severity}` });
          }
        }
        if (keep) kept.push(c);
      }
      actor.conditions = kept;
    }
  }
  if (phase === "ROUND_END" && !actorKey) out.round += 1;
  return { encounter: out, events };
}
function harvestEngagement(encounter, attackerKey, defenderKey, result, { attackerName, defenderName } = {}) {
  const out = clone(encounter ?? emptyEncounter());
  const atk = encounterActor(out, attackerKey, attackerName ?? attackerKey);
  const def = encounterActor(out, defenderKey, defenderName ?? defenderKey);
  if ((result.attack?.effects ?? []).some((e) => e.name === "Recharge")) {
    atk.cooldowns.recharge = true;
  }
  for (const hit of result.attack?.hits ?? []) {
    if (hit.evaded || hit.fieldAbsorbed) continue;
    for (const ar of hit.targetEffects?.armour ?? []) {
      const loc = hit.location ?? "Body";
      def.armourDamage[loc] = (def.armourDamage[loc] ?? 0) + (ar.amount ?? 0);
    }
    for (const st of hit.targetEffects?.statuses ?? []) {
      def.conditions.push({ name: st.status, severity: st.value ?? null, duration: st.duration ?? null, location: st.location ?? null });
    }
    def.wounds.taken += (hit.soak?.woundsInflicted ?? 0) + (hit.corrosiveWounds ?? 0);
  }
  return out;
}

// foundry/dh2-roll-vm/src/main.mjs
var MODULE_ID = "dh2-roll-vm";
function mapActor(actor) {
  const c = actor?.system?.characteristics ?? actor?.characteristics ?? {};
  const total = (k) => Number(c?.[k]?.total ?? c?.[k]?.base ?? 0) || 0;
  const weapons = actor?.items?.filter?.((i) => i.type === "weapon") ?? [];
  const w = weapons.find((i) => i.system?.equipped) ?? weapons[0];
  const specials = (w?.items ?? w?.system?.specials ?? []).filter?.((s) => s.type === "attackSpecial" || s.system?.level !== void 0) ?? [];
  const qualities = specials.map((s) => ({ name: s.name, level: s.system?.level ?? null }));
  return {
    name: actor?.name ?? "Unknown",
    characteristics: {
      ws: total("weaponSkill"),
      bs: total("ballisticSkill"),
      s: total("strength"),
      t: total("toughness"),
      ag: total("agility"),
      wp: total("willpower")
    },
    weapon: w ? {
      name: w.name,
      isMelee: (w.system?.class ?? "").toLowerCase() === "melee",
      damage: w.system?.damage ?? "1d10",
      pen: Number(w.system?.penetration ?? w.system?.pen ?? 0) || 0,
      damageType: w.system?.damageType ?? "Impact",
      rof: { single: true, burst: Number(w.system?.rateOfFire?.burst ?? 0) || 0, full: Number(w.system?.rateOfFire?.full ?? 0) || 0 },
      qualities,
      craftsmanship: w.system?.craftsmanship ?? "Common"
    } : void 0,
    talents: (actor?.items?.filter?.((i) => i.type === "talent") ?? []).map((t) => t.name),
    traits: (actor?.items?.filter?.((i) => i.type === "trait") ?? []).map((t) => ({ name: t.name, level: t.system?.level ?? null }))
  };
}
async function dh2Attack() {
  const attackerToken = canvas.tokens.controlled[0];
  const targetToken = game.user.targets.first?.() ?? [...game.user.targets][0];
  if (!attackerToken || !targetToken) {
    ui.notifications.warn("dh2-roll-vm: select an attacker token and target another token.");
    return;
  }
  const atk = mapActor(attackerToken.actor);
  const def = mapActor(targetToken.actor);
  const inputs = {
    attacker: { ...atk, action: "Standard Attack" },
    defender: {
      characteristics: def.characteristics,
      armour: Number(targetToken.actor?.system?.armour?.body?.total ?? 0) || 0,
      // body AP as the skeleton simplification
      toughnessBonus: Math.floor(def.characteristics.t / 10),
      weapon: def.weapon,
      talents: def.talents,
      traits: def.traits,
      evasion: { mode: "dodge" }
    },
    options: { autoResolveTests: true }
  };
  const rng = rollScript([]);
  const out = resolveEngagement(inputs, rng, buildRegistry());
  const t = out.attack.test;
  const lines = [
    `<b>${atk.name}</b> attacks <b>${def.name}</b> with <b>${out.attack.weapon}</b>`,
    `To-hit: ${t.roll} vs ${t.modifiedTarget} \u2014 <b>${t.success ? `HIT (${t.dos} DoS)` : `MISS (${t.dof} DoF)`}</b>`,
    ...(out.attack.effects ?? []).map((e) => `\u26A1 ${e.name}${e.effect ? ` \u2014 ${e.effect}` : ""}`),
    ...(out.attack.hits ?? []).map((h) => `Hit ${h.hitNumber} @ ${h.location}: dmg ${h.damage?.total ?? "\u2014"} (${h.damageType}, Pen ${h.totalPenetration})` + (h.soak ? ` \u2192 soak ${h.soak.reduction} \u2192 <b>${h.soak.woundsInflicted} wounds</b>` : "")),
    out.reaction ? `Reaction: ${out.reaction.prevented ? "Parry PREVENTED" : `${out.reaction.mode} ${out.reaction.test?.success ? "EVADED" : "failed"}`}` : null,
    out.attack.totalWounds !== void 0 ? `<b>Total wounds: ${out.attack.totalWounds}</b>` : null,
    `<span style="opacity:.6">${rng.trace.length} dice \xB7 dh2-roll-vm walking skeleton</span>`
  ].filter(Boolean);
  await ChatMessage.create({ content: lines.join("<br>") });
  return out;
}
async function importCharacter(raw) {
  const doc = migrateCharacter(typeof raw === "string" ? JSON.parse(raw) : raw);
  const v = validateCharacter(doc);
  if (!v.ok) {
    console.error("dh2-roll-vm | character validation failed:", v.errors);
    ui.notifications.error(`Character invalid: ${v.errors.map((e) => e.path).join(", ")}`);
    return null;
  }
  const c = doc.characteristics;
  const char = (base) => ({ base: Number(base) || 0, advance: 0, modifier: 0 });
  const actor = await Actor.create({
    name: doc.name,
    type: "acolyte",
    system: {
      characteristics: {
        weaponSkill: char(c.ws),
        ballisticSkill: char(c.bs),
        strength: char(c.s),
        toughness: char(c.t),
        agility: char(c.ag),
        intelligence: char(c.int),
        perception: char(c.per),
        willpower: char(c.wp),
        fellowship: char(c.fel)
      },
      wounds: { max: doc.wounds?.max ?? 10, value: doc.wounds?.current ?? doc.wounds?.max ?? 10 },
      fate: { max: doc.fate?.max ?? 0, value: doc.fate?.current ?? doc.fate?.max ?? 0 }
    }
  });
  const items = [
    ...(doc.weapons ?? []).map((w) => ({
      name: w.name,
      type: "weapon",
      system: {
        class: w.class ?? "basic",
        damage: w.damage,
        penetration: w.pen ?? 0,
        damageType: w.damageType ?? "Impact",
        craftsmanship: w.craftsmanship ?? "Common",
        rateOfFire: { single: 1, burst: w.rof?.burst ?? 0, full: w.rof?.full ?? 0 }
      }
    })),
    ...(doc.talents ?? []).map((t) => {
      const e = typeof t === "object" ? t : { name: t };
      return { name: e.name, type: "talent", system: {} };
    }),
    ...(doc.traits ?? []).map((t) => {
      const e = typeof t === "object" ? t : { name: t };
      return { name: e.name, type: "trait", system: e.level != null ? { level: e.level } : {} };
    })
  ];
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
  ui.notifications.info(`dh2-roll-vm: imported "${doc.name}" (${items.length} items).`);
  console.log("dh2-roll-vm | imported Actor", actor, "\u2014 schema warnings:", v.warnings);
  return actor;
}
async function syncEncounterToActor(actor, actorState) {
  const mine = actor.effects.filter((e) => e.flags?.["dh2-roll-vm"]?.managed);
  if (mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id));
  const effects = (actorState.conditions ?? []).map((c) => ({
    name: c.name,
    img: "icons/svg/aura.svg",
    duration: c.duration != null ? { rounds: c.duration } : {},
    flags: { "dh2-roll-vm": { managed: true, severity: c.severity ?? null, location: c.location ?? null, decay: c.decay ?? null } }
  }));
  if (effects.length) await actor.createEmbeddedDocuments("ActiveEffect", effects);
  return effects.length;
}
function readEncounterFromActor(actor, key = actor.name) {
  const enc = emptyEncounter();
  const entry = encounterActor(enc, key, actor.name);
  for (const e of actor.effects) {
    const f = e.flags?.["dh2-roll-vm"];
    if (!f?.managed) continue;
    entry.conditions.push({
      name: e.name,
      severity: f.severity ?? null,
      duration: e.duration?.rounds ?? null,
      location: f.location ?? null,
      ...f.decay != null ? { decay: f.decay } : {}
    });
  }
  return enc;
}
Hooks.once("ready", () => {
  game.dh2vm = {
    resolveAttack,
    resolveEngagement,
    resolveParry,
    rollTest,
    rollDamage,
    applySoak,
    rollScript,
    buildRegistry,
    compile,
    builtinRules,
    availableQualities,
    DSL_DOCS,
    validateCharacter,
    migrateCharacter,
    characterToCombatant,
    importCharacter,
    emptyEncounter,
    encounterActor,
    tickEncounter,
    harvestEngagement,
    syncEncounterToActor,
    readEncounterFromActor,
    mapActor,
    dh2Attack
  };
  console.log(`${MODULE_ID} | DH2 Roll VM ready \u2014 ${builtinRules.length} rules loaded. Try game.dh2vm.dh2Attack() or /dh2attack.`);
  ui.notifications?.info("DH2 Roll VM loaded (walking skeleton).");
});
Hooks.on("chatMessage", (log, message) => {
  if (message.trim().toLowerCase() === "/dh2attack") {
    dh2Attack();
    return false;
  }
  return true;
});
