# DSL architecture review & v2 schema plan

An architectural review of the rule DSL and engine, and a schema plan sized for:
**full DH2 coverage → Rogue Trader 1e → optional other FFG 40k lines (DH1,
Deathwatch, Black Crusade, Only War) → Foundry VTT as a compile target.**
Written against the state at 219 tests / 13 checkpoints / 22 DSL verbs / 33 facts.

Companion docs: [FOUNDRY_MIGRATION.md](FOUNDRY_MIGRATION.md) (category → Foundry
construct map), [POTENTIAL_FEATURES.md](POTENTIAL_FEATURES.md) (deferred features),
[grammar.md](api/lib/dsl/grammar.md) (current v1 grammar).

---

## 1. What is working — keep these invariants

These five properties are the reason the tool has scaled to ~40 rules without an
engine rewrite. Every proposal below preserves them.

1. **Three-layer split** — engine (mechanism) / rules (interpretation) / DSL
   (content-as-text), joined only by the checkpoint pipeline. The engine contains
   zero rule names; content is data. This is textbook
   mechanism/policy separation and it has already survived four taxonomy
   migrations without engine edits.
2. **Safety by construction** — declarative, non-Turing-complete, whitelisted
   facts/functions, no `eval`. User rules cannot reach arbitrary state. Keep the
   whitelist as the *only* seam between DSL text and the context.
3. **Determinism** — injectable RNG with labelled traces (`rollScript`), forced
   rolls, and pure `dispatch()`. This is what makes 219 deterministic tests and
   the stepped/reroll UI possible. Any new subsystem must roll through `d()`.
4. **Transport-agnostic core** — one `dispatch()` behind Express *and* the
   browser bundle. The static build proved the whole engine+DSL runs in a plain
   browser with zero changes. **This is the single most important fact for the
   Foundry plan** (§5).
5. **Docs–code parity enforced by test** — the reference cannot silently drift.

---

## 2. Findings — where v1 will not scale

Ordered by how hard they bite as coverage grows.

### F1. Verb proliferation (flat action namespace) — the core issue
The `then` grammar has **22 verbs**, and the recent growth pattern is one bespoke
verb per rulebook special: `corrode` (Corrosive), `reduce_unnatural_toughness`
(Felling), `detonate` (Blast), `prevent_parry` (Flexible), `cannot_parry`
(Unwieldy), `bump_quality` (Maximal), `suppress` (Overheats). Each addition
touches four files (parser case, interpreter case, grammar.md, docs.mjs). Planned
work already implies more: `smoke`, `scatter_hit`, `jam_on_die`, `consume_ammo`,
`opposed_test`. At RT scale this becomes a hundred-verb grammar — a union of
special cases rather than a language.

**Best practice:** a small orthogonal core, with rulebook-flavoured verbs as
*sugar* over it. Three primitives cover almost everything the 22 verbs do:

| Primitive | Generalises | Example |
|---|---|---|
| `set <slot> (= \| +=) expr` over a **registered slot table** | `set pen/jam_threshold/rf_threshold/scatter/damage_type`, `add/set/cancel modifier` (modifiers are just keyed slots), `reduce_unnatural_toughness` (a `target.unnatural_toughness_reduction` slot) | `set slot target.armour_corrosion += 1d10` |
| `flag <name>` over a **registered flag table** | `prevent_parry`, `cannot_parry`, `detonate`, `fail` (a `success=false` flag), `keep_highest` | `flag no_parry` |
| `declare <declaration>` — structured, resolved-by-engine records | `require_test`, `apply_status`, `roll_on`, `corrode`, `emit`, hit adjustments | `declare test "Toughness" -20 onFail (...)` |

Slots and flags become **data entries** (name, scope, type, doc string) instead
of parser+interpreter code. Adding "Felling" support becomes registering one slot,
not editing four files. The existing verbs stay as parse-time sugar → no content
rewrite.

