/**
 * Character schema v2 (CHARACTER_MODEL.md §4): characteristic objects with
 * modifiers-by-source, skills incl. specialist categories, XP ledger,
 * aptitudes, the Emperor's Tarot, and the v1→v2 migration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_SCHEMA_VERSION, emptyCharacter, validateCharacter, migrateCharacter,
    characterToCombatant, characteristicTotal, skillTarget, modifierTotal, SKILL_DEFS, canonicalSkillName,
} from '../lib/character-schema.mjs';

test('empty character is a valid current-version document', () => {
    const doc = emptyCharacter('Test');
    assert.ok(CHARACTER_SCHEMA_VERSION >= 2);
    const r = validateCharacter(doc);
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(doc.characteristics.ws, { base: 30, advances: 0, modifiers: [] });
});

test('v1 documents migrate losslessly: flat ints become { base, advances, modifiers }', () => {
    const v1 = {
        schemaVersion: 1, kind: 'dh2.character', name: 'Legacy',
        characteristics: { ws: 45, bs: 40, s: 30, t: 30, ag: 35, int: 30, per: 30, wp: 30, fel: 30 },
    };
    const d = migrateCharacter(v1);
    assert.equal(d.schemaVersion, CHARACTER_SCHEMA_VERSION);
    assert.deepEqual(d.characteristics.ws, { base: 45, advances: 0, modifiers: [] });
    assert.equal(characteristicTotal(d, 'ws'), 45);          // total preserved
    assert.deepEqual(d.skills, {});
    assert.deepEqual(d.xp, { total: 0, ledger: [] });
    assert.ok(validateCharacter(d).ok);
});

test('characteristic total = base + 5×advances + Σ modifiers-by-source', () => {
    const doc = emptyCharacter();
    doc.characteristics.bs = { base: 43, advances: 5, modifiers: [{ value: 5, source: 'Custom Grip' }, { value: -10, source: 'Old Wound' }] };
    assert.equal(characteristicTotal(doc, 'bs'), 43 + 25 + 5 - 10);
    assert.equal(modifierTotal(doc.characteristics.bs.modifiers), -5);
    const cb = characterToCombatant(doc);
    assert.equal(cb.characteristics.bs, 63);                 // combatant sees the derived total
});

test('skillTarget: RAW untrained (½ char) and +0/+10/+20/+30 at advances 1–4', () => {
    const doc = emptyCharacter();
    doc.characteristics.int = { base: 50, advances: 0, modifiers: [] };
    assert.equal(skillTarget(doc, 'Tech-Use').target, 25);   // untrained
    doc.skills['Tech-Use'] = { advances: 1 };
    assert.equal(skillTarget(doc, 'Tech-Use').target, 50);
    doc.skills['Tech-Use'].advances = 4;
    assert.equal(skillTarget(doc, 'Tech-Use').target, 80);
});

test('skill modifiers are tied to their source: +20 Tech-Use from an equipped item', () => {
    const doc = emptyCharacter();
    doc.characteristics.int = { base: 50, advances: 0, modifiers: [] };
    doc.skills['Tech-Use'] = { advances: 1, modifiers: [{ value: 20, source: 'Good Bionic Eyes' }] };
    const r = skillTarget(doc, 'Tech-Use');
    assert.equal(r.target, 70);
    assert.deepEqual(r.modifiers, [{ value: 20, source: 'Good Bionic Eyes' }]);
});

test('specialist skills: per-speciality advances; unknown speciality is untrained', () => {
    const doc = emptyCharacter();
    doc.characteristics.int = { base: 60, advances: 0, modifiers: [] };
    doc.skills['Scholastic Lore'] = {
        modifiers: [{ value: 10, source: 'Infused Knowledge' }],   // skill-wide
        specialities: { 'Occult': { advances: 2, modifiers: [{ value: 5, source: 'Grimoire' }] } },
    };
    const occ = skillTarget(doc, 'Scholastic Lore', 'Occult');
    assert.equal(occ.target, 60 + 10 + 10 + 5);              // trained(2)=+10, both modifier layers
    const unknown = skillTarget(doc, 'Scholastic Lore', 'Numerology');
    assert.equal(unknown.target, 30 + 10);                   // untrained ½ char, skill-wide mod still applies
    assert.equal(unknown.trained, false);
});

test('spelling-blind skill names: scholastic_lores ≡ Scholastic Lore', () => {
    assert.equal(canonicalSkillName('scholastic_lores'), 'Scholastic Lore');
    assert.equal(canonicalSkillName('TechUse'), 'Tech-Use');
    const doc = emptyCharacter();
    doc.skills['forbidden_lore'] = { specialities: { Heresy: { advances: 1 } } };
    assert.equal(skillTarget(doc, 'Forbidden Lore', 'heresy').trained, true);
});

test('validation: modifier shape, advances bounds, specialist misuse, tarot, xp', () => {
    const doc = emptyCharacter();
    doc.characteristics.ws.modifiers = [{ value: 'lots' }];
    doc.skills['Dodge'] = { advances: 9 };
    doc.skills['Athletics'] = { specialities: { X: { advances: 1 } } };   // not specialist → warning
    doc.skills['Made-Up Skill'] = { advances: 1 };                        // unknown → warning
    doc.xp = { total: -5, ledger: [{ name: 'x' }] };
    doc.tarot = { card: 7 };
    const r = validateCharacter(doc);
    const paths = r.errors.map((e) => e.path);
    assert.ok(paths.includes('characteristics.ws.modifiers[0]'));
    assert.ok(paths.includes('skills.Dodge.advances'));
    assert.ok(paths.includes('xp.total'));
    assert.ok(paths.includes('xp.ledger[0]'));
    assert.ok(paths.includes('tarot.card'));
    const warnPaths = r.warnings.map((w) => w.path);
    assert.ok(warnPaths.includes('skills.Athletics.specialities'));
    assert.ok(warnPaths.includes('skills.Made-Up Skill'));
});

test('aptitudes and tarot round-trip validation', () => {
    const doc = emptyCharacter();
    doc.aptitudes = ['Finesse', { name: 'Ballistic Skill', source: 'Role' }];
    doc.tarot = { card: 'The Emperor', text: 'To serve is to live.', effect: '+3 Fate threshold' };
    assert.ok(validateCharacter(doc).ok);
});

test('every SKILL_DEFS characteristic key is a real characteristic', () => {
    const keys = new Set(['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel']);
    for (const [name, def] of Object.entries(SKILL_DEFS)) assert.ok(keys.has(def.characteristic), name);
});
