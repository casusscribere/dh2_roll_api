# dh2_roll_api — agent orientation

(`AGENTS.md` mirrors this file. This repo's own docs are authoritative — this file only orients an agent
landing here from the wider ROGUE_TRADER workspace.)

## What this is

DH2 rules-DSL engine + d100 roll/engagement API + UI. Own git repo (`casusscribere/dh2_roll_api`),
GitHub Pages CI. It is the most mature codebase in the workspace and the declared
reference architecture for RT tool integration.

## Read in this order

1. `README.md` — run commands, endpoint table, UI pages, test count.
2. `ROADMAP.md` — the single execution plan; three-lane operating model (A: Engine/DSL, B: Pages,
   C: Foundry — **retired 2026-08-25**, see below).
3. `DSL_ARCHITECTURE.md` — rationale (findings F1–F10, schema).
4. `FOUNDRY_MIGRATION.md` — **historical**: live-install survey (2026-07-01) + the retired module
   lane's pack/deploy/Playwright record; the mapping tables remain useful reference.
5. `CHARACTER_MODEL.md`, `POTENTIAL_FEATURES.md`, `TBD.md`.

> **OD-1 RESOLVED (2026-08-25) — this repo has NO Foundry deploy lane.** `dark-heresy-3rd-edition`
> is a reference system only (user, 2026-07-29), and the user ruled the `dh2-roll-vm` module lane
> **dropped, not retargeted**: `foundry/`, `build:foundry`, `export:packs` and `deploy:foundry` are
> retired (git history is the undo). The engine reaches Foundry solely as the **library bundle**
> (`npm run build:engine-lib` → `dist/dh2-engine.mjs`) vendored by the `rogue-trader-2e` system as
> `module/vendor/dh2-engine.mjs` (hash-guarded there). Do not add a new Foundry deploy path here.

## Ground rules

- **Engine stays rules-agnostic** (`api/lib/engine.mjs` header is the contract): no trait/talent/quality
  interpretation in engine code. All content is `.dsl` under `api/data/rules/`, loaded through
  `api/lib/rules/sources.mjs`.
- All transports go through `dispatch(method, path, body)` (`api/lib/api-router.mjs`); Express and the
  Pages `fetch` patch are thin clients. New consumers (e.g. the RT map tools) should be dispatch
  clients too.
- "No untested rules": new DSL ships with golden-case content tests. Suite green at every phase
  boundary (`npm test`; Node ≥22 for the test glob).
- Docs are partly test-enforced (`dsl-docs.test.mjs`); update docs with behavior, not after.

## Workspace context

- Weapon data originates from `../../codified-systems/dark_heresy_2e/data/weapons.json`; crit table
  ported from the `dark-heresy-3rd-edition` Foundry system.
- After engine-behaviour changes, re-vendor into `rogue-trader-2e`
  (`~/REPOS_LINUX/FOUNDRY_SYSTEMS/rogue-trader-2nd-edition`): `npm run build:engine-lib`, copy
  `dist/dh2-engine.mjs` → its `module/vendor/dh2-engine.mjs`; its staleness guard fails its suite
  until the hashes match.
- The `foundry/` reverse-adapter *code* that survives here is `api/lib/foundry-actor.mjs` (character
  document → Foundry actor mapping) — an API-level mapper with its own tests, unrelated to the
  retired module.
- Open naming/topology decisions once RT rules land here: see
  `../../docs/RT_MAP_TOOLS_DH2_INTEGRATION_PLAN_2026-07-15.md` §4.
