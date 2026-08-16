/**
 * Fixes for two defects recorded in
 * `../../../../docs/DH2_ROLL_API_FINDINGS_2026-07-30.md`:
 *
 *  - **D-4** — `tools/merge-characters.mjs` `buildConflictPaths()` only ever
 *    emitted `skills.<Name>.advances`, so for the seven specialist skills
 *    (Common/Forbidden/Scholastic Lore, Linguistics, Navigate, Operate, Trade)
 *    — whose `.advances` is `undefined` on both sides — a differing
 *    per-speciality advance was overridden by the xlsx side and never recorded
 *    in `source.conflicts[]`, against the module header's promise that
 *    "nothing is silently dropped".
 *
 *  - **D-9** — `api/lib/foundry-actor.mjs` emitted one Item per `talents`
 *    entry AND one per `weaponTrainings` entry, so a character carrying both
 *    `Weapon Training (Las)` (talent) and `weaponTrainings: ['Las']` got the
 *    same talent Item twice, at two different tiers. Real for several campaign
 *    PCs (Rex Hellerand, Ogg).
 *
 * The de-dupe is deliberately scoped to SET-VALUED item types (talents): a
 * character genuinely can carry two Lasguns or two pict recorders, so
 * weapons/armour/gear duplicates must survive — those cases are pinned below
 * so the scope cannot be widened by accident.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCharacter } from '../../tools/merge-characters.mjs';
import { characterToFoundryActor } from '../lib/foundry-actor.mjs';
import { migrateCharacter } from '../lib/character-schema.mjs';

// ---------------------------------------------------------------------------
// D-4 — speciality conflicts
// ---------------------------------------------------------------------------

/** Minimal v4 doc carrying only the skills under test. */
const doc = (name, skills) => ({
    schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name, skills,
});

const conflictPaths = (x, r) => mergeCharacter(x, r).conflicts.map((c) => c.path);

test('D-4: a differing speciality advance is recorded as a conflict, xlsx winning', () => {
    const { doc: merged, conflicts } = mergeCharacter(
        doc('Rex', { 'Forbidden Lore': { specialities: { Xenos: { advances: 3 } } } }),
        doc('Rex', { 'Forbidden Lore': { specialities: { Xenos: { advances: 1 } } } }),
    );
    const c = conflicts.find((c) => c.path === 'skills.Forbidden Lore.specialities.Xenos.advances');
    assert.ok(c, `speciality conflict missing: ${JSON.stringify(conflicts.map((c) => c.path))}`);
    assert.equal(c.xlsx, 3);
    assert.equal(c.roll20, 1);
    assert.equal(c.winner, 'xlsx');
    // the xlsx value still wins the merge — only the reporting was broken
    assert.equal(merged.skills['Forbidden Lore'].specialities.Xenos.advances, 3);
    assert.deepEqual(merged.source.conflicts, conflicts);
});

test('D-4: each differing speciality of a skill gets its own conflict; equal ones get none', () => {
    const paths = conflictPaths(
        doc('Rex', {
            'Scholastic Lore': {
                specialities: { Occult: { advances: 2 }, Legend: { advances: 1 }, Numerology: { advances: 4 } },
            },
        }),
        doc('Rex', {
            'Scholastic Lore': {
                specialities: { Occult: { advances: 0 }, Legend: { advances: 1 }, Numerology: { advances: 2 } },
            },
        }),
    );
    assert.ok(paths.includes('skills.Scholastic Lore.specialities.Occult.advances'));
    assert.ok(paths.includes('skills.Scholastic Lore.specialities.Numerology.advances'));
    assert.ok(!paths.includes('skills.Scholastic Lore.specialities.Legend.advances'),
        'equal advances are not a conflict');
});