### F2. Flat fact namespace — scoping grew ad hoc
`target_sb`, `target_tb`, `target_armour`, `target_unnatural_toughness`,
`target_has_trait`, `opposing_present`, `opposing_has_quality` are an improvised
scoping system via name prefixes. Every defender-side need mints a new whitelist
entry; vehicles/ships will need `target.facing_armour`, crew stats, component
qualities — the cross-product explodes.

**Best practice:** **scoped paths**: one base fact table × a scope table
(`attacker` (default) | `target` | `weapon` | `opposing_weapon`, later `ship`,
`component`). `target.tb`, `opposing_weapon.has_quality("Force")`. One
whitelist declaration yields every legal scope; illegal scope×fact combinations
fail at compile time. v1 names remain as aliases.

### F3. One hardcoded pipeline — everything is attack-shaped
All 13 checkpoints belong to the personal-combat attack/parry/dodge flow. Full
DH2 needs at minimum: **skill tests** (generic, with modifier checkpoints),
**psychic powers** (focus-power test, psy rating, push, Phenomena/Perils),
**fear/pinning**, and **turn upkeep** (On Fire tick, Toxified end-of-turn,
Haywire decay, Recharge cooldown). RT adds **ship combat** — a parallel
macro-scale pipeline with its own phases (manoeuvre → shooting → boarding),
plus **extended/acquisition tests** (Profit Factor).

**Best practice:** **named pipelines** with namespaced checkpoints:
`on attack.ON_HIT`, `on power.PHENOMENA`, `on ship_attack.DAMAGE_MODS`,
`on upkeep.TURN_END`, `on test.MODIFIERS` (the generic skill-test pipeline the
d100 box already wants). The `Registry` already buckets by string — this is
cheap. Unqualified names default to `attack.*` for v1 compatibility.

### F4. System policy baked into the engine — the cross-system blocker
The engine hardcodes exactly the things that differ between FFG lines:

- `getDegree` (DoS formula — DH2's "1 + tens difference" vs DH1/RT's tens
  difference),
- the Righteous Fury *procedure* (DH2: 1d5 crit-table roll; RT/DH1:
  confirmation-roll variant),
- the ±60 modifier cap, jam default (96), aim values, hit-location tables and
  the multi-hit location sequences, evasion semantics.

**Best practice:** a **system policy object** — `POLICIES.dh2`, `POLICIES.rt1`, …
— holding these functions/constants, selected per request (`system: "rt1"`,
default `dh2`) and threaded through `RollContext`. Content rules then gate on a
`system` fact where behaviour (not just numbers) differs. Most qualities/talents
are shared across lines verbatim; the *policies* are where the systems actually
diverge, so isolating them is the cheapest possible multi-system architecture.

### F5. Stringly-typed levels
Qualities/traits carry levels inside display strings (`"Proven (3)"`) parsed by
regex at every read (`qualityLevel`). Structured Conditions/Circumstances
(`{name, severity}`) already moved past this. Foundry's `attackSpecial` items are
natively `{name, level}` — the regex round-trip is the impedance mismatch.

**Fix:** canonical internal form `{name, level}` for qualities/traits/talents;
strings accepted (and parsed once) at the API boundary. `bump_quality`/
`add_quality` then mutate objects, not strings.

### F6. No packages, versioning, or first-class metadata
- Source citations ("DH2 core p.145") live in comments — invisible to the
  compiler, the UI, Foundry export, and the fidelity-audit tooling.
- No file/module identity: `disabledRules` works on slugged display names, and
  `suppress "Name"` matches by display name — **display names are not unique**
  (Accurate, Defensive, Sanctified, Scatter, Maximal, … each have multiple
  same-named rules today; suppressing "Accurate" from a user pack would hit both
  branches of the built-in). Fine within one curated file set; unsafe across
  packages.
- No version pragma, so future grammar migrations can't auto-rewrite old text.

**Best practice:** a package header per file and rule-level metadata:

```
dsl 2
package "dh2.core.weapon-qualities" { system "dh2"  source "DH2 Core Rulebook" }
```

with `meta { page 145 }` (or `source page 145`) on rules, stable qualified ids
(`dh2.core.weapon-qualities/corrosive`), and a **layered registry** —
`core ← system ← campaign ← user` — where later layers may declaratively
`replaces "dh2.core/jam"` or `extends` (the statically-checked cousin of the
runtime `suppress`).

