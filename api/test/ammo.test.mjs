/**
 * Ammo tracking (p.144: RoF numbers = shots fired per mode; Maximal ×3 p.146):
 * the engine reports ammoUsed per attack; the character schema carries weapon
 * clips; the importer fills clips, psychic-power loadouts, and named
 * disorder/malignancy lists from the campaign sheets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack } from '../lib/engine.mjs';
import { buildRegistry } from '../lib/rules/index.mjs';
import { riggedDice, d100, die } from './helpers.mjs';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';
import { validateCharacter, migrateCharacter } from '../lib/character-schema.mjs';

const gun = (extra = {}) => ({ name: 'Autogun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 3, full: 10 }, qualities: [], ...extra });
const shot = (action, extra = {}) => resolveAttack({
    characteristics: { bs: 40, s: 30, t: 30 }, weapon: gun(extra.weapon), action,
    target: { armour: 0, toughnessBonus: 0 }, ...extra,
}, riggedDice([d100(95), die(5, 10), die(5, 10), die(5, 10)]), buildRegistry());

test('ammoUsed: 1 single / burst on semi / full on full-auto — hit or miss', () => {
    assert.equal(shot('Standard Attack').ammoUsed, 1);
    assert.equal(shot('Semi-Auto Burst').ammoUsed, 3);
    assert.equal(shot('Full Auto Burst').ammoUsed, 10);
    assert.equal(shot('Suppressing Fire (Semi)').ammoUsed, 3);
    assert.equal(shot('Suppressing Fire (Full)').ammoUsed, 10);
});

test('Maximal triples the expenditure (p.146); melee expends nothing', () => {
    const max = resolveAttack({
        characteristics: { bs: 40, s: 30, t: 30 }, weapon: gun({ qualities: ['Maximal'] }), action: 'Standard Attack',
        configs: ['Maximal'], target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(95)]), buildRegistry());
    assert.equal(max.ammoUsed, 3);
    const sword = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 },
        weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Standard Attack', target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(95)]), buildRegistry());
    assert.equal(sword.ammoUsed, 0);
});

test('roster: clips imported from the ARMAMENTS Clip column', () => {
    const aug = CHARACTER_ROSTER.find((c) => c.id.includes('augustine'))?.doc;
    const cat = aug.weapons.find((w) => w.name === 'Shuriken Catapult');
    assert.deepEqual(cat.clip, { max: 120, value: 120 });
});

test('roster: psychic powers imported with discipline + equipped loadout flag', () => {
    const uriel = CHARACTER_ROSTER.find((c) => c.id.includes('uriel'))?.doc;
    assert.ok(uriel.psychicPowers.length >= 5, `Uriel knows powers (${uriel.psychicPowers.length})`);
    for (const p of uriel.psychicPowers) {
        assert.ok(typeof p.name === 'string' && p.name);
        assert.equal(p.equipped, true);
    }
    assert.ok(validateCharacter(migrateCharacter(uriel)).ok);
});

test('roster: disorders carry names where the sheets record them', () => {
    const withDisorder = CHARACTER_ROSTER.filter((c) => (c.doc.insanity.disorders ?? []).length);
    assert.ok(withDisorder.length >= 1, 'at least one PC has a named disorder');
    for (const c of withDisorder) for (const d of c.doc.insanity.disorders) assert.ok(typeof d === 'string' && d.trim());
});
