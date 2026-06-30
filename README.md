# DH2 Roll API

Minimalist API + HTML front-end for Dark Heresy 2e d100 tests and weapon damage resolution. Mechanics ported from the `dark-heresy-3rd-edition` Foundry VTT system (`module/rolls/*.mjs`, `module/rules/*.mjs`); weapon profiles sourced from `codified-systems/dark_heresy_2e/data/weapons.json` (144 parseable profiles, DH2 core).

## Run

```
npm install
npm start          # http://localhost:3210
npm test           # 177 tests (engine + pipeline + DSL + docs + qualities/talents/traits/conditions/circumstances/configurations/actions/craftsmanship/jam/parry/scatter/roll-tables/target-effects/corrosive/engagement/stepped-engagement/force-rolls + crit table + weapon data + HTTP endpoints)
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
| POST | `/api/test` | `{target, modifiers:{any:number}}` | roll, modified target (±60 cap), success, DoS/DoF |
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
- Report controls (Roll UI, below "Resolve Engagement"): a **debug** toggle (default off) reveals the force-roll fields and the reroll buttons — with it off the report reads as plain results. A **verbose** toggle (default on) shows every die, modifier, and source; off collapses to totals only (`roll R vs T — HIT`, `dmg N`, wounds), hiding comments. At the end, **reroll whole attack** re-runs the entire engagement (hit → damage → evasion → soak/on-hit) — a full Fate-Point reroll, not just the last phase — by replaying the four `/api/engage` phases from the attack roll.
- On-hit Conditions (e.g. Prone, Crippled) carry the rule, the reason they applied, and optional **structured variables** — `apply_status "name" [value <expr>] [duration <expr>] [location <expr>] [, "reason"]` (value = severity, duration in rounds, location = hit location). Crippling(X) applies Crippled with `value` X bound to the struck `location` — e.g. `Crippled (severity 4, @ Right Leg)`. Conditions supplied as input may be structured objects `{name, severity, duration, location}`, read via `condition_severity/_duration/_location()`. Concussive's Toughness test and any other defender test show the roll vs. the threshold; Crippling/Prone are automatic (no defender test) per RAW, so they display the trigger reason rather than a roll.
- Blast (X): on a miss, scatters per p.230 — base distance **1d5 m** (set first), with a 1d10 direction on the Scatter Diagram; the distance is then DSL-alterable (increase or decrease) via `set scatter += …` (min 0). Blast also **`detonate`s**: it resolves its damage at the scatter point even though the shot missed (it can catch other targets in the area), so a Blast weapon always rolls damage — except on a **jam**, where the rule gates itself out (`roll <= jam_threshold`) because a jammed weapon never fired. `detonate` is a general DSL action: pair it with `set scatter` on any scattering weapon.
- Talents (DSL, activation-gated): Two-Weapon Wielder (−20 dual-wield), Ambidextrous (cancels off-hand −20; with Two-Weapon Wielder reduces dual-wield penalty to −10). Pass `talents: ["…"]` and `combat: { dualWielding | firingOffhand }` to `/api/attack`.
- Rule taxonomy — nine player-facing categories (the DSL `kind`; `KIND_GROUP` maps kind → category; Foundry targets in [FOUNDRY_MIGRATION.md](FOUNDRY_MIGRATION.md)):
  1. **Weapon qualities** — `quality` (`has_quality`), attached to weapons.
  2. **Talents & traits** — `talent` (XP-bought, `has_talent`) and `trait` (innate DH2.0, `has_trait`).
  3. **Circumstances** — `circumstance` (`has_circumstance`, `circumstances[]`): environmental modifiers (e.g. Darkness, the Haywire Field); entries may be structured `{name, severity}` (`circumstance_severity()`); toggleable now, map-aware later.
  4. **Conditions** — `condition` (`has_condition`, `conditions[]`): active states (Stunned, On Fire, Prone, Crippled, Aiming) with optional severity/duration/location. (Was `status`; `has_status`/`statuses[]` are aliases.)
  5. **Actions** — `action "Name" { type Half|Full|Reaction|Free [attack] [subtype <name>] }` declarations, compiled at load; hooked via `is_action()`/`action_type`/`is_reaction()` and **subtypes** (`is_attack`, `action_subtype("…")` — `attack` is the key subtype).
  6. **Configurations** — `configuration` (`configuration()`/`firing_mode` alias, `configs[]`): per-character toggles (Maximal, Off-Hand grip, dual-wield).
  7. **Roll tables** — `roll_table` + `roll_on` (see below).
  8. **Mechanical** — `mechanic`: weapon mechanics & craftsmanship (Jam, Overheats, craftsmanship tiers).
  9. **Miscellaneous** — `miscellaneous` (catch-all; `generic`/`rule` are aliases).
  Aliases normalise in the parser: `status`→`condition`, `generic`/`rule`→`miscellaneous`. Pass `traits[]`, `conditions[]`, `circumstances[]`, `configs[]` to `/api/attack` & `/api/resolve`.
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

## Architecture

The roll logic (under `api/`) is split into three layers joined by a **checkpoint
pipeline**: an **engine** (pure mechanism), a **rules layer** (interpretation), and a
**DSL** (rules-as-text). The engine never references any specific trait/talent/quality
by name: at fixed checkpoints it runs whatever effects a `Registry` holds, so the rule
set can be swapped without touching the engine.

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
`HIT_COUNT_BONUS`, `PENETRATION`, `DAMAGE_POOL`, `DIE_ADJUST`, `DAMAGE_MODS`, `ON_HIT`, `PARRY`, `EVASION`. An effect is
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
- `api/server.mjs` — Express server (no deps beyond express); exports `app` for tests, listens only when run directly; serves the `ui/` static front-end
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
- `roll-tables.test.mjs` — `roll_table` + `roll_on`: Scatter Diagram, Haywire (with field `area`), Hallucinogenic (test-gated)
- `craftsmanship-jam.test.mjs` — Jam mechanic + craftsmanship tiers (melee WS / ranged jam threshold)
- `parry-scatter.test.mjs` — Parry flow (Balanced/Defensive at PARRY) and Blast scatter/detonation on a miss
- `engagement.test.mjs`, `engagement-steps.test.mjs` — full + stepped (`/api/engage`) engagement resolution
- `roll-script.test.mjs` — debug force-rolls: `rollScript` trace + face-forcing
- `critical-damage.test.mjs` — crit-table lookups, fuzzy location mapping, clamping
- `weapons-data.test.mjs` — integrity checks on the 144 weapon profiles
- `server.test.mjs` — HTTP endpoint tests (app booted on an ephemeral port)
- `helpers.mjs` — shared deterministic-RNG utilities (imported, not run as a test)