test('D-4: specialities are reported across several skills at once', () => {
    const paths = conflictPaths(
        doc('Rex', {
            Linguistics: { specialities: { 'Low Gothic': { advances: 3 } } },
            Navigate: { specialities: { Surface: { advances: 2 } } },
            Trade: { specialities: { Armourer: { advances: 1 } } },
        }),
        doc('Rex', {
            Linguistics: { specialities: { 'Low Gothic': { advances: 1 } } },
            Navigate: { specialities: { Surface: { advances: 2 } } },
            Trade: { specialities: { Armourer: { advances: 4 } } },
        }),
    );
    assert.ok(paths.includes('skills.Linguistics.specialities.Low Gothic.advances'));
    assert.ok(paths.includes('skills.Trade.specialities.Armourer.advances'));
    assert.ok(!paths.includes('skills.Navigate.specialities.Surface.advances'));
});

test('D-4: a speciality only one side carries is not a conflict (nothing was overridden)', () => {
    // xlsx-only — taken as-is, same rule the whole-skill level already follows
    const xlsxOnly = conflictPaths(
        doc('Rex', { 'Common Lore': { specialities: { Imperium: { advances: 2 } } } }),
        doc('Rex', { 'Common Lore': { specialities: {} } }),
    );
    assert.deepEqual(xlsxOnly.filter((p) => p.includes('specialities')), []);
    // roll20-only — build data, so the xlsx side (which has none) still wins;
    // no value of the xlsx side was overridden, so no conflict is reported
    const roll20Only = conflictPaths(
        doc('Rex', { 'Common Lore': { specialities: {} } }),
        doc('Rex', { 'Common Lore': { specialities: { Imperium: { advances: 2 } } } }),
    );
    assert.deepEqual(roll20Only.filter((p) => p.includes('specialities')), []);
});

test('D-4: identical speciality maps on both sides produce no conflicts at all', () => {
    const same = { 'Forbidden Lore': { specialities: { Xenos: { advances: 3 }, Warp: { advances: 1 } } } };
    assert.deepEqual(conflictPaths(doc('Rex', same), doc('Rex', same)), []);
});

test('D-4: non-specialist skills still report at the .advances level only', () => {
    const paths = conflictPaths(
        doc('Rex', { Dodge: { advances: 3 } }),
        doc('Rex', { Dodge: { advances: 1 } }),
    );
    assert.deepEqual(paths, ['skills.Dodge.advances']);
});

// ---------------------------------------------------------------------------
// D-9 — duplicate Items out of foundry-actor
// ---------------------------------------------------------------------------

const actorDoc = (extra) => migrateCharacter({
    schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: 'Rex Hellerand', ...extra,
});

const named = (m, name) => m.items.filter((i) => i.name === name);

test('D-9: a talent and its weaponTrainings twin collapse into one Item', () => {
    const m = characterToFoundryActor(actorDoc({
        talents: ['Weapon Training (Las)'], weaponTrainings: ['Las'],
    }));
    assert.equal(named(m, 'Weapon Training (Las)').length, 1);
});

test('D-9: the surviving Item keeps the known tier rather than the unset 0', () => {
    // talents-derived entries carry tier 0 when the sheet did not record one;
    // the weaponTrainings stub knows Weapon Training is tier 1.
    const m = characterToFoundryActor(actorDoc({
        talents: [{ name: 'Weapon Training (Las)', tier: 0 }], weaponTrainings: ['Las'],
    }));
    const [wt] = named(m, 'Weapon Training (Las)');
    assert.equal(wt.system.tier, 1);

    // …and a tier the talent entry really carries is never overwritten
    const m2 = characterToFoundryActor(actorDoc({
        talents: [{ name: 'Weapon Training (Las)', tier: 2, notes: 'house rule' }],
        weaponTrainings: ['Las'],
    }));
    const [wt2] = named(m2, 'Weapon Training (Las)');
    assert.equal(wt2.system.tier, 2);
    assert.equal(wt2.system.benefit, 'house rule');
});

