/**
 * Task 7.1 (Phase 4, E-3): the Foundry → doc reverse adapter.
 *
 * `foundryActorToCharacter` inverts `characterToFoundryActor` by inverting the
 * SAME exported tables (7.1.1) — never a second hand-written mapping. The
 * contract is the ROUND TRIP over the whole campaign roster:
 *
 *   normalize(reverse(forward(migrate(doc)))) deep-equals normalize(migrate(doc))
 *
 * where `normalizeForRoundTrip` (exported — CB-4.2 reuses it) produces a
 * canonical comparison form: keys sorted, empty-default fields dropped,
 * string entries ≡ { name } objects, weaponTrainings folded into their talent
 * stubs (the forward map's D-9 dedupe makes the split unrecoverable, and the
 * folded view IS the doc's semantic content), tarot collapsed to its joined
 * display string (bio.divination is a one-way join), craftsmanship
 * case-folded, xp.spent made effective (spent ?? ledger sum).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    characterToFoundryActor, foundryActorToCharacter, normalizeForRoundTrip,
    CHAR_KEY_MAP,
} from '../lib/foundry-actor.mjs';
import { migrateCharacter, emptyCharacter } from '../lib/character-schema.mjs';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';

const roundTrip = (doc) => foundryActorToCharacter(characterToFoundryActor(doc));
const migrated = (id) =>
    migrateCharacter(structuredClone(CHARACTER_ROSTER.find((c) => c.id.includes(id)).doc));

/* ── the headline contract: lossless over the whole roster ──────────────── */

test('round trip: every roster document survives forward → reverse unchanged (normalized)', () => {
    for (const { id, doc } of CHARACTER_ROSTER) {
        const d = migrateCharacter(structuredClone(doc));
        assert.deepEqual(
            normalizeForRoundTrip(roundTrip(d)),
            normalizeForRoundTrip(d),
            `roster doc ${id} did not survive the round trip`);
    }
});

test('round trip: an empty character survives too', () => {
    const d = emptyCharacter('Blank');
    assert.deepEqual(normalizeForRoundTrip(roundTrip(d)), normalizeForRoundTrip(d));
});

/* ── characteristics ────────────────────────────────────────────────────── */

test('characteristics: base/advances map back 1:1 through the inverted table', () => {
    const d = migrated('augustine');
    const back = roundTrip(d);
    for (const k of Object.keys(CHAR_KEY_MAP)) {
        assert.equal(back.characteristics[k].base, d.characteristics[k].base, `${k}.base`);
        assert.equal(back.characteristics[k].advances, d.characteristics[k].advances, `${k}.advances`);
    }
});

test('characteristics: modifierSources flags restore modifiers-by-source verbatim', () => {
    const d = emptyCharacter('Mods');
    d.characteristics.ws.modifiers = [{ value: 5, source: 'Custom Grip' }, { value: -5, source: 'Injury' }];
    const back = roundTrip(d);
    assert.deepEqual(back.characteristics.ws.modifiers,
        [{ value: 5, source: 'Custom Grip' }, { value: -5, source: 'Injury' }]);
});

test('characteristics: a flat DH3 modifier with NO sources flag becomes one {value, source:"foundry"}', () => {
    const actor = characterToFoundryActor(emptyCharacter('Flat'));
    actor.system.characteristics.weaponSkill.modifier = 7;
    delete actor.flags['dh2-roll-vm'].modifierSources;
    const back = foundryActorToCharacter(actor);
    assert.deepEqual(back.characteristics.ws.modifiers, [{ value: 7, source: 'foundry' }]);
});

/* ── skills ─────────────────────────────────────────────────────────────── */

test('skills: camelCase keys map back to canonical names, specialities keep their labels', () => {
    const d = migrated('jack');
    const back = roundTrip(d);
    assert.ok(back.skills.Trade?.specialities, 'Trade specialities lost');
    assert.deepEqual(Object.keys(back.skills.Trade.specialities), Object.keys(d.skills.Trade.specialities));
});

test('skills: the R-8 characteristic override survives the trip (gnaeus Intimidate → wp)', () => {
    const d = migrated('gnaeus');
    assert.equal(d.skills.Intimidate.characteristic, 'wp', 'fixture assumption');
    const back = roundTrip(d);
    assert.equal(back.skills.Intimidate.characteristic, 'wp');
});

/* ── embedded items dispatch back by type ───────────────────────────────── */

test('items: weapons/armourItems/gear come back with their flag-carried fields', () => {
    const d = emptyCharacter('Kit');
    d.weapons = [{ name: 'Hellpistol', class: 'pistol', damage: '1d10+4', pen: 7, damageType: 'Energy',
        craftsmanship: 'Good', equipped: false, weight: 4, clip: { max: 30, value: 12 },
        rof: { single: true, burst: 0, full: 0 }, qualities: ['Accurate', 'Felling(2)'] }];
    d.armourItems = [{ name: 'Carapace', ap: 5, locations: ['body', 'head'], weight: 20, equipped: true }];
    d.gear = [{ name: 'Rope', weight: 2, quantity: 3, equipped: false, notes: '10m coil' }];
    const back = roundTrip(d);
    assert.deepEqual(back.weapons[0].qualities, ['Accurate', 'Felling(2)']);
    assert.equal(back.weapons[0].craftsmanship, 'Good');
    assert.equal(back.weapons[0].equipped, false);
    assert.deepEqual(back.weapons[0].clip, { max: 30, value: 12 });
    assert.equal(back.armourItems[0].ap, 5);
    assert.deepEqual(back.armourItems[0].locations, ['body', 'head']);
    assert.equal(back.gear[0].quantity, 3);
    assert.equal(back.gear[0].notes, '10m coil');
});

