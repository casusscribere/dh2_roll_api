# Character object model v2 — planning document

*Session: 2026-07-08. Status: **schema v2 SHIPPED** (characteristics as
base/advances/modifiers, skills incl. specialist categories, modifiers-by-
source, XP ledger, aptitudes, Emperor's Tarot — see character-schema.mjs and
schema-v2.test.mjs; roster regenerated; Characters page renders it). Still
open: §6b Delta 2 remainder (Roll-page skill/psy/clip plumbing), Foundry
importer v2, and the §7 decisions not yet exercised. Companion to
[TBD.md](TBD.md) §4.*

## 1. Goal

One character, three representations, one source of truth:

1. **Canonical JSON** (engine): versioned document, validated by
   `validateCharacter`, consumed by `characterToCombatant`, produced/read by the
   Roll UI and the import adapters.
2. **Foundry Actor** (module): a best-practices `acolyte`-type Actor in the
   `dark-heresy-3rd-edition` system — actor system-data for stats/pools/skills,
   **embedded Items** for everything list-shaped, ActiveEffects for conditions,
   module **flags** for house content.
3. The campaign's **spreadsheet sheets** (import source): the RT2 campaign's
   custom workbook (`ORIGINAL MATERIALS/RT_GDRIVE/Character Sheets/`), which is
   richer than schema v1 in specific, enumerable ways (see §3).

## 2. Evidence surveyed

**Schema v1** (Phase 2): identity, nine characteristics (flat ints), unnatural
(ws/bs/s/t/ag only), per-location armour ints, wounds/fate pools, four rule
lists, weapons (damage/pen/type/rof/qualities/craftsmanship/sbx), force field,
import provenance. No skills, no XP, no origin, no gear, no psy, no
corruption/insanity.

**Foundry DH3 system** (v14-validated, our primary Lane C target):
- Actor types `acolyte | npc | vehicle`. Acolyte = `base` + `creature` templates
  + bio/experience/insanity/corruption/aptitudes/backgroundEffects.
- `characteristics.<name>` = `{ label, short, base, advance, modifier,
  unnatural, cost }` — **base + advances, total derived**, never a stored total.
- Pools: `wounds { max, value, critical, rolled }`, `fatigue { max, value }`,
  `fate { max, value, rolled }`, `psy { rating, sustained, class, hasFocus }`.
- `skills.<key>` = `{ label, characteristics[], selectedCharacteristic, advance,
  isSpecialist, specialities{}, cost }` — specialist skills carry a
  **specialities map**, not duplicated rows.
- **Armour is not actor data** — it derives from embedded `armour` Items
  (per-location AP + `maxAgility`), modified by nested `armourModification`s.
- Items are **containers**: `weapon` nests `weaponModification | attackSpecial |
  ammunition` and carries `clip { max, value }`; 25 item types include
  `aptitude`, `talent`, `trait`, `psychicPower`, `forceField`, `cybernetic`,
  `mutation`, `malignancy`, `mentalDisorder`, `criticalInjury`,
  `specialAbility`, `peer`, `storageLocation`.

**Campaign workbook** (per-player files + `Blank Sheet v3.xlsx`; live sheets
examined: Augustine Haake (Heretek Sage), Ogg (Ogryn / Tau Convert / Warrior)):
- Tabs: Character Sheet · Experience Spending (ledger) · Stored Inventory ·
  Upgrades and Ammo · Ranged Weapons / Armor / Gear (reference data) · All
  Skills · Critical Damage Table.
