/**
 * Foundry importer v3 (api/lib/foundry-actor.mjs): the pure character-doc →
 * acolyte-Actor mapper, validated headlessly against the dark-heresy-3rd-
 * edition template shapes and the real campaign roster.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterToFoundryActor, camelKey } from '../lib/foundry-actor.mjs';
import { emptyCharacter, migrateCharacter } from '../lib/character-schema.mjs';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';

const aug = () => migrateCharacter(structuredClone(CHARACTER_ROSTER.find((c) => c.id.includes('augustine')).doc));
const uriel = () => migrateCharacter(structuredClone(CHARACTER_ROSTER.find((c) => c.id.includes('uriel')).doc));

test('camelKey matches the DH3 skill key style', () => {
    assert.equal(camelKey('Tech-Use'), 'techUse');
    assert.equal(camelKey('Sleight of Hand'), 'sleightOfHand');
    assert.equal(camelKey('Forbidden Lore'), 'forbiddenLore');
    assert.equal(camelKey('Dodge'), 'dodge');
});

test('characteristics map base/advance and sum modifiers-by-source into .modifier', () => {
    const doc = emptyCharacter();
    doc.characteristics.bs = { base: 43, advances: 5, modifiers: [{ value: 5, source: 'Custom Grip' }, { value: -10, source: 'Old Wound' }] };
    doc.unnatural = { s: 2 };
    const m = characterToFoundryActor(doc);
    assert.deepEqual(m.system.characteristics.ballisticSkill, { base: 43, advance: 5, modifier: -5, unnatural: 0 });
    assert.equal(m.system.characteristics.strength.unnatural, 2);
    // the per-source attribution survives in flags
    assert.deepEqual(m.flags['dh2-roll-vm'].modifierSources.characteristics.bs,
        [{ value: 5, source: 'Custom Grip' }, { value: -10, source: 'Old Wound' }]);
});

test('skills map to DH3 camel keys with specialist specialities', () => {
    const m = characterToFoundryActor(aug());
    assert.equal(m.system.skills.techUse.advance, 4);
    assert.equal(m.system.skills.dodge.advance, 4);
    const fl = m.system.skills.forbiddenLore;
    assert.equal(fl.isSpecialist, true);
    assert.ok(Object.keys(fl.specialities).length >= 8);
    assert.deepEqual(fl.specialities.archaeotech, { label: 'Archaeotech', advance: 1, cost: 0, taken: true });
});

test('xp → experience, tarot → bio.divination, pools land in DH3 shape', () => {
    const doc = aug();
    doc.tarot = { card: 'The Wanderer', text: 'Trust not the still waters.' };
    const m = characterToFoundryActor(doc);
    assert.deepEqual(m.system.experience, { total: 37000, used: 35950 });
    assert.equal(m.system.bio.divination, 'The Wanderer — Trust not the still waters.');
    assert.equal(m.system.insanity, 40);
    assert.equal(m.system.corruption, 9);
    assert.equal(m.system.wounds.critical, 0);
    assert.equal(m.system.fatigue.max, 11);                 // TB 5 + WB 6
});

test('embedded items: weapons with clip/equipped/weight, aptitudes, powers with loadout flag', () => {
    const m = characterToFoundryActor(aug());
    const cat = m.items.find((i) => i.type === 'weapon' && i.name === 'Shuriken Catapult');
    assert.deepEqual(cat.system.clip, { max: 120, value: 120 });
    assert.equal(cat.system.equipped, true);
    assert.equal(cat.system.craftsmanship, 'common');       // DH3 lowercase
    assert.ok(cat.flags['dh2-roll-vm'].qualities.includes('Razor-Sharp'));
    assert.equal(m.items.filter((i) => i.type === 'aptitude').length, 7);
    assert.equal(m.items.filter((i) => i.type === 'gear').length, 37);
    const u = characterToFoundryActor(uriel());
    const powers = u.items.filter((i) => i.type === 'psychicPower');
    assert.ok(powers.length >= 5);
    assert.equal(powers[0].flags['dh2-roll-vm'].equipped, true);
    assert.equal(u.system.psy.rating, 5);
});

test('afflictions and injuries become their DH3 item types', () => {
    const doc = emptyCharacter();
    doc.insanity = { points: 30, disorders: ['Night Terrors'] };
    doc.corruption = { points: 12, malignancies: ['Palsy'], mutations: ['Third Eye Mutation'] };
    doc.criticalInjuries = [{ location: 'leftArm', effect: 'Mangled fingers: -10 to grip tests', source: 'crit table' }];
    doc.field = { rating: 30, overloadMax: 5 };
    const m = characterToFoundryActor(doc);
    const types = m.items.map((i) => i.type);
    assert.ok(types.includes('mentalDisorder'));
    assert.ok(types.includes('malignancy'));
    assert.ok(types.includes('mutation'));
    const inj = m.items.find((i) => i.type === 'criticalInjury');
    assert.equal(inj.system.part, 'leftArm');
    assert.match(inj.system.description, /crit table/);
    assert.equal(m.items.find((i) => i.type === 'forceField').system.protectionRating, 30);
});

test('every roster character maps without throwing and yields a full actor payload', () => {
    for (const { name, doc } of CHARACTER_ROSTER) {
        const m = characterToFoundryActor(migrateCharacter(structuredClone(doc)));
        assert.equal(m.type, 'acolyte', name);
        assert.equal(Object.keys(m.system.characteristics).length, 9, name);
        assert.ok(m.items.length > 0, name);
        assert.ok(m.flags['dh2-roll-vm'].schemaVersion >= 3, name);
    }
});
