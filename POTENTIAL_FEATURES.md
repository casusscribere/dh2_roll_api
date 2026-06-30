# Potential features — deferred ideas

A scratchpad of features that have been discussed and intentionally deferred,
with enough context to pick them up later. Claude may draw from this when
planning or when a related request comes in. Not a roadmap — just a parking lot.

## Ammo tracking (deferred)

**Why deferred:** the engine has no notion of a magazine, shots-per-attack, or
reloads. Several rules reference ammunition but currently can't enforce it.

**What would need it:**
- **Maximal** (DH2 core p.146) — firing on Maximal "uses three times the normal
  amount of ammunition per shot and gains the Recharge quality." Implemented as
  an emitted *note* only (see the `firing_mode "Maximal"` rule); the ×3 ammo and
  Recharge are not enforced.
- **Rate of fire** — Semi-Auto / Full-Auto already pick a hit count from RoF, but
  don't deduct rounds. Overheats/Recharge weapons that must "cool down" between
  shots aren't tracked either.
- **Recharge** quality — a weapon that must spend a turn recharging between shots.

**Sketch of a design when we do it:**
- Add `clip: { size, loaded }` to the weapon profile and an `ammoCost` per action
  (1 normally; ×3 for Maximal; RoF-dependent for burst/full).
- Thread a mutable `clip.loaded` through the engagement; surface "rounds remaining"
  in the report and an "out of ammo / must reload" state.
- A `consume_ammo <expr>` DSL action (ON the to-hit / POST_ROLL checkpoint) so
  qualities/modes can declare their own ammo cost.
- A `Recharge`/`Overheats` cooldown flag that blocks the next shot until cleared.
- This is per-encounter mutable state, so it pairs with whatever we build for
  carrying defender armour (Corrosive) and conditions across turns.

## Range in metres (deferred)

**Why deferred:** range is modelled as a *band* (Point Blank / Short / Normal /
Long / Extreme), not metres, so effects that add/subtract metres can't shift the
band precisely.

**What would need it:**
- **Maximal** — "adds 10 metres to its range" (emitted as a note only today).
- **Scatter / Indirect** — distances are already in metres, but the firer↔target
  distance that determines the band is not, so the two don't interact.

**Sketch:** give weapons a numeric base range and derive the band from
attacker↔target distance; let a `set range += <metres>` action shift it. Keep the
band as a derived, display-friendly value.

## Blast area-of-effect on a hit (deferred)

**Why deferred:** Blast (X) is modelled only on a *miss* (scatter + detonate).
Its on-hit behaviour — "every creature within X metres of the hit is also struck
and must make an Agility test or take a hit" — is not modelled, because the tool
resolves one attacker↔one defender and has no notion of other targets, positions,
or distances on the table.

**Consequence today:** `bump_quality "Blast" by 2` (used by Maximal, p.146) does
correctly raise the Blast rating, but nothing consumes that value yet — so the
Blast bump is currently cosmetic (it shows as `Blast (1) → (3)` in the report but
changes no rolls). The miss-side scatter distance is a flat 1d5 and likewise does
not read Blast's X.

**Sketch when we do it:**
- Accept a list of secondary targets (or a count) in the area; for each, roll the
  Agility test (a `roll_table`/`require_test`-style declaration keyed off Blast's
  X-metre radius) and apply a hit on a failure.
