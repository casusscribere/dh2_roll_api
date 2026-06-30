# Foundry VTT migration map — for Claude

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