### F7. Mutable encounter state keeps knocking
Corrosive AP loss (per-attack `Map`), Toxified end-of-turn ticks, Recharge
cooldown, ammo, Haywire per-round decay — five deferred features all blocked on
the same missing concept. The stepped `/api/engage` already demonstrates the
pattern: **client-held serializable state posted back each step**.

**Best practice:** an explicit **EncounterState document** (actors' active
conditions with duration/severity, per-location AP, cooldowns, ammo) that flows
in/out of API calls, plus an `upkeep` pipeline (F3) whose effects tick it.
Design its shape to mirror Foundry **ActiveEffect** semantics (duration,
flags, per-turn handlers) so the headless engine and Foundry share one mental
model — see §5.

### F8. Doc metadata is a parallel structure
`docs.mjs` mirrors the interpreter tables and a test keeps them honest. Better:
define each fact/function/slot/flag **once** with its type/scopes/doc-string and
derive both the interpreter whitelist and the docs; the parity test becomes
structurally unnecessary (keep it as a tripwire).

### F9. Content ships without content-tests
Rules are verified by JS integration tests. At hundreds of rules across systems,
authors (human or codifier-agent) should ship executable examples *with* the
content — a DSL `example` block (given/expect over forced rolls) or a YAML
sidecar of golden cases, runnable by `node --test` and by the fidelity auditor.

### F10. Minor code health
- Three near-identical AST walkers (`collectNames`, `referencedNames`,
  `valuedNames`) → one generic visitor.
