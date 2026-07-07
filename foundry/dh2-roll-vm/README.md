# DH2 Roll VM — Foundry walking skeleton

**Purpose (ROADMAP.md Phase 1, Lane C):** throwaway-quality seam validation, not
a product. It vendors the same DSL VM bundle the GitHub Pages build ships
(engine + pipeline + all rules/data, zero dependencies) and runs one attack
end-to-end inside Foundry.

**Targets** (see FOUNDRY_MIGRATION.md "Live-install survey & integration plan"):
- **Primary: `dark-heresy-3rd-edition`** — Foundry **v14** (verified 14.360),
  DataModel-based, live-validated by its own test log.
- Compat: `dark-heresy-2nd` — Foundry v12.331 (same 1.8.1 data shapes).

## Install / deploy

```
npm run deploy:foundry     # build the bundle + copy into <FoundryData>/Data/modules/dh2-roll-vm
```

`FOUNDRY_DATA` overrides the data directory (default: the known local install).
Then launch Foundry, open the test world (dh3 v14 preferred), enable the module
(Manage Modules → "DH2 Roll VM (walking skeleton)"). Foundry does not
hot-reload esmodules — **reload the world (F5) after each redeploy**.

## Use

- Select an attacker token, target another token (`T`), then type **`/dh2attack`**
  in chat — the engagement report posts to chat.
- Import a character: `game.dh2vm.importCharacter(<canonical JSON>)` (export one
  from the Roll UI or `tools/import-character.mjs`).
- Or explore the whole VM from a macro / the console: `game.dh2vm` exposes
  `resolveAttack`, `resolveEngagement`, `rollTest`, `buildRegistry`, `compile`,
  `builtinRules`, `DSL_DOCS`, `mapActor`, `dh2Attack`, `importCharacter`,
  `validateCharacter`, `characterToCombatant`.

## Validation

**Automated (preferred):** with Foundry running at `localhost:30000` and the
test world open:

```
node tools/foundry-test/test-dh2vm-smoke.mjs [--headed]
```

(Playwright joins as `FOUNDRY_USER`, default `Gamemaster`, and asserts the
checklist below in-page. Playwright resolves from this repo or from the join
harness at `<FoundryData>/systems/dark-heresy-2nd/tools/foundry-join/`.)

Headless smoke (CI-safe, already passing): the bundle imports under stubbed
`Hooks`/`game` globals and resolves a deterministic `rollTest` — so any failure
inside real Foundry is a *Foundry-environment* finding, which is exactly what
this skeleton exists to surface.

### Checklist (what the smoke asserts; record findings in FOUNDRY_MIGRATION.md)

- [ ] Module loads (v14 primary / v12 compat) without console errors.
- [ ] `game.dh2vm.builtinRules.length` > 50 and `rollTest` is deterministic
      under `rollScript` (incl. the Unnatural bonus-DoS path).
- [ ] `resolveEngagement` with forced rolls produces the exact expected wounds.
- [ ] `importCharacter(<canonical JSON>)` creates an acolyte Actor with
      embedded weapon/talent/trait Items; `mapActor` reads it back sanely.
- [ ] `/dh2attack` with two tokens: engagement report renders in chat
      (skipped by the smoke unless a token is selected + targeted).
- [ ] Checkpoint semantics vs Foundry: nothing in the VM needed a Foundry hook
      mid-pipeline (the whole engagement resolves synchronously) — confirm this
      holds for the stepped flow too (future: pause between phases ↔ chat cards).
- [ ] Note every mapping gap found (armour by location, range bands from token
      distance, conditions from ActiveEffects) — these feed the AE mirror
      (Phase 4).

## Decision record

**Module** (not a new system), primary system **`dark-heresy-3rd-edition`
(v14)** with `dark-heresy-2nd` (v12) as compat — rationale in
FOUNDRY_MIGRATION.md "Live-install survey & integration plan".
