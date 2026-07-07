# DH2 Roll API

Minimalist API + HTML front-end for Dark Heresy 2e d100 tests and weapon damage resolution. Mechanics ported from the `dark-heresy-3rd-edition` Foundry VTT system (`module/rolls/*.mjs`, `module/rules/*.mjs`); weapon profiles sourced from `codified-systems/dark_heresy_2e/data/weapons.json` (144 parseable profiles, DH2 core).

## Run

```
npm install
npm start          # Express dev server → http://localhost:3210
npm test           # 286 tests (engine + pipeline + DSL + docs + rules content + character schema/adapters + phase0–5 suites + crit table + weapon data + HTTP endpoints)
npm run build:static   # bundle a server-free build → ./docs (for GitHub Pages)
npm run serve:static   # preview ./docs as Pages would → http://localhost:8080 (no API)
npm run export:packs   # DSL → Foundry compendium packs (RollTables + attackSpecial Items, LevelDB)
npm run deploy:foundry # build VM bundle + export packs + copy module into the live Foundry install
```

Open http://localhost:3210 for the UI. It has three pages: **Home** (navigation + status), **Roll** (d100 test, raw damage, Parry, and a **Full Attack Resolution — Engagement** checklist with attacker / weapon / defender zones, per-side talent toggles, Conditions/Circumstances/Configurations inputs, Evasion/Field reactions, on-hit target tests, and report controls — a **verbose** detail toggle, a **debug** toggle for per-roll die-forcing + reroll, and pause/skip pacing), and **Rules** (click any built-in rule to toggle it on/off; add, edit, validate, toggle, and remove your own DSL rules; an active/inactive summary; the full active DSL; and the DSL reference). Rule toggles and custom rules are stored per-browser (localStorage); rolls apply only the rules toggled active.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/weapons` | — | weapon profile list |
| GET | `/api/options` | — | actions, range bands, aim modes, hit locations |
| GET | `/api/rules` | — | selectable names by category: `qualities[]`, `talents[]`, `traits[]`, `conditions[]`, `circumstances[]`, `configurations[]`, `actions[]` (`statuses[]` kept as a back-compat alias of `conditions[]`) |
| GET | `/api/dsl-docs` | — | full DSL reference (checkpoints, facts, functions, actions) — rendered on the Rules page |
| GET | `/api/rules/source` | — | raw DSL source by category + per-rule list `{id,name,kind,checkpoint,category}` (for the Active DSL panel and built-in toggles) |
| POST | `/api/rules/validate` | `{rules:"<dsl>"}` | `{ok, count, effects[]}` or 400 `{ok:false, message, line, col}` |
| POST | `/api/test` | `{target, modifiers:{any:number}, testName?, talents?, traits?, conditions?, circumstances?, foe?}` | roll, modified target (±60 cap), success, DoS/DoF, pipeline effects (`foe` = the creature the test is about, read by `target.*` rules like Fear) |
| POST | `/api/damage` | `{formula, qualities[], …, customRules?}` | dice detail, modifiers, Righteous Fury + crit effect, total |
| POST | `/api/soak` | `{damage, penetration, armour, toughnessBonus}` | reduction, wounds inflicted |
| POST | `/api/attack` | see below | full resolution (+ rule `log`; `scatter` on a Blast miss) |
| POST | `/api/parry` | `{characteristics:{ws}, weapon:{qualities[]}, customModifier?, customRules?, disabledRules?}` | a Parry (WS) test running PARRY rules (Balanced, Defensive) |
| POST | `/api/resolve` | `{attacker, defender, options:{autoResolveTests}, customRules?, disabledRules?}` | full engagement: attack → Evasion/Field reaction → soak → apply → on-hit target effects |
| POST | `/api/engage` | `{phase:'attack'|'damage'|'evasion'|'onhit', attacker, defender, options, state, …}` | resolve ONE engagement phase (the stepped UI). The client holds `state` and posts it back; re-posting a phase rerolls just it (a Fate Point reroll). Composes to `/api/resolve`. |

### POST /api/attack

```json
{
  "characteristics": { "ws": 35, "bs": 42, "s": 34, "t": 36 },
  "weapon": {
    "name": "Bolt Pistol", "isMelee": false, "damage": "1d10+5",
    "pen": 4, "damageType": "Explosive",
    "rof": { "single": true, "burst": 2, "full": 0 },
    "qualities": ["Tearing"], "sbMultiplier": 0
  },
  "action": "Semi-Auto Burst",
  "aim": "None",
  "rangeBand": "Short Range",
  "customModifier": 0,
  "calledShotLocation": "Head",
  "target": { "armour": 4, "toughnessBonus": 3 },
  "talents": ["Two-Weapon Wielder", "Ambidextrous"],
  "traits": ["Brutal Charge (3)"],
  "conditions": ["Full Aim"],
  "circumstances": ["Darkness"],
  "configs": ["Maximal"],
  "combat": { "dualWielding": true, "firingOffhand": false },
  "customRules": "talent \"Hatred\" { on MODIFIERS when has_talent(\"Hatred\") then add modifier \"hatred\" = 10 }"
}
```

`target` is optional — include it to get per-hit soak and total wounds. `talents`
and `combat` drive the talent rules (e.g. Ambidextrous); `customRules` is DSL text
compiled and merged into the rule set for that request only; `disabledRules` is a list of
built-in rule ids to suppress (e.g. `["tearing"]`). The response includes a `log` array
tracing which rule effects fired.

## Mechanics implemented

