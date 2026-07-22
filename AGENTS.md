# dh2_roll_api — agent orientation

(`CLAUDE.md` mirrors this file. This repo's own docs are authoritative — this file only orients an agent
landing here from the wider ROGUE_TRADER workspace.)

## What this is

DH2 rules-DSL engine + d100 roll/engagement API + UI. Own git repo (`casusscribere/dh2_roll_api`),
GitHub Pages CI, Foundry deploy lane. It is the most mature codebase in the workspace and the declared
reference architecture for RT tool integration.

## Read in this order

1. `README.md` — run commands, endpoint table, UI pages, test count.
2. `ROADMAP.md` — the single execution plan; three-lane operating model (A: Engine/DSL, B: Pages,
   C: Foundry — gradual adoption targeting `dark-heresy-3rd-edition` on v14.360).
3. `DSL_ARCHITECTURE.md` — rationale (findings F1–F10, schema).
4. `FOUNDRY_MIGRATION.md` — live-install survey (2026-07-01) + pack export/deploy/Playwright harness.
5. `CHARACTER_MODEL.md`, `POTENTIAL_FEATURES.md`, `TBD.md`.

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
- `npm run deploy:foundry` copies into the live Windows Foundry install — from WSL make the target path
  configurable (see `../../docs/handoff_2026-07-22/04_WSL_TRANSFER_RECOMMENDATIONS.md` §5).
- Known churn: `foundry/dh2-roll-vm/packs/*/LOG` files modify on Foundry runs; decide a .gitignore
  policy rather than committing noise.
- Open naming/topology decisions once RT rules land here: see
  `../../docs/RT_MAP_TOOLS_DH2_INTEGRATION_PLAN_2026-07-15.md` §4.