- Character Sheet regions: XP (Total/Used/Remaining + last-gained date); STATS
  pools (Fate, Wounds, Carrying current/max, Armor, Fatigue, Psy Rating);
  CHARACTERISTICS (Score + per-characteristic **Upgrades count** + separate
  **Unnatural** column; Insanity/Corruption/**Influence** listed alongside);
  CREATION (Homeworld/Background/Role + **Elite Advance** row — Ogg:
  "Ogryn / Tau Convert / Warrior / The Fragmented"); APTITUDES (+source);
  TALENTS (+source, often with XP cost); EQUIPMENT (+weight); SHIELDING (force
  field); ARMAMENTS (weapon blocks: Name, Quality, RoF `S/3/10`, Range `80m`,
  Damage, Pen, **Clip**, Special = qualities, plus a **mods line** — "Custom
  Grip (+5), Motion-Predictor…"); WEAPON TRAINING list; GRENADES; PSY POWERS
  (Power/Tree/Notes); MUTATIONS/MALIGNANCIES; OTHER TRAITS (freeform house
  abilities); house mechanics (**Dramatic Moment** uses, **Additional Dice**);
  SKILLS (Name/Char/Score/Rank/Misc/derived DoS) with specialist groups
  (Common/Forbidden/Scholastic Lores, Linguistics, Navigate, Operate) as
  per-speciality rank tables.
- `RT2 stats.xlsx` chargen matrix confirms **xenos/abhuman PCs** (Tau Fire
  Warrior, Ogryn Guevesa, Ratling) — species is expressed via
  Homeworld/Background + traits, not a dedicated field.
- Embedded d10/d100 roller and DoS columns are sheet conveniences (derived) —
  not character state.

## 3. Gap analysis — spreadsheet → v1 → proposed v2 → Foundry

| Spreadsheet region | v1 | v2 proposal | Foundry mapping |
|---|---|---|---|
| Name / player | `name` | + `player` | Actor.name / bio |
| CREATION row + Elite Advance | — | `origin { homeworld, background, role, eliteAdvances[] }` | bio + backgroundEffects |
| Characteristics Score | flat int | `{ base, advances, misc }`, **total derived** | characteristics (1:1) |
| Upgrades count | — | `characteristics.<k>.advances` | `.advance` |
| Unnatural column | ws/bs/s/t/ag only | all nine keys | `.unnatural` |
| Insanity / Corruption | — | `insanity { points, disorders[] }`, `corruption { points, malignancies[] }` | actor insanity/corruption + mentalDisorder/malignancy Items |
| Influence | — | `influence` (int) | bio (DH2 Influence) |
| STATS pools | wounds, fate | + `fatigue`, `psy { rating, class, sustained }`, carrying **derived** | fatigue/psy 1:1 |
| XP block + Spending tab | — | `xp { total, ledger[] { name, cost, source?, date? } }` (`used` derived) | experience + item `cost` fields |
| APTITUDES | — | `aptitudes[] { name, source? }` | aptitude Items / actor.aptitudes |
| SKILLS + Lore tables | — | `skills { <key>: { advances, misc?, characteristic?, specialities?{} } }` | skills (1:1, incl. specialist map) |
| TALENTS + source | `talents[]` | entries gain `source?`, `notes?` | talent Items |
| OTHER TRAITS (house) | `traits[]` (name-only) | traits[] + `notes`; freeform → `extensions` | specialAbility Items / flags |
| ARMAMENTS blocks | weapons[] | + `clip { max, value }`, `range` (m), `mods[]`, `weight?` | weapon Item + nested mods/ammo |
| WEAPON TRAINING | — | `weaponTrainings[]` | talent Items (WT (X)) |
| SHIELDING | `field` | keep | forceField Item |
| EQUIPMENT / Stored Inventory | — | `gear[] { name, weight?, notes?, stored? }` | gear/tool/consumable Items + storageLocation |
| PSY POWERS | — | `psychicPowers[] { name, discipline?, notes? }` (Phase 6 will extend) | psychicPower Items |
| Bionics ("Bionic Arm (Right)") | in gear text | `cybernetics[]` (optional; else gear) | cybernetic Items |
| Dramatic Moment / Additional Dice | — | `extensions { <ns>: … }` (preserved, unvalidated) | `flags["dh2-roll-vm"].<ns>` |
| Dice roller / DoS columns | — | **not modeled** (derived/convenience) | — |
| Reference tabs | — | **not character state** (they are the weapon/armour DB) | compendium packs |

## 4. Proposed canonical JSON (schema v2, sketch)

```json
{
  "schemaVersion": 2,
  "kind": "dh2.character",
  "system": "dh2",
  "name": "Augustine Haake",
  "origin": { "homeworld": "Research Station", "background": "Heretek",
              "role": "Sage", "eliteAdvances": [] },
  "characteristics": { "ws": { "base": 26, "advances": 1, "misc": 0 }, "…": {} },
  "unnatural": { "s": 2, "t": 2 },
  "pools": {
    "wounds":  { "max": 10, "current": 10, "criticalDamage": 0 },
    "fate":    { "max": 4, "current": 1 },
    "fatigue": { "current": 0 },
    "psy":     { "rating": 0, "class": "bound", "sustained": 0 },
    "corruption": { "points": 9 }, "insanity": { "points": 40 },
    "influence": 19
  },
  "xp": { "total": 37000, "ledger": [ { "name": "Mighty Shot", "cost": 600, "source": "Core RB" } ] },
  "aptitudes": [ { "name": "Finesse", "source": "Background" } ],
  "skills": {
    "dodge": { "advances": 4 },
    "forbiddenLore": { "specialities": { "Archaeotech": { "advances": 1 } } }
  },
  "talents": [ { "name": "Mighty Shot", "source": "xp" } ],
  "traits": [ "Sturdy" ],
  "weaponTrainings": [ "Solid Projectile", "Plasma", "Shuriken" ],
  "conditions": [], "circumstances": [],
  "weapons": [ { "name": "Shuriken Catapult", "class": "basic",
                 "damage": "1d10+4", "damageType": "Rending", "pen": 3,
                 "rof": { "single": true, "burst": 3, "full": 10 },
                 "clip": { "max": 120, "value": 120 }, "range": 80,
                 "qualities": ["Razor Sharp", "Reliable"],
                 "mods": ["Custom Grip", "Motion-Predictor"],
                 "craftsmanship": "Common" } ],
  "armour": { "head": 6, "body": 11, "leftArm": 6, "rightArm": 6, "leftLeg": 6, "rightLeg": 6 },
  "field": { "rating": 0, "overloadMax": 0 },
  "gear": [ { "name": "Voidstalker Cloak" }, { "name": "3 Smoke Grenades", "weight": 1.5 } ],
  "psychicPowers": [],
  "extensions": { "rt2-house": { "dramaticMoments": ["Shock and Awe"], "additionalDice": [] } },
  "source": { "adapter": "xlsx-campaign", "file": "Augustine Haake.xlsx", "importedAt": "…" }
}
```

Design rules carried over from v1: named entries accept `"Name (X)"` strings or
objects everywhere (Stage 1 canonicalisation, spelling-blind matching); unknown
keys warn, never error; `migrateCharacter` keeps every old document loadable —
**v1→v2**: flat characteristic int → `{ base: v, advances: 0 }`, missing blocks
default empty, `extensions` passes through untouched.

## 5. Foundry equivalent — best practices to adopt

1. **Actor system-data for scalars, embedded Items for lists.** Never store
   talent/weapon/gear arrays in actor data — create embedded documents so packs,
   drag-drop, and the DH3 sheet all work.
2. **Base + advances, derive totals** (matches both the sheet's Upgrades column
   and DH3). The engine keeps consuming totals via `characterToCombatant`.
3. **Armour as Items, summary derived** — canonical JSON keeps the flat
   per-location summary (what the engine soaks with); the Foundry importer
   builds `armour` Items and lets the system derive. One-way derivation, no
   double bookkeeping.
4. **Weapon mods/ammo as nested items** on the weapon (DH3 `containerTypes`),
   `clip {max, value}` carried now (consumed when the deferred ammo work lands).
5. **Conditions ↔ ActiveEffects** — already how the Phase 4 encounter mirror
   works; character-level conditions use the same mapping.
6. **House content → flags** (`flags["dh2-roll-vm"]`), mirroring the JSON
   `extensions` bag — never invent system fields.
7. **Phase 8**: express this schema as a `TypeDataModel` (v14 DataModel) so the
   FIELDS table and the DataFields are generated from one definition — the v1
   file already names fields 1:1 for this.

## 6. Import path for the campaign workbook

New adapter `tools/adapters/xlsx-campaign.mjs` (pattern: existing Google-Sheets/
Roll20 adapters): read the fixed regions of the Character Sheet tab
(anchor-label scan, not cell coordinates — the sheets drift), the Experience
Spending ledger, and Stored Inventory; emit schema v2 JSON; `--report` mode
lists unmapped cells so house content lands in `extensions` visibly, not
silently. Reference tabs (Ranged Weapons/Armor/Gear) are the campaign's item
database — candidates for pack generation later, not character state.

## 6b. Roll-UI character loading — JSON upload + campaign preset roster

*(planned this session; sequenced into §8 below by dependency)*

**What exists (Phase 2):** the Roll page's "Character import / export" panel —
a JSON **file** input, →Attacker/→Defender apply (stats, unnaturals, weapon,
rule-panel toggles with levels), export back to JSON, and `/api/character/
validate` surfacing field-level errors in `#char-status`.

**Delta 1 — preset dropdown (plumbing; schema-agnostic).**
- `api/data/characters/*.json` — a checked-in roster directory of canonical
  character documents, each stamped with `source` provenance.
- `GET /api/characters` → `[{ id, name, player, system, schemaVersion }]`;
  `GET /api/characters/<id>` → the document. Both trivially bundleable for the
  static build (the docs/ shim serves the same JSON).
- Roll page: a **Preset** `<select>` beside the file input (a flat character
  list — human player names are deliberately NOT stored or shown), plus a
  Refresh. Selecting a preset routes through the SAME path as a file upload:
  fetch → `migrateCharacter` → `validateCharacter` → status panel →
  →Attacker/→Defender buttons. One code path, two sources.

**Delta 2 — apply-coverage upgrade (depends on schema v2).**
`applyCharacter(side)` today sets characteristics/unnaturals/weapon/armour/
rule toggles. With v2 it additionally sets: skills → the d100 test box (skill
picker with computed target), `pools.psy.rating` → the Force/psyker input,
weapon `clip`/`range`/`mods` → the weapon panel (clip display until the ammo
engine lands), fatigue/wounds → encounter-tracker seeding, and a **weapon
picker** when the document carries several weapons (the sheets all do) instead
of silently taking `weapons[0]`. Unmapped v2 blocks (xp, aptitudes,
extensions) surface in `#char-status` as "carried, not applied".

**Delta 3 — roster generation (depends on the xlsx adapter).**
`npm run import:campaign` — batch-runs the xlsx-campaign adapter over
`ORIGINAL MATERIALS/RT_GDRIVE/Character Sheets/` (active player folders only;
`Unused-Dead-Inactive` excluded) and writes `api/data/characters/`. Re-runnable
whenever the sheets change; the adapter's `--report` lists unmapped cells per
character.

**Dependency chain / staging.** Delta 1 has no schema dependency — it can ship
immediately with hand-authored **schema-v1 preset stubs** (stats + main weapon
+ talents, lossy). Faithful presets and full apply-coverage require v2 + the
adapter. To avoid double work the roster is generated once, after the adapter
exists (§8 step 4); only the dropdown plumbing lands early (step 0-capable).

**New decisions raised** (added to §7): D9 privacy — checked-in campaign PC
data would be published by the GitHub Pages deploy; D10 preset freshness —
regenerate on demand vs at build time.

## 7. Open decisions (answer before implementation)

1. **Characteristic advances**: store count (sheet) with system-defined step
   (+5), or store the derived value? *Proposal: count.*
2. **Skill key set**: adopt DH3's skill keys verbatim (1:1 Foundry mapping,
   incl. `isSpecialist` groups) vs a DH2-core-native list? *Proposal: DH3 keys —
   they already model DH2's skill list.*
3. **XP ledger**: import the full spending history or just totals? *Proposal:
   full ledger (it exists, it's cheap, it answers "where did the XP go").*
4. **Cybernetics**: first-class list or gear entries? *Proposal: first-class
   (DH3 has the item type; two sheets have bionics).*
5. **Species/xenos PCs**: keep species implicit in origin + traits (as the
   campaign does) or add a `species` field? *Proposal: implicit; a trait pack
   per species carries the mechanics (Ogryn traits etc.).*
6. **`kind`/`system` for the RT campaign**: keep `dh2.character` with
   `system: "rt2-house"`? The campaign runs DH2-style chargen, so the document
   kind stays; the system tag selects policies later (Phase 7).
7. **Influence vs Profit Factor**: sheet tracks Influence (DH2); RT Profit
   Factor arrives with Phase 7 policies — reserve `pools.profitFactor`?
8. **Where does `weaponTrainings` bite?** Enumerate now; a later mechanic rule
   can warn when firing an untrained class (same advisory pattern as the
   talent gates).
9. **Preset privacy (§6b):** `api/data/characters/` would ship with
   `build:static` → published on GitHub Pages. Options: (a) keep presets out of
   the static bundle (dev-server only — *proposed default*), (b) an opt-in
   build flag, (c) publish (campaign group may not care). Decide before the
   roster lands in the repo.
10. **Preset freshness (§6b):** regenerate the roster only via explicit
    `npm run import:campaign` (proposed — deterministic, reviewable diffs) vs
    hooking it into the build.

## 8. Suggested execution order (when green-lit)

Dependency-ordered; §6b items interleaved where their prerequisites are met.

1. Schema v2 in `character-schema.mjs` (fields + validation + v1→v2 migration) + tests.
   - *(parallel-capable, no schema dependency)* **§6b Delta 1**: preset
     endpoints + Roll-page dropdown, exercised with 1–2 hand-authored v1 stubs.
2. `characterToCombatant` upgrade (derived totals, skills for `test.*`, clip passthrough).
3. xlsx-campaign adapter + round-trip test against two real sheets (Augustine, Ogg).
4. **§6b Delta 3**: `npm run import:campaign` → generate the core-character
   roster into `api/data/characters/` (active folders only; honour decision D9
   before committing).
5. Roll-page apply-coverage upgrade (**§6b Delta 2**): skills → d100 box,
   psy rating, clip/range/mods, multi-weapon picker, "carried, not applied"
   reporting; export upgraded to emit v2.
6. Foundry importer v2 (embedded Items per §5) + join-smoke assertions.
7. (Phase 8) TypeDataModel generation from the FIELDS table.