- Read Blast's level via `quality_level("Blast", …)` so `bump_quality` becomes
  load-bearing (Maximal's +2, etc. widen the radius / number affected).
- Pairs with the **range in metres** work above — radius and positions are the
  same coordinate model.

## DSL rule taxonomy — nine-category model (IMPLEMENTED)

The nine-category model is **implemented** (see README "Rule taxonomy",
`grammar.md`, and `KIND_GROUP` in `lib/rules/index.mjs`; Foundry targets in
FOUNDRY_MIGRATION.md). `category = UI grouping + Foundry target`; `kind = DSL tag
+ engine behaviour`. Current status per category:

| # | Category | kind / file | Status |
|---|----------|-------------|--------|
| 1 | **Weapon qualities** | `quality` (weapon-qualities.dsl) | ✅ done. *Deferred:* broaden to non-weapon items (armour/gear) + an `item_type` fact. |
| 2 | **Talents & Traits** | `talent`, `trait` | ✅ done. |
| 3 | **Circumstances** | `circumstance` (circumstances.dsl) | ✅ done — `has_circumstance()` + `circumstances[]`. *Deferred:* map/scene-aware auto-apply. |
| 4 | **Conditions** | `condition` (conditions.dsl) | ✅ done — `has_condition()`, structured vars (severity/duration/location). |
| 5 | **Actions** | `action` decl (actions.dsl) | ✅ done — compiled at load via `registerActions()`; hooked via `is_action()`/`action_type`/`is_reaction()`. |
| 6 | **Configurations** | `configuration` (configurations.dsl) | ✅ done — `configuration()`/`firing_mode` + `configs[]`; Maximal recategorised here. |
| 7 | **Roll tables** | `roll_table` (roll-tables.dsl) | ✅ done. |
| 8 | **Mechanical** | `mechanic` (mechanics.dsl) | ✅ done (Jam, craftsmanship). *Needs clarifying — see below.* |
| 9 | **Miscellaneous** | `miscellaneous` (`generic`/`rule` aliases) | ✅ done. |

Parser alias normalisation: `status`→`condition`, `generic`/`rule`→`miscellaneous`.
The old `condition` kind (situational) is now `circumstance`; the old `status`
kind (active) is now `condition` — so "Condition" means what players expect
(Stunned, On Fire, Prone, Crippled, Aiming) per DH2 core p.242.

Still open within these categories:
- **Qualities → non-weapon items** (armour/gear qualities + `item_type`).
- **Circumstances → map-aware** auto-apply (Foundry Scene Regions).
- **Conditions → per-turn handlers** (On Fire/Bleeding damage each round) — needs a
  turn loop the headless engine doesn't have; that's the Foundry side.

**Mechanical additions — needs expanding/clarifying (explicit TODO).** Category 8
is currently a vague bin. It should eventually distinguish: (a) *weapon mechanics*
(Jam, Overheats, Reliable/Unreliable thresholds), (b) *craftsmanship* tiers, (c)
*ammo/charge* economies (see "Ammo tracking" above), (d) *profile modifiers*
(weapon/armour mods, ammo variants — see "Modifications" below). Decide whether
these are sub-kinds of `mechanic` or separate categories before authoring many.

**Other categories the rulebook + Foundry model imply** (scan of DH2 core + the
DH3 `template.json` item types — see Foundry map below):
- **Modifications** — ammunition, weapon mods, armour mods: *swappable* profile
  changers (vs intrinsic qualities). DH3 models these as nested items that
  contribute `attackSpecial`s. Overlaps Qualities + Configurations; worth its own
  category once `bump_quality`/profile-rewrite matures.
- **Psychic powers** — Focus Power tests, psy rating, Psychic Phenomena (DH2
  p.150+). A whole subsystem; not roll-DSL-shaped yet. Own category later.
- **Corruption & Insanity** — Mutations, Malignancies, Mental Disorders (DH3 item
  types `mutation`/`malignancy`/`mentalDisorder`). Long-arc character state akin
  to Talents/Traits but acquired adversely.
- **Critical effects** — the RF / critical-damage tables are already `roll_table`-
  shaped (engine `critical-damage.mjs`); fold them into the Roll tables category.
- **Cybernetics / Force fields** — DH3 has `cybernetic`/`forceField` item types;
  force fields are already engine-modelled (rating/overload) and could be authored
  as item Qualities.

## Foundry VTT porting map (deferred)

Moved to its own doc: **[FOUNDRY_MIGRATION.md](FOUNDRY_MIGRATION.md)** — maps each
DSL category onto the live `dark-heresy-3rd-edition` system constructs
(`attackSpecial` items, ActiveEffects, `CombatActionManager`, `config.mjs`
startup registries, native `RollTable`s) and tracks the four-stage taxonomy
implementation.

## Vehicle weapon interactions (deferred)

Several weapon qualities have a distinct effect against **vehicles** that this
single-actor, character-vs-character tool does not model (no vehicle Actor,
facings, Armour-by-facing, Operate skill, or vehicle critical tables). Implement
when a vehicle target model exists.

- **Graviton (p.146) — vehicle facing.** Against a *vehicle or cover*, Graviton
  inflicts additional damage equal to the **Armour points of the facing struck**
  (not the character armour at a hit location, which is what the implemented
  `add modifier "graviton" = target_armour` uses). Additionally, vehicles that
  suffer Critical damage from Graviton **always roll on the Motive Systems
  Critical Effects table**, regardless of where they were hit. Needs: a vehicle
  target with per-facing Armour, a `facing` fact, and a way to force a specific
  critical table.
- **Flame (p.145) — vehicle pilot test.** When the target of a Flame attack is a
  vehicle, the **pilot makes the appropriate Operate test with a bonus equal to
  the vehicle's Armour on the facing hit**; on a failure the vehicle catches fire
  (the On Fire! vehicle sidebar, p.263). The implemented Flame models the
  creature case (Agility test → On Fire). Needs: a vehicle target + a pilot/crew
  Operate test, and the vehicle On Fire variant.

## Smoke (X) weapon quality — implementation plan (deferred)

Smoke (DH2 core p.148) is authored but **not yet implemented**, because it needs
a new non-damaging area mechanic and shares the scatter machinery with Blast in a
way that is worth doing cleanly.

RAW: rather than inflicting damage, a Smoke weapon creates a **smokescreen at the
point of impact** with a radius in metres equal to X, lasting **1d10+10 rounds**
(shorter in adverse weather; smoke effects on p.229). A Smoke weapon — like a
Blast weapon — **scatters when the firer misses** (p.230), but *only* Blast
inflicts damage on a scatter. A Smoke weapon still creates its smokescreen at the
**scattered** origin point; it deals no damage on a scatter unless the weapon
*also* has Blast.

Required pieces:

1. **A `smoke` action** (DSL) — `smoke <radius> for <duration>` — that records a
   smoke cloud `{ radius, duration }` onto the result (a new `ctx.smoke`
   accumulator, surfaced as `result.smoke` / `scatter.smoke`). Add to parser,
   interpreter, and docs (parity).
2. **On a hit:** an `ON_HIT` Smoke rule emits the cloud at the impact location:
   `then smoke quality_level("Smoke", 0) for 1d10 + 10`.
3. **On a miss (scatter):** an `ON_MISS` Smoke rule that activates scatter
   **without** `detonate` — `set scatter = 1d5; roll_on "Scatter Diagram"; smoke …`
   — so the engine computes the scatter point and attaches the smoke cloud there
   but rolls **no** damage. This is the key distinction from Blast, whose `ON_MISS`
   rule additionally calls `detonate`. A weapon with *both* Smoke and Blast gets
   both rules: Blast's `detonate` resolves the damage at the scatter point and
   Smoke attaches the cloud — exactly the RAW "scatters and damages and smokes".
4. **Engine:** in the `ON_MISS` scatter block, after computing `scatter`, harvest
   `ctx.smoke` onto `scatter.smoke` (mirroring how `scatter.hit` is built only
   when `ctx.detonate`). On a hit, harvest `ctx.smoke` onto the hit/result.
5. **UI:** render the smokescreen (radius + duration) on the hit line and on the
   scatter line.

No change to the existing Blast rule is needed — Smoke composes with it through
the shared `ON_MISS` scatter seam (`detonate` gates damage; `smoke` is
independent).

## Force, Spray, Indirect — implementation plans + DSL-extension approaches (deferred)

The three remaining unimplemented core qualities (alongside the planned **Smoke**
above) each need a *different* new piece of DSL/engine machinery. Listed by
increasing invasiveness.

### Force (DH2 core p.145) — needs a `psy_rating` fact (static part is cheap)
A Force weapon is a Best-craftsmanship Mono variant of its Low-Tech base; in a
**psyker's** hands it gains **+damage and +penetration equal to the wielder's base
psy rating** and its **damage type becomes Energy**; and on damaging a foe the
psyker may take a Focus Power action (Opposed vs Willpower) for **+1d10 Energy per
DoS, ignoring Armour and Toughness**. Force weapons are immune to Power Field
(already handled — Power Field checks `not opposing_has_quality("Force")`).

DSL approach — split into a cheap static half and a deferred psychic half:
- **Static (implementable now):** add a **`psy_rating` fact** (and `is_psyker`)
  read from `attacker.psyRating`. Then author Force as:
  `on DAMAGE_POOL when has_quality("Force") and psy_rating > 0 then set damage_type = "Energy"`
  (reuses the existing `set damage_type`); `on DAMAGE_MODS … then add modifier
  "force" = psy_rating`; `on PENETRATION … then set pen += psy_rating`. Only the
  new `psy_rating`/`is_psyker` facts are required — everything else already exists.
- **Focus Power bonus (deferred):** the Opposed-Willpower test that yields +1d10/DoS
  **ignoring soak** needs (a) a generic **`opposed_test`** action (attacker stat vs
  defender stat → DoS), and (b) an **ignore-soak damage channel** like the one
  Corrosive already uses (`hit.corrosiveWounds`) — call it bonus/true damage. Best
  built with the psychic subsystem.

### Indirect (X) (DH2 core p.145) — needs a per-HIT scatter action
No line of sight; the attack is **−10 and a Full Action**, and **every hit** (not
just a miss) **scatters**: roll the Scatter Diagram per hit and displace it Xd10 m
from the target. Missed potential hits are still fired and scatter too.

DSL approach:
- The **−10** is a trivial `add modifier "indirect" = -10` at MODIFIERS; the
  "Full Action not Half" is an action-economy `emit` note.
- The hard part is **per-hit scatter on a HIT**. Today scatter is a *per-attack,
  on-miss* mechanic (`set scatter`/`detonate`/`roll_on "Scatter Diagram"` at
  `ON_MISS`). Indirect needs a **new `scatter_hit <distance-expr>` action at
  `ON_HIT`** that, per hit, rolls the Scatter Diagram for a direction and `Xd10`
  for the distance and attaches `{ direction, directionText, distance }` to that
  hit (the engine resolves the table like it does for Haywire). New DSL action +
  a small `applyOnHit` harvest; the Scatter Diagram table already exists.

### Spray (DH2 core p.149) — needs a no-BS-test attack mode (most invasive)
Spray inverts the attack: **no BS test**; every creature in a 30° cone makes a
**Challenging (+0) Agility test or takes one Body hit** (untrained → targets +20,
+30 if Heavy & unbraced; cover only protects if total). It **jams on a damage die
of 9** (before modifiers) and **cannot make Called Shots**. (Reliable + Spray, or
any weapon that makes no hit roll, never jams.)

DSL approach:
- This is the only quality that changes the **control flow of the attack** rather
  than mutating a checkpoint, so it needs an engine-level **attack mode**: a weapon
  flagged Spray skips `rollTest`, **auto-hits the Body**, and instead emits a
  **defender Agility test** (which the existing `require_test "Agility" …` +
  `resolveTargetTests` machinery already resolves — the test *passing* means the
  hit is avoided, the inverse of today's "fail → suffer effect", so a
  `require_test … on_success_negates` flavour or an inverted flag is needed). True
  cone/multi-target is out of scope (single-actor tool) — model one representative
  target.
- **Jam on a damage die of 9:** a new **`jam_on_die <n>`** action at `DIE_ADJUST`
  that flags a jam when a kept damage die equals n (before modifiers); the engine
  then cancels the hit. This is awkward because the jam is discovered *after* the
  hit is already counted — it needs the damage stage to be able to retro-cancel,
  or Spray's damage to be rolled as part of resolving the hit.
- **No Called Shot:** `emit` a note when `is_action("Called Shot")`.
- Recommendation: implement only once a genuine area/template + no-attack-roll mode
  is wanted; it does not fit the current single-d100-to-hit pipeline.

## Toxic / Toxified — full end-of-turn implementation (deferred)

The Toxic (X) quality and the **Toxified** condition are implemented as a *shell*:
a wounding Toxic hit applies the Toxified condition (carrying severity X), and the
condition documents the effect. The full RAW (DH2 core p.150) is a **recurring,
end-of-turn** resolution this single-attack tool has no loop for:

> At the end of his turn, if the character suffered damage (after Armour and
> Toughness) in the last round from a Toxic weapon, he must make a Toughness test
> at −10×X or suffer 1d10 additional damage (of the toxin's type).

To implement fully, the tool would need a **turn/round model**: a per-character
"conditions tick" phase that, at end of turn, runs each active Toxified
condition's Toughness test (using the carried severity for the penalty) and
applies the 1d10 follow-up damage on a failure. This is the same end-of-turn
machinery that On Fire (1d10 E/round) and Bleeding-type conditions want — best
built once as a generic "condition upkeep" pass keyed off structured conditions,
rather than per-quality. Until then, the shell correctly *inflicts and records*
the condition; only the recurring tick is descriptive.

## Daemonic and From Beyond traits — implementation plan (deferred)

The **Sanctified** weapon quality is implemented and keys off the **target's**
traits via the new `target_has_trait("…")` function: against a Daemonic target,
its Holy damage negates the target's Unnatural Toughness (reusing Felling's
reduction). The traits themselves are supplied as data on the target
(`traits: ["Daemonic (4)"]`); these two creature traits should also be authored
as first-class **trait** rules (traits.dsl) so they apply to a creature *making*
or *defending* an attack, not just as a flag Sanctified reads.

- **Daemonic (X)** (DH2 core p.135). A creature increases its **Toughness bonus
  against all damage by X** "in the same manner as an Unnatural Characteristic",
  stacking with any Unnatural Toughness it also has. This increase **is negated by
  damage from force weapons, psychic powers, holy (Sanctified) attacks, or other
  Daemonic creatures**. Daemonic creatures also have the **Undying** trait.
  - Implementation: a `trait "Daemonic"` that, at the soak seam, contributes X to
    the defender's Unnatural Toughness — but the engine soaks from the *target*
    block, and traits today are *attacker*-side. So the clean path is either (a) a
    **defender-trait** pass that maps `Daemonic (X)` on the target into
    `unnaturalToughness += X` before soak, or (b) keep treating it as data (set
    `unnaturalToughness`) and only author the *negation* rules. The negation is
    already covered for Sanctified; **Force** and **psychic** negation would hook
    the same `reduce_unnatural_toughness target_unnatural_toughness` pattern gated
    on `target_has_trait("Daemonic")`.
  - Needs: a `target_trait_level("Daemonic", 0)` accessor if (a) is chosen, and a
    decision on where defender traits fold into soak.
- **From Beyond** (DH2 core p.135). The creature is **immune to Fear, Pinning,
  Insanity points, and mind-affecting psychic powers**. None of these subsystems
  (Fear tests, Pinning, Insanity, psychic) are modelled yet, so From Beyond has
  **no mechanical hook** in the current engine — author it once those subsystems
  exist. For now it is recognised as a target trait (so `target_has_trait("From
  Beyond")` is usable by future rules) but carries no effect.
