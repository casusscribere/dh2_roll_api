# TBD — deferred work, pending decisions, remaining phases

The consolidated to-be-done list (updated 2026-07-08). Sections: **planned
next steps (recommended order)**, **remaining roadmap phases**, **deferred
engine/model gaps**, and **decisions pending**. Detailed design sketches for
the engine gaps live in [POTENTIAL_FEATURES.md](POTENTIAL_FEATURES.md); phase
lane detail in [ROADMAP.md](ROADMAP.md). Suite baseline: 339/339.

## 0. Planned next steps (recommended order)

1. [x] **Roll-page Delta 2 finish** — SHIPPED (2026-07-12): weapon picker on
   preset apply (name/damage/clip per option), d100 skill picker fed by the
   skillTarget mirror (sets target + test name for test.* gating), Psy Rating
   input auto-filled and threaded into the engagement (Force weapons work
   from the UI); exports carry psy + clip back out.
2. [x] **Foundry importer v3** — SHIPPED (2026-07-12): pure mapper
   `api/lib/foundry-actor.mjs` (headlessly tested vs the DH3 template
   shapes; 7 tests incl. the whole roster) — characteristics with advances +
   summed modifiers-by-source (attribution in flags), camelCase skills with
   specialist specialities, xp → experience, tarot → bio.divination, embedded
   Items for weapons (clip/equipped/weight)/gear/aptitudes/talents/traits/
   psychic powers (loadout flag)/disorders/malignancies/mutations/critical
   injuries/force field. `game.dh2vm.importCharacter` uses it. Deliberate
   simplifications: weapon qualities ride in description+flags (attackSpecial
   pack-linking is Phase 8); skill modifiers have no DH3 field → flags only.
   NOT yet live-validated in a Foundry world (join-smoke assertion pending —
   run `node tools/foundry-test/test-dh2vm-smoke.mjs` with Foundry up).
3. **Phase 6 — psychic powers** — the pipeline pattern is proven (attack /
   test / upkeep); both campaign psykers now carry imported power lists with
   equipped loadouts as immediate test content. Includes the Force-weapon
   Focus Power rider (the last weapon-quality asterisk).
4. **Phase 5 talent sweep in tranches**, building the small seams as needed —
   the critical-damage model first (unblocks Deathdealer AND richer Righteous
   Fury), then attack-sequence state (Double Tap), shooting-into-melee
   (Target Selection), the Stun action's special resolution.
5. **Phase 7 — Rogue Trader policies** — the campaign's actual system;
   everything above is the DH2 chassis it layers onto via `POLICIES.rt1` +
   `rt1.*` packs + `ship_attack`.
6. Along the way: **decide D9** (roster in the public Pages bundle — the
   roster is now player-name-free, but the PCs' full builds still ship; an
   exclude flag is one line), and the **engine half of ammo** (refuse-empty,
   `consume_ammo`, Recharge economy).

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

- [~] **Ammo tracking** — PARTIALLY SHIPPED (2026-07-08): the engine reports
      `ammoUsed` per attack (p.144 mode costs, Maximal ×3 enforced), weapons
      carry `clip { max, value }`, and the Roll page ticks the clip down with
      insufficient/empty warnings + reload. Still open: engine-side clip
      STATE (the engine doesn't refuse to fire an empty clip — UI-advisory
      only), a `consume_ammo <expr>` DSL action for qualities with custom
      costs, and the Recharge/Overheats cooldown economy.
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
- [x] **Roll-UI preset dropdown (CHARACTER_MODEL.md §6b Deltas 1+3)** — SHIPPED
      (2026-07-08) on the v1-lossy adapter: `npm run import:campaign` parses
      the ten active PCs' workbooks (anchor-label scanning) into
      `api/data/characters/roster.mjs`; `GET /api/characters`; player-grouped
      dropdown sharing the file-upload validate/apply path; lossiness recorded
      per document in `source.unmapped` and shown in the status panel.
      D10 resolved as proposed (explicit re-run only). **D9 still open**: the
      roster is currently bundled by `build:static` — decide before the next
      Pages publish whether PC data should ship (exclude flag is trivial).
- [x] **Schema v2** — SHIPPED (2026-07-08): characteristics as
      { base, advances, modifiers[] } (totals derived), skills incl.
      specialist categories with per-speciality advances, modifiers-by-source
      on characteristics AND skills, XP total/spent/ledger, aptitudes
      (+origin), Emperor's Tarot (⇄ Foundry bio.divination); v1→v2 migration;
      importer fills everything from the workbooks (incl. side-table lores,
      Upgrades→advances, Misc→sourced modifier, XP-spending tab); Characters
      page renders the full Foundry column set. Roster regenerated as v2.
- [x] **Schema v3** — SHIPPED (2026-07-08): equipment with the equip toggle
      (weapons weight/equipped/clip, armourItems deriving per-location AP,
      gear × quantity incl. Stored Inventory as unequipped), RAW-derived
      encumbrance (Table 7-26 p.248) / fatigue threshold (p.233) / movement
      (p.245), psy (→ combatant psyRating), psychicPowers, insanity/
      corruption (+disorders/malignancies/mutations lists), wounds.critical,
      criticalInjuries, amputations. Characters page: Gear + Psychic tabs
      real, state panels on Main. Roster regenerated (psy ratings, gear,
      insanity/corruption imported).
- [ ] **§6b Delta 2 remainder** — Roll-page skill application (d100 box skill
      picker fed by skillTarget), psy rating auto-fill from the preset (the
      combatant now carries it — wire the input), weapon range/mods fields +
      multi-weapon picker on apply.
- [ ] **v3 content the sheets hold but the importer skips**: armour worn as
      items (only the STATS AP scalar is carried), weapon weights (ARMAMENTS
      blocks lack a weight column — gear rows carry them instead).
      SHIPPED since first noted: PSY POWERS block → psychicPowers[] (with
      discipline + equipped loadout flag), weapon clips → clip{max,value},
      disorder/malignancy/mutation names from their sections.
- [ ] **Foundry importer v2** — map the new blocks onto the Actor: skills →
      system.skills (specialities map), xp → system.experience, aptitudes →
      aptitude Items, tarot → bio.divination, modifiers-by-source → item-tied
      bonuses / ActiveEffects.