test('D-9: the survivor keeps its own ref/dsl flags', () => {
    const m = characterToFoundryActor(actorDoc({
        talents: [{ name: 'Weapon Training (Las)', ref: 'dh2:talent:weapon_training' }],
        weaponTrainings: ['Las'],
    }));
    const wt = named(m, 'Weapon Training (Las)');
    assert.equal(wt.length, 1);
    assert.equal(wt[0].flags?.['dh2-roll-vm']?.ref, 'dh2:talent:weapon_training');
});

test('D-9: flags a LOSING duplicate carries are folded into the survivor', () => {
    // first entry bare, second one carrying the builder addendum: the first
    // keeps its place, but its ref/dsl provenance must not be thrown away.
    const m = characterToFoundryActor(actorDoc({
        talents: [
            { name: 'Hatred (Xenos)' },
            { name: 'Hatred (Xenos)', ref: 'dh2:talent:hatred', dsl: 'talent "Hatred"' },
        ],
    }));
    const [h] = named(m, 'Hatred (Xenos)');
    assert.equal(m.items.filter((i) => i.type === 'talent').length, 1);
    assert.equal(h.flags['dh2-roll-vm'].ref, 'dh2:talent:hatred');
    assert.equal(h.flags['dh2-roll-vm'].dsl, 'talent "Hatred"');
});

test('D-9: a survivor\'s own flag value is never overwritten by the duplicate\'s', () => {
    const m = characterToFoundryActor(actorDoc({
        talents: [
            { name: 'Hatred (Xenos)', ref: 'dh2:talent:hatred' },
            { name: 'Hatred (Xenos)', ref: 'homebrew:hatred' },
        ],
    }));
    const [h] = named(m, 'Hatred (Xenos)');
    assert.equal(h.flags['dh2-roll-vm'].ref, 'dh2:talent:hatred');
});

test('D-9: genuinely distinct weapon trainings are NOT merged', () => {
    const m = characterToFoundryActor(actorDoc({
        talents: ['Weapon Training (Las)', 'Weapon Training (Bolt)'],
        weaponTrainings: ['Las', 'Bolt', 'Chain'],
    }));
    const trainings = m.items.filter((i) => i.name.startsWith('Weapon Training'));
    assert.deepEqual(trainings.map((i) => i.name).sort(),
        ['Weapon Training (Bolt)', 'Weapon Training (Chain)', 'Weapon Training (Las)']);
});

test('D-9: duplicates within the talents list itself collapse, case-insensitively', () => {
    const m = characterToFoundryActor(actorDoc({
        talents: ['resistance', 'resistance', 'Sound  Constitution', 'sound constitution'],
    }));
    assert.equal(m.items.filter((i) => i.type === 'talent').length, 2);
});

test('D-9: de-duping is scoped to talents — countable possessions survive twice', () => {
    const m = characterToFoundryActor(actorDoc({
        weapons: [{ name: 'Lasgun', damage: '1d10+3' }, { name: 'Lasgun', damage: '1d10+3' }],
        gear: [{ name: 'Pict Recorder', equipped: true }, { name: 'Pict Recorder', equipped: false }],
        talents: ['Pict Recorder'],   // same name, different type — also distinct
    }));
    assert.equal(m.items.filter((i) => i.type === 'weapon' && i.name === 'Lasgun').length, 2);
    assert.equal(m.items.filter((i) => i.type === 'gear' && i.name === 'Pict Recorder').length, 2);
    assert.equal(m.items.filter((i) => i.type === 'talent' && i.name === 'Pict Recorder').length, 1);
});

test('D-9: item order is otherwise untouched', () => {
    const m = characterToFoundryActor(actorDoc({
        aptitudes: ['General'],
        talents: ['Weapon Training (Las)', 'Quick Draw'],
        weaponTrainings: ['Las'],
        traits: ['Sturdy'],
    }));
    assert.deepEqual(m.items.map((i) => `${i.type}:${i.name}`), [
        'aptitude:General',
        'talent:Weapon Training (Las)',
        'talent:Quick Draw',
        'trait:Sturdy',
    ]);
});
