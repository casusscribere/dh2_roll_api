/**
 * Roll20 adapter v4 coverage (pipeline plan Task 3.1).
 *
 * Two lanes of evidence:
 *   - the sanitized dump fixture (roll20-dump-sample.json, shape
 *     roll20.character_dump.v1) carries the REAL sheet's full attribute
 *     vocabulary but with all values blanked — it proves the adapter walks the
 *     whole vocabulary without throwing, consumes display twins, and validates;
 *   - a synthetic character built from the same verified vocabulary WITH
 *     values (modeled on the live 2026-07-23 dump) proves the value semantics:
 *     totals/upgrades → base+advances, Unnat → unnatural, ranks → advances,
 *     damage-component composition, origin strings, etc.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { fromRoll20, fromRoll20Dump } from '../../tools/adapters/roll20.mjs';
import { validateCharacter, CHARACTER_SCHEMA_VERSION } from '../lib/character-schema.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/roll20-dump-sample.json', import.meta.url), 'utf8'));
const XP_NOTE = 'xp/aptitudes absent from Roll20 sheet (merge lane fills from xlsx)';

// --- fixture lane (sanitized real dump) -----------------------------------------

test('roll20 v4: every fixture character maps without throwing and validates', () => {
    const results = fromRoll20Dump(FIXTURE);
    assert.equal(results.length, FIXTURE.characters.length);
    for (const [i, { character, unmapped }] of results.entries()) {
        const src = FIXTURE.characters[i];
        assert.equal(character.name, src.name);
        assert.equal(character.schemaVersion, CHARACTER_SCHEMA_VERSION);
        assert.equal(character.kind, 'dh2.character');
        const r = validateCharacter(character);
        assert.deepEqual(r.errors, [], `${src.name}: ${JSON.stringify(r.errors)}`);   // warnings allowed
        assert.ok(Array.isArray(unmapped));
    }
});

test('roll20 v4: dump envelope stamps source provenance per character', () => {
    const results = fromRoll20Dump(FIXTURE);
    for (const [i, { character }] of results.entries()) {
        assert.equal(character.source.adapter, 'roll20-dump-v4');
        assert.equal(character.source.roll20CharacterId, FIXTURE.characters[i].id);
        assert.equal(character.source.roll20Name, FIXTURE.characters[i].name);
        assert.equal(character.source.exportedAt, FIXTURE.generated_at);
    }
});

test('roll20 v4: fixture unmapped carries the xp/aptitudes note; xp stays empty', () => {
    for (const { character, unmapped } of fromRoll20Dump(FIXTURE)) {
        assert.ok(unmapped.includes(XP_NOTE), `missing xp note for ${character.name}`);
        assert.equal(character.xp.total, 0);
        assert.deepEqual(character.xp.ledger, []);
        assert.deepEqual(character.aptitudes, []);
    }
});

test('roll20 v4: display twins are consumed, not reported unmapped', () => {
    for (const { character, unmapped } of fromRoll20Dump(FIXTURE)) {
        for (const twin of ['dispWeaponSkill', 'WeaponSkillMod', 'DodgeScore', 'fatws', 'headReduction', 'talentstring', 'playername']) {
            assert.ok(!unmapped.includes(twin), `${character.name}: ${twin} should be consumed`);
        }
    }
});

test('roll20 v4: sanitized fixture characteristics keep the upgrade shape (advances object)', () => {
    // Skulker's sheet carries WeaponSkillupgrades → the object form, advances 0
    const skulker = fromRoll20Dump(FIXTURE)[0].character;
    assert.deepEqual(skulker.characteristics.ws, { base: 0, advances: 0, modifiers: [] });
    assert.equal(skulker.unnatural.ws, 0);
});

// --- synthetic lane (real vocabulary + values) ----------------------------------

const attr = (name, current, max = '') => ({ name, current, max });
const SYNTH = {
    id: '-TestRowId0000000001',
    name: 'Test Acolyte',
    attribs: [
        // characteristics: flat total + Upgrades + Unnat (+ display twins)
        attr('WeaponSkill', '31'), attr('WeaponSkillUpgrades', '0'), attr('WeaponSkillUnnat', '0'),
        attr('BallisticSkill', '68'), attr('BallisticSkillUpgrades', '4'), attr('BallisticSkillMod', '10'),
        attr('Strength', '34'), attr('StrengthUnnat', '2'), attr('dispStrength', '34'),
        attr('Toughness', '57'), attr('ToughnessUpgrades', '3'), attr('ToughnessAdj', '0'),
        attr('Agility', '52'), attr('AgilityUpgrades', '2'),
        attr('Intelligence', '70'), attr('IntelligenceUpgrades', '5'),
        attr('Perception', '53'), attr('PerceptionUpgrades', '1'),
        attr('Willpower', '61'), attr('WillpowerUpgrades', '2'),
        attr('Fellowship', '29'),
        attr('Influence', '19'), attr('InfluenceMod', '0'),
        // vitals
        attr('MaxWounds', '12'), attr('CurWounds', 8, '12'),
        attr('MaxFatePoints', '3'), attr('CurFatePoints', '2'),
        attr('Insanity', '36'), attr('CurInsanity', '39'), attr('MaxInsanity', '100'),
        attr('Corruption', '9'), attr('CurCorruption', '9'),
        attr('CurFatigue', '1'), attr('MaxPsy', '3'), attr('Psy', '0'),
        // origin + armour
        attr('homeworld', 'Stygies VIII'), attr('background', 'N/A'), attr('role', 'Tech-Priest'),
        attr('bodyArmor', '6'), attr('headArmor', '4'), attr('leftArmArmor', '6'), attr('bodyReduction', '0'),
        // skills: flat ranks + fixed specialist slots + numbered lore slots
        attr('DodgeRanks', '2'), attr('DodgeScore', 62),
        attr('TechUseRanks', '4'), attr('TechUseScore', 120), attr('TechUseMisc', '20'),
        attr('NvStellarRanks', '2'), attr('OpSurfaceRanks', '1'),
        attr('TradeName', 'Linguist'), attr('TradeRanks', '2'),
        attr('ForbiddenLore1', 'Archaeotech'), attr('ForbiddenLoreRanks1', '1'), attr('ForbiddenLoreScore1', 70),
        attr('Linguistics1', 'Binary'), attr('LinguisticsRanks1', '1'),
        attr('CommonLore2', 'N/A'),
        // repeating lore rows (incl. a dedup against the flat Archaeotech slot)
        attr('repeating_fls_-RowFlsA00000000001_ForbiddenLoreNames', 'Archaeotech'),
        attr('repeating_fls_-RowFlsA00000000001_ForbiddenLoreRanks', '2'),
        attr('repeating_fls_-RowFlsB00000000002_ForbiddenLoreNames', 'Heresy'),
        attr('repeating_fls_-RowFlsB00000000002_ForbiddenLoreRanks', '1'),
        attr('repeating_sls_-RowSls000000000001_ScholasticLoreNames', 'Numerology'),
        attr('repeating_sls_-RowSls000000000001_ScholasticLoreRanks', '2'),
        // weapons: a ranged pistol (full vocabulary) and a melee blade (inference)
        attr('repeating_weapons_-RowWpnA0000000001_wpnnames', 'Archangel MkII'),
        attr('repeating_weapons_-RowWpnA0000000001_wpndmgnumdices', '1'),
        attr('repeating_weapons_-RowWpnA0000000001_wpndmgdices', '10'),
        attr('repeating_weapons_-RowWpnA0000000001_wpndmgstatics', '6'),
        attr('repeating_weapons_-RowWpnA0000000001_wpndmgtypes', 'E'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnpens', '6'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnranges', '30'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnsingleshots', 'S'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnsemishots', '2'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnautoshots', '-'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnclipcurs', '10'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnclipmaxs', '10'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnweights', '4'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnspecials', 'Maximal, Proven(3), Vengeful(9)'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnqualitys', 'best'),
        attr('repeating_weapons_-RowWpnA0000000001_wpncats', 'pistol'),
        attr('repeating_weapons_-RowWpnA0000000001_wpnselsw', false),
        attr('repeating_weapons_-RowWpnB0000000002_wpnnames', 'Omnissian Axe'),
        attr('repeating_weapons_-RowWpnB0000000002_wpndmgnumdices', '1'),
        attr('repeating_weapons_-RowWpnB0000000002_wpndmgdices', '10'),
        attr('repeating_weapons_-RowWpnB0000000002_wpndmgstatics', '4'),
        attr('repeating_weapons_-RowWpnB0000000002_wpndmgtypes', 'rending'),
        attr('repeating_weapons_-RowWpnB0000000002_wpnpens', '2'),
        // talents / equipment / powers / proficiencies
        attr('repeating_talents_-RowTal000000000001_talentnames', 'mightyshot'),
        attr('repeating_talents_-RowTal000000000002_talentnames', 'sprint'),
        attr('talentstring', 'mightyshot.sprint.'),
        attr('repeating_equipment_-RowEqp000000000001_equipnames', 'Voidstalker Cloak'),
        attr('repeating_equipment_-RowEqp000000000001_equipselects', '1'),
        attr('repeating_equipment_-RowEqp000000000001_equipdescs', 'Stealth + 30 in darkness.'),
        attr('repeating_equipment_-RowEqp000000000002_equipnames', 'Praetor Armour'),
        attr('repeating_equipment_-RowEqp000000000002_equipweights', '16'),
        attr('repeating_equipment_-RowEqp000000000002_equipselects', '0'),
        attr('repeating_powers_-RowPow000000000001_psynames', 'Objuration Mechanicum'),
        attr('repeating_profs_-RowPro000000000001_wpnprofs', 'E(Shuriken), Plasma, SP'),
        // sheet state the adapter must leave visible as unmapped
        attr('structured', 'x'),
        // privacy: never mapped (decision D9)
        attr('playername', 'A Real Person'),
    ],
};

test('roll20 v4: characteristics — total/Upgrades → base + advances; Unnat → unnatural', () => {
    const { character } = fromRoll20(SYNTH);
    assert.deepEqual(character.characteristics.bs, { base: 48, advances: 4, modifiers: [] });
    assert.deepEqual(character.characteristics.ws, { base: 31, advances: 0, modifiers: [] });
    assert.deepEqual(character.characteristics.int, { base: 45, advances: 5, modifiers: [] });
    assert.equal(character.characteristics.s, 34);         // no Upgrades attrib → flat total (v1 shorthand)
    assert.equal(character.characteristics.fel, 29);
    assert.equal(character.unnatural.s, 2);
    assert.equal(character.unnatural.ws, 0);               // '0' on the sheet stays 0
});

test('roll20 v4: vitals, influence, psy, armour', () => {
    const { character } = fromRoll20(SYNTH);
    assert.deepEqual({ max: character.wounds.max, current: character.wounds.current }, { max: 12, current: 8 });
    assert.deepEqual({ max: character.fate.max, current: character.fate.current }, { max: 3, current: 2 });
    assert.equal(character.insanity.points, 39);           // CurInsanity wins over Insanity
    assert.equal(character.corruption.points, 9);
    assert.equal(character.fatigue.current, 1);
    assert.equal(character.influence, 19);
    assert.deepEqual({ rating: character.psy.rating, class: character.psy.class }, { rating: 3, class: 'bound' });
    assert.equal(character.armour.body, 6);
    assert.equal(character.armour.head, 4);
    assert.equal(character.armour.leftArm, 6);
});

test('roll20 v4: origin strings → { name } members; N/A → null', () => {
    const { character } = fromRoll20(SYNTH);
    assert.deepEqual(character.origin.homeworld, { name: 'Stygies VIII' });
    assert.equal(character.origin.background, null);
    assert.deepEqual(character.origin.role, { name: 'Tech-Priest' });
    assert.deepEqual(character.origin.eliteAdvances, []);
});

test('roll20 v4: skills — flat ranks, fixed specialist slots, lore slots + repeating rows (dedup)', () => {
    const { character } = fromRoll20(SYNTH);
    assert.equal(character.skills.Dodge.advances, 2);
    assert.equal(character.skills['Tech-Use'].advances, 4);
    assert.equal(character.skills.Navigate.specialities.Stellar.advances, 2);
    assert.equal(character.skills.Operate.specialities.Surface.advances, 1);
    assert.equal(character.skills.Trade.specialities.Linguist.advances, 2);
    // flat slot rank 1 vs repeating row rank 2 → max wins
    assert.equal(character.skills['Forbidden Lore'].specialities.Archaeotech.advances, 2);
    assert.equal(character.skills['Forbidden Lore'].specialities.Heresy.advances, 1);
    assert.equal(character.skills['Scholastic Lore'].specialities.Numerology.advances, 2);
    assert.equal(character.skills.Linguistics.specialities.Binary.advances, 1);
    assert.ok(!('Common Lore' in character.skills));       // "N/A" slot skipped
});

test('roll20 v4: one weapon fully asserted; melee inferred without range/RoF evidence', () => {
    const { character } = fromRoll20(SYNTH);
    const [pistol, axe] = character.weapons;
    assert.deepEqual(pistol, {
        name: 'Archangel MkII',
        class: 'pistol',
        damage: '1d10+6',
        pen: 6,
        damageType: 'Energy',
        rof: { single: true, burst: 2, full: 0 },          // '-' autoshots → 0
        qualities: ['Maximal', 'Proven(3)', 'Vengeful(9)'],
        craftsmanship: 'Best',
        clip: { max: 10, value: 10 },
        weight: 4,
    });
    assert.equal(axe.name, 'Omnissian Axe');
    assert.equal(axe.class, 'melee');                      // no wpncats, no range, no semi/auto
    assert.equal(axe.damage, '1d10+4');
    assert.equal(axe.damageType, 'Rending');
});

test('roll20 v4: talents, gear (equipselects toggle), powers, weapon trainings', () => {
    const { character } = fromRoll20(SYNTH);
    assert.deepEqual(character.talents, ['mightyshot', 'sprint']);   // repeating rows win over talentstring
    assert.deepEqual(character.gear, [
        { name: 'Voidstalker Cloak', equipped: true, description: 'Stealth + 30 in darkness.' },
        { name: 'Praetor Armour', weight: 16, equipped: false },
    ]);
    assert.deepEqual(character.psychicPowers, [{ name: 'Objuration Mechanicum' }]);
    assert.deepEqual(character.weaponTrainings, ['E(Shuriken)', 'Plasma', 'SP']);
});

test('roll20 v4: synthetic character validates; xp/aptitudes stay empty with the note', () => {
    const { character, unmapped } = fromRoll20(SYNTH);
    const r = validateCharacter(character);
    assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
    assert.equal(character.xp.total, 0);
    assert.deepEqual(character.xp.ledger, []);
    assert.deepEqual(character.aptitudes, []);
    assert.ok(unmapped.includes(XP_NOTE));
    assert.ok(unmapped.includes('structured'));            // genuinely unknown → reported
    assert.ok(!unmapped.includes('playername'));           // consumed, never mapped (privacy D9)
    assert.equal(character.player, undefined);
    assert.equal(character.source.roll20CharacterId, '-TestRowId0000000001');
});

test('roll20 v4: bare legacy userscript export keeps working (flat totals, no envelope)', () => {
    const { character } = fromRoll20({
        name: 'Acolyte Legacy',
        attribs: [
            attr('weapon_skill', 38),
            attr('unnatural_strength', 2),
            attr('wounds', 9, 13),
            attr('repeating_weapons_-Nabc123_name', 'Autogun'),
            attr('repeating_weapons_-Nabc123_damage', '1d10+3'),
        ],
    });
    assert.equal(character.characteristics.ws, 38);        // v1 flat shorthand preserved
    assert.equal(character.unnatural.s, 2);
    assert.deepEqual({ max: character.wounds.max, current: character.wounds.current }, { max: 13, current: 9 });
    assert.equal(character.weapons[0].name, 'Autogun');
    assert.equal(character.weapons[0].damage, '1d10+3');
    assert.equal(character.weapons[0].class, undefined);   // legacy rows: no melee inference
});
