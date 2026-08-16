/**
 * Branch-coverage companion suite for the two least-covered lib modules:
 *   - api/lib/foundry-actor.mjs  (schema-v4 doc → acolyte Actor mapping)
 *   - api/lib/advancement.mjs    (XP-spending engine)
 *
 * The existing foundry-actor.test.mjs / advancement.test.mjs cover the happy
 * paths against the roster and the real chargen pack. This file deliberately
 * drives the paths they do not reach: the armour/trait item mappings (no
 * campaign character owns either), every documented `??` fallback, and — on
 * the advancement side — the throw sites a GM actually meets (rank skips,
 * unknown refs, duplicate purchases) plus the psy-rating / elite-advance /
 * duplicate-aptitude branches.
 *
 * Two tests are CHARACTERIZATION tests marked `BUG:` — they pin behaviour that
 * is currently wrong so a fix is a deliberate, visible change. See the comments.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { characterToFoundryActor } from '../lib/foundry-actor.mjs';
import { emptyCharacter, migrateCharacter } from '../lib/character-schema.mjs';
import { CHARGEN_PACK as PACK } from '../data/chargen/pack.mjs';
import {
    advanceCost, checkPrerequisites, listAvailableAdvances,
    applyAdvance, applyOrigin, validateBuild, xpSummary,
} from '../lib/advancement.mjs';

const CAMPAIGN_DIR = new URL('../../campaign/characters/', import.meta.url);
const campaignDoc = (file) =>
    migrateCharacter(JSON.parse(readFileSync(new URL(file, CAMPAIGN_DIR), 'utf8')));

// ---------------------------------------------------------------------------
// foundry-actor.mjs
// ---------------------------------------------------------------------------

test('armour items become DH3 armour Items; AP + locations survive in flags', () => {
    // No campaign character carries armourItems (their AP is the flat `armour`
    // block), so this mapping is only reachable synthetically.
    const doc = campaignDoc('rex-hellerand.json');
    doc.armourItems = [
        { name: 'Enforcer Light Carapace', ap: 5, locations: ['body', 'leftArm', 'rightArm'], weight: 8, maxAgility: 2 },
        { name: 'Stowed Flak Cloak', ap: 3, equipped: false },       // no locations / weight / maxAgility
    ];
    const armour = characterToFoundryActor(doc).items.filter((i) => i.type === 'armour');
    assert.equal(armour.length, 2);
    assert.deepEqual(armour[0].system, {
        equipped: true, weight: 8, maxAgility: 2,
        description: 'AP 5 (body, leftArm, rightArm)',
    });
    assert.deepEqual(armour[0].flags['dh2-roll-vm'], { ap: 5, locations: ['body', 'leftArm', 'rightArm'] });
    // defaults: unequipped stays unequipped, missing locations read as "all"
    assert.deepEqual(armour[1].system, {
        equipped: false, weight: 0, maxAgility: 0, description: 'AP 3 (all)',
    });
    assert.deepEqual(armour[1].flags['dh2-roll-vm'], { ap: 3, locations: ['all'] });
});

test('traits map with and without a level; ref/dsl ride the item flags', () => {
    const doc = campaignDoc('ogg.json');
    doc.traits = [
        { name: 'Sturdy', level: 2, ref: 'dh2:trait:sturdy' },
        { name: 'Regeneration', level: 0 },                          // level 0 is still a level
        { name: 'Unnatural Senses', dsl: 'trait unnatural_senses' },
        'Fear',                                                      // bare string entry
    ];
    const traits = characterToFoundryActor(doc).items.filter((i) => i.type === 'trait');
    assert.deepEqual(traits.map((t) => t.name), ['Sturdy', 'Regeneration', 'Unnatural Senses', 'Fear']);
    assert.deepEqual(traits[0].system, { level: 2 });
    assert.deepEqual(traits[0].flags, { 'dh2-roll-vm': { ref: 'dh2:trait:sturdy' } });
    assert.deepEqual(traits[1].system, { level: 0 });
    assert.equal(traits[1].flags, undefined);                        // no ref/dsl → no flags key
    assert.deepEqual(traits[2].system, {});                          // level absent → empty system
    assert.deepEqual(traits[2].flags, { 'dh2-roll-vm': { dsl: 'trait unnatural_senses' } });
    assert.deepEqual(traits[3].system, {});
});

test('a near-empty document maps to the documented DH3 defaults', () => {
    const m = characterToFoundryActor({ name: 'Sparse', schemaVersion: 4, kind: 'dh2.character' });
    assert.equal(m.name, 'Sparse');
    assert.equal(m.type, 'acolyte');
    assert.equal(m.items.length, 0);
    assert.deepEqual(m.system.characteristics.weaponSkill, { base: 0, advance: 0, modifier: 0, unnatural: 0 });
    assert.deepEqual(m.system.characteristics.influence, { base: 0, advance: 0, modifier: 0, unnatural: 0 });
    assert.deepEqual(m.system.wounds, { max: 10, value: 10, critical: 0 });
    assert.deepEqual(m.system.fate, { max: 0, value: 0 });
    assert.deepEqual(m.system.fatigue, { value: 0, max: 0 });
    assert.deepEqual(m.system.psy, { rating: 0, sustained: 0, class: 'bound', hasFocus: false });
    assert.deepEqual(m.system.experience, { total: 0, used: 0 });
    assert.deepEqual(m.system.bio, { divination: '', homeWorld: '', background: '', role: '', elite: '' });
    assert.deepEqual(m.flags['dh2-roll-vm'], {
        schemaVersion: 4,
        modifierSources: { characteristics: {}, skills: {} },
        amputations: [], xpLedger: [], source: null, origin: null, extensions: {},
    });
});

test('scalar characteristics, unknown skills, explicit xp.spent and a non-"none" psy class', () => {
    const m = characterToFoundryActor({
        name: 'Scalar', schemaVersion: 4,
        characteristics: { ws: 33, bs: '41', s: null },              // int / numeric string / null
        unnatural: { ws: 1 },
        skills: {
            'Tech-Use': { advances: 2, modifiers: [{ value: 10, source: 'Cog' }] },
            'Bogus Skill': { advances: 3 },                          // not in SKILL_DEFS → dropped
            'Common Lore': { advances: 1 },                          // specialist, no specialities block
        },
        xp: { total: 500, spent: 120, ledger: [{ cost: 99 }] },      // explicit spent wins over the ledger
        psy: { rating: 2, class: 'unbound', sustained: 1 },
    });
    assert.equal(m.system.characteristics.weaponSkill.base, 33);
    assert.equal(m.system.characteristics.weaponSkill.unnatural, 1);
    assert.equal(m.system.characteristics.ballisticSkill.base, 41);  // "41" coerced
    assert.equal(m.system.characteristics.strength.base, 0);         // null → 0
    assert.deepEqual(Object.keys(m.system.skills), ['techUse', 'commonLore']);
    assert.equal(m.system.skills.techUse.isSpecialist, false);
    assert.equal(m.system.skills.commonLore.isSpecialist, true);
    assert.equal(m.system.skills.commonLore.specialities, undefined);
    assert.deepEqual(m.flags['dh2-roll-vm'].modifierSources.skills, { 'Tech-Use': [{ value: 10, source: 'Cog' }] });
    assert.deepEqual(m.flags['dh2-roll-vm'].modifierSources.characteristics, {});
    assert.deepEqual(m.system.experience, { total: 500, used: 120 });
    assert.equal(m.system.psy.class, 'unbound');                     // only 'none' is rewritten to 'bound'
    assert.equal(m.system.psy.sustained, 1);

    // DH3 has no 'none' psy class: the schema default is rewritten to 'bound'
    const blank = emptyCharacter('No Psyker');
    assert.equal(blank.psy.class, 'none');
    assert.equal(characterToFoundryActor(blank).system.psy.class, 'bound');
});

test('item variants: bare weapon defaults, single-fire-off weapons, gear/aptitude/talent/cybernetic/power/crit forms', () => {
    const m = characterToFoundryActor({
        name: 'Variants', schemaVersion: 4,
        weapons: [
            { name: 'Bare Gun' },
            { name: 'Driver SMG', class: 'basic', damage: '1d10', pen: 2, damageType: 'Rending', craftsmanship: 'Best', equipped: false, weight: 5, clip: { max: 40 }, rof: { single: false, burst: 0, full: 10 }, qualities: ['Storm', { name: 'Reliable' }] },
        ],
        gear: [{ name: 'Rope', equipped: false, notes: '20m', quantity: 3 }, { name: 'Lho-stick' }],
        aptitudes: ['Finesse', { name: 'Tech', source: 'role' }],
        talents: [{ name: 'Jaded', tier: 2, notes: 'ignore fear', source: 'core p.120', ref: 'dh2:talent:jaded' }, 'Bare Talent'],
        weaponTrainings: ['Las'],
        cybernetics: [{ name: 'Bionic Arm', location: 'left arm', notes: 'good quality' }, { name: 'Plain Implant' }],
        psychicPowers: [{ name: 'Smite', discipline: 'Pyromancy', cost: 3, notes: 'ouch', equipped: false, dsl: 'power smite' }, 'Bare Power'],
        criticalInjuries: ['Lost an ear'],                            // bare-string form
        field: { rating: 0 },                                         // 0 → no forceField item
    });
    const byName = (n) => m.items.find((i) => i.name === n);

    const bare = byName('Bare Gun');
    assert.deepEqual(bare.system.clip, { max: 0, value: 0 });
    assert.deepEqual(bare.system.rateOfFire, { single: 1, burst: 0, full: 0 });
    assert.equal(bare.system.class, 'basic');
    assert.equal(bare.system.craftsmanship, 'common');
    assert.equal(bare.system.equipped, true);
    assert.equal(bare.system.description, '');
    assert.deepEqual(bare.flags['dh2-roll-vm'].qualities, []);

    const smg = byName('Driver SMG');
    assert.deepEqual(smg.system.rateOfFire, { single: 0, burst: 0, full: 10 });   // rof.single === false → 0
    assert.deepEqual(smg.system.clip, { max: 40, value: 40 });                     // value defaults to max
    assert.equal(smg.system.equipped, false);
    assert.equal(smg.system.craftsmanship, 'best');
    assert.equal(smg.system.description, 'Qualities: Storm, Reliable');            // object qualities named
    assert.deepEqual(smg.flags['dh2-roll-vm'].qualities, ['Storm', 'Reliable']);

    assert.deepEqual(byName('Rope').system, { equipped: false, weight: 0, description: '20m' });
    assert.equal(byName('Rope').flags['dh2-roll-vm'].quantity, 3);
    assert.deepEqual(byName('Lho-stick').system, { equipped: true, weight: 0, description: '' });
    assert.equal(byName('Lho-stick').flags['dh2-roll-vm'].quantity, 1);

    assert.equal(byName('Finesse').system.description, '');                        // string aptitude
    assert.equal(byName('Tech').system.description, 'Source: role');
    assert.deepEqual(byName('Jaded').system, { tier: 2, benefit: 'ignore fear', description: 'Source: core p.120' });
    assert.deepEqual(byName('Jaded').flags, { 'dh2-roll-vm': { ref: 'dh2:talent:jaded' } });
    assert.deepEqual(byName('Bare Talent').system, { tier: 0, benefit: '', description: '' });
    assert.deepEqual(byName('Weapon Training (Las)').system, { tier: 1, benefit: '', description: '' });

    assert.equal(byName('Bionic Arm').system.description, 'Location: left arm — good quality');
    assert.equal(byName('Plain Implant').system.description, '');

    assert.equal(byName('Smite').system.discipline, 'Pyromancy');
    assert.deepEqual(byName('Smite').flags['dh2-roll-vm'], { equipped: false, dsl: 'power smite' });
    assert.deepEqual(byName('Bare Power').system, { discipline: '', cost: 0, sustained: 'No', description: '' });
    assert.deepEqual(byName('Bare Power').flags['dh2-roll-vm'], { equipped: true });

    const crit = m.items.find((i) => i.type === 'criticalInjury');
    assert.deepEqual(crit.system, { part: 'body', type: 'impact', description: 'Lost an ear' });
    assert.equal(crit.name, 'Lost an ear');
    assert.ok(!m.items.some((i) => i.type === 'forceField'), 'field rating 0 → no force field item');
});

test('long critical-injury text is truncated to a 60-char item name', () => {
    const effect = 'The limb is utterly destroyed and the wound cauterised by the blast, leaving nothing usable';
    const m = characterToFoundryActor({ name: 'Crit', schemaVersion: 4, criticalInjuries: [{ location: 'leftLeg', effect }] });
    const crit = m.items.find((i) => i.type === 'criticalInjury');
    assert.equal(crit.name.length, 60);
    assert.equal(crit.name, effect.slice(0, 60));
    assert.equal(crit.system.part, 'leftLeg');
    assert.equal(crit.system.description, effect);                    // no source → no suffix
});

test('every on-disk campaign character maps, and origin strings/objects both reach bio', () => {
    const files = readdirSync(CAMPAIGN_DIR).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 10, 'the merged campaign roster');
    for (const f of files) {
        const m = characterToFoundryActor(campaignDoc(f));
        assert.equal(m.type, 'acolyte', f);
        assert.equal(typeof m.name, 'string', f);
        assert.ok(m.items.length > 0, f);
        assert.equal(Object.keys(m.system.characteristics).length, 10, f);
        for (const k of Object.keys(m.system.bio)) assert.equal(typeof m.system.bio[k], 'string', `${f} bio.${k}`);
    }
    // origin entries accept the string form, the { name } form, and drop empties
    const doc = campaignDoc('gnaeus.json');
    doc.origin = { homeworld: 'Hive World', background: { name: 'Outcast' }, role: null, eliteAdvances: [{ name: 'Assassin' }, 'Psyker', {}] };
    const bio = characterToFoundryActor(doc).system.bio;
    assert.deepEqual(bio.homeWorld, 'Hive World');
    assert.deepEqual(bio.background, 'Outcast');
    assert.deepEqual(bio.role, '');
    assert.deepEqual(bio.elite, 'Assassin, Psyker');
});

// ---------------------------------------------------------------------------
// advancement.mjs
// ---------------------------------------------------------------------------

const mk = (aptitudes = [], xpTotal = 5000) => {
    const d = emptyCharacter('Coverage Test');
    d.aptitudes = aptitudes.map((name) => ({ name, source: 'extra' }));
    d.xp = { total: xpTotal, ledger: [] };
    return d;
};

test('advanceCost rejects an unknown advance kind by name', () => {
    assert.throws(() => advanceCost(PACK, { kind: 'bogus' }), /^Error: unknown advance kind "bogus"$/);
    assert.throws(() => advanceCost(PACK, {}), /^Error: unknown advance kind "undefined"$/);
    assert.throws(() => advanceCost(PACK, { kind: 'psy_rating', rank: 0 }), /^Error: psy rating must be ≥ 1, got 0$/);
    assert.throws(() => advanceCost(PACK, { kind: 'elite_advance' }), /^Error: elite advance needs its entry xpCost$/);
    assert.throws(() => advanceCost(PACK, { kind: 'skill', matches: 0, rank: 5 }), /^Error: skill rank must be 1\.\.4, got 5$/);
});

test('psy rating: offered to a Psyker elite advance holder, then bought rank by rank', () => {
    const d = mk([], 5000);
    d.origin.eliteAdvances = [{ name: 'Psyker' }];                     // rating still 0
    const psy = listAvailableAdvances(d, PACK).find((a) => a.kind === 'psy_rating');
    assert.deepEqual(
        { ref: psy.ref, name: psy.name, rank: psy.rank, matches: psy.matches, cost: psy.cost },
        { ref: 'psy.rating', name: 'Psy Rating 1', rank: 1, matches: 0, cost: 200 },
    );

    const { doc: d2, entry } = applyAdvance(d, PACK, psy);
    assert.equal(d2.psy.rating, 1);
    assert.equal(d2.psy.class, 'bound', "class 'none' is upgraded on the first rating");
    assert.equal(d.psy.rating, 0, 'input untouched');
    assert.deepEqual({ kind: entry.kind, ref: entry.ref, rank: entry.rank, cost: entry.cost },
        { kind: 'psy_rating', ref: 'psy.rating', rank: 1, cost: 200 });

    // second rank costs 200 × new rating and follows on
    const psy2 = listAvailableAdvances(d2, PACK).find((a) => a.kind === 'psy_rating');
    assert.equal(psy2.rank, 2);
    assert.equal(psy2.cost, 400);
    assert.equal(applyAdvance(d2, PACK, psy2).doc.psy.rating, 2);

    // rank skipping is refused with the current rating in the message
    assert.throws(() => applyAdvance(d2, PACK, { ...psy2, rank: 4 }), /^Error: psy rating 4 skips \(current: 1\)$/);

    // a doc with no psy block at all gets one created
    const noPsy = structuredClone(d);
    delete noPsy.psy;
    assert.deepEqual(applyAdvance(noPsy, PACK, psy).doc.psy, { rating: 1, class: 'bound', sustained: 0 });

    // a non-psyker is offered nothing
    assert.ok(!listAvailableAdvances(mk(), PACK).some((a) => a.kind === 'psy_rating'));
});

test('elite advances: listed, cost-carried, appended to origin (created when absent), never twice', () => {
    const d = mk([], 5000);
    const offered = listAvailableAdvances(d, PACK).filter((a) => a.kind === 'elite_advance');
    assert.ok(offered.length > 0);
    assert.ok(!offered.some((a) => a.ref === 'dh2:elite_advance:inquisitor'), 'entries without an xpCost are not offered');

    const sister = offered.find((a) => a.ref === 'dh2:elite_advance:sister_of_battle');
    assert.equal(sister.cost, 750);
    assert.equal(sister.matches, 0);
    assert.equal(sister.prereqsMet, false, 'Willpower 40 is parsed and unmet at base 30');
    assert.throws(() => applyAdvance(d, PACK, sister), /^Error: prerequisites unmet: .*Willpower 40.*confirmed:true/s);

    const { doc: d2, entry } = applyAdvance(d, PACK, sister, { confirmed: true });
    assert.deepEqual(d2.origin.eliteAdvances, [{ name: 'Sister of Battle', ref: 'dh2:elite_advance:sister_of_battle', cost: 750 }]);
    assert.equal(entry.kind, 'elite_advance');
    assert.equal(entry.cost, 750);
    assert.equal(entry.rank, undefined, 'elite advances carry no rank');
    assert.equal(xpSummary(d2).remaining, 5000 - 750);

    // already taken → no longer offered
    assert.ok(!listAvailableAdvances(d2, PACK).some((a) => a.ref === 'dh2:elite_advance:sister_of_battle'));

    // a doc with no origin block gets the canonical one built
    const noOrigin = structuredClone(d);
    delete noOrigin.origin;
    const built = applyAdvance(noOrigin, PACK, sister, { confirmed: true }).doc.origin;
    assert.deepEqual({ homeworld: built.homeworld, background: built.background, role: built.role }, { homeworld: null, background: null, role: null });
    assert.equal(built.eliteAdvances.length, 1);
});

test('applyAdvance error surface: unknown kind, unknown characteristic, unknown skill ref, rank skips', () => {
    const d = mk(['Weapon Skill', 'Offence'], 5000);
    assert.throws(() => applyAdvance(d, PACK, { kind: 'bogus', ref: 'x', cost: 0 }), /^Error: unknown advance kind "bogus"$/);
    assert.throws(() => applyAdvance(d, PACK, { kind: 'characteristic', ref: 'luck', rank: 1, cost: 100 }), /^Error: unknown characteristic "luck"$/);
    assert.throws(() => applyAdvance(d, PACK, { kind: 'skill', ref: 'dh2:skill:nope', rank: 1, cost: 100 }), /^Error: unknown skill ref "dh2:skill:nope"$/);

    // non-specialist skill rank sequence, both directions
    const dodge = listAvailableAdvances(d, PACK).find((a) => a.kind === 'skill' && a.name === 'Dodge');
    const { doc: d2 } = applyAdvance(d, PACK, dodge);
    assert.equal(d2.skills.Dodge.advances, 1);
    assert.throws(() => applyAdvance(d2, PACK, dodge), /^Error: rank 1 skips \(current: 1\)$/);
    const dodge2 = listAvailableAdvances(d2, PACK).find((a) => a.kind === 'skill' && a.name === 'Dodge');
    assert.equal(dodge2.rank, 2);
    assert.equal(applyAdvance(d2, PACK, dodge2).doc.skills.Dodge.advances, 2);

    // specialist speciality rank sequence
    const cl = listAvailableAdvances(d2, PACK).find((a) => a.kind === 'skill' && a.name === 'Common Lore (new speciality)');
    const { doc: d3 } = applyAdvance(d2, PACK, { ...cl, speciality: 'Imperium', name: 'Common Lore' });
    assert.equal(d3.skills['Common Lore'].specialities.Imperium.advances, 1);
    assert.throws(() => applyAdvance(d3, PACK, { ...cl, speciality: 'Imperium', name: 'Common Lore' }),
        /^Error: rank 1 skips \(current: 1\)$/);
    const cl2 = listAvailableAdvances(d3, PACK).find((a) => a.name === 'Common Lore (Imperium)');
    assert.equal(cl2.rank, 2);
    assert.equal(applyAdvance(d3, PACK, cl2).doc.skills['Common Lore'].specialities.Imperium.advances, 2);
});

test('characteristic normalisation: the object form advances in place, the scalar form is upgraded first', () => {
    // object form (the canonical shape) — untouched by the normalisation branch
    const obj = mk(['Weapon Skill', 'Offence'], 5000);
    obj.characteristics.ws = { base: 42, advances: 1, modifiers: [{ value: 5, source: 'Implant' }] };
    const ws2 = listAvailableAdvances(obj, PACK).find((a) => a.kind === 'characteristic' && a.ref === 'ws');
    assert.equal(ws2.rank, 2, 'next rank follows the stored advance count');
    const after = applyAdvance(obj, PACK, ws2).doc.characteristics.ws;
    assert.deepEqual(after, { base: 42, advances: 2, modifiers: [{ value: 5, source: 'Implant' }] });

    // scalar form — upgraded to { base, advances, modifiers } on write
    const scalar = mk(['Ballistic Skill', 'Finesse'], 5000);
    scalar.characteristics.bs = 37;
    const bs1 = listAvailableAdvances(scalar, PACK).find((a) => a.kind === 'characteristic' && a.ref === 'bs');
    assert.equal(bs1.rank, 1);
    assert.deepEqual(applyAdvance(scalar, PACK, bs1).doc.characteristics.bs, { base: 37, advances: 1, modifiers: [] });
    assert.equal(scalar.characteristics.bs, 37, 'input untouched');

    // and the scalar form still enforces the rank sequence after normalisation
    assert.throws(() => applyAdvance(scalar, PACK, { ...bs1, rank: 3 }), /^Error: rank 3 skips \(current advances: 0\)$/);
});

test('listAvailableAdvances caps: maxed characteristics, veteran skills, held vs specialist talents', () => {
    const d = mk([], 99999);
    d.characteristics.ws = { base: 30, advances: 5, modifiers: [] };   // table length = 5
    d.skills = {
        Dodge: { advances: 4 },                                        // veteran = last rank
        'Common Lore': { specialities: { Imperium: { advances: 4 }, Tech: { advances: 1 } } },
    };
    d.talents = [{ name: 'Jaded' }, { name: 'Peer (Nobility)' }];
    const list = listAvailableAdvances(d, PACK);

    assert.ok(!list.some((a) => a.kind === 'characteristic' && a.ref === 'ws'), 'maxed characteristic drops out');
    assert.ok(list.some((a) => a.kind === 'characteristic' && a.ref === 'bs'), 'others still offered');
    assert.ok(!list.some((a) => a.name === 'Dodge'), 'veteran skill drops out');
    assert.ok(!list.some((a) => a.name === 'Common Lore (Imperium)'), 'veteran speciality drops out');
    const tech = list.find((a) => a.name === 'Common Lore (Tech)');
    assert.equal(tech.rank, 2);
    assert.ok(list.some((a) => a.name === 'Common Lore (new speciality)'), 'a new speciality is always offered');
    assert.ok(!list.some((a) => a.kind === 'talent' && a.name === 'Jaded'), 'held non-specialist talent drops out');
    assert.ok(list.some((a) => a.kind === 'talent' && a.name === 'Peer'), 'specialist talents stay buyable');
});

test('checkPrerequisites: full characteristic names, specialisations, mixed alternatives, unmet psy rating', () => {
    const d = mk();
    d.characteristics.wp = { base: 45, advances: 0, modifiers: [] };
    d.talents = [{ name: 'Resistance (Fear)' }];

    assert.deepEqual(checkPrerequisites(d, ['Willpower 40']), { met: true, problems: [] });   // long name → wp
    assert.deepEqual(checkPrerequisites(d, ['Resistance (Any)']), { met: true, problems: [] });   // "(X)" base match

    // the threshold is inclusive: total EQUAL to the requirement passes, one under fails
    const edge = mk();
    edge.characteristics.ag = { base: 25, advances: 1, modifiers: [] };               // total 30
    assert.deepEqual(checkPrerequisites(edge, ['Ag 30']), { met: true, problems: [] });
    assert.deepEqual(checkPrerequisites(edge, ['Agility 30']), { met: true, problems: [] });
    assert.equal(checkPrerequisites(edge, ['Ag 31']).met, false);
    assert.deepEqual(checkPrerequisites(d, []), { met: true, problems: [] });
    assert.deepEqual(checkPrerequisites(d, undefined), { met: true, problems: [] });

    const psy = checkPrerequisites(d, ['Psy Rating 3']);
    assert.equal(psy.met, false);
    assert.deepEqual(psy.problems, ['unmet prerequisite: "Psy Rating 3"']);

    // one parseable-and-false alternative + one unparseable → blocked, not warned
    const mixed = checkPrerequisites(d, ['Ag 90 or Nonexistent Talent']);
    assert.equal(mixed.met, false);
    assert.deepEqual(mixed.problems, ['unmet prerequisite: "Ag 90 or Nonexistent Talent"']);
});

test('applyOrigin: duplicate aptitudes surface as a choice instead of stacking', () => {
    const d = emptyCharacter('Dup');
    d.aptitudes = [{ name: 'Toughness', source: 'prior' }];           // Feral World also grants Toughness
    const res = applyOrigin(d, PACK, { homeworldRef: 'dh2:home_world:feral_world' });
    assert.deepEqual(res.choicesNeeded, [{ kind: 'duplicate_aptitude', duplicate: 'Toughness', source: 'homeworld' }]);
    assert.deepEqual(res.doc.aptitudes, [{ name: 'Toughness', source: 'prior' }], 'no duplicate pushed');
    assert.deepEqual(res.doc.origin.homeworld, { name: 'Feral World', ref: 'dh2:home_world:feral_world' });
    assert.deepEqual(res.doc.fate, { max: 2, current: 2 });
    assert.deepEqual(res.characteristicModifiers, { S: 3, T: 3, Inf: -3 });
});

test('applyOrigin: every "X or Y" grant is a choice point, and answering them applies the pick', () => {
    const base = emptyCharacter('Sororitas');
    base.xp = { total: 1234, ledger: [] };                             // pre-existing XP is not overwritten

    const unanswered = applyOrigin(base, PACK, { backgroundRef: 'dh2:background:adepta_sororitas' });
    assert.deepEqual(unanswered.choicesNeeded.map((c) => c.kind), ['aptitude', 'skill', 'skill', 'talent']);
    assert.deepEqual(unanswered.choicesNeeded[1], {
        kind: 'skill', options: ['Charm', 'Intimidate'], key: 'Charm or Intimidate', source: 'background',
    });
    assert.deepEqual(unanswered.doc.aptitudes, []);
    assert.deepEqual(unanswered.doc.talents, []);
    assert.deepEqual(Object.keys(unanswered.doc.skills), ['Athletics', 'Common Lore', 'Linguistics']);
    assert.deepEqual(unanswered.doc.skills['Common Lore'], { specialities: { 'Adepta Sororitas': { advances: 1 } } });
    assert.equal(unanswered.doc.xp.total, 1234);
    assert.equal(unanswered.woundsFormula, null, 'no homeworld → no wounds formula');
    assert.equal(unanswered.fateThreshold, null);
    assert.deepEqual(unanswered.characteristicModifiers, {});

    const answered = applyOrigin(base, PACK, {
        backgroundRef: 'dh2:background:adepta_sororitas',
        choices: {
            'Offence or Social': 'Social',
            'Charm or Intimidate': 'Intimidate',
            'Medicae or Parry': 'Parry',
            'Weapon Training (Flame or Las, Chain)': 'Weapon Training (Las)',
        },
    });
    assert.deepEqual(answered.choicesNeeded, []);
    assert.deepEqual(answered.doc.aptitudes, [{ name: 'Social', source: 'background' }]);
    assert.equal(answered.doc.skills.Intimidate.advances, 1);
    assert.equal(answered.doc.skills.Parry.advances, 1);
    assert.deepEqual(answered.doc.talents, [{ name: 'Weapon Training (Las)' }]);
});

test('applyOrigin: bare specialist grants ask for a speciality, unknown grants are flagged, duplicate talents grant once', () => {
    // synthetic background so the branches are driven directly (pack is read-only input)
    const pack = {
        ...PACK,
        backgrounds: [...PACK.backgrounds, {
            ref: 'test:bg', name: 'Test BG',
            skillsGranted: ['Trade', 'Xenoarchaeology', 'Athletics'],
            talentsGranted: ['Jaded', 'Jaded'],
            startingAptitude: 'Tech',
        }],
    };
    const res = applyOrigin(emptyCharacter('Synthetic'), pack, { backgroundRef: 'test:bg' });
    assert.deepEqual(res.choicesNeeded, [
        { kind: 'speciality', skill: 'Trade', key: 'Trade', source: 'background' },
        { kind: 'unresolved_skill', grant: 'Xenoarchaeology', source: 'background' },
    ]);
    assert.deepEqual(res.doc.skills, { Athletics: { advances: 1 } });
    assert.deepEqual(res.doc.talents, [{ name: 'Jaded' }], 'a talent already held is not pushed twice');
    assert.deepEqual(res.doc.aptitudes, [{ name: 'Tech', source: 'background' }]);
    assert.equal(res.doc.xp.total, PACK.startingXp);

    assert.throws(() => applyOrigin(emptyCharacter('X'), PACK, { roleRef: 'dh2:role:nope' }),
        /^Error: unknown role ref "dh2:role:nope"$/);
    assert.throws(() => applyOrigin(emptyCharacter('X'), PACK, { homeworldRef: 'dh2:home_world:nope' }),
        /^Error: unknown homeworld ref "dh2:home_world:nope"$/);
    assert.throws(() => applyOrigin(emptyCharacter('X'), PACK, { backgroundRef: 'dh2:background:nope' }),
        /^Error: unknown background ref "dh2:background:nope"$/);
});

test('validateBuild: held pack talents without a ledger purchase warn; ledger buys of unheld talents error', () => {
    const d = mk([], 2000);
    d.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500, date: '2026-01-01' }];
    d.characteristics.ws.advances = 1;
    d.talents = [{ name: 'Jaded' }, { name: 'Resistance (Fear)' }, { name: 'Totally Made Up' }];

    const r = validateBuild(d, PACK);
    assert.equal(r.ok, true, 'unpurchased holdings warn, never error');
    assert.deepEqual(r.warnings, [
        'talent "Jaded" held without a ledger purchase (origin grant or import)',
        'talent "Resistance (Fear)" held without a ledger purchase (origin grant or import)',
    ]);
    assert.deepEqual(r.errors, []);
    // "Totally Made Up" is not a corpus talent → not reported at all

    // an empty ledger suppresses the warning entirely (nothing to reconcile against)
    const fresh = mk([], 2000);
    fresh.talents = [{ name: 'Jaded' }];
    assert.deepEqual(validateBuild(fresh, PACK), { ok: true, errors: [], warnings: [] });

    // the converse: the ledger claims a talent the doc does not hold
    const missing = mk([], 2000);
    missing.xp.ledger = [{ kind: 'talent', ref: 'dh2:talent:jaded', name: 'Jaded', cost: 300 }];
    const r2 = validateBuild(missing, PACK);
    assert.equal(r2.ok, false);
    assert.deepEqual(r2.errors, ['ledger buys talent "Jaded" but the doc does not hold it']);
});

test('BUG (characterization): typed SKILL ledger entries are replayed but never reconciled', () => {
    // advancement.mjs builds `expSkill` (lines ~444-447) and never compares it,
    // so skill-advance drift between the ledger and the doc is silently accepted
    // even for a fully-typed (builder-written) ledger — unlike characteristics.
    const d = mk([], 2000);
    d.xp.ledger = [
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 1, cost: 300, date: '2026-01-01' },
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 2, cost: 600, date: '2026-01-02' },
    ];
    d.skills = { Dodge: { advances: 0 } };                             // ledger says 2, doc says 0
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] },
        'CURRENT (wrong) behaviour — the same drift on a characteristic is an error');

    // proof that the characteristic side does catch it
    const chr = mk([], 2000);
    chr.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500 }];
    chr.characteristics.ws.advances = 3;
    const r = validateBuild(chr, PACK);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['characteristic ws: ledger implies 1 advances, doc has 3']);
});

test('BUG (characterization): the pack keys willpower "wil" but documents key it "wp" — WIL advances are unbuyable', () => {
    // pack.characteristicAptitudes uses the corpus key "wil"; character docs use
    // "wp" (CHARACTERISTIC_KEYS / CHAR_KEY_BY_NAME). listAvailableAdvances reads
    // doc.characteristics['wil'] → always undefined → always offers rank 1, and
    // applyAdvance then throws. /api/chargen/advance answers 400 for willpower.
    assert.ok('wil' in PACK.characteristicAptitudes && !('wp' in PACK.characteristicAptitudes));
    const d = mk(['Willpower', 'Psyker'], 5000);
    d.characteristics.wp = { base: 40, advances: 3, modifiers: [] };    // already 3 advances bought

    const wil = listAvailableAdvances(d, PACK).find((a) => a.ref === 'wil');
    assert.equal(wil.rank, 1, 'CURRENT (wrong): the stored 3 advances are invisible, so rank resets');
    assert.equal(wil.cost, PACK.costs.characteristic.matches_2[0], 'and it is priced as a first advance');
    assert.throws(() => applyAdvance(d, PACK, wil), /^Error: unknown characteristic "wil"$/);
    assert.ok(!listAvailableAdvances(d, PACK).some((a) => a.ref === 'wp'), 'no "wp" advance is ever offered');
});
