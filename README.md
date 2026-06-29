# DH2 Roll API

Minimalist API + HTML front-end for Dark Heresy 2e d100 tests and weapon damage resolution. Mechanics ported from the `dark-heresy-3rd-edition` Foundry VTT system (`module/rolls/*.mjs`, `module/rules/*.mjs`); weapon profiles sourced from `codified-systems/dark_heresy_2e/data/weapons.json` (144 parseable profiles, DH2 core).

## Run

```
npm install
npm start          # http://localhost:3210
npm test           # 130 tests (engine + pipeline + DSL + docs + talents/traits/statuses/toggles/branches/parry/scatter + crit table + weapon data + HTTP endpoints)
```

Open http://localhost:3210 for the UI. It has three pages: **Home** (navigation + status), **Roll** (d100 test, raw damage, full attack resolution with weapon dropdown / manual entry, talent/trait/status & dual-wield controls), and **Rules** (click any built-in rule to toggle it on/off; add, edit, validate, toggle, and remove your own DSL rules; an active/inactive summary; the full active DSL; and the DSL reference). Rule toggles and custom rules are stored per-browser (localStorage); rolls apply only the rules toggled active.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/weapons` | — | weapon profile list |
| GET | `/api/options` | — | actions, range bands, aim modes, hit locations |
| GET | `/api/rules` | — | selectable names by category: `talents[]`, `traits[]`, `statuses[]`, `qualities[]` |
| GET | `/api/dsl-docs` | — | full DSL reference (checkpoints, facts, functions, actions) — rendered on the Rules page |
| GET | `/api/rules/source` | — | raw DSL source by category + per-rule list `{id,name,kind,checkpoint,category}` (for the Active DSL panel and built-in toggles) |
| POST | `/api/rules/validate` | `{rules:"<dsl>"}` | `{ok, count, effects[]}` or 400 `{ok:false, message, line, col}` |
| POST | `/api/test` | `{target, modifiers:{any:number}}` | roll, modified target (±60 cap), success, DoS/DoF |
| POST | `/api/damage` | `{formula, qualities[], …, customRules?}` | dice detail, modifiers, Righteous Fury + crit effect, total |
| POST | `/api/soak` | `{damage, penetration, armour, toughnessBonus}` | reduction, wounds inflicted |
| POST | `/api/attack` | see below | full resolution (+ rule `log`; `scatter` on a Blast miss) |
| POST | `/api/parry` | `{characteristics:{ws}, weapon:{qualities[]}, customModifier?, customRules?, disabledRules?}` | a Parry (WS) test running PARRY rules (Balanced, Defensive) |

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
  "statuses": ["Full Aim"],
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
- Blast (X): on a miss, scatters per p.230 — base 1d10 m − BS bonus (min 0) with a 1d10 direction; the scatter-distance modifier is DSL-alterable via `set scatter += …`.
- Talents (DSL, activation-gated): Two-Weapon Wielder (−20 dual-wield), Ambidextrous (cancels off-hand −20; with Two-Weapon Wielder reduces dual-wield penalty to −10). Pass `talents: ["…"]` and `combat: { dualWielding | firingOffhand }` to `/api/attack`.
- Rule categories (DSL `kind`): `talent` (XP-bought, `has_talent`), `trait` (innate DH2.0, `has_trait` — e.g. Brutal Charge, Unnatural Strength), `condition` (situational, non-purchasable — e.g. off-hand penalty), `quality` (weapon, `has_quality`), `status` (active conditions, `has_status` — e.g. On Fire, Full/Half Aim), `generic` (catch-all; `rule` is an accepted alias). Pass `traits: ["…"]` and `statuses: ["…"]` to `/api/attack`.

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
  context.mjs     RollContext + log  dsl/{tokenizer,parser}.mjs → AST   data/rules/traits.dsl
  engine.mjs      orchestrates flow  dsl/{interpreter,compiler}.mjs     data/rules/statuses.dsl
```

Checkpoints (see `api/lib/pipeline.mjs`): `MODIFIERS`, `POST_ROLL`, `ON_MISS`, `HIT_COUNT_MULT`,
`HIT_COUNT_BONUS`, `PENETRATION`, `DAMAGE_POOL`, `DIE_ADJUST`, `DAMAGE_MODS`, `PARRY`. An effect is
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
- `api/lib/dsl/` — trait DSL: `grammar.md` (spec), `tokenizer.mjs`, `parser.mjs` (→ AST), `interpreter.mjs` (whitelisted facts/actions), `compiler.mjs` (→ Effect), `docs.mjs` (reference metadata served at `/api/dsl-docs`)
- `api/data/rules/*.dsl` — rule content authored in the DSL, compiled into the default registry: `weapon-qualities.dsl`, `talents.dsl` (talents + conditions), `traits.dsl` (DH2.0 traits), `statuses.dsl` (status conditions)
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
- `categories.test.mjs` — rule kinds (talent/trait/condition/quality/status/generic), trait/status activation, built-in rule toggling, Accurate aim-gating
- `parry-scatter.test.mjs` — Parry flow (Balanced/Defensive at PARRY) and Blast scatter on a miss (ON_MISS, DSL-alterable distance)
- `critical-damage.test.mjs` — crit-table lookups, fuzzy location mapping, clamping
- `weapons-data.test.mjs` — integrity checks on the 144 weapon profiles
- `server.test.mjs` — HTTP endpoint tests (app booted on an ephemeral port)
- `helpers.mjs` — shared deterministic-RNG utilities (imported, not run as a test)
