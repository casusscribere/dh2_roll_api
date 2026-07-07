# Unified refactor / build / migration roadmap

The single execution plan combining the **DSL v2 architecture**
([DSL_ARCHITECTURE.md](DSL_ARCHITECTURE.md) — findings F1–F10, schema §3, stages)
with the **delivery strategy** (web-first on GitHub Pages, character schema as
data, exporter adapters, early Foundry seam validation). It supersedes the
checklists in DSL_ARCHITECTURE.md §6–7; the rationale stays there, the plan
lives here.

**Operating model — three lanes, every phase:**

- **Lane A (Engine/DSL):** the refactor stages. Non-breaking; suite green at
  every phase boundary.
- **Lane B (Pages):** each phase ends with a **deployed increment** on the
  GitHub Pages build (CI: test → build:static → deploy already in place). The
  site remains the dev harness + headless simulator + authoring surface — not
  the product UI.
- **Lane C (Foundry):** **gradual adoption**, not a big-bang port. Each phase
  adds one concrete Foundry element, starting with a throwaway seam validation
  and compounding toward a distributable module. **Primary target:
  `dark-heresy-3rd-edition` (live-validated on Foundry v14.360)** with
  `dark-heresy-2nd` (v12) as compat secondary and `rogue-trader-2nd` as the
  Phase-7 target — all present in the user's live install
  (`…\FoundryVTT\Data\systems`). Increments land via `npm run deploy:foundry`
  (build + copy into `Data/modules/`) and are validated with the Playwright
  join harness — see FOUNDRY_MIGRATION.md "Live-install survey & integration
  plan". A mismatch discovered in Lane C feeds back into Lane A while change
  is cheap.

**Cross-cutting rules (all phases):**
- Every rule authored or migrated carries `meta` (book/page) once Phase 0 lands.
- From Phase 5 on, content ships with content-tests (`example` blocks / golden
  cases) — no untested rules.
- Tag a release per phase; `docs/` (Pages) and the Foundry module version move
  together.
- The character schema carries `schemaVersion` + migrations from its first
  commit.

---