test('items: talents/traits/powers/cybernetics/afflictions/injuries dispatch to their lists', () => {
    const d = emptyCharacter('Lists');
    d.talents = [{ name: 'Jaded', ref: 'dh2:talent:jaded' }];
    d.traits = [{ name: 'Unnatural Strength', level: 2 }];
    d.psychicPowers = [{ name: 'Force Bolt', discipline: 'Telekinesis', cost: 200, equipped: false }];
    d.cybernetics = [{ name: 'Bionic Arm', location: 'left arm', notes: 'good craft' }];
    d.insanity.disorders = ['Phobia (Daemons)'];
    d.corruption.malignancies = ['Palsy'];
    d.corruption.mutations = ['Third Eye'];
    d.criticalInjuries = [{ location: 'leftArm', effect: 'Broken bone' }];
    d.field = { rating: 30, overloadMax: 0 };
    const back = roundTrip(d);
    assert.equal(back.talents[0].ref, 'dh2:talent:jaded');
    assert.equal(back.traits[0].level, 2);
    assert.deepEqual(back.psychicPowers[0],
        { name: 'Force Bolt', discipline: 'Telekinesis', cost: 200, equipped: false });
    assert.equal(back.cybernetics[0].location, 'left arm');
    assert.equal(back.cybernetics[0].notes, 'good craft');
    assert.deepEqual(back.insanity.disorders, ['Phobia (Daemons)']);
    assert.deepEqual(back.corruption.malignancies, ['Palsy']);
    assert.deepEqual(back.corruption.mutations, ['Third Eye']);
    assert.equal(back.criticalInjuries[0].location, 'leftArm');
    assert.equal(back.criticalInjuries[0].effect, 'Broken bone');
    assert.equal(back.field.rating, 30);
});

test('items: a pure Weapon Training stub folds back as the talent-stub form', () => {
    const d = emptyCharacter('Trained');
    d.weaponTrainings = ['Las', 'Bolt'];
    const norm = normalizeForRoundTrip(roundTrip(d));
    const names = (norm.talents ?? []).map((t) => t.name);
    assert.ok(names.includes('Weapon Training (Las)'), JSON.stringify(norm.talents));
    assert.ok(names.includes('Weapon Training (Bolt)'));
    // …and the original normalizes to the same folded view.
    assert.deepEqual(norm, normalizeForRoundTrip(d));
});

/* ── scalars, bio, flags ────────────────────────────────────────────────── */

test('bio.divination comes back as tarot (joined display form)', () => {
    const d = emptyCharacter('Fated');
    d.tarot = { card: 'The Emperor', text: 'Serve Him', effect: '+1 Fate' };
    const back = roundTrip(d);
    assert.equal(typeof back.tarot.text, 'string');
    assert.deepEqual(normalizeForRoundTrip(back).tarot, normalizeForRoundTrip(d).tarot);
});

test('experience, ledger, extensions, amputations and origin come back from flags', () => {
    const d = migrated('augustine');
    d.extensions = { campaign: { note: 'x' } };
    d.amputations = ['leftHand'];
    d.origin = { homeworld: { name: 'Hive World', ref: 'dh2:home_world:hive_world' }, background: null, role: null, eliteAdvances: [] };
    const back = roundTrip(d);
    assert.equal(back.xp.total, d.xp.total);
    assert.deepEqual(back.xp.ledger, d.xp.ledger);
    assert.deepEqual(back.extensions, d.extensions);
    assert.deepEqual(back.amputations, ['leftHand']);
    assert.deepEqual(back.origin, d.origin);
});

test('the flat armour block (manual AP override) survives — harys has a rating-30 field too', () => {
    const d = migrated('augustine');
    assert.ok(Object.values(d.armour).some((v) => v > 0), 'fixture assumption: augustine has flat AP');
    const back = roundTrip(d);
    assert.deepEqual(back.armour, d.armour);

    const h = migrated('harys');
    assert.equal(roundTrip(h).field.rating, 30);
});

test('psy: rating and class survive; a non-psyker comes back as rating 0 / class none', () => {
    const psyker = migrated('uriel');
    assert.equal(psyker.psy.rating, 5, 'fixture assumption');
    const backP = roundTrip(psyker);
    assert.equal(backP.psy.rating, 5);
    assert.equal(backP.psy.class, 'bound');

    const mundane = roundTrip(migrated('gnaeus'));
    assert.equal(mundane.psy.rating, 0);
    assert.equal(mundane.psy.class, 'none');
});