- `/` in expressions is JS float division and no rounding functions exist —
  unused by content today, but a latent bug (DH2's global rule is round *up*).
  v2: integer semantics + explicit `ceil()`/`floor()`/`half()` (half = RAW
  round-up default).
- Priority conventions (0–49 injector / 50–99 additive / 100+ canceller) are
  comments, not constructs — v2 can name them (`phase inject|modify|cancel`)
  and lint violations.

---

## 3. DSL v2 — target schema

Everything below is expressible as a superset of v1; §6 stages it without
breaking existing content.

### 3.1 File shape

```
dsl 2
package "rt1.core.ship-weapons" {
  system "rt1"                     // dh1 | dh2 | rt1 | dw | bc | ow | core
  source "Rogue Trader Core Rulebook"
  requires "core.combat"           // package dependency (load order + ids)
}
```

### 3.2 Rules (unchanged silhouette, richer clauses)

```
quality "Corrosive" {
  meta { page 145 }
  on attack.ON_HIT                       // namespaced pipeline.checkpoint
  when has(quality "Corrosive")          // unified has(); v1 forms remain sugar
  then declare armour_damage 1d10        // declaration primitive (was `corrode`)
  example {                              // content-test shipped with the rule
    given  { weapon { qualities ["Corrosive"] }  target { armour 4  tb 3 }  rolls [20, 5, 7] }
    expect { target.armour_after == 0   wounds == 3 }
  }
}
```

- **Facts are scoped paths** (F2): `target.tb`, `weapon.pen`,
  `opposing_weapon.has(quality "Force")`, later `ship.component("Void Shield").active`.
- **Actions are three primitives + sugar** (F1): `set <slot>`, `flag <flag>`,
  `declare <decl>`. All v1 verbs parse to these.
- **`system` fact + policy** (F4): `when system == "rt1"` for behavioural
  divergence; numeric policy lives in the engine policy object, not in rules.
- **Override across layers** (F6):

```
mechanic "Jam (RT)" {
  replaces "dh2.core.mechanics/jam"      // static, id-based; lint-checked
  on attack.POST_ROLL
  when weapon.is_ranged and roll > slot(jam_threshold)
  then declare event "Jam"; flag attack_failed
}
```

### 3.3 New pipelines (the expansion surface)

| Pipeline | Checkpoints (sketch) | Serves |
|---|---|---|
| `test` | MODIFIERS, POST_ROLL | generic skill/characteristic tests (d100 box, Fear, Pinning, acquisition/Profit Factor) |
| `power` | MODIFIERS, POST_ROLL, PHENOMENA, PERILS, EFFECT | psychic powers, psy rating, push; Phenomena/Perils are `roll_table`s |
| `upkeep` | TURN_START, TURN_END, ROUND_END | On Fire tick, Toxified, Haywire decay, Recharge/ammo cooldowns — reads/writes EncounterState |
| `ship_attack` | MODIFIERS, POST_ROLL, HIT_LOCATION(facing), DAMAGE_POOL, DAMAGE_MODS, ON_HIT(component/crit) | RT macro-combat; ship components model cleanly as "qualities" of the ship, crew ratings as characteristics |
| `opposed` | both sides' MODIFIERS, RESOLVE | opposed tests (Force weapon focus-power rider, grapples) |

Personal-combat content is untouched; `attack.*` remains the default namespace.

### 3.4 Entity vocabulary growth (categories)

The 10-category taxonomy holds. Planned additions slot in without grammar work:
**Powers** (psychic — new pipeline + `power` kind), **Modifications**
(ammo/weapon/armour mods — profile-rewriting rules, the `bump_quality` machinery
generalised), **Critical effects** (already `roll_table`-shaped), **Ship
components** (RT — qualities scoped to `ship`). Each is a `kind` + a file + a
`KIND_GROUP` row, exactly like the last four taxonomy stages.

---

## 4. Cross-system coverage strategy

- **Shared spine:** d100 roll-under, characteristics+bonuses, DoS/DoF, talents/
  traits/qualities, hit locations, wounds/crits, fate. ~70% of content rules
  port verbatim between lines; they differ mainly in *lists* (which talents
  exist) and *levels*.
- **Policy deltas** (F4) carry the real divergence: DoS formula, RF procedure,
  evasion/reaction economy, crit-table selection, fatigue rules. One policy
  object per line; content stays shared.
- **Per-line packages** layer on top: `core.*` (shared spine) ← `dh2.*` ← a
  campaign layer. RT1 = `core.*` + `rt1.*` (policies + ship pipeline + Profit
  Factor tests). Other lines are additional policy objects + content packs —
  no engine work once F3/F4 land.
- **Provenance metadata** (F6) keys every rule to book+page, which is what the
  ttrpg-fidelity-auditor needs to verify content packs against `_pdf_text`
  sources mechanically.

---

## 5. Foundry VTT alignment

The category→construct map in FOUNDRY_MIGRATION.md stands. Three architectural
commitments make it real:

1. **Treat the compiled Effect (+ metadata) as a stable IR** with three
   backends: (a) the live registry (API server), (b) the browser bundle
   (shipped), (c) a **Foundry module**. The static build already proved the
   whole DSL VM is dependency-free ESM that runs in a browser — so the Foundry
   system can **vendor the interpreter** and run actual DSL rules inside its
   roll pipeline hooks, rather than hand-porting each rule.
2. **Compile what maps cleanly; interpret the rest.** Effects whose `when`/
   `apply` reduce to ActiveEffect `changes[]` (flat modifiers keyed on actor
   data) export as native AEs; `roll_table` → native RollTable; qualities →
   `attackSpecial` items (F5's `{name, level}` makes this 1:1); everything
   conditional/checkpoint-shaped runs through the vendored VM. Rule `meta`
   (book/page) lands in item descriptions.
3. **EncounterState ↔ ActiveEffect mirror** (F7): design the headless state
   document with AE semantics (duration in rounds, severity/location in flags,
   upkeep pipeline ≙ per-turn handlers) so one rule definition drives both the
   headless simulator and live play.

Package/extract note: when convenient, split `lib/dsl` + `lib/pipeline` +
policies into a standalone package (the "40k rules VM") consumed by the API
server, the static bundle, and the Foundry module — the import graph already
permits it.

---

## 6. Staged migration plan (each stage lands green on the full suite)

| Stage | Change | Breaking? |
|---|---|---|
| 0 | `dsl` version pragma + `package`/`meta` headers (parsed, stored, surfaced in `/api/rules/source` and the UI) | No — v1 files without headers default to `dsl 1`, package `legacy` |
| 1 | Canonical `{name, level}` for qualities/traits/talents at the API boundary; regex parsing collapses to one boundary function | No — strings still accepted |
| 2 | Scoped facts (`target.*`, `weapon.*`, `opposing_weapon.*`); v1 prefixed names become aliases; docs derive from single-source metadata (F8) | No |
| 3 | Slot/flag registries; the 22 verbs re-parse as sugar over `set`/`flag`/`declare`; new content may use primitives directly | No |
| 4 | Namespaced pipelines; `attack.*` default; add `test.*` and wire the d100 box through it | No |
| 5 | Layered registry + id-based `replaces`; `suppress` deprecated in favour of static override where possible | No (suppress kept) |
| 6 | EncounterState + `upkeep` pipeline; Toxified/On Fire ticks, Recharge, ammo, Haywire decay become real | No — stateless calls still work without a state doc |
| 7 | `power` pipeline + Phenomena/Perils tables (DH2 psychic completion); Force weapon rider via `opposed` | No |
| 8 | `POLICIES.rt1` + `rt1.*` package + `ship_attack` pipeline | No |
| 9 | Foundry backend: exporter (attackSpecial/AE/RollTable/pack JSON) + vendored VM module | N/A (new target) |

Stages 0–3 are the high-leverage, low-risk core: after them, adding the
remaining DH2 qualities (Force/Spray/Indirect/Smoke) stops requiring parser
work, and everything later is additive content.

---

## 7. Development strategy & execution status

The adopted delivery strategy (evaluated and refined 2026-07-01):

**Web-first, port-later — with one early exception.** Features land continuously
on the deployable GitHub Pages site (fast loop, deterministic tests, zero
infrastructure) until the port gate below is met. The exception: a **Foundry
walking skeleton** is built *early* (right after Stage 3), not at the end — a
throwaway-quality module that vendors the DSL VM and resolves one attack
end-to-end inside Foundry. Its purpose is to validate the seam (checkpoint
semantics vs. hook timing, EncounterState vs. combat documents, pack ID
strategy) while the cost of changing the IR is still low. Big-bang porting after
"feature complete" is the classic integration failure mode; one early skeleton
de-risks it without diverting the web-first flow.

**Foundry target decision (to make at the skeleton):** module-for-existing-system
(`dark-heresy-3rd-edition`, per FOUNDRY_MIGRATION.md) vs. new system. Default
assumption: **module + exporter for the existing system** — a from-scratch
system adds sheets/packs/migrations surface that the port gate should not
require. Revisit only if the skeleton shows the existing system's data model
fights the IR.

**Character schema: data, not DSL.** The DSL stays a *rules* language; character
state is a **versioned JSON document schema** (formalising what
`buildEngagementInputs` already assembles ad hoc: characteristics, unnatural,
weapon, qualities/talents/traits/conditions/circumstances/configs, combat
flags). The two connect only through the scoped-facts layer (§3.2): every fact
the DSL can read must have a home in the schema — that is the invariant, and it
makes the schema derivable-by-audit. Single-source the schema definition and
derive from it: (a) boundary validation, (b) the Roll UI form population, (c)
the exporter target shape, (d) later the Foundry `TypeDataModel`/DataFields
definition (design the schema so fields map 1:1 onto DataFields; include a
`schemaVersion` and write migration functions from day one, as Foundry does).

**Exporter/importer track (Google template + Roll20 → common JSON).** Correct
shape: two thin **source adapters** → one canonical, versioned character JSON →
consumed by the site importer and, later, a Foundry-module Actor importer.
Guidance: keep adapters out of the engine core (`tools/` directory or separate
repo); prefer a Google **Sheets** template over Docs if possible (structured
cells + API beat prose parsing); build the Roll20 adapter around its character
attribute JSON export. The importer's key feature is **validation with
field-level errors** against the schema (the `/api/rules/validate` endpoint is
the precedent). This track is orthogonal to engine work and can proceed in
parallel.

**Content-sweep sequencing.** "All talents/traits/circumstances affecting the
attack loop" is ~100+ rules. Do **not** author them on the v1 grammar — land
Stages 0–3 first so content addition needs no parser work, then mass-author with
content-tests (F9) attached, prioritised by at-table frequency. The Stage-4
`test` pipeline then captures most non-attack talents with the same machinery.

**UI stance.** The Pages site is a *development harness and headless-sim
front-end*, not the product UI — Foundry is. Keep the hand-rolled UI minimal
(character import renders a summary + populates the roll form); do not
gold-plate sheets the Foundry port will replace.

**Port gate (exit criteria for "core featureset complete"):**
1. Stages 0–6 landed (metadata, canonical levels, scoped facts,
   slots/flags/declarations, pipelines, layers, EncounterState + upkeep).
2. Attack-loop content coverage: all DH2 weapon qualities incl. Force/Spray/
   Indirect/Smoke; attack-relevant talents/traits authored with content-tests.
3. Character schema v1 + both import adapters validating round-trip.
4. Walking skeleton re-validated against the then-current IR.
5. Suite green; Pages build green; every rule carries book/page metadata.

### Execution

**The live execution plan is [ROADMAP.md](ROADMAP.md)** — it merges the stages
above with this strategy into eight phases, each with three lanes: Engine/DSL
(Lane A), a deployed GitHub Pages increment (Lane B), and a **gradual Foundry
increment** (Lane C: baseline survey → walking skeleton → Actor importer → pack
export → ActiveEffect mirror → playtest → … → distributable module). The
"port gate" above is superseded by that per-phase Foundry lane; the gate's
criteria survive as the Phase 8 entry conditions.

**Status (2026-07-07):** Roadmap Phases 0–3 are complete, **and the v1 grammar
has been retired (dsl 3)** — the redundant legacy surfaces (prefixed alias
facts/functions, kind aliases, thin sugar verbs) were removed after migrating
all content with `tools/migrate-dsl.mjs`; the kept-by-design surfaces (default
`attack` namespace, rich verbs, runtime `suppress`, boundary canonicalization)
are now the single canonical authoring style ahead of the Phase 5 sweep. Delivered against the
findings: F1 slots/flags/declarations (verbs are sugar) · F2 scoped facts ·
F5 canonical `{name, level}` · F6 packages/meta/qualifiedIds **and** the layered
`replaces` override · F8 single-source vocabulary (docs derive) · F10
`ceil`/`floor`/`half` + round-up `/` · F3 **started** — `attack` is the default
pipeline namespace and `test.*` is live (`/api/test`); `power`/`upkeep`/
`ship_attack` remain (Phases 4/6/7) · F4 (system policies) and F7
(EncounterState) are the next structural items (Phases 4/7) · F9
(content-tests) begins with the Phase 5 sweep. Foundry: walking skeleton
validated on v14.360; canonical-character Actor import working; pack export v1
(RollTables + attackSpecials, LevelDB) shipping via `deploy:foundry`.

## 8. Summary of recommendations

1. Collapse the verb set onto **slots / flags / declarations** (F1) — the single
   highest-leverage change.
2. Introduce **scoped fact paths** and retire prefix-facts (F2).
3. **Namespace checkpoints by pipeline**; add `test`, `upkeep`, `power`,
   `ship_attack` over time (F3).
4. Extract **per-system policy objects** (DoS, RF, caps, tables) selected per
   request (F4) — the key to RT and the other lines.
5. Make **`{name, level}` canonical**; strings only at the boundary (F5).
6. Add **package headers, rule metadata (book/page), stable ids, and layered
   registries with static `replaces`** (F6).
7. Introduce the **EncounterState document + upkeep pipeline**, designed to
   mirror Foundry ActiveEffects (F7).
8. **Single-source the vocabulary metadata**; derive docs and whitelists (F8).
9. Ship **content-tests with content** (`example` blocks / golden sidecars) (F9).
10. For Foundry: **IR + three backends; vendor the DSL VM; compile AE-shaped
    effects, interpret the rest** (§5).
