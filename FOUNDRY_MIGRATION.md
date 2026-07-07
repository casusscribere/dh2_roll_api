# Foundry VTT migration map — for Claude

## Live-install survey & integration plan (2026-07-01 — supersedes parts of the Phase 0 baseline)

The user's actual Foundry install is now known:
`C:\Users\kirkl\AppData\Local\FoundryVTT\Data\` (systems/ + modules/).
`Data/systems/` contains **four** systems; three matter here:

| System | Version | Foundry | Notes |
|---|---|---|---|
| **`dark-heresy-3rd-edition`** | 1.8.1 | **v14 (verified 14.360)** | The v14 migration this doc originally targeted — it EXISTS and is **live-validated** (its `FOUNDRY_V14_TEST_LOG.md`: smoke + deep suites PASS on 2026-05-01 against a live world — DataModels (`module/models/data-models.mjs`), actor/item CRUD, 13 packs, 4 actor / 27 item sheets). Same 1.8.1 lineage as `dark-heresy-2nd`, so the rules seams are identical (`module/rules/attack-specials.mjs`, `combat-actions.mjs`, `config.mjs`, `critical-damage.mjs`, `active-effects.mjs`, …). Packs exist in BOTH legacy `.db` and compiled **LevelDB directory** form. |
| `dark-heresy-2nd` | 1.8.1 | v12 (12.331) | The v12 original (the CURSOR_DOCS copy surveyed in Phase 0 was a snapshot of this). |
| **`rogue-trader-2nd`** | 1.8.1 | v12 (12.331) | Same family, forked for Rogue Trader — a concrete local Lane C target for **Roadmap Phase 7**. |

Also present: `dark-heresy-2nd/tools/foundry-join/` — a **Playwright headless
harness** (joins a running Foundry at `FOUNDRY_URL` as `FOUNDRY_USER`, then runs
in-page assertions; `--headless/--headed`). The dh3 v14 validation was run
through it. This is the machinery that turns our module validation from a
manual checklist into a repeatable script.

### Integration decisions

1. **Primary module target: `dark-heresy-3rd-edition` (v14)**, with
   `dark-heresy-2nd` (v12) as a secondary compatibility target. Rationale: the
   v14 system is live-validated and DataModel-based (where Foundry is going);
   the two share the 1.8.1 data shapes, so `mapActor`'s candidate-driven reads
   work on both; the module uses only APIs stable across v12–v14 (`Hooks`,
   `ChatMessage.create`, `Actor.create`, `createEmbeddedDocuments`,
   `ui.notifications`). Update `module.json`: compatibility `minimum 12,
   verified 14.360`; `relationships.systems` lists BOTH systems.
2. **Deploy step for Lane C** (mirror of the Pages deploy): add
   `npm run deploy:foundry` = `build:foundry` + copy `foundry/dh2-roll-vm/` →
   `<FoundryData>/Data/modules/dh2-roll-vm/`. Foundry data path resolved from a
   `FOUNDRY_DATA` env var falling back to the known
   `C:\Users\kirkl\AppData\Local\FoundryVTT\Data`. Every phase's Lane C
   increment then lands in the live install the same way Lane B lands on Pages.
   (Foundry hot-reload does not cover esmodules — a world reload (F5) is
   needed after deploy; note it in the script output.)
3. **Automated validation** (converts the task-#5 manual checklist): adopt the
   join-harness pattern — `tools/foundry-test/test-dh2vm-smoke.mjs` (Playwright,
   dep shared with the existing harness) joins a running Foundry test world
   with the module enabled and asserts: module loaded without console errors;
   `game.dh2vm.builtinRules.length > 50`; deterministic
   `rollTest({target:40}, rollScript([20]))`; `importCharacter(sample)` creates
   an acolyte Actor with items; `dh2Attack()` posts a chat card given two
   scripted tokens. Prereqs (one-time, user-side): a test world per system
   (dh3-v14 primary), a join user, Foundry running at `localhost:30000`. This
   stays a **local gate** (no Foundry license in CI); CI keeps guarding the VM
   via the headless smoke (stubbed globals) already in place.
4. **Pack export (Roadmap Phase 3 Lane C) format decision:** emit **source
   JSON compiled to LevelDB directories** via `@foundryvtt/foundryvtt-cli`,
   matching dh3's compiled layout — do NOT generate legacy NeDB `.db`. Target
   the v14 system's pack list shape.
5. **Rogue Trader (Phase 7):** `rogue-trader-2nd` is the Lane C target; same
   deploy/validate machinery. It is v12-pinned — when Phase 7 arrives, decide
   whether to repeat the dh3-style v14 migration on it (the playbook and test
   logs for that migration live in the dh3 tree as precedent).
6. **Dev loop (documented for every future Lane C increment):**
   `npm run deploy:foundry` → launch Foundry → open the test world → F5 after
   redeploys → `node tools/foundry-test/test-dh2vm-smoke.mjs` (or manual
   checklist). Findings recorded here.

### Walking-skeleton validation — PASS (recorded 2026-07-07)

`node tools/foundry-test/test-dh2vm-smoke.mjs` against the live install —
world on **`dark-heresy-3rd-edition`, Foundry 14.360**, module
**dh2-roll-vm v0.2.0**, join user password-authenticated. All checks green:

- module active; `game.dh2vm` registered; **53 rules compiled in-page**.
- `rollTest` deterministic under `rollScript` (forced 20 vs 40 → dos 5 incl.
  +2 Unnatural) — the VM's RNG/policy path works inside Foundry.
- `resolveEngagement` fully deterministic in-page (wounds 7 = die 7 kept +
  SB 5 − soak 5) — the **whole checkpoint pipeline runs synchronously in
  Foundry with no hook/timing mismatch** (the key seam question — answered).
- `importCharacter` (canonical schema v1 JSON) → acolyte Actor with
  weapon/talent/trait embedded Items on the **v14 DataModel system**;
  `mapActor` reads the characteristics back (ws 35 / bs 40 / …). Actor CRUD
  round-trip confirmed.
- `/dh2attack` chat-card check skipped (no token selected/targeted) —
  optional manual follow-up, not blocking: the engagement math it would
  exercise is covered by the deterministic in-page `resolveEngagement`.

**Conclusions:** the vendored-VM approach is sound on v14; the IR needs no
change for Foundry timing; Actor⇄schema mapping works both directions.
Phase 3's pack export can proceed against this validated target.

### Pack export v1 — SHIPPED (2026-07-07, Roadmap Phase 3 Lane C)

`npm run export:packs` (part of `deploy:foundry`) generates compendia from the
DSL source per the format decision above: 4 `roll_table` declarations → native
**RollTable** documents; 35 weapon-quality rules → **`attackSpecial` Items**
(`hasLevel` from the valued-names analysis; package · book · page provenance in
descriptions and `flags['dh2-roll-vm']`). Source JSON in
`foundry/dh2-roll-vm/packs-src/`, compiled to **LevelDB** directories via
`@foundryvtt/foundryvtt-cli` v3 (embedded results carry `!tables.results!`
keys), deterministic name-hashed ids. Round-trip verified with `extractPack`;
the join smoke now asserts both packs index in-world and that Corrosive loads
with its p.145 cite. Module v0.3.0 declares the packs (`attack-specials` bound
to `system: dark-heresy-3rd-edition`; tables system-agnostic).

### ActiveEffect mirror — SHIPPED (2026-07-07, Roadmap Phase 4 Lane C)

Module v0.4.0 adds the EncounterState ⇄ ActiveEffect mirror:
`game.dh2vm.syncEncounterToActor(actor, actorState)` writes the actor's
conditions as module-managed AEs (condition `duration` → AE `duration.rounds`;
`severity`/`location`/`decay` → `flags['dh2-roll-vm']`), and
`readEncounterFromActor(actor)` reads them back into a state document; the
vendored `tickEncounter` then runs the same upkeep the headless engine runs
(On Fire burn, Toxified test, decay/expiry). The join smoke gained two checks:
AE round-trip parity on a temp actor, and an in-page deterministic tick
(On Fire burns a forced 7). Run the smoke to validate on your world; the
combat-hook automation (auto-tick on `updateCombat`) is Phase 8 material.

### Consequences for earlier sections

- The **module-vs-new-system decision stands** (module), but the primary
  system flips from `dark-heresy-2nd` to **`dark-heresy-3rd-edition`** — the
  "v12 pin + unexecuted v14 plan" concern below is resolved by the live v14
  system; the v12 systems remain as secondary/compat targets.
- The Phase-0 baseline below described the CURSOR_DOCS snapshot; it remains
  accurate for `dark-heresy-2nd` specifically.

## Phase 0 baseline (recorded 2026-07-01 — ROADMAP.md Lane C)

The target system surveyed on disk at
`C:\Users\kirkl\Documents\AI_TOOL_DIRECTORIES\CURSOR_DOCS\rogue_trader_2e\dark-heresy-2nd`:

- **System id `dark-heresy-2nd`** (title "Dark Heresy 2nd Edition"), **version
  1.8.1**, by Matt Keathley (github `mrkeathley/dark-heresy-2nd-vtt`). This doc
  previously referred to it as "dark-heresy-3rd-edition" — the on-disk system id
  is `dark-heresy-2nd`; use that everywhere.
- **Compatibility pinned to Foundry v12** (`minimum 12, verified 12.331,
  maximum 12`). Its `FOUNDRY_V14_MIGRATION_PLAN.md` is present and *not yet
  executed* (baseline section still describes v12 as current) — a 5-phase plan
  (v12/13 sandbox → v14 data models behind adapters → per-document migration →
  pack format → regression release).
- **13 packs**, all legacy `.db` (NeDB) format incl. `attack-specials.db`,
  `tables.db` (RollTable), `talents.db`, `traits.db`, `weapons.db`,
  `weapon-mods.db`, `ammo.db`, `psychic-powers.db`. v14 requires LevelDB packs —
  pack export (Roadmap Phase 3 Lane C) should emit the modern format and not
  inherit `.db`.
- Expected seams confirmed present: `module/rules/attack-specials.mjs`,
  `module/rules/config.mjs`, `module/actions/combat-action-manager.mjs`,
  `module/rolls/{roll-data,damage-data,roll-helpers}.mjs`,
  `module/hooks-manager.mjs`, ActiveEffect chat handlers
  (`burning-chat.hbs`, `bleeding-chat.hbs`), and `dark-heresy-migrations.mjs`
  (world-version migration flow).
- **Implication for the walking skeleton (Roadmap Phase 1):** validate against
  **v12.331 first** (the system's only supported core), while writing the
  module against APIs stable across v12→v14 where possible; re-validate when
  the upstream v14 migration lands. The module-vs-new-system decision stays
  open until the skeleton, but the v12 pin + unexecuted v14 plan raises the
  option of contributing the v14 migration upstream as part of Lane C.

## Phase 1 walking skeleton (built 2026-07-01 — awaiting in-Foundry validation)

`foundry/dh2-roll-vm/` — a throwaway module bundling the DSL VM as a Foundry
esmodule (`npm run build:foundry`, ~200 KB ESM; same inlined-data recipe as the
Pages bundle). Registers `game.dh2vm` (the full VM surface) and a `/dh2attack`
chat command that maps two `dark-heresy-2nd` Actors (`characteristics.*.total`,
weapon Items, nested `attackSpecial` items → canonical `{name, level}`
qualities) into a `resolveEngagement` call and posts the report to chat.

- **Headless smoke: PASSED** — the bundle imports under stubbed `Hooks`/`game`
  globals, loads all 53 built-in rules, and resolves a deterministic
  `rollTest` (Unnatural bonus DoS intact). Remaining risk is Foundry-
  environment-specific, which the in-app checklist (module README) surfaces.
- **Interim decision (default until in-app validation says otherwise): MODULE
  for `dark-heresy-2nd`**, not a new system. Rationale: the seam validated so
  far is clean (the VM is synchronous and self-contained; Actor mapping is a
  pure function), and a new system would add sheets/packs/migrations surface
  with no offsetting benefit at this phase. Revisit at Phase 3 (pack export)
  if the NeDB→LevelDB pack format or the v12 pin becomes a blocker.
- **Known skeleton simplifications** (feed Phase 2 schema + Phase 4 AE mirror):
  armour taken from body location only; range band not derived from token
  distance; defender always Dodges; conditions/circumstances not yet read from
  ActiveEffects.

How this tool's DSL taxonomy maps onto the live **`dark-heresy-3rd-edition`**
Foundry system (the eventual second compile target). This is a planning/reference
doc — nothing here is wired up yet. The DSL stays the authoring + headless-sim
source of truth; Foundry documents are generated/seeded from it (the
foundry-module's `pack-builder.py` is the existing seam).

> Target system is mid **Foundry v14 migration** (see its
> `FOUNDRY_V14_MIGRATION_PLAN.md`). Port against v14 data-model + ActiveEffect
> APIs, not v12.

## Observed system architecture (the analogues already exist)

| System file | Role | Our analogue |
|-------------|------|--------------|
| `module/rules/attack-specials.mjs` | builds `rollData.attackSpecials` from equipped/enabled nested items `{name, level}` | Qualities (`has_quality`, `{quality, level}`) |
| `module/rules/active-effects.mjs` | ActiveEffect handlers (`handleOnFire`, `handleBleeding`), per-turn | Conditions + Circumstances |
| `module/actions/combat-action-manager.mjs` | `updateCombat` hook, action lifecycle | Actions |
| `module/rules/config.mjs` | builds `CONFIG.DarkHeresy` tables at `init` from `*Names()` | "compiled at startup" registries (Actions, etc.) |
| `module/rules/{ammo,weapon-modifiers}.mjs` | profile modifiers in the roll pipeline | Mechanical + Modifications |
| `template.json` (26 Item types) | typed Items | most categories |
| native `RollTable` + `tables.db` | tables | Roll tables |

`template.json` Item types: ammunition, aptitude, armour, armourModification,
attackSpecial, backpack, consumable, criticalInjury, cybernetic, drug, enemy,
forceField, gear, journalEntry, malignancy, mentalDisorder, mutation, peer,
psychicPower, specialAbility, storageLocation, talent, tool, trait, weapon,
weaponModification. Actor types: acolyte, npc, vehicle. Note: **no `condition`,
`action`, or `quality` Item type** — those are ActiveEffects / managed code /
nested `attackSpecial`s respectively.

## Category → Foundry construct

| DSL category | Foundry construct | Porting notes |
|--------------|-------------------|---------------|
| **Qualities** | `attackSpecial` Item (nested in weapon); `armourModification` for armour | `attack-specials.mjs` already yields `{name, level}` — 1:1 with our `{quality, level}`. Non-weapon qualities = `armourModification`. |
| **Talents & Traits** | `talent`, `trait` Items | Direct; talents.db pack. |
| **Circumstances** | **ActiveEffect** (toggle) → later **Scene Region behaviours** | Foundry v12+ Scene Regions auto-apply by map area — the "map-aware" system. Start as manual toggled ActiveEffects. |
| **Conditions** | **CONFIG.statusEffects** + **ActiveEffect** (native `duration`, `flags` for severity/location) | Conditions are status effects, not Items. ActiveEffect.duration is native; `active-effects.mjs` runs per-turn handlers. conditions.db has 17. |
| **Actions** | `CombatActionManager` + `action` template field + `config.mjs` registration | Register at `init`/`setup` (= "compiled at startup"). `action: "Half Action"` already tags items. |
| **Configurations** | Actor **flags** / sheet toggles → driving **ActiveEffect**s | "Set in the character sheet" = actor flags enabling effects (Maximal, grip, stance). |
| **Roll tables** | native **RollTable** documents | tables.db has 21. Export DSL `roll_table` → RollTable. |
| **Mechanical** | system **rules/** modules (managed code) | Jam/overheat/craftsmanship in the roll pipeline — not Items. |
| **Miscellaneous** | `gear` Item / **Macro** / JournalEntry | Catch-all. |

## Porting principles

- **DSL is the source of truth, Foundry is a compile target.** `roll_table` →
  RollTable, `quality` → attackSpecial Item, `action` → registered combat action.
- **Checkpoints → roll pipeline + Hooks.** Engine checkpoints (MODIFIERS / ON_HIT
  / …) map onto `rolls/roll-data.mjs` + `rolls/damage-data.mjs` and combat Hooks.
  Our `when`/`apply` effects become `rollData` contributions and ActiveEffect
  `changes`.
- **"Recompile at startup" → CONFIG at `init`/`setup`**, exactly as `config.mjs`
  builds its tables today.

## Taxonomy implementation status (this tool)

The 9-category model is implemented in the DSL in four stages (all DONE). Foundry
target for each is the table above.

- **Stage 1 — renames + categories ✅.** kinds: `status`→`condition`,
  `condition`→`circumstance`, mechanics' `generic`→`mechanic`, `generic`/`rule`→
  `miscellaneous` (aliases normalised in the parser). `KIND → category` is the
  `KIND_GROUP` map. New functions `has_condition` / `has_circumstance`; inputs
  `conditions[]` / `circumstances[]` (old `statuses[]` still accepted). Foundry:
  grouping only; targets unchanged.
- **Stage 2 — Configurations ✅.** `configuration(...)` (firing_mode alias) +
  `configs[]` toggle list; Maximal recategorised from `quality` to `configuration`.
  `bump_quality` raises a quality in place. Foundry: actor flags → effects.
- **Stage 3 — structured Conditions ✅.** `apply_status "n" [value][duration]
  [location]`; accessors `condition_severity/_duration/_location()`; `conditions[]`
  may carry objects `{name, severity, duration, location}`. Foundry: ActiveEffect
  `duration` + `flags`.
- **Stage 4 — Actions ✅.** `action "Name" { type Half|Full|Reaction|Free [attack] }`
  declarations compiled once at load via `registerActions()` ("checked at
  startup"); rules hook via `is_action()` / `action_type` / `is_reaction()`.
  Foundry: `CombatActionManager` + CONFIG registration at `init`.