## Phase 0 — Foundations & metadata
*(architecture stages 0–1 · tasks #1, #2)*

| Lane | Work |
|---|---|
| **A** | `dsl` version pragma; `package "…" { system, source }` headers; per-rule `meta { page N }` (tokenizer → parser → compiler; stored on effects). Canonical **`{name, level}`** for qualities/talents/traits — strings parsed once at the API boundary; `bump_quality`/`add_quality` mutate objects (F5, F6). |
| **B** | Rules page shows package + book/page provenance per rule; `/api/rules/source` carries metadata. **Deploy.** |
| **C** | No code. Pin the target: survey `dark-heresy-3rd-edition`'s v14 migration state, `template.json`, pack format; record the compatibility baseline in FOUNDRY_MIGRATION.md. |

**Done when:** suite green; every built-in file has a package header; Pages
shows provenance; Foundry baseline documented.

## Phase 1 — Vocabulary & primitives
*(stages 2–3 · tasks #3, #4, #5)*

| Lane | Work |
|---|---|
| **A** | **Scoped fact paths** (`target.*`, `weapon.*`, `opposing_weapon.*`; attacker default) with v1 prefix-facts as aliases; single-source vocabulary metadata → derive interpreter whitelist *and* docs (F2, F8). Then **slots / flags / declarations** with the 22 v1 verbs re-parsed as sugar (F1). Integer expression semantics + `ceil()`/`floor()`/`half()` (round-up default per DH2 p.18). |
| **B** | DSL reference page auto-derived from the single-source metadata (checkpoints, scoped facts, slots, flags). **Deploy.** |
| **C** | **Walking skeleton** (task #5): scratch module vendoring the DSL VM (`lib/dsl` + `pipeline` — already proven browser-portable by the static bundle); resolve one attack end-to-end via a macro/hook inside the system. Validates checkpoint↔hook timing, Actor data → facts mapping, pack ID strategy. Record the **module-vs-new-system decision** (default: module). Throwaway quality. |

**Done when:** new-mechanic additions require zero parser/interpreter edits
(data entries only); skeleton resolves an attack in Foundry; decision recorded.

## Phase 2 — Character schema & importers
*(task #6)*

| Lane | Work |
|---|---|
| **A** | **Character schema v1** — versioned JSON document formalising `buildEngagementInputs` (characteristics, `unnatural`, weapon, five rule lists, combat flags). Single-sourced: derive boundary validation, UI form population, exporter target shape; fields designed to map 1:1 onto Foundry DataFields. `/api/character/validate` with field-level errors. |
| **B** | Character **import/export UI**: load canonical JSON → populates attacker/defender panels; save current panels → JSON. `tools/` adapters: **Google Sheets template** (structured cells over Docs prose) and **Roll20 attribute JSON** → canonical form. **Deploy.** |
| **C** | **Actor importer**: the same canonical JSON creates/updates an Actor in Foundry (module command). One schema, two consumers — the schema↔DataFields mapping is proven here, not at the end. |

**Done when:** a character round-trips template → JSON → site roll AND
template → JSON → Foundry Actor.

## Phase 3 — Pipelines & rule layers
*(stages 4–5)*

| Lane | Work |
|---|---|
| **A** | **Named pipelines** with namespaced checkpoints (`attack.*` default); add `test.*` (generic skill/characteristic tests) and route the d100 flow through it (F3). **Layered registry** — core ← system ← campaign ← user — with static id-based `replaces`; `suppress` deprecated-but-kept (F6). |
| **B** | d100 box gains full modifier/talent hooks via `test.*`; Rules page gains layer management (enable a campaign/user pack above the built-ins). **Deploy.** |
| **C** | **Pack export v1**: `roll_table` → native RollTable documents; qualities → `attackSpecial` items (trivial now that `{name, level}` is canonical); `meta` pages land in item descriptions. Skeleton loads the generated packs. |

**Done when:** a user pack can cleanly override a core rule by id; Foundry packs
are generated from DSL source, not hand-built.

## Phase 4 — Encounter state & upkeep
*(stage 6)*

| Lane | Work |
|---|---|
| **A** | **EncounterState document** (per-actor conditions with severity/duration/location, per-location AP, cooldowns, ammo) + **`upkeep` pipeline** (TURN_START/TURN_END/ROUND_END). Corrosive AP, Toxified end-of-turn, On Fire tick, Recharge cooldown, Haywire decay become real (F7). Stateless calls still work without a state doc. |
| **B** | Encounter tracker panel: state persists across engagements in the session (localStorage), upkeep ticks resolvable per round. **Deploy.** |
| **C** | **ActiveEffect mirror**: module maps EncounterState ↔ AEs (duration in rounds, severity/location in flags); upkeep effects run from combat hooks. Parity test: same scenario ticked headless and in Foundry produces identical state. |

**Done when:** the five state-blocked features work on both surfaces from one
rule definition.

## Phase 5 — DH2 attack-loop content sweep

| Lane | Work |
|---|---|
| **A** | Remaining qualities on the new primitives: **Force** (psy_rating static half), **Indirect** (`scatter_hit` declaration), **Smoke** (smoke declaration over the scatter seam), **Spray** (no-BS attack mode — the one engine addition). Then the attack-relevant **talent/trait sweep** (~100 rules), mass-authored with content-tests, prioritised by at-table frequency; codifier agents + fidelity audit against `_pdf_text` page cites. |
| **B** | Full rule browser (search/filter by category/package/page). **Deploy.** |
| **C** | Full pack regeneration; **playtest scenario** module world exercising the swept content; defect list feeds back to Lane A. |

**Done when:** every DH2 weapon quality implemented; attack-relevant
talents/traits covered with tests; a Foundry playtest runs on generated packs.

## Phase 6 — Psychic powers (DH2 completion)
*(stage 7)*

| Lane | Work |
|---|---|
| **A** | `power.*` pipeline (MODIFIERS, POST_ROLL, PHENOMENA, PERILS, EFFECT); psy rating + push; Phenomena/Perils as `roll_table`s; Force weapon focus-power rider via `opposed`. |
| **B** | Focus-power roller page. **Deploy.** |
| **C** | Psychic-power packs + power rolls through the vendored VM in the module. |

## Phase 7 — Rogue Trader
*(stage 8)*

| Lane | Work |
|---|---|
| **A** | **`POLICIES.rt1`** (DoS formula, RF procedure, evasion economy deltas) selected per request; `rt1.*` content packages layered over `core.*`; `ship_attack` pipeline (components-as-qualities, facing armour via scoped facts); Profit Factor/acquisition through `test.*`. |
| **B** | System selector (dh2/rt1) on the site; ship-combat roller. **Deploy.** |
| **C** | RT packs as a module option. Other FFG lines (DH1/DW/BC/OW) repeat this phase's pattern: policy object + content pack, no engine work. |

## Phase 8 — Foundry productionisation
*(stage 9)*

| Lane | Work |
|---|---|
| **A** | Freeze IR v2; extract `lib/dsl` + `pipeline` + policies as the standalone "rules VM" package consumed by API, Pages bundle, and module. |
| **B** | Pages remains the authoring/validation/headless-sim surface; documents the module. **Deploy.** |
| **C** | The module becomes a **distributable deliverable**: manifest + release URL, versioned pack export in CI (same workflow that deploys Pages), v14 compliance pass, migration functions for schema/pack updates. |

**Done when:** a GM installs the module from a manifest URL and plays DH2 (and
RT) content generated from the same DSL source the Pages site runs.

---

## Sequencing rationale (why this order)

1. **Metadata before content** (P0) — provenance must exist before the sweep, or
   100+ rules get retrofitted.
2. **Primitives before content** (P1) — the sweep on v1 grammar would mint
   dozens of bespoke verbs (F1's failure mode).
3. **Foundry seam before schema freeze** (P1–P2) — the walking skeleton and
   Actor importer surface IR/schema mismatches while both are cheap to change.
4. **State before the sweep** (P4→P5) — several swept talents/qualities touch
   durations/cooldowns; authoring them pre-state means re-touching them.
5. **Content before psychic/RT** (P5→P6–7) — proves the primitives at scale on
   the best-understood loop first.
6. **Productionise last** (P8) — everything before it keeps the module low-cost
   and regenerable.

## Risk register

| Risk | Mitigation |
|---|---|
| Foundry hook timing can't express a checkpoint | Surfaces in P1 skeleton; adjust pipeline IR then, not at P8 |
| `dark-heresy-3rd-edition` v14 migration stalls upstream | P0 baseline pins a known-good version; module-vs-system decision revisited at P1 |
| Google/Roll20 template drift breaks adapters | Adapters are thin + schema validation gives field-level errors; templates versioned |
| Content sweep quality at scale | Content-tests mandatory + fidelity audit against `_pdf_text` cites |
| Scope creep on the Pages UI | UI stance: dev harness only; sheet-like features deferred to Foundry |