- d100 test: modifier sum capped ±60; natural 1 auto-success, 100 auto-failure; DoS = 1 + tens-digit difference (per Foundry `getDegree`).
- Actions: Standard (+10), All Out (+30), Charge (+20), Called Shot (−20), Swift (0), Lightning (−10), Semi-Auto (0), Full Auto (−10).
- Range bands: Point Blank +30, Short +10, Normal 0, Long −10, Extreme −30; aim Half +10 / Full +20 (cancelled on All Out Attack).
- Jam on 97+ (Reliable: only 100); Overheats on 92+.
- Extra hits: semi/Swift = ⌊(DoS−1)/2⌋, full/Lightning = DoS−1, capped at RoF−1; Storm doubles; Twin-Linked +1 at DoS ≥ 2.
- Hit location by reversed attack-roll digits; multi-hit location chains per Table 7-6.
- Damage: Tearing (extra die, keep highest), Righteous Fury on natural 10 (or Vengeful X) with 1d5 crit-effect lookup from the full DH2 critical table (Energy/Explosive/Impact/Rending × location), Proven X (die minimum), Primitive X (die cap), Accurate (requires the Aim action: +10 to hit, and +1d10 damage at DoS 3+, +2d10 at DoS 5+), melee +SB (×2 supported), Razor Sharp, Melta.
- Soak: wounds = damage − (max(0, armour − pen) + TB).
- Parry (`/api/parry`): WS test with Balanced (+10) / Defensive (+15) qualities (Defensive also −10 to attacks).
- Jam is a DSL mechanic: a ranged weapon jams on a roll > `jam_threshold` (default 96). Reliable → only 100; Unreliable → 91+; craftsmanship adjusts it (`set jam_threshold`).
- Weapon craftsmanship (`weapon.craftsmanship`): melee Poor −10 / Good +5 / Best +10 to WS (attacks & parries), Best +1 damage; ranged Poor jams 91+, Good only on 100, Best never jams or overheats.
- Razor Sharp doubles penetration at DoS ≥ 3 on any attack (melee or ranged).
- On-hit target effects (`ON_HIT`): Concussive(X) → target Toughness test at −10×X (fail = Stunned 1/DoF; Prone if damage > target SB); Crippling(X) → Crippled on ≥1 wound. With `autoResolveTests: true` and a target's characteristics, the engine rolls the tests; otherwise it surfaces them for the GM. Pass `target: { …, toughness, strength }`.
- Felling (X) (p.145): reduces the target's **Unnatural Toughness** bonus by X for the damage calc only — never the base Toughness Bonus. The defender carries `unnaturalToughness` (added to TB when soaking; a UI field on the defender); Felling runs at `PENETRATION` via `reduce_unnatural_toughness <expr>`. `target_unnatural_toughness` exposes it to rules.
- **Unnatural Characteristic (X)** (p.139): (1) X adds to that characteristic's **bonus**; (2) a **successful** test using it gains **⌈X/2⌉ bonus degrees of success** (round up, p.18) — the target number is unchanged, and failures gain nothing. Modelled in `rollTest` (which gained an `unnatural` param returning `bonusDos`) and threaded into the to-hit (attacker WS/BS), Parry & Dodge (defender WS/Ag), while attacker **Unnatural Strength** folds into the melee damage Strength Bonus and **Unnatural Toughness** is the existing soak field. Supplied as `unnatural:{ws,bs,s}` (attacker) / `unnatural:{ws,ag}` (defender); the Roll UI exposes the loop-relevant ones (d100 Test box, attacker WS/BS/S, defender WS/Ag). No DSL grammar change — it surfaces through the existing `sb`/`tb` facts. (Target on-hit resist tests, e.g. Concussive, do not yet apply the DoS bonus — a documented limitation.)
- Flame (p.145) + On Fire (p.243): a Flame hit forces an **Agility test or catch fire** — `require_test "Agility" 0 "…" => apply_status "On Fire"` (the `=>` on-fail follow-up now applies a Condition as well as rolling a roll_table). On Fire is a Condition (a burning attacker also takes −10 to its own attacks). RAW Flame is a no-BS area attack; that targeting is out of scope, the test/effect are modelled.
- Overheats (p.146) **overrides Jam**: an Overheats weapon overheats instead of jamming. Generic `suppress "Rule Name"` action — Overheats (POST_ROLL priority 10) suppresses the baseline `Jam` mechanic (priority 50); `runCheckpoint` skips any effect whose name is suppressed.
- Flexible (p.145): an attack from a Flexible weapon **cannot be Parried** — the `prevent_parry` action flags the attack and the engagement's evasion phase **refuses a Parry reaction and notes it** ("Parry — PREVENTED …"). Safeguard works in both the atomic `/api/resolve` and the stepped `/api/engage` flows.
- Graviton (p.146): on a hit, **+damage equal to the target's Armour** at the struck location (effectively negating armour) — `add modifier "graviton" = target_armour`, with the defender's AP threaded into the damage step. The vehicle interaction (facing armour + Motive Systems crits) is deferred — see [POTENTIAL_FEATURES.md](POTENTIAL_FEATURES.md).
- Inaccurate (p.146): the weapon gains **no benefit from the Aim action** — a MODIFIERS rule at canceller priority (`cancel modifier "aim"`) strips the aim bonus after it is applied.
- Lance (p.147): variable penetration — **+base penetration once per degree of success** (`set pen += pen * dos`), e.g. base pen 5 at 3 DoS → +15 → total 20.
- Shocking (p.148): a hit that inflicts **≥1 wound** forces a Toughness test (Challenging) → **Stunned** on a fail (`require_test "Toughness" 0 … => apply_status "Stunned"`, gated on `wounds > 0`; the Fatigue level is descriptive).
- Snare (X) (p.148): on a hit, an **Agility test at −10×X** or the target is **Immobilised** (Helpless until it escapes).
- Scatter (p.148) — the weapon **quality** (distinct from the scatter game mechanic / Scatter Diagram used by Blast on a miss): **+10 to hit & +3 damage** at Point Blank, **+10 to hit** at Short Range, **−3 damage** at any longer range. (Damage rules now read `range` — the damage step carries the weapon's `rangeBand`.)
- Sanctified (p.148): the weapon's **damage counts as Holy** — `set damage_type = "Holy"` (a new action surfacing the overridden type on the result). Its concrete interaction: against a target with the **Daemonic** trait, the Holy attack **negates the target's Unnatural Toughness** (RAW p.135, reusing Felling's reduction) — keyed off the new `target_has_trait("…")` function (the defender's `traits[]` are threaded into the to-hit/PENETRATION context, so it works in both `/api/resolve` and stepped `/api/engage`). Daemonic / From Beyond as first-class traits, and Force/psychic negation, are planned — see [POTENTIAL_FEATURES.md](POTENTIAL_FEATURES.md).
- Toxic (X) (p.150): a wounding hit poisons the target — it gains the **Toxified** condition (severity X). Toxified is a documented **shell** (the recurring end-of-turn Toughness-test-or-1d10-damage needs a turn loop this tool lacks; planned).
- Unbalanced (p.150): **−10 to Parry** (`PARRY` modifier) and a note that it cannot make Lightning Attack actions.
- Unwieldy (p.150): the weapon **cannot Parry** — a `cannot_parry` action makes `resolveParry` refuse the reaction (returns `prevented` with a note, no roll); the engagement evades nothing. Also notes it cannot make Lightning Attack actions.
- Power Field (p.148): on a **successful Parry** against a weapon that **lacks** Power Field (and is not Force/Warp/Natural), rolls 1d100 on the **Power Field Destruction** table — **26+ destroys the attacker's weapon**. Implemented via a new **`POST_PARRY`** checkpoint (fires once the parry's success is known) and the **`opposing_has_quality("…")`** fact (the attacker's weapon is threaded into the parry as `against`); `opposing_present` guards the bare `/api/parry` test so it doesn't fire without an attacker. Verified atomic & stepped.
- **Conflicting-quality system** ("which quality wins"): opposed qualities are **not** collapsed onto a single numeric severity axis (they are asymmetric — different checkpoints, different side-effects). Each quality is its own rule; same-field clashes resolve by checkpoint **priority** and, for outright overrides, the `suppress "Name"` action (Overheats → Jam). A weapon carrying **mutually-exclusive** qualities (Accurate/Inaccurate, Reliable/Unreliable, Balanced/Unbalanced/Unwieldy) is a data error, surfaced as a **"Quality conflict" warning** (native check in `lib/rules/quality-conflicts.mjs`, registered into every registry) rather than silently double-applied.
- Darkness (p.229) — a Circumstance: **WS −20** melee, **BS −30** ranged.
- Haywire Field (p.146) — an environmental **Circumstance with a severity** (1–5 = Insignificant…Prolonged Dead Zone). Modelled as **one** circumstance whose severity thresholds the penalty (2 → −10, 3 → −20, 4–5 → −60), not five separate ones — RAW the field "lessens one step per round", so a degrading severity fits. Powered ranged attacks (non-Primitive) take the penalty; read via `circumstance_severity()`. Supply as `circumstances: [{name:"Haywire Field", severity:N}]`.
- Recharge (p.146): a weapon that must recharge between shots — a quality that emits a note. Firing on **Maximal** grants it dynamically via `add_quality "Recharge"`. (The Maximal config no longer emits two `Maximal`-named effects — the Blast bump now shows as `Blast ↑`, so the log doesn't read as a repeat.)
- Corrosive (p.145): each hit corrodes the struck location's armour via the `corrode <expr>` action (default `1d10`). The loss is permanent and **cumulative per location** (later hits in the attack soak against the reduced AP), and any amount beyond the current AP — or all of it if unarmoured — is dealt as wounds **ignoring Toughness**. The report shows the new AP (`armour 3 → 1`) so it can be carried to the next encounter; the `target_armour` fact exposes the current AP to other rules. Tech-Use repair is GM bookkeeping (out of scope).
- Engagement (`/api/resolve`): attacker vs. defender, resolved as a checklist — ① to-hit → ② defender reaction (Evasion `dodge`/`parry`, or a Force Field that absorbs on a roll ≤ rating and overloads on a low roll) → ③ soak → ④ apply → ⑤ on-hit target effects. A successful Dodge negates 1 + ⌊DoS/2⌋ hits; Parry negates one.
- Stepped engagement (`/api/engage`): the engine is decomposed into four independently re-rollable phases (attack → damage → evasion → on-hit), each rolling its own dice. The Roll UI drives them one at a time, pausing between phases by default so you can inspect or **reroll** a single phase (a Fate Point reroll). The "skip pause after …" boxes auto-advance past a given pause. Composing all four over one rng stream reproduces `/api/resolve` exactly.
- Debug **force rolls**: `/api/resolve` and `/api/engage` accept `forcedRolls` (a sparse array of die *faces* by roll index) and return a `rollTrace` describing every `dN` roll made, in order, with a label (`to-hit`, `damage die 1`, `dodge (Ag)`, `force field`, `Toughness test`, `corrode`, `scatter direction`, …). The Roll UI surfaces this as an editable field per roll under each phase — blank = random, type a face and reroll the phase to pin it. Backed by `rollScript()` (a recording/scripting rng); leaving `forcedRolls` unset is fully random, so normal play is unaffected.
- Active-rules panel (Roll UI, per side): the attacker and defender each get a **dynamic toggle panel** enumerating the rule set's Talents, Traits, Circumstances, and Conditions (from `/api/rules`). Each row is a checkbox, plus a numeric value box **only when the rule takes a severity/level variable** — computed by `valuedNames()` (a rule that reads `trait_level`/`quality_level`/`circumstance_severity`/`condition_severity` for its own name, surfaced as `valued` in `/api/rules`). So Brutal Charge (X) and Haywire Field get a value box; boolean rules (On Fire, Darkness, Ambidextrous) are toggle-only. The **toggle decides whether the rule is sent in the API call** (and so whether it can fire and appear in the report), and the value sets a level (talents/traits → `Name (X)`, e.g. `Brutal Charge (3)`) or a severity (circumstances/conditions → `{name, severity}`). **Talents & Traits default ON**; Circumstances & Conditions default OFF. Weapon Configurations remain the weapon-gated firing-mode toggles (e.g. Maximal). Unnatural Characteristics are the per-characteristic "Unnatural" inputs.
- Report controls (Roll UI, below "Resolve Engagement"): a **debug** toggle (default off) reveals the force-roll fields and the reroll buttons — with it off the report reads as plain results. A **verbose** toggle (default on) shows every die, modifier, and source; off collapses to totals only (`roll R vs T — HIT`, `dmg N`, wounds), hiding comments. At the end, **reroll whole attack** re-runs the entire engagement (hit → damage → evasion → soak/on-hit) — a full Fate-Point reroll, not just the last phase — by replaying the four `/api/engage` phases from the attack roll.
- On-hit Conditions (e.g. Prone, Crippled) carry the rule, the reason they applied, and optional **structured variables** — `apply_status "name" [value <expr>] [duration <expr>] [location <expr>] [, "reason"]` (value = severity, duration in rounds, location = hit location). Crippling(X) applies Crippled with `value` X bound to the struck `location` — e.g. `Crippled (severity 4, @ Right Leg)`. Conditions supplied as input may be structured objects `{name, severity, duration, location}`, read via `condition_severity/_duration/_location()`. Concussive's Toughness test and any other defender test show the roll vs. the threshold; Crippling/Prone are automatic (no defender test) per RAW, so they display the trigger reason rather than a roll.
- Blast (X): on a miss, scatters per p.230 — base distance **1d5 m** (set first), with a 1d10 direction on the Scatter Diagram; the distance is then DSL-alterable (increase or decrease) via `set scatter += …` (min 0). Blast also **`detonate`s**: it resolves its damage at the scatter point even though the shot missed (it can catch other targets in the area), so a Blast weapon always rolls damage — except on a **jam**, where the rule gates itself out (`roll <= jam_threshold`) because a jammed weapon never fired. `detonate` is a general DSL action: pair it with `set scatter` on any scattering weapon.
- Talents (DSL, activation-gated): Two-Weapon Wielder (−20 dual-wield), Ambidextrous (cancels off-hand −20; with Two-Weapon Wielder reduces dual-wield penalty to −10). Pass `talents: ["…"]` and `combat: { dualWielding | firingOffhand }` to `/api/attack`.
- Rule taxonomy — nine player-facing categories (the DSL `kind`; `KIND_GROUP` maps kind → category; Foundry targets in [FOUNDRY_MIGRATION.md](FOUNDRY_MIGRATION.md)). **Talents and Traits are distinct categories** (a `talent` is XP-bought; a `trait` is innate DH2.0) — kept separate in the taxonomy, the `/api/rules/source` view, and the Roll UI:
  1. **Weapon qualities** — `quality` (`has_quality`), attached to weapons.
  2. **Talents** — `talent` (XP-bought, `has_talent`, `talents[]`); authored in `talents.dsl`.
  3. **Traits** — `trait` (innate DH2.0, `has_trait`, `traits[]`); authored in `traits.dsl`.
  4. **Circumstances** — `circumstance` (`has_circumstance`, `circumstances[]`): environmental modifiers (e.g. Darkness, the Haywire Field); entries may be structured `{name, severity}` (`circumstance_severity()`); toggleable now, map-aware later.
  5. **Conditions** — `condition` (`has_condition`, `conditions[]`): active states (Stunned, On Fire, Prone, Crippled, Aiming) with optional severity/duration/location. (Was `status`; `has_status`/`statuses[]` are aliases.)
  6. **Actions** — `action "Name" { type Half|Full|Reaction|Free [attack] [subtype <name>] }` declarations, compiled at load; hooked via `is_action()`/`action_type`/`is_reaction()` and **subtypes** (`is_attack`, `action_subtype("…")` — `attack` is the key subtype).
  7. **Configurations** — `configuration` (`configuration()`/`firing_mode` alias, `configs[]`): per-character toggles (Maximal, Off-Hand grip, dual-wield).
  8. **Mechanical** — `mechanic`: weapon mechanics & craftsmanship (Jam, Overheats, craftsmanship tiers).
  9. **Miscellaneous** — `miscellaneous` (catch-all; `generic`/`rule` are aliases).

  Roll tables (`roll_table` + `roll_on`) are a DSL construct invoked *by* rules, not a player-facing category (they are not in `KIND_GROUP`) — documented below.
  Aliases normalise in the parser: `status`→`condition`, `generic`/`rule`→`miscellaneous`. Pass `traits[]`, `conditions[]`, `circumstances[]`, `configs[]` to `/api/attack` & `/api/resolve`.
- **Provenance (Roadmap Phase 0 / Stage 0):** every built-in rule file opens with a `dsl 2` pragma and a `package "dh2.core.…" { system "dh2" source "…" }` header; rules carry `meta { page N }` (verified against `_pdf_text/dh19_core.txt` footer markers). Compiled effects expose `page`/`package`/`system`/`sourceBook` and a stable `qualifiedId` (`pkg/rule-id` — the Stage-5 layering key); `/api/rules/source` and the Rules page surface them (page cites on the toggle chips, package + book on each Active-DSL subcategory).
- **Canonical levels (Stage 1):** qualities/talents/traits are `{ name, level }` objects internally — strings like `"Proven (3)"`/`"Vengeful 9"` are parsed once at the API boundary (`canonList` in `lib/rules/_util.mjs`); both forms are accepted as input everywhere, and `bump_quality`/`add_quality` now produce objects (1:1 with Foundry `attackSpecial` items).
- **Scoped facts (Phase 1 / Stage 2):** predicates may read through scope paths — `target.tb`, `weapon.pen`, `opposing_weapon.has_quality("Force")` — with the unscoped name meaning the attacker. The whole vocabulary (facts + functions, with types, scopes, and doc strings) is defined ONCE in `lib/dsl/vocabulary.mjs`; the interpreter whitelists **and** the DSL reference derive from it, so they cannot drift. Legacy prefixed names (`target_sb`, `opposing_has_quality`, …) remain as aliases. Scope×name validity is checked at compile time. The `target` block is now threaded into the damage checkpoints too (so `target.*` works at `DAMAGE_MODS`, not just `ON_HIT`).
- **Slots / flags / declarations (Phase 1 / Stage 3):** the `then` side now rests on three primitives — `set <slot> (=|+=) <expr>` over a registered slot table (pen, jam_threshold, rf_threshold, scatter, damage_type, extra_dice, extra_hits, unnatural_toughness_reduction), `flag <name>` over a flag table (no_parry, cannot_parry, detonate, attack_failed, keep_highest), and `declare test|status|table_roll|armour_damage|event …`. All v1 verbs (`set pen +=`, `add_die`, `prevent_parry`, `fail`, `corrode`, …) parse to these — **adding a new engine knob is now a data entry in `vocabulary.mjs`, not parser/interpreter edits**. Slot modes are validated at compile time (`set jam_threshold += …` is rejected). Expression `/` is integer division rounding **up** (DH2 p.18); `ceil()`/`floor()`/`half()` are available (`half(n)` = round-up half).
- **Character schema v1 + importers (Phase 2):** the canonical, versioned character document ([api/lib/character-schema.mjs](api/lib/character-schema.mjs)) — nine characteristics, `unnatural`, per-location armour, wounds/fate, the four rule lists, weapons, force field, `schemaVersion` + migrations. Single-sourced: the FIELDS table drives `validateCharacter` (field-level errors), `GET /api/character/schema` (reference + template), and `characterToCombatant` (THE schema→engine mapping, shared by the Roll UI, tests, and the Foundry importer). `POST /api/character/validate` migrates + validates + previews the combatant. **Adapters** in [tools/](tools/): `google-sheets.mjs` (key/value CSV template — [tools/templates/google-sheet-template.csv](tools/templates/google-sheet-template.csv)) and `roll20.mjs` (attribute-JSON, candidate-driven mapping + repeating sections), driven by `node tools/import-character.mjs <file> [--adapter=…] [--out=…]`. The Roll page gains **Character import/export** (load JSON → attacker/defender panels incl. rule toggles with levels; export panels → JSON); the Foundry module gains `game.dh2vm.importCharacter(json)` (canonical JSON → acolyte Actor with embedded weapon/talent/trait Items).
- **EncounterState + upkeep pipeline (Phase 4):** a serialisable encounter document ([api/lib/encounter.mjs](api/lib/encounter.mjs)) carries mutable state ACROSS engagements and turns — the five state-blocked features are now real: **Corrosive AP loss persists** (per-location `armourDamage` seeds later soaks), **applied conditions persist** (a defender set On Fire attacks at −10 next engagement), **Recharge** sets a cooldown on firing (warning effect if you fire while recharging) and clears at turn end, **On Fire burns 1d10 at turn start** (DSL: `declare damage 1d10, "…"` on `upkeep.TURN_START`), **Toxified tests Toughness at turn end** with the 1d10 rolled only on failure (`require_test … => damage 1d10`), and **durations expire / Haywire-style severities `decay`** at round end (engine mechanism). Opt-in: pass `encounter` + `attackerKey`/`defenderKey` to `/api/resolve`//`/api/engage` (returns the updated document); `POST /api/encounter/tick` runs a phase (`TURN_START|TURN_END|ROUND_END`) and returns `{encounter, events}`. The Roll page gains an **Encounter Tracker** (enable → state persists in localStorage, tick buttons, event log); the Foundry module gains the **ActiveEffect mirror** (`syncEncounterToActor`/`readEncounterFromActor` — duration→AE rounds, severity/location/decay→flags) with a round-trip parity check in the join smoke.
- **Attack-loop content sweep (Phase 5):** the last four DH2 weapon qualities and an attack-relevant talent/trait tranche, all RAW-cited. **Force** (p.145, static half): +psy rating damage & pen and Energy type in a psyker's hands (`psyRating` input / `psy_rating`/`is_psyker` facts; the Focus Power rider is Phase 6). **Indirect** (p.147): −10 to hit, every hit lands `1d10 − BSB` metres off (`declare scatter_hit`, clamped ≥ 0, Scatter Diagram direction), misses scatter X d10. **Smoke** (p.149): `declare smoke <radius> duration 1d10+10` on hit or at the miss scatter point — composes with Blast (one scatter, both payloads). **Spray** (p.149): no attack roll (auto-hit, always Body, Called Shot ignored), targets roll Agility with the generic **`avoids_hit`** flavor of `require_test` (a pass voids the hit's wounds), natural 9 on a damage die jams. **Talents** (talents.dsl): Marksman cancels the Long/Extreme range penalty, Precision Killer removes the Called-Shot −20 (specialised or bare entries), Mighty Shot/Crushing Blow add `half(bs_bonus)`/`half(ws_bonus)` damage, Two-Weapon Master erases the dual-wield penalty, Hatred (+10 WS vs a "Hated Foe"-flagged engagement), Iron Jaw & Die Hard as upkeep policy (Die Hard `suppress`es the Blood Loss Fatigue and rolls Willpower instead). **Traits** (traits.dsl): Auto-Stabilised cancels the new Unbraced circumstance (−30, p.219), Fear rolls its rating penalty in the `test.*` pipeline against the new `foe` input on `/api/test`, From Beyond surfaces its immunity, Sturdy +20 vs Grapple/Knock Down/Takedown, Regeneration ticks a Toughness test each TURN_START. Encounter actors now carry `stats.talents`/`stats.traits` so upkeep rules can gate on them; the Rules page gained a **search/filter bar** (text, category, active/inactive/replaced state) over the built-in rule browser.
- **dsl 3 — v1 support removed (pre-Phase-4 cleanup):** the DSL now runs entirely on the refactored surface. Removed: the prefixed alias facts/functions (`target_sb`, `target_armour`, `opposing_present`, `target_has_trait`, `opposing_has_quality`, …— use scoped paths `target.armour`, `opposing_weapon.present`), the `has_status`/`firing_mode` aliases, the kind aliases (`status`/`generic`/`rule`), and the thin sugar verbs (`add_die`, `keep_highest`, `add_hits`, `fail`, `prevent_parry`, `cannot_parry`, `detonate`, `reduce_unnatural_toughness` — use `set <slot>` / `flag <name>`). Kept by design: bare checkpoints (= the `attack` namespace), the rich verbs (`require_test`/`apply_status`/`roll_on`/`corrode`/`emit`/`bump_quality`), `suppress` (runtime conditional override — distinct from static `replaces`), and string-level input canonicalization. An explicit `dsl 1`/`dsl 2` pragma is rejected with a pointer to **`node tools/migrate-dsl.mjs <file> --write`** (comment/string-safe codemod; `--all` migrated the built-ins).
- **Pipelines + rule layers (Phase 3):** checkpoints are namespaced by **pipeline** — bare ids are the default `attack` pipeline; the **`test.*` pipeline** (`test.MODIFIERS`, `test.POST_ROLL`) backs `/api/test`, so generic characteristic/skill tests run rule effects gated on the new `test_name` fact plus talents/conditions/circumstances (the d100 box gained Test-name and Talents/Conditions inputs and reports pipeline effects). **Layered overrides:** a user/campaign rule with `replaces "dh2.core.mechanics/jam"` (qualifiedId or bare rule id) statically drops the named core rule — the id-based successor to the runtime `suppress` (kept for same-layer overrides). The Rules page strikes through replaced built-ins with a "⇐ replaced by" note.
- **Pack export v1 (Phase 3 / Lane C):** `npm run export:packs` generates Foundry compendia **from the DSL source** — `roll_table` declarations → native **RollTable** documents, weapon-quality rules → **`attackSpecial` Items** (with `hasLevel` from the valued-names analysis and package · book · page provenance in the description) — written as source JSON under `foundry/dh2-roll-vm/packs-src/` and compiled to **v12+ LevelDB** via `@foundryvtt/foundryvtt-cli` (no legacy NeDB), with deterministic name-hashed ids for stable diffs. `deploy:foundry` ships them; the join smoke asserts both packs load and Corrosive carries its p.145 cite.
- **Foundry walking skeleton (Phase 1 / Lane C):** `npm run build:foundry` bundles the whole VM as a Foundry esmodule into [foundry/dh2-roll-vm/](foundry/dh2-roll-vm/); **`npm run deploy:foundry`** builds + copies it into the live install (`<FOUNDRY_DATA>/Data/modules/dh2-roll-vm`, default the local FoundryVTT path). Dual-target: **`dark-heresy-3rd-edition` (Foundry v14, primary)** + `dark-heresy-2nd` (v12, compat). Exposes `game.dh2vm` (VM + `importCharacter` + `mapActor`) and the `/dh2attack` chat command. Validation: headless smoke in CI, plus the **Playwright join smoke** `node tools/foundry-test/test-dh2vm-smoke.mjs` against a running Foundry test world (pattern borrowed from the system's own v14 validation harness). Findings land in [FOUNDRY_MIGRATION.md](FOUNDRY_MIGRATION.md).
- **Roll tables** (`roll_table` + `roll_on`): a roll_table names a die and `<lo>[-<hi>]: "outcome" [=> "Status", …]` rows; a rule invokes one with `roll_on "Table" [+ <expr>]` (the engine rolls, finds the row, applies any statuses). Built-ins (data, p.145/146/230): **Scatter Diagram** (Blast's miss direction), **Haywire Field Effects**, **Hallucinogenic Effects** (rolled via `require_test … => roll_on` only when the Toughness test fails). The table die is labelled, so it shows in the force-roll trace.
- **Action-aware predicates**: the `action` fact is set in every flow (including the **Parry** and **Dodge** reactions); `action_type` ("Half"/"Full"/"Reaction"/"Free"), `is_action("Parry")`, `is_reaction()`, and **action subtypes** (`is_attack`, `action_subtype("…")`) let `when` blocks gate on the action. Actions carry subtype designations (`attack` is the key one, referenced by many rules) — e.g. Defensive's −10 applies only `when is_attack` (`quality "Defensive" { on MODIFIERS when has_quality("Defensive") and is_attack then add modifier "defensive" = -10 }`), while its +15 is `on PARRY`.
- **Configurations** (`configuration("…")` / `firing_mode` alias + `configs[]`): per-character toggles that rewrite the profile, distinct from an Action. **Maximal** (p.146) toggles +1d10 damage, +2 Pen, and `bump_quality "Blast" by 2`; its +10 m range / ×3 ammo / Recharge are surfaced as a note (range-in-metres and ammo tracking are deferred — see [POTENTIAL_FEATURES.md](POTENTIAL_FEATURES.md)). The Roll UI offers a Configurations toggle for each one the weapon enables (`/api/options` → `firingModes`, `/api/rules` → `configurations`).

## Project layout

The backend (API logic) and frontend (UI/interface logic) live in two parallel
directories:

```
dh2_roll_api/
  api/                 ← API: Express server, roll engine, rules, DSL, tests
    server.mjs  lib/  data/  test/
  ui/                  ← UI: static front-end (no build step)
    index.html  roll.html  rules.html  style.css  rules-store.js
  package.json  .gitignore  README.md
```

The server (`api/server.mjs`) serves the static UI from the sibling `ui/` directory.

## Static / GitHub Pages build

The whole tool runs **server-free in the browser** — GitHub Pages serves only static
files, and this backend is a pure-function library over static data (no DB, no secrets,
no persistence; custom rules already live in `localStorage`). `npm run build:static`
produces a deployable `./docs` folder.

**How it works.** The route behaviour is defined once in `api/lib/api-router.mjs`
(`dispatch(method, path, body) → { status, body }`), shared verbatim by two transports —
so they cannot drift:

- **Dev:** `api/server.mjs` (Express) wraps each route around `dispatch`.
- **Static:** `api/lib/pages-api.mjs` patches `window.fetch` so every `/api/*` request is
  answered in-process by `dispatch`. The front-end is unchanged — it still calls
  `fetch('/api/resolve', …)`, but there is no server.

The build (`scripts/build-static.mjs`):

1. **Inlines the data.** The on-disk rule (`.dsl`) and weapon (`.json`) files are loaded
   only through `api/lib/rules/sources.mjs` (the one place that touches `fs`). The build
   generates an inlined twin and esbuild aliases `sources.mjs` → it, so the bundle carries
   the data with no filesystem.
2. **Bundles** `pages-api.mjs` (engine + DSL + data + fetch patch) into `docs/dh2-engine.js`
   — a single classic IIFE (~230 KB).
3. **Copies** the UI into `docs/`, injecting `<script src="dh2-engine.js">` as the first
   element in `<head>` so the `fetch` patch is installed **before** the page's app script
   runs (the app's scripts are classic and call the API at load).
4. Emits `.nojekyll` so Pages serves files verbatim.

**Preview locally** exactly as Pages would (a plain static server, no API backend):
`npm run serve:static` → http://localhost:8080. A request to `/api/*` on that server 404s —
proving the API exists only in the browser bundle.

**Deploy** — two options:

- **GitHub Actions** (recommended): the included `.github/workflows/pages.yml` runs the
  tests, `npm run build:static`, and publishes `docs/` to Pages on every push to `main`.
  Set *Settings → Pages → Source = GitHub Actions*. `docs/` need not be committed.
- **Branch folder:** commit `docs/` and set *Settings → Pages → Source = Deploy from a
  branch → main / docs*.

Because Pages serves under `https://<user>.github.io/<repo>/`, all asset/link paths are
**relative** (they already are). The Express server and the test suite are untouched —
local dev and CI still use the real server; only the published artifact is static.

## Architecture

The roll logic (under `api/`) is split into three layers joined by a **checkpoint
pipeline**: an **engine** (pure mechanism), a **rules layer** (interpretation), and a
**DSL** (rules-as-text). The engine never references any specific trait/talent/quality
by name: at fixed checkpoints it runs whatever effects a `Registry` holds, so the rule
set can be swapped without touching the engine.

> **Forward plan:** [ROADMAP.md](ROADMAP.md) — the unified refactor/build/migration
> plan: eight phases, each landing an Engine/DSL stage, a **deployed GitHub Pages
> increment**, and a **gradual Foundry increment** (skeleton → importer → packs →
> ActiveEffect mirror → distributable module). Architecture rationale and the
> **DSL v2 schema** behind it: [DSL_ARCHITECTURE.md](DSL_ARCHITECTURE.md)
> (slots/flags/declarations, scoped facts, named pipelines, per-system policy
> objects, packages/layers, EncounterState↔ActiveEffect mirror).

```
api/lib (engine + rules + dsl)                                       api/data (rule content)
  dice.mjs        d100/damage math   rules/combat-actions.mjs native   data/weapons.json
  hit-locations.mjs  location tables rules/index.mjs  assembles reg     data/rules/weapon-qualities.dsl
  pipeline.mjs    checkpoints+Registry rules/_util.mjs quality parsing  data/rules/talents.dsl
  context.mjs     RollContext + log  dsl/{tokenizer,parser}.mjs → AST   data/rules/{traits,conditions}.dsl
  engine.mjs      orchestrates flow  dsl/{interpreter,compiler}.mjs     data/rules/{circumstances,configurations}.dsl
  actions.mjs     Actions taxonomy   rules/index.mjs registers actions  data/rules/{mechanics,actions,roll-tables}.dsl
```

Checkpoints (see `api/lib/pipeline.mjs`): `MODIFIERS`, `POST_ROLL`, `ON_MISS`, `HIT_COUNT_MULT`,
`HIT_COUNT_BONUS`, `PENETRATION`, `DAMAGE_POOL`, `DIE_ADJUST`, `DAMAGE_MODS`, `ON_HIT`, `PARRY`, `POST_PARRY`, `EVASION`. An effect is
`{ id, source, checkpoint, priority?, when?(ctx), apply(ctx) }` — `when` is the activation
predicate ("is this rule in effect right now?"), `apply` mutates the shared `RollContext`.
A DSL rule may have several `when … then …` **branches**, each compiling to its own effect
(e.g. Accurate adds one die at DoS≥3 and a second only at DoS≥5); branches share a `ruleId`
so one toggle controls them all.

### Trait DSL

Rule interpretations can be authored as text and compiled to effects. The built-in
weapon qualities are themselves authored this way in `api/data/rules/weapon-qualities.dsl`
(compiled at load time), which dogfoods the language. Pipeline: `tokenize → parse →
compile`. Predicates/expressions are evaluated over a **whitelisted** fact + function
table (`api/lib/dsl/interpreter.mjs`) — no `eval`/`Function` — so user-supplied rules are
safe to interpret. See `api/lib/dsl/grammar.md` for syntax. A rule may have several
`when … then …` branches. Example:

```
talent "Ambidextrous" tier 1 {
  on MODIFIERS
  priority 100
  when has_talent("Ambidextrous") and firing_offhand and not dual_wielding
    then cancel modifier "off_hand"
  when has_talent("Ambidextrous") and has_talent("Two-Weapon Wielder") and dual_wielding
    then set modifier "two_weapon" = -10
}
```

## Files

### `api/` — backend
- `api/server.mjs` — Express server (no deps beyond express); thin HTTP transport over `dispatch`; exports `app` for tests, listens only when run directly; serves the `ui/` static front-end
- `api/lib/api-router.mjs` — **transport-agnostic** `dispatch(method, path, body)` — the single source of truth for every `/api/*` endpoint, shared by the Express server and the static browser build
- `api/lib/pages-api.mjs` — static-build entry: patches `window.fetch` to answer `/api/*` from `dispatch` in-process (bundled into the GitHub Pages site)
- `api/lib/rules/sources.mjs` — the only filesystem touch: loads the `.dsl` rule files + `weapons.json`. The static build swaps in a generated inlined twin (esbuild alias) so the bundle carries the data with no `fs`.
- `api/lib/engine.mjs` — orchestrator + pure d100/damage/soak math; injectable RNG and registry (fully unit-testable). Re-exports the public surface.
- `api/lib/dice.mjs`, `api/lib/hit-locations.mjs` — pure primitives + DH2 location tables
- `api/lib/pipeline.mjs` — checkpoint constants, `Registry`, and the `runCheckpoint` runner (no rule content)
- `api/lib/context.mjs` — `RollContext` (shared state + audit `log`)
- `api/lib/rules/` — rule interpretations: `combat-actions.mjs` (native effects), `_util.mjs` (quality parsing), assembled by `index.mjs`
- `api/lib/actions.mjs` — the combat Actions taxonomy (type + subtypes like `attack`), populated from `actions.dsl` at load and read by `is_action`/`action_type`/`is_reaction`/`is_attack`/`action_subtype`
- `api/lib/dsl/` — trait DSL: `grammar.md` (spec), `tokenizer.mjs`, `parser.mjs` (→ AST + roll_table/action declarations), `interpreter.mjs` (whitelisted facts/actions), `compiler.mjs` (→ Effect/Table/Action), `docs.mjs` (reference metadata served at `/api/dsl-docs`)
- `api/data/rules/*.dsl` — rule content authored in the DSL, compiled into the default registry: `weapon-qualities.dsl`, `talents.dsl`, `traits.dsl` (DH2.0 traits), `conditions.dsl`, `circumstances.dsl`, `configurations.dsl` (Maximal), `mechanics.dsl` (Jam + craftsmanship), `actions.dsl` (the Actions taxonomy), `roll-tables.dsl` (Scatter/Haywire/Hallucinogenic)
- `api/lib/critical-damage.mjs` — crit table copied verbatim from the Foundry system
- `api/data/weapons.json` — generated from the codified DH2 corpus (provenance preserved per entry)

### `ui/` — frontend
- `ui/` — multi-page UI: `index.html` (home/nav), `roll.html` (roller), `rules.html` (rule manager), `style.css` (shared), `rules-store.js` (localStorage rule store + server validation, shared by the roll & rules pages)

### `scripts/` — static build (GitHub Pages)
- `scripts/build-static.mjs` — `npm run build:static`: inlines the data, esbuild-bundles the engine + fetch shim into `docs/dh2-engine.js`, assembles `docs/` (see "Static / GitHub Pages build")
- `scripts/serve-static.mjs` — `npm run serve:static`: zero-dependency static server for previewing `docs/` with no API backend
- `.github/workflows/pages.yml` — CI: test → build → deploy `docs/` to GitHub Pages on push to `main`

### `api/test/` — Node built-in test runner (`node --test`)
- `engine.test.mjs` — deterministic rigged-dice tests for the roll engine (now exercising DSL-driven qualities)
- `pipeline.test.mjs` — checkpoint runner contract + registry extension (rules change rolls without engine edits)
- `dsl.test.mjs` — tokenizer + parser (text → AST), precedence, multi-branch rules, error reporting
- `dsl-compiler.test.mjs` — compiler + interpreter (AST → Effect), branch-per-effect, predicate/action evaluation, semantic validation
- `dsl-docs.test.mjs` — parity: the DSL reference documents exactly the engine's checkpoints/facts/functions
- `talents.test.mjs` — DSL talents end-to-end (Ambidextrous activation: dual-wield / off-hand gating)
- `categories.test.mjs` — rule kinds & alias normalisation; Condition/Circumstance activation + structured-Condition variables; built-in toggling; Accurate aim-gating
- `dsl-actions.test.mjs` — action-aware predicates (`is_action`/`action_type`/`is_reaction`) and the `action` declaration construct
- `firing-modes.test.mjs` — Configurations: Maximal via `configuration()`/`configs[]`, and `bump_quality`
- `target-effects.test.mjs` — on-hit effects: Concussive/Crippling tests & statuses, Corrosive, Felling, Flame/On Fire (incl. condition duration)
- `quality-extensions.test.mjs` — Overheats-overrides-Jam (suppress), Flexible (prevent_parry), Graviton, Darkness & Haywire-Field circumstances, Off-Hand as a Configuration
- `quality-extensions2.test.mjs` — Inaccurate (cancel aim), Lance (pen×DoS), Shocking, Snare, Scatter (range mods), Sanctified (Holy + Daemonic UT negation, atomic & stepped), Toxic/Toxified, Unbalanced/Unwieldy (parry), Power Field (`POST_PARRY` weapon destruction + Force immunity), Lance+Melta independent base-pen scaling, and the mutually-exclusive quality-conflict detector
- `unnatural.test.mjs` — Unnatural Characteristic (p.139): `rollTest` bonus DoS (⌈X/2⌉, success-only), to-hit WS/BS DoS, Strength → SB, Dodge Ag DoS → more hits evaded; and Talents/Traits as distinct taxonomy categories
- `phase0.test.mjs` — `dsl` pragma / `package` headers / rule `meta` provenance on effects & builtins; canonical `{name, level}` (string/object equivalence, `bump_quality` objects)
- `phase1.test.mjs` — scoped fact paths (`target.*`, `weapon.*`, `opposing_weapon.*`) + aliases; slot/flag/`declare` primitives and verb-sugar equivalence; `ceil`/`floor`/`half` and round-up `/`
- `phase2.test.mjs` — character schema v1 (validation, migration, `characterToCombatant`), `/api/character/*` endpoints, Google-Sheets & Roll20 adapters, cross-adapter engine round-trip
- `phase3.test.mjs` — `test.*` pipeline (test_name gating, Unnatural DoS, POST_ROLL effects, `/api/test` shape), `attack.` namespace normalisation, layered `replaces` overrides
- `phase4.test.mjs` — EncounterState + upkeep: On Fire burn, Toxified end-of-turn test (lazy on-fail damage), duration expiry + Haywire decay, Recharge cooldown lifecycle, Corrosive AP persistence across engagements, condition merge, /api/encounter/tick
- `phase5.test.mjs` — the last four weapon qualities (Force psyker vs mundane, Indirect per-hit scatter + clamp, Smoke hit/miss/Blast-compose, Spray auto-hit / `avoids_hit` / natural-9 jam / Body-only) and the talent/trait tranche (Marksman, Mighty Shot, Crushing Blow, Precision Killer, Two-Weapon Master, Hatred, Auto-Stabilised vs Unbraced, Fear via `foe`, From Beyond, Sturdy; upkeep: Iron Jaw, Die Hard suppressing Blood Loss, Regeneration)
- `roll-tables.test.mjs` — `roll_table` + `roll_on`: Scatter Diagram, Haywire (with field `area`), Hallucinogenic (test-gated)
- `craftsmanship-jam.test.mjs` — Jam mechanic + craftsmanship tiers (melee WS / ranged jam threshold)
- `parry-scatter.test.mjs` — Parry flow (Balanced/Defensive at PARRY) and Blast scatter/detonation on a miss
- `engagement.test.mjs`, `engagement-steps.test.mjs` — full + stepped (`/api/engage`) engagement resolution
- `roll-script.test.mjs` — debug force-rolls: `rollScript` trace + face-forcing
- `critical-damage.test.mjs` — crit-table lookups, fuzzy location mapping, clamping
- `weapons-data.test.mjs` — integrity checks on the 144 weapon profiles
- `server.test.mjs` — HTTP endpoint tests (app booted on an ephemeral port)
- `helpers.mjs` — shared deterministic-RNG utilities (imported, not run as a test)
