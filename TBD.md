# TBD — deferred work, pending decisions, remaining phases

The consolidated to-be-done list (2026-07-08). Three sections: **remaining
roadmap phases**, **deferred engine/model gaps**, and **decisions pending**.
Detailed design sketches for the engine gaps live in
[POTENTIAL_FEATURES.md](POTENTIAL_FEATURES.md); phase lane detail in
[ROADMAP.md](ROADMAP.md). Suite baseline at time of writing: 311/311.

## 1. Remaining roadmap phases

### Phase 5 tail — content sweep (IN PROGRESS)
- [ ] Talent/trait long-tail sweep (~13 of ~100 attack-relevant rules authored).
      Split per rule: *authorable now* vs *blocked on a seam* (see §3).
- [ ] Lane C playtest scenario: a Foundry test world exercising the swept
      content; defect list feeds back to Lane A.
- [ ] Operational: live Foundry install's packs are lock-skipped — close
      Foundry, re-run `npm run deploy:foundry`.

### Phase 6 — Psychic powers
- [ ] `power.*` pipeline (MODIFIERS, POST_ROLL, PHENOMENA, PERILS, EFFECT).
- [ ] Psy rating + push; Phenomena/Perils as `roll_table`s.
- [ ] Force-weapon Focus Power rider (the deferred half of p.145).
- [ ] Lane B: focus-power roller page. Lane C: psychic-power packs.

### Phase 7 — Rogue Trader
- [ ] `POLICIES.rt1` (DoS formula, RF procedure, evasion economy) selected per
      request; `rt1.*` packages layered over `core.*` via `replaces`.
- [ ] `ship_attack` pipeline (components-as-qualities, facing armour via scoped
      facts); Profit Factor / acquisition through `test.*`.
- [ ] Lane B: dh2/rt1 system selector; ship-combat roller. Lane C: RT packs;
      other FFG lines (DH1/DW/BC/OW) repeat as policy + pack, no engine work.

### Phase 8 — Foundry productionisation
- [ ] Freeze IR v2; extract `lib/dsl` + pipeline + policies as the standalone
      rules-VM package (consumed by API, Pages bundle, module).
- [ ] Distributable module: manifest + release URL, versioned pack export in
      CI, v14 compliance pass, schema/pack migration functions.
- [ ] Combat-hook auto-tick for upkeep (`updateCombat` → TURN/ROUND ticks) —
      parked as Phase 8 material in FOUNDRY_MIGRATION.md.

## 2. Deferred engine/model gaps
(sketches in POTENTIAL_FEATURES.md unless noted)

- [ ] **Ammo tracking** — clips/reloads/`consume_ammo`; unblocks Maximal's ×3
      ammo (currently a note) and real Recharge economies.
- [ ] **Range in metres** — numeric range + derived band; unblocks Maximal's
      +10 m and scatter↔band interaction.
- [ ] **Blast on-hit AoE** — secondary targets in the X-metre radius; makes
      `bump_quality "Blast"` load-bearing (currently cosmetic).
- [ ] **Fatigue as tracked state** — Blood Loss / Die Hard / Stun surface
      Fatigue as log events only; no counter on the actor/encounter.
- [ ] **Critical-damage model** — "this hit crit" state feeding the crit
      tables; blocks Deathdealer and richer Righteous Fury handling.
- [ ] **Attack-sequence state** — "second attack vs same target this turn";
      blocks Double Tap.
- [ ] **Shooting-into-melee circumstance** — blocks Target Selection.
- [ ] **Regeneration healing is advisory** — the upkeep Toughness test rolls
      but does not decrement `wounds.taken`; needs an on-PASS effect primitive
      (`require_test … => heal <expr>`-style).

## 3. Decisions pending

**Content policy (per Phase-5 tranche):**
- [ ] For each seam-blocked talent (Deathdealer, Double Tap, Target Selection):
      build the seam vs ship a note-only rule — decide per tranche.
- [ ] **Stun action**: not offered in the action radios because the engine
      would wrongly resolve normal damage; needs its special resolution
      (1d10+SB vs TB + head AP → Stunned + Fatigue, p.224) before listing.
- [ ] **Machine (X)** trait: target-side armour floor — decide how target-side
      profile rules should work before authoring.
- [ ] **Hatred group parameter**: approximated by the "Hated Foe" circumstance
      toggle; revisit if/when target faction matching exists.

**Taxonomy / architecture:**
- [ ] Split the `mechanic` category bin: weapon mechanics / craftsmanship /
      ammo economies / profile modifiers — decide before authoring many more.
- [ ] **Modifications** category (ammo variants, weapon/armour mods as
      swappable profile changers; DH3 models these as nested items).
- [ ] Qualities on **non-weapon items** (armour/gear + an `item_type` fact).
- [ ] Map/scene-aware **auto-applied circumstances** (Foundry Scene Regions).
- [ ] `suppress` / rule-name matching left exact-spelling on purpose —
      normalization covers entry names + actions only; extend or leave.

**UX:**
- [ ] Talents default ON, so a fresh Roll page shows honest-but-noisy
      prerequisite warnings against the default stats. Flip talents to default
      OFF (one-line change) or keep the "everything on" convention.

## 4. Active planning threads
- [ ] **Character object model v2** — Foundry-compliant character datafile:
      canonical JSON in the engine, best-practices Foundry Actor equivalent in
      the module; validated against the RT campaign's custom spreadsheets
      (`ORIGINAL MATERIALS/RT_GDRIVE/Character Sheets/`). See
      CHARACTER_MODEL.md (planning doc, this session).
- [ ] **Roll-UI character loading (CHARACTER_MODEL.md §6b)** — JSON upload
      already exists (Phase 2); add the campaign **preset dropdown**
      (`api/data/characters/` roster + `GET /api/characters[/<id>]`, grouped by
      player, same validate/apply path as file upload), then the v2
      apply-coverage upgrade (skills → d100 box, psy rating, clip/mods,
      multi-weapon picker). Dependency-staged in §8: dropdown plumbing is
      schema-agnostic (can ship now with v1 stubs); the faithful roster waits
      on schema v2 + the xlsx-campaign adapter. Decisions D9 (don't publish PC
      data via the Pages build — proposed) and D10 (regenerate roster only via
      explicit `npm run import:campaign`) gate the roster commit.
