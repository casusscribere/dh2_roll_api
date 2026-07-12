/**
 * Character schema v3: equipment (weapons/armour items/gear) with weights and
 * the equip toggle, encumbrance vs Table 7-26 (p.248), derived armour by
 * location, fatigue threshold (p.233), movement (p.245), psy, insanity/
 * corruption, critical wounds, and amputations. Plus the v2→v3 migration and
 * the roster regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_SCHEMA_VERSION, emptyCharacter, validateCharacter, migrateCharacter,
    characterToCombatant, encumbrance, armourByLocation, fatigueThreshold, movement, CARRY_TABLE,
} from '../lib/character-schema.mjs';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';

const withStats = (s, t, ag = 30, wp = 30) => {
    const doc = emptyCharacter();
    doc.characteristics.s = { base: s, advances: 0, modifiers: [] };
    doc.characteristics.t = { base: t, advances: 0, modifiers: [] };
    doc.characteristics.ag = { base: ag, advances: 0, modifiers: [] };
    doc.characteristics.wp = { base: wp, advances: 0, modifiers: [] };
    return doc;
};

test('empty character is a valid v3 document', () => {
    assert.equal(CHARACTER_SCHEMA_VERSION, 3);
    const r = validateCharacter(emptyCharacter());
    assert.ok(r.ok, JSON.stringify(r.errors));
});

test('v2 (and v1) documents migrate to v3 with equipment/state defaults', () => {
    const v1 = { schemaVersion: 1, kind: 'dh2.character', name: 'Old', characteristics: { ws: 30, bs: 30, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 }, weapons: [{ name: 'Knife', damage: '1d5' }], wounds: { max: 10, current: 8 } };
    const d = migrateCharacter(v1);
    assert.equal(d.schemaVersion, 3);
    assert.deepEqual(d.gear, []);
    assert.deepEqual(d.psy, { rating: 0, class: 'none', sustained: 0 });
    assert.equal(d.wounds.critical, 0);
    assert.equal(d.wounds.current, 8);
    assert.ok(validateCharacter(d).ok);
});

test('encumbrance: equipped items sum (weight × quantity); limits from SB+TB (Table 7-26)', () => {
    const doc = withStats(34, 57);              // SB 3 + TB 5 = 8 → carry 56
    doc.gear = [
        { name: 'Armour', weight: 16 },                            // equipped by default
        { name: '3 Grenades', weight: 0.5, quantity: 3 },          // 1.5
        { name: 'Ship crate', weight: 100, equipped: false },      // stored — no weight
    ];
    doc.weapons = [{ name: 'Gun', damage: '1d10', weight: 4 }, { name: 'Spare', damage: '1d10', weight: 9, equipped: false }];
    const e = encumbrance(doc);
    assert.equal(e.carried, 21.5);
    assert.equal(e.carry, 56);
    assert.equal(e.lift, 112);
    assert.equal(e.push, 224);
    assert.equal(e.encumbered, false);
    // the equip toggle drives the number
    doc.gear[2].equipped = true;
    assert.equal(encumbrance(doc).carried, 121.5);
    assert.equal(encumbrance(doc).encumbered, true);
    // unnatural strength raises the bracket
    doc.unnatural = { s: 2 };
    assert.equal(encumbrance(doc).carry, CARRY_TABLE[10].carry);   // SB 3+2 + TB 5 = 10
});

test('armourByLocation: highest equipped item per location; flat block is the fallback', () => {
    const doc = emptyCharacter();
    doc.armour = { head: 2, body: 3, leftArm: 2, rightArm: 2, leftLeg: 2, rightLeg: 2 };
    assert.equal(armourByLocation(doc).body, 3);                   // fallback (no items)
    doc.armourItems = [
        { name: 'Flak Vest', ap: 3, locations: ['body'] },
        { name: 'Carapace', ap: 6, locations: ['body', 'leftArm', 'rightArm'] },
        { name: 'Great Helm', ap: 4, locations: ['head'], equipped: false },   // not worn
    ];
    const ap = armourByLocation(doc);
    assert.equal(ap.body, 6);                                      // highest wins, no stacking
    assert.equal(ap.leftArm, 6);
    assert.equal(ap.head, 0);                                      // unequipped item ignored; fallback unused once items exist
    assert.equal(ap.leftLeg, 0);
    // the combatant soaks with the derived AP
    doc.weapons = [];
    assert.equal(characterToCombatant(doc, { location: 'body' }).armour, 6);
});

test('fatigue threshold = TB + WB (p.233); movement = AgB ×1/2/3/6 (p.245)', () => {
    const doc = withStats(30, 57, 52, 61);
    assert.equal(fatigueThreshold(doc), 5 + 6);
    assert.deepEqual(movement(doc), { half: 5, full: 10, charge: 15, run: 30 });
    doc.unnatural = { ag: 2 };
    assert.deepEqual(movement(doc), { half: 7, full: 14, charge: 21, run: 42 });
});

test('psy rating flows to the combatant (Force weapons read it)', () => {
    const doc = emptyCharacter();
    doc.psy = { rating: 3, class: 'bound', sustained: 0 };
    assert.equal(characterToCombatant(doc).psyRating, 3);
});

test('validation: v3 blocks reject bad shapes, warn on unknown amputations', () => {
    const doc = emptyCharacter();
    doc.gear = [{ name: 'x', weight: -1 }, { name: '', weight: 1 }];
    doc.armourItems = [{ name: 'Vest', ap: -2 }];
    doc.weapons = [{ name: 'Gun', damage: '1d10', clip: { max: -3 }, equipped: 'yes' }];
    doc.psy = { rating: 2, class: 'rogue' };
    doc.insanity = { points: 140 };
    doc.wounds.critical = -1;
    doc.amputations = ['leftArm', 'tail'];
    const r = validateCharacter(doc);
    const paths = r.errors.map((e) => e.path);
    for (const p of ['gear[0].weight', 'gear[1].name', 'armourItems[0].ap', 'weapons[0].clip.max',
        'weapons[0].equipped', 'psy.class', 'insanity.points', 'wounds.critical']) {
        assert.ok(paths.includes(p), `expected error at ${p}: ${JSON.stringify(paths)}`);
    }
    assert.ok(r.warnings.some((w) => w.path === 'amputations[1]'));
    assert.ok(!paths.includes('amputations[0]'), 'known part is fine');
});

test('roster regression: gear imported with per-unit weights, stored items unequipped', () => {
    const aug = CHARACTER_ROSTER.find((c) => c.id.includes('augustine'))?.doc;
    assert.equal(aug.schemaVersion, 3);
    const grenades = aug.gear.find((g) => /Smoke Grenades/.test(g.name));
    assert.equal(grenades.quantity, 3);
    assert.equal(grenades.weight, 0.5);                            // sheet total 1.5 ÷ 3
    assert.ok(aug.gear.some((g) => g.equipped === false), 'Stored Inventory tab → unequipped');
    assert.ok(encumbrance(aug).carried > 0);
    assert.equal(aug.insanity.points, 40);
    assert.equal(aug.corruption.points, 9);
    const ogg = CHARACTER_ROSTER.find((c) => c.id === 'ogg')?.doc;
    assert.equal(fatigueThreshold(ogg), Math.floor(60 / 10) + 2 + Math.floor(50 / 10));   // TB 6 + Unnat T 2 + WB 5
});
