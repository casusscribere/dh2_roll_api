# campaign/ — canonical campaign character documents

The data-at-rest home of the character pipeline's hub: one schema-v4 (or later) canonical JSON
document per campaign character, produced by the import/merge lanes described in the workspace
plan `../../docs/ROLL20_CHARACTER_PIPELINE_PLAN_2026-07-23.md` (Part 7.0).

## Contract

- **Contents of `characters/` are git-ignored** (see `.gitignore` here). This is campaign data —
  full PC builds — and workspace decision D9 (whether any of it may ship in the public Pages
  bundle) is unresolved. Until D9 says otherwise, nothing under `characters/` is committed or
  published. This README and the ignore rule are the only tracked files.
- Documents here are **merge outputs**, written by `tools/merge-characters.mjs` (Phase 4 of the
  plan) or, before that exists, by `tools/import-character.mjs --out-dir`. Every document must
  pass `validateCharacter` (`api/lib/character-schema.mjs`) and carries `source` provenance
  identifying its inputs (roll20 dump, xlsx workbook) and any merge conflicts.
- **No human player names** in any document (the roster privacy rule — see
  `CHARACTER_MODEL.md` §6b/D9). Player identity stays in folder names on the GDrive side only.
- The preset roster (`api/data/characters/roster.mjs`) is *generated from* these documents once
  the merge lane lands; regeneration is always explicit (`npm run import:campaign` /
  `import:merged`), never a build side effect.

## Layout

```
campaign/
  README.md          ← this contract (tracked)
  .gitignore         ← ignores characters/ (tracked)
  characters/        ← one <char-id>.json per PC (ignored, created on first import)
  MERGE_REPORT.md    ← latest merge --report output (ignored; regenerate at will)
```
