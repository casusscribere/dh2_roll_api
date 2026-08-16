/**
 * Branch/guard coverage for the engine seam, the rules registry helpers, the
 * character schema validator and the import adapters.
 *
 * These modules are all high on LINE coverage and low on BRANCH coverage: the
 * happy path is exercised everywhere, the guards are not. Every test here
 * drives a specific guard — a validation failure, an unknown name, an empty
 * collection, a null input, a boundary value — and asserts the OBSERVABLE
 * consequence (the error path/message, the returned shape, the emitted event),
 * never merely "it did not throw".
 *
 * Companion to (not a replacement for) engine.test.mjs, pipeline.test.mjs,
 * dependencies.test.mjs, roll20-adapter.test.mjs, builder-core.test.mjs and
 * schema-v4.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { riggedDice, d100, die } from './helpers.mjs';
import { Registry, CHECKPOINTS, runCheckpoint } from '../lib/pipeline.mjs';
import {
    entryName, canonEntry, canonList, entryLevel, normName, hasQuality, qualityLevel,
} from '../lib/rules/_util.mjs';
import {
    ACTIONS, registerActions, availableActions, actionType, isReaction,
    actionSubtypes, actionHasSubtype, isAction,
} from '../lib/actions.mjs';
import { checkDependencies, DEPENDENCIES } from '../lib/rules/dependencies.mjs';
import { availableTalents, availableTraits, buildRegistry } from '../lib/rules/index.mjs';
import {
    emptyEncounter, encounterActor, tickEncounter, mergeActorState, harvestEngagement,
    ENCOUNTER_SCHEMA_VERSION,
} from '../lib/encounter.mjs';
import {
    resolveTest, rollDamage, resolveAttack, resolveParry, resolveEngagement,
    engageAttackRoll, engageDamage, engageEvasion, engageOnHit,
} from '../lib/engine.mjs';
import {
    emptyCharacter, validateCharacter, migrateCharacter, characterToCombatant,
    characteristicTotal, skillTarget, encumbrance, armourByLocation, movement,
    fatigueThreshold, modifierTotal, canonicalSkillName, CHARACTER_SCHEMA_VERSION,
} from '../lib/character-schema.mjs';
import { fromRoll20, fromRoll20Dump } from '../../tools/adapters/roll20.mjs';
import { fromGoogleSheetCsv } from '../../tools/adapters/google-sheets.mjs';
import { BuilderSession, groupAdvances } from '../../ui/builder-core.mjs';
import { dispatch } from '../lib/api-router.mjs';

/** Find every error/warning entry for a path (validateCharacter reports). */
const at = (list, path) => list.filter((e) => e.path === path);
/** Assert exactly one report entry at `path` and return it. */
const one = (list, path) => {
    const hits = at(list, path);
    assert.equal(hits.length, 1, `expected exactly one entry at "${path}", got ${JSON.stringify(hits)}`);
    return hits[0];
};

// ============================================================ rules/_util ====

test('_util: entryName/canonEntry/entryLevel tolerate null, undefined and bare strings', () => {
    // nullish → the empty-string fallbacks, never a throw
    assert.equal(entryName(null), '');
    assert.equal(entryName(undefined), '');
    assert.deepEqual(canonEntry(null), { name: '', level: null });
    assert.deepEqual(canonEntry(undefined), { name: '', level: null });
    assert.equal(entryLevel(null), null);
    assert.equal(entryLevel(undefined), null);
    assert.equal(normName(null), '');
    assert.equal(normName(undefined), '');
    // object entries with a missing name/level fall back, they do not throw
    assert.deepEqual(canonEntry({}), { name: '', level: null });
    assert.equal(entryLevel({}), null);
    assert.equal(entryName({ name: 'Tearing' }), 'Tearing');
});

test('_util: both level spellings parse — "Name (3)" and the bare-suffix "Name 3"', () => {
    assert.deepEqual(canonEntry('Proven (3)'), { name: 'Proven', level: 3 });
    assert.deepEqual(canonEntry('Vengeful 9'), { name: 'Vengeful', level: 9 });
    assert.equal(entryLevel('Proven (3)'), 3);
    assert.equal(entryLevel('Vengeful 9'), 9);          // the `\s(\d+)$` fallback branch
    assert.equal(entryLevel('Tearing'), null);
    // an unlevelled name keeps level null rather than inventing a 0
    assert.deepEqual(canonEntry('Razor Sharp'), { name: 'Razor Sharp', level: null });
});

test('_util: canonList tolerates a nullish list; hasQuality/qualityLevel handle empty input', () => {
    assert.deepEqual(canonList(null), []);
    assert.deepEqual(canonList(undefined), []);
    assert.deepEqual(canonList(['Proven (3)', { name: 'Tearing' }]),
        [{ name: 'Proven', level: 3 }, { name: 'Tearing', level: null }]);
    // absent collections are "no qualities", not a crash
    assert.equal(hasQuality(undefined, 'Tearing'), false);
    assert.equal(hasQuality(null, 'Tearing'), false);
    assert.equal(hasQuality([], 'Tearing'), false);
    // fallback is returned both when the list is empty AND when the match is unlevelled
    assert.equal(qualityLevel(undefined, 'Proven', 7), 7, 'nullish list → fallback');
    assert.equal(qualityLevel([], 'Proven', 7), 7, 'no match → fallback');
    assert.equal(qualityLevel(['Proven'], 'Proven', 7), 7, 'match without a level → fallback');
    assert.equal(qualityLevel(['Proven (3)'], 'Proven', 7), 3, 'levelled match wins over the fallback');
});

test('_util: normName is spelling-blind across spaces, underscores and hyphens', () => {
    assert.equal(normName('Razor Sharp'), 'razorsharp');
    assert.equal(normName('razor_sharp'), 'razorsharp');
    assert.equal(normName('Two-Weapon Wielder'), 'twoweaponwielder');
    assert.ok(hasQuality([{ name: 'RazorSharp' }], 'razor_sharp'));
});

// ============================================================== actions ======

test('actions: unknown and nullish action names return the documented empty shapes', () => {
    // byName() falls off the end of the ACTIONS scan → every reader takes its default
    assert.equal(actionType('No Such Action'), '');
    assert.equal(actionType(undefined), '');
    assert.equal(actionType(null), '');
    assert.equal(isReaction('No Such Action'), false);
    assert.deepEqual(actionSubtypes('No Such Action'), []);
    assert.deepEqual(actionSubtypes(undefined), []);
    assert.equal(actionHasSubtype('No Such Action', 'attack'), false);
    // …while a known action still resolves through the same path
    assert.equal(actionType('swift_attack'), 'Half');
    assert.equal(isReaction('Parry'), true);
    assert.ok(actionHasSubtype('SemiAutoBurst', 'ranged'));
    assert.equal(isAction(undefined, 'Parry'), false);
    assert.equal(isAction('parry', 'Parry'), true);
});

test('actions: registerActions ignores null/nameless entries and defaults subtypes to []', () => {
    const before = availableActions();
    registerActions();                       // no argument → the default []
    registerActions([null, undefined, {}, { type: 'Half' }]);   // no `name` → skipped
    assert.deepEqual(availableActions(), before, 'nameless entries must not enter the taxonomy');

    try {
        registerActions([{ name: 'Coverage Probe', type: 'Free' }]);   // no subtypes key
        assert.equal(actionType('Coverage Probe'), 'Free');
        assert.deepEqual(actionSubtypes('Coverage Probe'), [], 'missing subtypes defaults to []');
        assert.ok(availableActions().includes('Coverage Probe'));
    } finally {
        delete ACTIONS['Coverage Probe'];
    }
    assert.deepEqual(availableActions(), before, 'taxonomy restored');
});

// ========================================================= rules/dependencies

test('dependencies: a call with no arguments at all yields no warnings', () => {
    // config.talents / config.traits / known.* are all undefined — every list
    // defaults to empty, so no subject is active and nothing is reported.
    assert.deepEqual(checkDependencies(), []);
    assert.deepEqual(checkDependencies({}), []);
    assert.deepEqual(checkDependencies({}, {}), []);
    assert.deepEqual(checkDependencies({ talents: [] }, { talents: availableTalents }), []);
});

test('dependencies: a blank-string characteristic is SKIPPED, not treated as 0', () => {
    const known = { talents: availableTalents, traits: availableTraits };
    // Crushing Blow needs WS 40. An empty string means "not supplied" (the Roll
    // page's cleared input) — skipping it, not failing it, is the contract.
    assert.deepEqual(checkDependencies({ talents: ['Crushing Blow'], characteristics: { ws: '' } }, known), []);
    assert.deepEqual(checkDependencies({ talents: ['Crushing Blow'], characteristics: { ws: null } }, known), []);
    // supplied and below the bar → a warning naming the threshold
    const bad = checkDependencies({ talents: ['Crushing Blow'], characteristics: { ws: 39 } }, known);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].requirement, 'WS 40');
    assert.match(bad[0].message, /Crushing Blow requires WS 40 \(p\.125\)/);
    // exactly at the bar → satisfied (boundary is inclusive)
    assert.deepEqual(checkDependencies({ talents: ['Crushing Blow'], characteristics: { ws: 40 } }, known), []);
});

test('dependencies: entries with no `requires`, and requirement forms the checker does not understand', () => {
    const known = { talents: [...availableTalents, 'Coverage Subject', 'Coverage Alien'], traits: availableTraits };
    DEPENDENCIES.talents['Coverage Subject'] = { page: 999 };   // deliberately no requires[]
    // an unrecognised requirement OBJECT (neither a name, an anyOf, nor a
    // characteristic) is not checkable — it must be skipped, never warned
    DEPENDENCIES.talents['Coverage Alien'] = { requires: [{ homeworld: 'Fenksworld' }, { anyOf: [{ homeworld: 'x' }] }] };
    try {
        assert.deepEqual(checkDependencies({ talents: ['Coverage Subject'] }, known), []);
        assert.deepEqual(checkDependencies({ talents: ['Coverage Alien'] }, known), [],
            'an unknown requirement form is skipped, including inside anyOf');
    } finally {
        delete DEPENDENCIES.talents['Coverage Subject'];
        delete DEPENDENCIES.talents['Coverage Alien'];
    }
    assert.ok(!('Coverage Subject' in DEPENDENCIES.talents), 'table restored');
    assert.ok(!('Coverage Alien' in DEPENDENCIES.talents), 'table restored');
});

test('dependencies: trait subjects go through the same path as talents', () => {
    DEPENDENCIES.traits['Coverage Trait'] = { page: 42, requires: [{ characteristic: 't', min: 40 }] };
    try {
        const known = { talents: availableTalents, traits: [...availableTraits, 'Coverage Trait'] };
        const warn = checkDependencies({ traits: ['Coverage Trait'], characteristics: { t: 30 } }, known);
        assert.equal(warn.length, 1);
        assert.equal(warn[0].kind, 'trait');
        assert.equal(warn[0].page, 42);
        assert.deepEqual(checkDependencies({ traits: ['Coverage Trait'], characteristics: { t: 40 } }, known), []);
    } finally {
        delete DEPENDENCIES.traits['Coverage Trait'];
    }
});

// ============================================================== pipeline =====

test('pipeline: Registry.table() and .all() handle nullish names and report everything registered', () => {
    const r = new Registry();
    assert.equal(r.table(undefined), undefined, 'a nullish table name resolves to undefined');
    assert.equal(r.table(null), undefined);
    assert.equal(r.table('nope'), undefined);
    r.addTable(null);            // ignored
    r.addTable({ nameless: true });
    assert.deepEqual(r.tables(), [], 'a table without a name is not registered');

    const tbl = { name: 'Coverage Table', die: { count: 1, sides: 10 }, rows: [] };
    r.addTable(tbl);
    assert.equal(r.table('COVERAGE table'), tbl, 'lookup is case-insensitive');
    assert.deepEqual(r.tables(), [tbl]);

    r.add({ id: 'a', checkpoint: CHECKPOINTS.MODIFIERS, apply: () => {} });
    r.add({ id: 'b', checkpoint: CHECKPOINTS.ON_HIT, apply: () => {} });
    assert.deepEqual(r.all().map((e) => e.id).sort(), ['a', 'b'], 'all() flattens every bucket');
});

test('pipeline: runCheckpoint tolerates a null context and a context without a log array', () => {
    const seen = [];
    const r = new Registry().add({
        id: 'probe', source: 'test', checkpoint: CHECKPOINTS.MODIFIERS,
        apply: (ctx) => seen.push(ctx),
    });
    runCheckpoint(r, CHECKPOINTS.MODIFIERS, null);
    assert.deepEqual(seen, [null], 'effect still fires with a null ctx');

    const noLog = { suppressed: undefined };
    runCheckpoint(r, CHECKPOINTS.MODIFIERS, noLog);
    assert.equal(noLog.log, undefined, 'no log array is created when the ctx has none');

    const withLog = { log: [] };
    runCheckpoint(r, CHECKPOINTS.MODIFIERS, withLog);
    assert.deepEqual(withLog.log, [{ checkpoint: CHECKPOINTS.MODIFIERS, effect: 'probe', source: 'test' }]);
});

test('pipeline: an anonymous effect logs as "(anonymous)" and a bad effect is rejected', () => {
    const r = new Registry().add({ checkpoint: CHECKPOINTS.MODIFIERS, apply: () => {} });
    const ctx = { log: [] };
    runCheckpoint(r, CHECKPOINTS.MODIFIERS, ctx);
    assert.equal(ctx.log[0].effect, '(anonymous)');
    assert.throws(() => new Registry().add({ checkpoint: 'NOT_A_CHECKPOINT', apply: () => {} }), /Invalid effect/);
    assert.throws(() => new Registry().add({ checkpoint: CHECKPOINTS.MODIFIERS }), /Invalid effect/);
    assert.throws(() => new Registry().add(null), /Invalid effect/);
});

// ============================================================= encounter =====

const UPKEEP_APPLY_DSL = `
condition "Cursed" {
  on upkeep.TURN_END
  when has_condition("Cursed")
  then require_test "Fellowship" 0 "the curse takes hold" => apply_status "Doomed" value 2 duration 3 location "Head"
}
`;

test('encounter: an unknown upkeep phase throws, naming the three legal phases', () => {
    const enc = emptyEncounter();
    assert.equal(enc.schemaVersion, ENCOUNTER_SCHEMA_VERSION);
    assert.throws(() => tickEncounter(enc, 'ROUND_START'),
        /Unknown upkeep phase 'ROUND_START' \(TURN_START \| TURN_END \| ROUND_END\)/);
    assert.throws(() => tickEncounter(enc, undefined), /Unknown upkeep phase/);
});

test('encounter: ticking an actorKey that is not in the document is a no-op', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'a').conditions.push({ name: 'On Fire' });
    const { encounter, events } = tickEncounter(enc, 'TURN_START', buildRegistry(), riggedDice([]), 'ghost');
    assert.deepEqual(events, [], 'no events for a missing actor');
    assert.equal(encounter.actors.a.wounds.taken, 0, 'the real actor is untouched');
    assert.equal(encounter.round, 1);
});

test('encounter: an actor with no stats block still ticks (talents/traits default to empty)', () => {
    const enc = emptyEncounter();
    // a hand-assembled actor, as an external tracker might post it
    enc.actors.raw = { name: 'Raw', conditions: [{ name: 'On Fire' }], armourDamage: {}, cooldowns: {}, wounds: { taken: 0 } };
    const { encounter, events } = tickEncounter(enc, 'TURN_START', buildRegistry(), riggedDice([die(4, 10)]));
    const burn = events.find((e) => e.type === 'damage');
    assert.ok(burn, 'On Fire still burns without a stats block');
    assert.equal(burn.amount, 4);
    assert.equal(encounter.actors.raw.wounds.taken, 4);
});

test('encounter: a Toxified actor with no stored Toughness tests against 0 and always fails', () => {
    const enc = emptyEncounter();
    const a = encounterActor(enc, 'v', 'Victim');   // stats.characteristics stays {}
    a.conditions.push({ name: 'Toxified', severity: 1 });
    const { encounter, events } = tickEncounter(enc, 'TURN_END', buildRegistry(), riggedDice([d100(15), die(9, 10)]));
    const t = events.find((e) => e.type === 'test');
    assert.equal(t.characteristic, 'Toughness');
    assert.equal(t.threshold, -10, 'no stored T → target 0, Toxic(1) → −10');
    assert.equal(t.success, false);
    assert.equal(t.damage, 9);
    assert.equal(encounter.actors.v.wounds.taken, 9);
});

test('encounter: an upkeep test on an unmapped characteristic resolves against 0 and can apply a condition', () => {
    const enc = emptyEncounter();
    const a = encounterActor(enc, 'c', 'Cursed One');
    a.stats.characteristics = { t: 40, ag: 40, wp: 40, fel: 60 };   // fel is deliberately NOT mapped
    a.conditions.push({ name: 'Cursed' });
    const reg = buildRegistry(UPKEEP_APPLY_DSL);
    const { encounter, events } = tickEncounter(enc, 'TURN_END', reg, riggedDice([d100(30)]));

    const t = events.find((e) => e.type === 'test');
    assert.equal(t.characteristic, 'Fellowship');
    assert.equal(t.threshold, 0, 'Fellowship is not one of the mapped upkeep characteristics → target 0');
    assert.equal(t.success, false, 'a roll of 30 against 0 fails');
    assert.equal(t.outcome, 'the curse takes hold');
    assert.equal(t.applied, 'Doomed');
    assert.equal(encounter.actors.c.wounds.taken, 0, 'this rule declares no damage');

    const doomed = encounter.actors.c.conditions.find((x) => x.name === 'Doomed');
    assert.deepEqual(doomed, { name: 'Doomed', severity: 2, duration: 3, location: 'Head' });
});

test('encounter: a per-actor ROUND_END tick does NOT advance the round counter', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'a').conditions.push({ name: 'Stunned', duration: 2 });
    encounterActor(enc, 'b').conditions.push({ name: 'Stunned', duration: 2 });
    const scoped = tickEncounter(enc, 'ROUND_END', buildRegistry(), riggedDice([]), 'a');
    assert.equal(scoped.encounter.round, 1, 'a scoped tick is not a round boundary');
    assert.equal(scoped.encounter.actors.a.conditions[0].duration, 1);
    assert.equal(scoped.encounter.actors.b.conditions[0].duration, 2, 'the other actor is untouched');
    const whole = tickEncounter(enc, 'ROUND_END', buildRegistry(), riggedDice([]));
    assert.equal(whole.encounter.round, 2, 'a whole-encounter tick advances the round');
});

test('encounter: mergeActorState handles a combatant with no conditions and an unknown key', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'k').conditions.push({ name: 'On Fire' }, { name: 'Stunned' });
    const merged = mergeActorState({ name: 'Bob' }, enc, 'k');
    assert.deepEqual(merged.conditions.map((c) => c.name), ['On Fire', 'Stunned']);
    assert.equal(merged.name, 'Bob', 'the rest of the combatant survives the merge');

    // the dedupe key reads both spellings of a combatant-side condition
    const mixed = mergeActorState({ conditions: [{ name: 'On Fire' }, 'Stunned'] }, enc, 'k');
    assert.deepEqual(mixed.conditions, [{ name: 'On Fire' }, 'Stunned'],
        'both the object and the string spelling suppress the duplicate');

    const untouched = { name: 'Bob' };
    assert.equal(mergeActorState(untouched, enc, 'nobody'), untouched, 'unknown key returns the input as-is');
    assert.equal(mergeActorState(untouched, null, 'k'), untouched, 'no encounter returns the input as-is');
    assert.equal(mergeActorState(untouched, undefined, 'k'), untouched);
});

test('encounter: harvestEngagement seeds a fresh document from an empty result', () => {
    // no encounter, and a result with no attack block at all
    const out = harvestEngagement(undefined, 'atk', 'def', {});
    assert.equal(out.schemaVersion, ENCOUNTER_SCHEMA_VERSION);
    assert.equal(out.round, 1);
    assert.equal(out.actors.atk.name, 'atk', 'the key is the default display name');
    assert.equal(out.actors.def.name, 'def');
    assert.equal(out.actors.atk.cooldowns.recharge, undefined, 'no Recharge effect → no cooldown');
    assert.equal(out.actors.def.wounds.taken, 0);
    assert.deepEqual(out.actors.def.conditions, []);
});

test('encounter: harvestEngagement skips evaded and field-absorbed hits, and defaults every optional field', () => {
    const result = {
        attack: {
            effects: [{ name: 'Recharge' }],
            hits: [
                { evaded: true, location: 'Head', targetEffects: { statuses: [{ status: 'Ignored' }] }, soak: { woundsInflicted: 99 } },
                { fieldAbsorbed: true, location: 'Body', targetEffects: { statuses: [{ status: 'AlsoIgnored' }] } },
                // no `location`, no soak, no corrosiveWounds, and status/armour
                // entries missing every optional member
                { targetEffects: { armour: [{}], statuses: [{ status: 'Bleeding' }] } },
                // no targetEffects at all
                { location: 'Head', soak: { woundsInflicted: 3 }, corrosiveWounds: 2 },
            ],
        },
    };
    const out = harvestEngagement(emptyEncounter(), 'atk', 'def', result, { attackerName: 'Gunner', defenderName: 'Mark' });
    assert.equal(out.actors.atk.name, 'Gunner');
    assert.equal(out.actors.def.name, 'Mark');
    assert.equal(out.actors.atk.cooldowns.recharge, true, 'the Recharge effect sets the cooldown');
    // evaded/absorbed hits contributed nothing
    assert.deepEqual(out.actors.def.conditions, [{ name: 'Bleeding', severity: null, duration: null, location: null }]);
    assert.deepEqual(out.actors.def.armourDamage, { Body: 0 }, 'a location-less corroding hit defaults to Body, amount 0');
    assert.equal(out.actors.def.wounds.taken, 5, 'only the landed hit: 3 soaked + 2 corrosive');
});

// ================================================================ engine =====

const GUN = { name: 'Gun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] };

test('engine: resolveTest with no target rolls against 0 and labels itself "test"', () => {
    const r = resolveTest({}, riggedDice([d100(50)]));
    assert.equal(r.target, 0, 'a missing target is 0, not NaN');
    assert.equal(r.success, false);
    assert.equal(r.testName, '');
    assert.deepEqual(r.effects, []);
    // a named test keeps the "<name> test" label path
    const named = resolveTest({ target: 40, testName: 'Awareness' }, riggedDice([d100(10)]));
    assert.equal(named.testName, 'Awareness');
    assert.equal(named.success, true);
});

test('engine: rollDamage keeps the weapon damage type when no rule overrides it', () => {
    const r = rollDamage({ formula: '1d10', damageType: 'Rending' }, riggedDice([die(5, 10)]));
    assert.equal(r.damageType, 'Rending');
    assert.equal(r.total, 5);
    assert.deepEqual(r.dice.discarded, [], 'no keep-highest rule → nothing discarded');
    assert.equal(r.righteousFury.length, 0);
});

test('engine: a weaponless attacker resolves with the documented placeholder defaults', () => {
    // no weapon, no action, no rangeBand: every `??` default in runToHit
    const r = resolveAttack({ characteristics: { bs: 50 } }, riggedDice([d100(70)]));
    assert.equal(r.weapon, 'Unnamed weapon');
    assert.equal(r.action, 'Standard Attack');
    assert.equal(r.rangeBand, 'Normal Range');
    assert.equal(r.ammoUsed, 1);
    assert.equal(r.test.modifiedTarget, 60, 'BS 50 + the Standard Attack +10');
    assert.equal(r.test.success, false, '70 vs a modified 60 misses');
    assert.deepEqual(r.hits, []);
    assert.equal(r.totalWounds, undefined, 'no defender → no wound total');
});

test('engine: an unknown action name passes through untouched and falls back to the Standard Attack profile', () => {
    const r = resolveAttack({ characteristics: { bs: 90 }, weapon: GUN, action: 'Improvised Nonsense' },
        riggedDice([d100(10), die(4, 10)]));
    assert.equal(r.action, 'Improvised Nonsense', 'the caller-supplied spelling is preserved');
    assert.equal(r.ammoUsed, 1, 'unknown actions use the single-shot rate');
    assert.equal(r.hits.length, 1, 'no extra hits accrue for an unknown action');
});

test('engine: an unknown aim mode contributes no bonus', () => {
    const aimed = resolveAttack({ characteristics: { bs: 50 }, weapon: GUN, action: 'Standard Attack', aim: 'Telescopic' },
        riggedDice([d100(50), die(3, 10)]));
    assert.equal(aimed.test.modifiers.aim, undefined, 'an unrecognised aim mode adds nothing');
    assert.equal(aimed.test.modifiedTarget, 60, 'only the Standard Attack +10 applies');
});

test('engine: rollHitDamage defaults — no weapon damageType, no talents/traits/aim on the source', () => {
    // resolveAttack with a weapon carrying only name+damage: every optional
    // weapon/source field takes its default inside rollHitDamage.
    const bare = { name: 'Rock', damage: '1d10' };
    const r = resolveAttack({ characteristics: { bs: 90, s: 30 }, weapon: bare, action: 'Standard Attack' },
        riggedDice([d100(5), die(6, 10)]));
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].damageType, 'Impact', 'a weapon with no damageType is Impact');
    assert.equal(r.hits[0].damage.total, 6, 'no SB for a non-melee weapon');
    assert.equal(r.hits[0].penetration, 0);
});

test('engine: resolveParry with no weapon, no customModifier and no unnatural still resolves', () => {
    const r = resolveParry({ characteristics: { ws: 45 } }, riggedDice([d100(20)]));
    assert.equal(r.weapon, 'Unnamed weapon');
    assert.equal(r.action, 'Parry');
    assert.equal(r.test.success, true);
    assert.equal(r.test.characteristic, 'WS');
    assert.equal(r.test.modifiers.modifier, undefined, 'no customModifier → no modifier entry');
    assert.equal(r.tableRolls, undefined, 'no POST_PARRY table roll → the key is omitted');
    // a WS-less parrier rolls against 0
    const noWs = resolveParry({}, riggedDice([d100(20)]));
    assert.equal(noWs.test.target, 0);
    assert.equal(noWs.test.success, false);
});

test('engine: engageEvasion returns the null reaction for an absent or unknown evasion mode', () => {
    assert.deepEqual(engageEvasion({}, 1), { reaction: null, evaded: 0 });
    assert.deepEqual(engageEvasion({ evasion: {} }, 1), { reaction: null, evaded: 0 });
    assert.deepEqual(engageEvasion({ evasion: { mode: 'block' } }, 1), { reaction: null, evaded: 0 });
});

test('engine: a Dodge with no Agility and no evasion modifier rolls against 0', () => {
    const ev = engageEvasion({ evasion: { mode: 'dodge' } }, 1, buildRegistry(), riggedDice([d100(40)]));
    assert.equal(ev.reaction.mode, 'dodge');
    assert.equal(ev.reaction.test.target, 0);
    assert.equal(ev.reaction.test.success, false);
    assert.equal(ev.evaded, 0);
    // `agility` and `ag` are both accepted spellings
    const spelledAg = engageEvasion({ evasion: { mode: 'dodge' }, characteristics: { ag: 60 } }, 1, buildRegistry(), riggedDice([d100(10)]));
    assert.equal(spelledAg.reaction.test.target, 60);
    assert.ok(spelledAg.evaded >= 1);
});

test('engine: engageAttackRoll/engageDamage work with no defender supplied', () => {
    const reg = buildRegistry();
    const attack = engageAttackRoll({ characteristics: { bs: 90 }, weapon: GUN, action: 'Standard Attack' },
        reg, riggedDice([d100(5)]));
    assert.equal(attack.success, true);
    assert.equal(attack.hits.length, 1);
    assert.equal(attack.scatter, undefined, 'a hit carries no scatter block');
    const dmg = engageDamage({ weapon: GUN }, attack, reg, riggedDice([die(7, 10)]));
    assert.equal(dmg.hits[0].damage.total, 7);
    assert.equal(dmg.hits[0].damageType, 'Impact');
    assert.equal(dmg.hits[0].fellingReduction, 0, 'no Felling → 0, never undefined');
});

test('engine: engageDamage on a missed attack (no hits, no meta) returns an empty hit list', () => {
    const reg = buildRegistry();
    const miss = engageAttackRoll({ characteristics: { bs: 20 }, weapon: GUN, action: 'Standard Attack' },
        reg, riggedDice([d100(90)]));
    assert.equal(miss.success, false);
    assert.deepEqual(miss.hits, []);
    assert.equal(miss.meta, undefined);
    assert.deepEqual(engageDamage({ weapon: GUN }, miss, reg, riggedDice([])), { hits: [] });
    assert.deepEqual(engageDamage({}, {}, reg, riggedDice([])), { hits: [] });
});

test('engine: engageOnHit with a rating-0 field and a defender with no characteristics', () => {
    const reg = buildRegistry();
    const damageHits = [{ hitNumber: 1, location: 'Body', damage: { total: 8, error: undefined }, totalPenetration: 0 }];
    const out = engageOnHit({ weapon: GUN }, { field: { rating: 0, overloadMax: 0 } }, damageHits, 0, {}, reg, riggedDice([]));
    assert.equal(out.fieldDown, false);
    assert.equal(out.hits[0].field, undefined, 'a rating-0 field never rolls');
    assert.equal(out.hits[0].soak.woundsInflicted, 8, 'no armour, no TB → full damage');
    assert.equal(out.totalWounds, 8);
});

test('engine: engageOnHit skips soak entirely for a hit whose damage failed to parse', () => {
    const reg = buildRegistry();
    const damageHits = [{ hitNumber: 1, location: 'Body', damage: { error: 'Cannot parse damage formula "oops"' }, totalPenetration: 0 }];
    const out = engageOnHit({ weapon: GUN }, {}, damageHits, 0, {}, reg, riggedDice([]));
    assert.equal(out.hits[0].soak, undefined, 'an unparseable damage roll produces no soak block');
    assert.equal(out.totalWounds, 0);
});

test('engine: an unparseable damage formula still yields a typed hit — weapon type, else Impact', () => {
    const broken = { name: 'Broken', isMelee: false, damage: 'not-a-formula', damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const r = resolveAttack({ characteristics: { bs: 90 }, weapon: broken, action: 'Standard Attack' }, riggedDice([d100(5)]));
    assert.match(r.hits[0].damage.error, /Cannot parse damage formula "not-a-formula"/);
    assert.equal(r.hits[0].damageType, 'Energy', 'the weapon type stands in when the damage roll failed');

    const typeless = { ...broken, damageType: undefined };
    const r2 = resolveAttack({ characteristics: { bs: 90 }, weapon: typeless, action: 'Standard Attack' }, riggedDice([d100(5)]));
    assert.equal(r2.hits[0].damageType, 'Impact', 'with no weapon type either, Impact is the floor');
    assert.equal(r2.hits[0].soak, undefined, 'no defender → no soak either way');

    // the same fallback chain in the stepped flow
    const reg = buildRegistry();
    const atk = engageAttackRoll({ characteristics: { bs: 90 }, weapon: broken, action: 'Standard Attack' }, reg, riggedDice([d100(5)]));
    assert.equal(engageDamage({ weapon: broken }, atk, reg, riggedDice([])).hits[0].damageType, 'Energy');
    assert.equal(engageDamage({ weapon: typeless }, atk, reg, riggedDice([])).hits[0].damageType, 'Impact');
});

test('engine: a rule cannot drive the hit count below zero', () => {
    const reg = buildRegistry(`
quality "Negative Probe" {
  on HIT_COUNT_MULT
  when has_quality("Negative Probe")
  then set extra_hits += (0 - 5)
}
`);
    const gun = { ...GUN, qualities: ['Negative Probe'] };
    const r = resolveAttack({ characteristics: { bs: 90 }, weapon: gun, action: 'Standard Attack' },
        riggedDice([d100(5), die(4, 10)]), reg);
    assert.equal(r.test.success, true);
    assert.equal(r.hits.length, 1, 'the additional-hit count clamps at 0 — a success always lands one hit');
});

test('engine: a landed hit with an unparseable damage roll contributes 0 wounds, not NaN', () => {
    const broken = { name: 'Broken', isMelee: false, damage: 'nonsense', damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] };
    const r = resolveAttack({
        characteristics: { bs: 90 }, weapon: broken, action: 'Standard Attack',
        target: { armour: 0, toughnessBonus: 0 },
    }, riggedDice([d100(5)]));
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].soak, undefined, 'no soak block is produced for an errored damage roll');
    assert.equal(r.totalWounds, 0, 'a soak-less hit totals 0 wounds');
});

test('engine: resolveParry coerces a non-numeric customModifier to 0 and reads unnatural WS', () => {
    const junk = resolveParry({ characteristics: { ws: 40 }, customModifier: 'lots' }, riggedDice([d100(30)]));
    assert.equal(junk.test.modifiers.modifier, 0, 'a non-numeric customModifier contributes 0, not NaN');
    assert.equal(junk.test.modifiedTarget, 40);

    const unnatural = resolveParry({ characteristics: { ws: 40 }, unnatural: { ws: 4 } }, riggedDice([d100(10)]));
    assert.equal(unnatural.test.unnatural, 4);
    assert.equal(unnatural.test.bonusDos, 2, 'Unnatural (4) → ⌈4/2⌉ = 2 bonus DoS');
    // a non-numeric unnatural is 0, not NaN
    const junkUnnatural = resolveParry({ characteristics: { ws: 40 }, unnatural: { ws: 'many' } }, riggedDice([d100(10)]));
    assert.equal(junkUnnatural.test.unnatural, 0);
});

test('engine: a Dodge coerces a non-numeric evasion modifier to 0', () => {
    const ev = engageEvasion({ evasion: { mode: 'dodge', modifier: 'plenty' }, characteristics: { agility: 50 } },
        1, buildRegistry(), riggedDice([d100(30)]));
    assert.equal(ev.reaction.test.modifiers.modifier, 0);
    assert.equal(ev.reaction.test.modifiedTarget, 50);
});

test('engine: a defender-supplied toughnessBonus overrides the derived one', () => {
    const reg = buildRegistry();
    const damageHits = [{ hitNumber: 1, location: 'Body', damage: { total: 10 }, totalPenetration: 0 }];
    const derived = engageOnHit({ weapon: GUN }, { characteristics: { t: 40 } }, damageHits, 0, {}, reg, riggedDice([]));
    assert.equal(derived.totalWounds, 6, 'TB derived from T 40 → 4');
    const explicit = engageOnHit({ weapon: GUN }, { characteristics: { t: 40 }, toughnessBonus: 9 }, damageHits, 0, {}, reg, riggedDice([]));
    assert.equal(explicit.totalWounds, 1, 'an explicit toughnessBonus wins over the derived one');
});

test('engine: engageAttackRoll surfaces the scatter block on a Blast miss', () => {
    const blast = { name: 'Frag Grenade', isMelee: false, damage: '2d10', pen: 0, damageType: 'Explosive', rof: { single: true, burst: 0, full: 0 }, qualities: ['Blast (3)'] };
    const reg = buildRegistry();
    // roll 80 vs BS 30 (+10 Standard Attack) → a miss, so Blast scatters:
    // 1d5 distance, a Scatter Diagram direction, then the detonation's 2d10.
    const out = engageAttackRoll({ characteristics: { bs: 30 }, weapon: blast, action: 'Standard Attack' },
        reg, riggedDice([d100(80), die(3, 5), die(4, 10), die(6, 10), die(2, 10)]));
    assert.equal(out.success, false);
    assert.ok(out.scatter, 'a missed Blast attaches a scatter block');
    assert.equal(out.scatter.direction, 4);
    assert.equal(out.scatter.directionText, 'short and to the right');
    assert.equal(out.scatter.baseDistance, 3);
    assert.equal(out.scatter.distance, 3);
    assert.equal(out.scatter.hit.damage.total, 8, 'Blast still detonates at the scatter point');
    assert.equal(out.scatter.hit.totalPenetration, 0);
    assert.deepEqual(out.hits, []);
    assert.equal(out.meta, undefined);
});

test('engine: PENETRATION modifiers are folded into a scattered Blast detonation', () => {
    const blast = { name: 'Krak Missile', isMelee: false, damage: '2d10', pen: 2, damageType: 'Explosive', rof: { single: true, burst: 0, full: 0 }, qualities: ['Blast (3)', 'Pen Probe'] };
    const reg = buildRegistry(`
quality "Pen Probe" {
  on PENETRATION
  when has_quality("Pen Probe")
  then set pen += 4
}
`);
    const out = engageAttackRoll({ characteristics: { bs: 30 }, weapon: blast, action: 'Standard Attack' },
        reg, riggedDice([d100(80), die(3, 5), die(4, 10), die(6, 10), die(2, 10)]));
    assert.equal(out.success, false);
    assert.equal(out.scatter.hit.penetration, 2, 'the weapon base pen');
    assert.deepEqual(out.scatter.hit.penetrationModifiers, { 'pen probe': 4 });
    assert.equal(out.scatter.hit.totalPenetration, 6, 'base + the rule modifier applies at the scatter point too');
});

test('engine: resolveEngagement with a weaponless attacker passes null to the Parry safeguard', () => {
    const reg = buildRegistry();
    const r = resolveEngagement({
        attacker: { characteristics: { bs: 90 }, action: 'Standard Attack' },   // no weapon at all
        defender: { characteristics: { ws: 90, t: 30 }, evasion: { mode: 'parry' }, weapon: { name: 'Sword', qualities: [] } },
    }, riggedDice([d100(5), d100(5)]), reg);
    assert.equal(r.attack.success, true);
    assert.equal(r.attack.weapon, 'Unnamed weapon');
    assert.equal(r.reaction.mode, 'parry', 'a null attacking weapon does not prevent the Parry');
    assert.equal(r.reaction.test.success, true);
    assert.equal(r.defender.evaded, 1);
    assert.match(r.attack.hits[0].damage.error, /Cannot parse damage formula/);
    assert.equal(r.attack.totalWounds, 0);
});

test('engine: a passed avoids_hit test voids the hit and its wounds (Spray, p.149)', () => {
    const spray = { name: 'Flamer', isMelee: false, damage: '1d10', pen: 0, damageType: 'Energy', rof: { single: true, burst: 0, full: 0 }, qualities: ['Spray'] };
    const target = { armour: 0, toughnessBonus: 0, agility: 60 };
    // damage die 5, then the defender's Agility test rolls 10 → passes → avoided
    const avoided = resolveAttack({ characteristics: { bs: 40 }, weapon: spray, action: 'Standard Attack', target, autoResolveTests: true },
        riggedDice([die(5, 10), d100(10)]));
    assert.equal(avoided.test.autoHit, true, 'Spray never rolls to hit');
    assert.equal(avoided.hits[0].avoided, true);
    assert.equal(avoided.hits[0].avoidedBy, 'Agility');
    assert.equal(avoided.totalWounds, 0, 'an avoided hit contributes no wounds even though soak ran');

    // the same shot with a FAILED Agility test lands
    const landed = resolveAttack({ characteristics: { bs: 40 }, weapon: spray, action: 'Standard Attack', target, autoResolveTests: true },
        riggedDice([die(5, 10), d100(90)]));
    assert.equal(landed.hits[0].avoided, undefined);
    assert.equal(landed.totalWounds, 5);
});

test('engine: a roll_table row gap resolves to the documented "(no matching row)" placeholder', () => {
    const reg = buildRegistry(`
roll_table "Gappy Table" {
  die 1d10
  1-3: "a low result"
}
quality "Gap Probe" {
  on POST_PARRY
  when has_quality("Gap Probe") and success
  then roll_on "Gappy Table"
}
`);
    // parry succeeds (roll 10 vs WS 40), then the table rolls an 8 — outside every row
    const gap = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Probe', qualities: ['Gap Probe'] } },
        riggedDice([d100(10), die(8, 10)]), reg);
    assert.equal(gap.test.success, true);
    assert.equal(gap.tableRolls.length, 1);
    assert.equal(gap.tableRolls[0].roll, 8);
    assert.equal(gap.tableRolls[0].text, '(no matching row)');
    assert.deepEqual(gap.tableRolls[0].statuses, []);
    // a roll INSIDE the table still finds its row
    const hitRow = resolveParry({ characteristics: { ws: 40 }, weapon: { name: 'Probe', qualities: ['Gap Probe'] } },
        riggedDice([d100(10), die(2, 10)]), reg);
    assert.equal(hitRow.tableRolls[0].text, 'a low result');
});

// ======================================================= character-schema ====

test('schema: modifierTotal and the modifier shape guard', () => {
    assert.equal(modifierTotal(undefined), 0);
    assert.equal(modifierTotal(null), 0);
    assert.equal(modifierTotal([]), 0);
    assert.equal(modifierTotal([{ value: 5 }, { value: -2 }]), 3);
    assert.equal(modifierTotal([{ value: 'x' }, null, { value: 4 }]), 4, 'non-numeric entries count as 0');

    const doc = emptyCharacter('M');
    doc.characteristics.ws.modifiers = [
        { value: 5, source: 'Ok' },
        { value: 5, note: 42 },          // note must be a string
        { value: 'nope' },               // value must be an integer
        { value: 5, source: 7 },         // source must be a string
    ];
    const r = validateCharacter(doc);
    assert.equal(r.ok, false);
    for (const i of [1, 2, 3]) {
        assert.match(one(r.errors, `characteristics.ws.modifiers[${i}]`).message,
            /Must be \{ value: int, source\?: string, note\?: string \}/);
    }
    assert.equal(at(r.errors, 'characteristics.ws.modifiers[0]').length, 0, 'the valid modifier is not reported');
});

test('schema: characteristicTotal handles flat ints, missing keys and junk values', () => {
    assert.equal(characteristicTotal({ characteristics: { ws: 42 } }, 'ws'), 42, 'v1 flat int is the total');
    assert.equal(characteristicTotal({}, 'ws'), 0, 'no characteristics block → 0');
    assert.equal(characteristicTotal({ characteristics: {} }, 'ws'), 0, 'missing key → 0');
    assert.equal(characteristicTotal({ characteristics: { ws: null } }, 'ws'), 0);
    assert.equal(characteristicTotal({ characteristics: { ws: 'thirty' } }, 'ws'), 0, 'a junk value is 0, not NaN');
    assert.equal(characteristicTotal({ characteristics: { ws: {} } }, 'ws'), 0, 'an empty object → base 0, advances 0');
    assert.equal(characteristicTotal({ characteristics: { ws: { base: 30 } } }, 'ws'), 30, 'advances/modifiers default');
    assert.equal(characteristicTotal({ characteristics: { ws: { base: 30, advances: 2, modifiers: [{ value: 3 }] } } }, 'ws'), 43);
});

test('schema: skillTarget returns null for an unknown skill and treats unknown specialities as untrained', () => {
    const doc = emptyCharacter('S');
    doc.characteristics.int = { base: 41, advances: 0, modifiers: [] };
    doc.characteristics.ag = { base: 35, advances: 0, modifiers: [] };

    assert.equal(skillTarget(doc, 'Basket Weaving'), null, 'unknown skill name → null');
    assert.equal(skillTarget({}, 'Dodge').target, 0, 'a document with no skills block is untrained at ½ of 0');
    assert.equal(skillTarget({}, 'Dodge').trained, false);
    assert.equal(canonicalSkillName('Basket Weaving'), null);
    assert.equal(canonicalSkillName('scholastic_lores'), 'Scholastic Lore', 'plural + snake_case still canonicalise');

    // a skill with NO document entry at all: untrained = half the characteristic
    const untrained = skillTarget(doc, 'Acrobatics');
    assert.deepEqual(untrained, { target: 17, characteristic: 'ag', advances: 0, trained: false, modifiers: [] });

    // a specialist skill with no entry, and with an entry but an unknown speciality
    assert.equal(skillTarget(doc, 'Forbidden Lore').target, 20, 'no entry → untrained (½ of 41 = 20)');
    assert.equal(skillTarget(doc, 'Forbidden Lore', 'Xenos').trained, false);
    doc.skills['Forbidden Lore'] = { specialities: { Daemonology: { advances: 2, modifiers: [{ value: 5 }] } }, modifiers: [{ value: 3 }] };
    assert.equal(skillTarget(doc, 'Forbidden Lore', 'Xenos').target, 23, 'unknown speciality is untrained (20) + skill mods (3)');
    assert.equal(skillTarget(doc, 'Forbidden Lore', 'daemonology').target, 59, '41 + 10 + 3 + 5, spelling-blind');
    assert.equal(skillTarget(doc, 'Forbidden Lore', null).target, 23, 'no speciality named → untrained');

    // an entry that overrides the governing characteristic
    doc.skills['Acrobatics'] = { advances: 1, characteristic: 'int' };
    assert.equal(skillTarget(doc, 'acrobatics').characteristic, 'int');
    assert.equal(skillTarget(doc, 'acrobatics').target, 41);
});

test('schema: encumbrance counts only equipped items and clamps the SB+TB index', () => {
    const doc = emptyCharacter('E');
    doc.characteristics.s = { base: 30, advances: 0, modifiers: [] };
    doc.characteristics.t = { base: 30, advances: 0, modifiers: [] };
    doc.weapons = [{ name: 'A', damage: '1d10', weight: 5 }, { name: 'B', damage: '1d10', weight: 100, equipped: false }];
    doc.armourItems = [{ name: 'Flak', ap: 3, weight: 4 }, { name: 'Stored', ap: 1, weight: 50, equipped: false }];
    doc.gear = [{ name: 'Ration', weight: 0.5, quantity: 4 }, { name: 'Chest', weight: 40, equipped: false }, { name: 'Weightless' }];
    const e = encumbrance(doc);
    assert.equal(e.sbPlusTb, 6, 'SB 3 + TB 3');
    assert.equal(e.carried, 11, '5 + 4 + (0.5 × 4); unequipped and weightless items add nothing');
    assert.equal(e.carry, 36);
    assert.equal(e.encumbered, false);

    // above the table's top index the limits clamp rather than returning undefined
    const titan = emptyCharacter('T');
    titan.unnatural = { s: 20, t: 20 };
    const te = encumbrance(titan);
    assert.equal(te.sbPlusTb, 20, 'the SB+TB sum clamps to the last CARRY_TABLE row');
    assert.equal(te.carry, 2250);
    assert.equal(encumbrance({}).sbPlusTb, 0, 'an empty document is index 0');
    assert.equal(encumbrance({}).carry, 0.9);
});

test('schema: armourByLocation falls back to the flat block, honours "all", and ignores unknown locations', () => {
    const doc = emptyCharacter('A');
    doc.armour = { head: 2, body: 4 };
    assert.deepEqual(armourByLocation(doc), { head: 2, body: 4, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 },
        'no equipped items → the flat block wins');
    assert.deepEqual(armourByLocation({}), { head: 0, body: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 },
        'an empty document is all-zero');

    doc.armourItems = [
        { name: 'Bodyglove', ap: 3 },                                     // no locations[] → "all"
        { name: 'Helm', ap: 5, locations: ['head', 'nose'] },             // "nose" is not a location
        { name: 'Plate', locations: ['body'] },                           // no ap → 0
        { name: 'Stored Carapace', ap: 9, locations: ['all'], equipped: false },
    ];
    const ap = armourByLocation(doc);
    assert.equal(ap.head, 5, 'the highest equipped item wins — armour does not stack');
    assert.equal(ap.body, 3, 'the ap-less item cannot beat the bodyglove');
    assert.equal(ap.leftLeg, 3);
    assert.equal(ap.nose, undefined, 'an unknown location is dropped, not added');
    assert.equal(Object.values(ap).every((v) => v <= 5), true, 'the unequipped AP 9 item never applies');
});

test('schema: movement and fatigueThreshold on a bare document', () => {
    assert.deepEqual(movement({}), { half: 0, full: 0, charge: 0, run: 0 });
    assert.equal(fatigueThreshold({}), 0);
    const doc = { characteristics: { ag: 35, t: 40, wp: 29 }, movementModifier: -10 };
    assert.deepEqual(movement(doc), { half: 0, full: 0, charge: 0, run: 0 }, 'the AgB delta floors at 0');
    assert.deepEqual(movement({ characteristics: { ag: 35 } }), { half: 3, full: 6, charge: 9, run: 18 });
    assert.equal(fatigueThreshold(doc), 6, 'TB 4 + WB 2');
});

test('schema: validateCharacter rejects non-objects outright', () => {
    for (const bad of [null, undefined, 'a string', 42, true]) {
        const r = validateCharacter(bad);
        assert.equal(r.ok, false);
        assert.deepEqual(r.errors, [{ path: '', message: 'Not an object' }]);
        assert.deepEqual(r.warnings, []);
    }
});

test('schema: the document header — schemaVersion, kind, name, system', () => {
    const r = validateCharacter({ schemaVersion: '4', kind: 'dh2.actor', name: '   ', system: 7 });
    assert.equal(r.ok, false);
    assert.equal(one(r.errors, 'schemaVersion').message, 'Required integer');
    assert.equal(one(r.errors, 'kind').message, 'Must be "dh2.character"');
    assert.equal(one(r.errors, 'name').message, 'Required non-empty string', 'a whitespace-only name is empty');
    assert.equal(one(r.errors, 'system').message, 'Must be a string');
    assert.equal(one(r.errors, 'characteristics').message, 'Required object');

    // a FUTURE version warns rather than errors (forward compatibility)
    const future = emptyCharacter('F');
    future.schemaVersion = CHARACTER_SCHEMA_VERSION + 1;
    const fr = validateCharacter(future);
    assert.equal(fr.ok, true, 'a newer document is still loadable');
    assert.match(one(fr.warnings, 'schemaVersion').message,
        new RegExp(`Document is v${CHARACTER_SCHEMA_VERSION + 1}; this build knows v${CHARACTER_SCHEMA_VERSION}`));
});

test('schema: characteristics — missing keys, bounds, wrong shapes and unknown keys', () => {
    const doc = emptyCharacter('C');
    delete doc.characteristics.fel;
    doc.characteristics.ws = 201;                    // v1 flat int, out of range
    doc.characteristics.bs = -1;                     // v1 flat int, out of range
    doc.characteristics.s = 'strong';                // neither int nor object
    doc.characteristics.t = null;
    doc.characteristics.ag = { base: 250 };
    doc.characteristics.int = { base: 30, advances: 6 };
    doc.characteristics.per = { base: 30, advances: -1 };
    doc.characteristics.wp = { base: 30, modifiers: 'nope' };
    doc.characteristics.luck = 40;                   // not a DH2 characteristic

    const r = validateCharacter(doc);
    assert.equal(r.ok, false);
    assert.equal(one(r.errors, 'characteristics.fel').message, 'Required');
    assert.equal(one(r.errors, 'characteristics.ws').message, 'Integer 0–200 required');
    assert.equal(one(r.errors, 'characteristics.bs').message, 'Integer 0–200 required');
    assert.match(one(r.errors, 'characteristics.s').message, /\{ base, advances, modifiers\[\] \} \(or a flat int\) required/);
    assert.match(one(r.errors, 'characteristics.t').message, /required/);
    assert.equal(one(r.errors, 'characteristics.ag.base').message, 'Integer 0–200 required');
    assert.equal(one(r.errors, 'characteristics.int.advances').message, 'Integer 0–5 required');
    assert.equal(one(r.errors, 'characteristics.per.advances').message, 'Integer 0–5 required');
    assert.match(one(r.errors, 'characteristics.wp.modifiers').message, /Must be an array/);
    assert.match(one(r.warnings, 'characteristics.luck').message, /Unknown characteristic \(ignored\)/);

    // boundaries are inclusive
    const edge = emptyCharacter('Edge');
    edge.characteristics.ws = 0;
    edge.characteristics.bs = 200;
    edge.characteristics.s = { base: 0, advances: 0, modifiers: [] };
    edge.characteristics.t = { base: 200, advances: 5, modifiers: [] };
    assert.equal(validateCharacter(edge).ok, true, '0/200 and advances 0/5 are legal');
});

test('schema: skills — wrong container, unknown names, bounds and speciality shapes', () => {
    const doc = emptyCharacter('K');
    doc.skills = [];
    assert.match(one(validateCharacter(doc).errors, 'skills').message, /Must be an object keyed by skill name/);
    doc.skills = 'Dodge';
    assert.match(one(validateCharacter(doc).errors, 'skills').message, /Must be an object keyed by skill name/);

    doc.skills = {
        'Basket Weaving': { advances: 1 },
        Dodge: 'trained',
        Awareness: { advances: 5 },
        Athletics: { advances: 1, characteristic: 'luck' },
        Charm: { advances: 1, modifiers: [{ value: 1.5 }] },
        Command: { advances: 2, specialities: { X: { advances: 1 } } },            // not a specialist skill
        'Common Lore': { advances: 2, specialities: 'Imperium' },
        'Forbidden Lore': { specialities: { Xenos: 'yes', Warp: { advances: 9 }, Chaos: { advances: 1, modifiers: 3 } } },
    };
    const r = validateCharacter(doc);
    assert.equal(r.ok, false);
    assert.match(one(r.warnings, 'skills.Basket Weaving').message, /Not a DH2 core skill name/);
    assert.equal(one(r.errors, 'skills.Dodge').message, 'Must be an object');
    assert.equal(one(r.errors, 'skills.Awareness.advances').message, 'Integer 0–4 required');
    assert.match(one(r.errors, 'skills.Athletics.characteristic').message, /One of: ws, bs, s, t, ag, int, per, wp, fel/);
    assert.match(one(r.errors, 'skills.Charm.modifiers[0]').message, /Must be \{ value: int/);
    assert.match(one(r.warnings, 'skills.Command.specialities').message, /Command is not a specialist skill/);
    assert.match(one(r.errors, 'skills.Common Lore.specialities').message, /Must be an object keyed by speciality/);
    assert.match(one(r.warnings, 'skills.Common Lore.advances').message, /Specialist skill/);
    assert.equal(one(r.errors, 'skills.Forbidden Lore.specialities.Xenos').message, 'Must be an object');
    assert.equal(one(r.errors, 'skills.Forbidden Lore.specialities.Warp.advances').message, 'Integer 0–4 required');
    assert.match(one(r.errors, 'skills.Forbidden Lore.specialities.Chaos.modifiers').message, /Must be an array/);
});

test('schema: xp — container, totals, ledger array and every typed ledger field', () => {
    const doc = emptyCharacter('X');
    doc.xp = 1000;
    assert.match(one(validateCharacter(doc).errors, 'xp').message, /Must be \{ total, spent\?, ledger\[\] \}/);
    doc.xp = null;
    assert.match(one(validateCharacter(doc).errors, 'xp').message, /Must be \{ total, spent/);

    doc.xp = { total: -1, spent: 1.5, ledger: {} };
    let r = validateCharacter(doc);
    assert.equal(one(r.errors, 'xp.total').message, 'Non-negative integer required');
    assert.equal(one(r.errors, 'xp.spent').message, 'Non-negative integer required');
    assert.equal(one(r.errors, 'xp.ledger').message, 'Must be an array');

    doc.xp = {
        total: 1000,
        ledger: [
            null,
            { name: 'No cost' },
            { name: 'Bad cost', cost: -5 },
            { name: 'Bad kind type', cost: 100, kind: 7 },
            { name: 'Unknown kind', cost: 100, kind: 'vehicle' },
            { name: 'Bad ref', cost: 100, ref: 42 },
            { name: 'Bad rank', cost: 100, rank: 0 },
            { name: 'Bad matches', cost: 100, matches: 3 },
            { name: 'Negative matches', cost: 100, matches: -1 },
            { name: 'Good', cost: 0, kind: 'talent', ref: 'dh2:talent:jaded', rank: 1, matches: 2 },
        ],
    };
    r = validateCharacter(doc);
    assert.match(one(r.errors, 'xp.ledger[0]').message, /\{ name: string, cost: int ≥ 0/);
    assert.equal(at(r.errors, 'xp.ledger[1]').length, 1, 'a ledger entry without a cost is rejected');
    assert.equal(at(r.errors, 'xp.ledger[2]').length, 1, 'a negative cost is rejected');
    assert.equal(one(r.errors, 'xp.ledger[3].kind').message, 'String required');
    assert.match(one(r.warnings, 'xp.ledger[4].kind').message, /Unknown kind "vehicle"/);
    assert.equal(one(r.errors, 'xp.ledger[5].ref').message, 'String required');
    assert.equal(one(r.errors, 'xp.ledger[6].rank').message, 'Integer ≥ 1 required');
    assert.equal(one(r.errors, 'xp.ledger[7].matches').message, 'Integer 0–2 required');
    assert.equal(one(r.errors, 'xp.ledger[8].matches').message, 'Integer 0–2 required');
    assert.equal(at(r.errors, 'xp.ledger[9]').length, 0, 'the fully-typed entry is clean');
    assert.equal(at(r.warnings, 'xp.ledger[9].kind').length, 0);
});

test('schema: aptitudes and the Emperor’s Tarot', () => {
    const doc = emptyCharacter('A');
    doc.aptitudes = 'Finesse';
    assert.equal(one(validateCharacter(doc).errors, 'aptitudes').message, 'Must be an array');
    doc.aptitudes = ['Finesse', { name: 'Ballistic Skill', source: 'role' }, 42, {}, null];
    const r = validateCharacter(doc);
    assert.match(one(r.errors, 'aptitudes[2]').message, /Must be a string or \{ name, source\? \}/);
    assert.equal(at(r.errors, 'aptitudes[3]').length, 1, 'an object without a name is not a named entry');
    assert.equal(at(r.errors, 'aptitudes[4]').length, 1, 'null is not a named entry');
    assert.equal(at(r.errors, 'aptitudes[0]').length, 0);
    assert.equal(at(r.errors, 'aptitudes[1]').length, 0);

    doc.aptitudes = [];
    doc.tarot = 'The Emperor';
    assert.match(one(validateCharacter(doc).errors, 'tarot').message, /Must be \{ card\?, text\?, effect\? \}/);
    doc.tarot = { card: 7, text: 'ok', effect: {} };
    const tr = validateCharacter(doc);
    assert.equal(one(tr.errors, 'tarot.card').message, 'String required');
    assert.equal(one(tr.errors, 'tarot.effect').message, 'String required');
    assert.equal(at(tr.errors, 'tarot.text').length, 0);
});

test('schema: armourItems — container, entry shape and every optional field bound', () => {
    const doc = emptyCharacter('AI');
    doc.armourItems = {};
    assert.equal(one(validateCharacter(doc).errors, 'armourItems').message, 'Must be an array');

    doc.armourItems = [
        'Flak Cloak',
        { name: '  ', ap: 3 },
        { name: 'No AP' },
        { name: 'Bad AP', ap: -1 },
        { name: 'Bad Locations', ap: 1, locations: 'all' },
        { name: 'Odd Locations', ap: 1, locations: ['all', 'wing'] },
        { name: 'Bad Weight', ap: 1, weight: -0.5 },
        { name: 'Bad Equipped', ap: 1, equipped: 'yes' },
        { name: 'Bad MaxAg', ap: 1, maxAgility: 1.5 },
        { name: 'Fine', ap: 4, locations: ['body'], weight: 8, equipped: true, maxAgility: 0 },
    ];
    const r = validateCharacter(doc);
    assert.equal(one(r.errors, 'armourItems[0]').message, 'Must be an object', 'a bare string is not an armour item');
    assert.equal(one(r.errors, 'armourItems[1].name').message, 'Required non-empty string');
    assert.equal(one(r.errors, 'armourItems[2].ap').message, 'Non-negative integer AP required');
    assert.equal(one(r.errors, 'armourItems[3].ap').message, 'Non-negative integer AP required');
    assert.match(one(r.errors, 'armourItems[4].locations').message, /Must be an array/);
    assert.match(one(r.warnings, 'armourItems[5].locations[1]').message, /Unknown location "wing" \(ignored\)/);
    assert.match(one(r.errors, 'armourItems[6].weight').message, /Non-negative number \(kg\) required/);
    assert.equal(one(r.errors, 'armourItems[7].equipped').message, 'Boolean required');
    assert.equal(one(r.errors, 'armourItems[8].maxAgility').message, 'Non-negative integer required');
    assert.equal(r.errors.filter((e) => e.path.startsWith('armourItems[9]')).length, 0, 'the well-formed item is clean');
});

test('schema: gear — container, entry shape, weight/quantity/equipped bounds and description/dsl', () => {
    const doc = emptyCharacter('G');
    doc.gear = 'rope';
    assert.equal(one(validateCharacter(doc).errors, 'gear').message, 'Must be an array');

    doc.gear = [
        null,
        { name: '' },
        { name: 'Bad Weight', weight: 'heavy' },
        { name: 'Bad Qty', quantity: 0 },
        { name: 'Fractional Qty', quantity: 1.5 },
        { name: 'Bad Equipped', equipped: 1 },
        { name: 'Bad Desc', description: 42 },
        { name: 'Bad Dsl', dsl: {} },
        { name: 'Fine', weight: 0, quantity: 1, equipped: false, description: 'ok', dsl: 'quality "X" {}' },
    ];
    const r = validateCharacter(doc);
    assert.equal(one(r.errors, 'gear[0]').message, 'Must be an object');
    assert.equal(one(r.errors, 'gear[1].name').message, 'Required non-empty string');
    assert.match(one(r.errors, 'gear[2].weight').message, /Non-negative number \(kg\) required/);
    assert.equal(one(r.errors, 'gear[3].quantity').message, 'Integer ≥ 1 required');
    assert.equal(one(r.errors, 'gear[4].quantity').message, 'Integer ≥ 1 required');
    assert.equal(one(r.errors, 'gear[5].equipped').message, 'Boolean required');
    assert.equal(one(r.errors, 'gear[6].description').message, 'String required');
    assert.match(one(r.errors, 'gear[7].dsl').message, /String \(DSL source\) required/);
    assert.equal(r.errors.filter((e) => e.path.startsWith('gear[8]')).length, 0);
});

test('schema: fatigue / psy / psychicPowers guards', () => {
    const doc = emptyCharacter('P');
    doc.fatigue = 3;
    assert.match(one(validateCharacter(doc).errors, 'fatigue').message, /Must be \{ current \}/);
    doc.fatigue = { current: -1 };
    assert.equal(one(validateCharacter(doc).errors, 'fatigue.current').message, 'Non-negative integer required');
    doc.fatigue = { current: 0 };

    doc.psy = 'psyker';
    assert.match(one(validateCharacter(doc).errors, 'psy').message, /Must be \{ rating, class, sustained \}/);
    doc.psy = { rating: -1, class: 'warp-touched', sustained: 1.5 };
    let r = validateCharacter(doc);
    assert.equal(one(r.errors, 'psy.rating').message, 'Non-negative integer required');
    assert.match(one(r.errors, 'psy.class').message, /One of: none, bound, unbound, daemonic/);
    assert.equal(one(r.errors, 'psy.sustained').message, 'Non-negative integer required');
    doc.psy = { rating: 0, class: 'none', sustained: 0 };

    doc.psychicPowers = 'Smite';
    assert.equal(one(validateCharacter(doc).errors, 'psychicPowers').message, 'Must be an array');
    doc.psychicPowers = [
        'Smite',
        42,
        { name: 'Bad Equipped', equipped: 'yes' },
        { name: 'Bad Cost', cost: -1 },
        { name: 'Bad Discipline', discipline: 7 },
        { name: 'Bad Notes', notes: [] },
        { name: 'Bad Ref', ref: 42 },
        { name: 'Odd Ref', ref: 'NotASlug' },
        { name: 'Bad Dsl', dsl: 7 },
        { name: 'Fine', equipped: true, cost: 300, discipline: 'Telepathy', notes: 'n', ref: 'dh2:psychic_power:smite', dsl: 'x' },
    ];
    r = validateCharacter(doc);
    assert.match(one(r.errors, 'psychicPowers[1]').message, /Must be a string or \{ name, … \}/);
    assert.equal(one(r.errors, 'psychicPowers[2].equipped').message, 'Boolean required');
    assert.equal(one(r.errors, 'psychicPowers[3].cost').message, 'Non-negative integer required');
    assert.equal(one(r.errors, 'psychicPowers[4].discipline').message, 'String required');
    assert.equal(one(r.errors, 'psychicPowers[5].notes').message, 'String required');
    assert.match(one(r.errors, 'psychicPowers[6].ref').message, /String ref required \(dh2:<type>:<snake_id>\)/);
    assert.match(one(r.warnings, 'psychicPowers[7].ref').message, /Ref "NotASlug" does not match <system>:<type>:<snake_id>/);
    assert.match(one(r.errors, 'psychicPowers[8].dsl').message, /String \(DSL source\) required/);
    assert.equal(r.errors.filter((e) => e.path.startsWith('psychicPowers[9]')).length, 0);
});

test('schema: insanity / corruption blocks and their entry lists', () => {
    const doc = emptyCharacter('I');
    doc.insanity = 'mad';
    assert.equal(one(validateCharacter(doc).errors, 'insanity').message, 'Must be an object');
    doc.insanity = { points: 101, disorders: 'phobia' };
    let r = validateCharacter(doc);
    assert.equal(one(r.errors, 'insanity.points').message, 'Integer 0–100 required');
    assert.equal(one(r.errors, 'insanity.disorders').message, 'Must be an array');

    doc.insanity = { points: 0, disorders: ['Phobia', 7] };
    doc.corruption = { points: -1, malignancies: [null], mutations: {} };
    r = validateCharacter(doc);
    assert.match(one(r.errors, 'insanity.disorders[1]').message, /Must be a string or \{ name, … \}/);
    assert.equal(one(r.errors, 'corruption.points').message, 'Integer 0–100 required');
    assert.equal(at(r.errors, 'corruption.malignancies[0]').length, 1);
    assert.equal(one(r.errors, 'corruption.mutations').message, 'Must be an array');

    // boundaries are inclusive and an absent block is skipped entirely
    doc.insanity = { points: 100 };
    doc.corruption = { points: 0 };
    assert.equal(validateCharacter(doc).ok, true);
    delete doc.insanity;
    delete doc.corruption;
    assert.equal(validateCharacter(doc).ok, true);
});

test('schema: critical wounds, criticalInjuries and amputations', () => {
    const doc = emptyCharacter('W');
    doc.wounds = { max: 10, current: 10, critical: -1 };
    assert.equal(one(validateCharacter(doc).errors, 'wounds.critical').message, 'Non-negative integer required');
    doc.wounds = { max: 10, current: 10, critical: 0 };

    doc.criticalInjuries = 'lost an eye';
    assert.equal(one(validateCharacter(doc).errors, 'criticalInjuries').message, 'Must be an array');
    doc.criticalInjuries = ['Scarred', { effect: 'Blinded', location: 'head' }, { location: 'head' }, { effect: 'Limp', location: 'tail' }];
    let r = validateCharacter(doc);
    assert.match(one(r.errors, 'criticalInjuries[2]').message, /Must be a string or \{ location\?, effect, source\? \}/);
    assert.match(one(r.warnings, 'criticalInjuries[3].location').message, /Unknown location "tail"/);
    assert.equal(at(r.warnings, 'criticalInjuries[1].location').length, 0);

    doc.criticalInjuries = [];
    doc.amputations = 'leftArm';
    assert.equal(one(validateCharacter(doc).errors, 'amputations').message, 'Must be an array');
    doc.amputations = ['leftArm', 'tail'];
    r = validateCharacter(doc);
    assert.match(one(r.warnings, 'amputations[1]').message, /Unknown part "tail"/);
    assert.equal(r.ok, true, 'an unknown amputation is only a warning');
});

test('schema: size / movementModifier bounds and item description+dsl types', () => {
    const doc = emptyCharacter('S');
    doc.size = 0;
    assert.match(one(validateCharacter(doc).errors, 'size').message, /Integer 1–10 required \(4 = Average\)/);
    doc.size = 11;
    assert.equal(at(validateCharacter(doc).errors, 'size').length, 1);
    doc.size = 4.5;
    assert.equal(at(validateCharacter(doc).errors, 'size').length, 1);
    doc.size = 1;
    assert.equal(at(validateCharacter(doc).errors, 'size').length, 0, '1 is the inclusive floor');
    doc.size = 10;
    assert.equal(at(validateCharacter(doc).errors, 'size').length, 0, '10 is the inclusive ceiling');

    doc.movementModifier = -11;
    assert.match(one(validateCharacter(doc).errors, 'movementModifier').message, /Integer −10–10 required/);
    doc.movementModifier = 11;
    assert.equal(at(validateCharacter(doc).errors, 'movementModifier').length, 1);
    doc.movementModifier = 10;
    assert.equal(at(validateCharacter(doc).errors, 'movementModifier').length, 0);

    doc.weapons = [{ name: 'Sword', damage: '1d10', description: 7, dsl: 9 }];
    const r = validateCharacter(doc);
    assert.equal(one(r.errors, 'weapons[0].description').message, 'String required');
    assert.match(one(r.errors, 'weapons[0].dsl').message, /String \(DSL source\) required/);
});

test('schema: unnatural and flat armour blocks — unknown keys warn, bad values error', () => {
    const doc = emptyCharacter('U');
    doc.unnatural = 'strong';
    assert.equal(one(validateCharacter(doc).errors, 'unnatural').message, 'Must be an object');
    doc.unnatural = { ws: 2, int: 3, t: -1, ag: 1.5 };
    let r = validateCharacter(doc);
    assert.match(one(r.warnings, 'unnatural.int').message, /Unknown\/unsupported unnatural characteristic \(ignored\)/);
    assert.equal(one(r.errors, 'unnatural.t').message, 'Non-negative integer required');
    assert.equal(one(r.errors, 'unnatural.ag').message, 'Non-negative integer required');
    assert.equal(at(r.errors, 'unnatural.ws').length, 0);

    doc.unnatural = {};
    doc.armour = 'flak';
    assert.equal(one(validateCharacter(doc).errors, 'armour').message, 'Must be an object');
    doc.armour = { head: 3, tail: 1, body: -2 };
    r = validateCharacter(doc);
    assert.match(one(r.warnings, 'armour.tail').message, /Unknown hit location \(ignored\)/);
    assert.equal(one(r.errors, 'armour.body').message, 'Non-negative integer required');
});

test('schema: wounds / fate tracks must be objects with integer max & current', () => {
    const doc = emptyCharacter('T');
    doc.wounds = 10;
    doc.fate = 'two';
    let r = validateCharacter(doc);
    assert.match(one(r.errors, 'wounds').message, /Must be \{ max, current \}/);
    assert.match(one(r.errors, 'fate').message, /Must be \{ max, current \}/);

    doc.wounds = { max: 10.5, current: '10' };
    doc.fate = { max: 2 };
    r = validateCharacter(doc);
    assert.equal(one(r.errors, 'wounds.max').message, 'Integer required');
    assert.equal(one(r.errors, 'wounds.current').message, 'Integer required');
    assert.equal(at(r.errors, 'fate.current').length, 0, 'an absent member is skipped');
    // negative integers are legal on a wound track (damage overflow)
    doc.wounds = { max: 10, current: -3 };
    assert.equal(at(validateCharacter(doc).errors, 'wounds.current').length, 0);
});

test('schema: talents / traits / conditions / circumstances lists, with ref+dsl checks', () => {
    const doc = emptyCharacter('L');
    for (const listName of ['talents', 'traits', 'conditions', 'circumstances']) {
        const bad = emptyCharacter('L');
        bad[listName] = 'Hatred';
        assert.equal(one(validateCharacter(bad).errors, listName).message, 'Must be an array');
    }
    doc.talents = ['Hatred (Mutants)', 42, { name: 'Jaded', ref: 'dh2:talent:jaded' }, { name: 'Odd', ref: 'nope' }, { name: 'BadRef', ref: 7 }, { name: 'BadDsl', dsl: 7 }];
    doc.traits = [{ name: 'Daemonic', level: 4, ref: 'dh2:trait:daemonic' }, null];
    doc.conditions = [{ name: 'Stunned', duration: 2 }, { level: 1 }];
    doc.circumstances = ['Darkness', { name: 'Haywire Field', severity: 3 }];
    const r = validateCharacter(doc);
    assert.match(one(r.errors, 'talents[1]').message, /Must be a string or \{ name, … \} object/);
    assert.match(one(r.warnings, 'talents[3].ref').message, /Ref "nope" does not match/);
    assert.match(one(r.errors, 'talents[4].ref').message, /String ref required/);
    assert.match(one(r.errors, 'talents[5].dsl').message, /String \(DSL source\) required/);
    assert.equal(at(r.errors, 'traits[1]').length, 1, 'null is not a named entry');
    assert.equal(at(r.errors, 'conditions[1]').length, 1, 'an object without a name is not a named entry');
    assert.equal(r.errors.filter((e) => e.path.startsWith('circumstances')).length, 0);
});

test('schema: weapons — container, entry shape and every field guard', () => {
    const doc = emptyCharacter('Wp');
    doc.weapons = {};
    assert.equal(one(validateCharacter(doc).errors, 'weapons').message, 'Must be an array');

    doc.weapons = [
        'Chainsword',
        { name: ' ', damage: '1d10' },
        { name: 'No Damage' },
        { name: 'Bad Damage', damage: 'd10' },
        { name: 'Bad Class', damage: '1d10', class: 'siege' },
        { name: 'Bad Pen', damage: '1d10', pen: -1 },
        { name: 'Bad Type', damage: '1d10', damageType: 'Sonic' },
        { name: 'Bad Craft', damage: '1d10', craftsmanship: 'Legendary' },
        { name: 'Bad Qualities', damage: '1d10', qualities: 'Tearing' },
        { name: 'Odd Quality', damage: '1d10', qualities: ['Tearing', 42] },
        { name: 'Bad Rof', damage: '1d10', rof: null },
        { name: 'Bad Sb', damage: '1d10', sbMultiplier: 3 },
        { name: 'Bad Weight', damage: '1d10', weight: Infinity },
        { name: 'Bad Equipped', damage: '1d10', equipped: 'yes' },
        { name: 'Bad Clip', damage: '1d10', clip: 'full' },
        { name: 'Odd Clip', damage: '1d10', clip: { max: -1, value: 1.5 } },
        { name: 'Fine', damage: ' 2 d 10 + 3 ', class: 'melee', pen: 0, damageType: 'Rending', craftsmanship: 'Best', qualities: ['Tearing', { name: 'Proven', level: 3 }], rof: { single: true, burst: 0, full: 0 }, sbMultiplier: 2, weight: 0, equipped: true, clip: { max: 0, value: 0 } },
    ];
    const r = validateCharacter(doc);
    assert.equal(one(r.errors, 'weapons[0]').message, 'Must be an object');
    assert.equal(one(r.errors, 'weapons[1].name').message, 'Required non-empty string');
    assert.match(one(r.errors, 'weapons[2].damage').message, /Damage formula "XdY\[\+Z\]" required/);
    assert.equal(at(r.errors, 'weapons[3].damage').length, 1, '"d10" has no dice count');
    assert.match(one(r.errors, 'weapons[4].class').message, /One of: melee, pistol, basic, heavy, thrown/);
    assert.equal(one(r.errors, 'weapons[5].pen').message, 'Non-negative integer required');
    assert.match(one(r.errors, 'weapons[6].damageType').message, /One of: Impact, Energy, Explosive, Rending/);
    assert.match(one(r.errors, 'weapons[7].craftsmanship').message, /One of: Poor, Common, Good, Best/);
    assert.equal(one(r.errors, 'weapons[8].qualities').message, 'Must be an array');
    assert.match(one(r.errors, 'weapons[9].qualities[1]').message, /Must be a string or \{ name, level \}/);
    assert.match(one(r.errors, 'weapons[10].rof').message, /Must be \{ single, burst, full \}/);
    assert.equal(one(r.errors, 'weapons[11].sbMultiplier').message, 'Integer 0–2 required');
    assert.match(one(r.errors, 'weapons[12].weight').message, /Non-negative number \(kg\) required/);
    assert.equal(one(r.errors, 'weapons[13].equipped').message, 'Boolean required');
    assert.match(one(r.errors, 'weapons[14].clip').message, /Must be \{ max, value \}/);
    assert.equal(one(r.errors, 'weapons[15].clip.max').message, 'Non-negative integer required');
    assert.equal(one(r.errors, 'weapons[15].clip.value').message, 'Non-negative integer required');
    assert.equal(r.errors.filter((e) => e.path.startsWith('weapons[16]')).length, 0, 'the whitespace-tolerant formula is legal');
});

test('schema: field, origin, influence, weaponTrainings, cybernetics, extensions, player, pools', () => {
    const doc = emptyCharacter('V');
    doc.field = 'refractor';
    assert.match(one(validateCharacter(doc).errors, 'field').message, /Must be \{ rating, overloadMax \}/);
    doc.field = { rating: -1, overloadMax: 1.5 };
    let r = validateCharacter(doc);
    assert.equal(one(r.errors, 'field.rating').message, 'Non-negative integer required');
    assert.equal(one(r.errors, 'field.overloadMax').message, 'Non-negative integer required');
    doc.field = { rating: 0, overloadMax: 0 };

    doc.origin = [];
    assert.match(one(validateCharacter(doc).errors, 'origin').message, /Must be \{ homeworld\?, background\?, role\?, eliteAdvances\[\] \}/);
    doc.origin = 'hive world';
    assert.equal(at(validateCharacter(doc).errors, 'origin').length, 1);
    doc.origin = {
        homeworld: 42,
        background: { name: 'Adeptus Ministorum', ref: 'not-a-slug' },
        role: null,
        eliteAdvances: [{ name: 'Psyker', cost: -1 }, 7, { name: 'Untouchable', ref: 42 }],
    };
    r = validateCharacter(doc);
    assert.match(one(r.errors, 'origin.homeworld').message, /Must be null, a string, or \{ name, ref\? \}/);
    assert.match(one(r.warnings, 'origin.background.ref').message, /does not match/);
    assert.equal(at(r.errors, 'origin.role').length, 0, 'null members are skipped');
    assert.equal(one(r.errors, 'origin.eliteAdvances[0].cost').message, 'Non-negative integer required');
    assert.match(one(r.errors, 'origin.eliteAdvances[1]').message, /Must be a string or \{ name, ref\?, cost\? \}/);
    assert.match(one(r.errors, 'origin.eliteAdvances[2].ref').message, /String ref required/);
    doc.origin.eliteAdvances = 'Psyker';
    assert.equal(one(validateCharacter(doc).errors, 'origin.eliteAdvances').message, 'Must be an array');

    doc.origin = { homeworld: null, background: null, role: null, eliteAdvances: [] };
    doc.influence = -1;
    assert.equal(one(validateCharacter(doc).errors, 'influence').message, 'Non-negative integer required');
    doc.influence = 0;

    doc.weaponTrainings = 'Las';
    assert.equal(one(validateCharacter(doc).errors, 'weaponTrainings').message, 'Must be an array of strings');
    doc.weaponTrainings = ['Las', '  ', 42];
    r = validateCharacter(doc);
    assert.equal(one(r.errors, 'weaponTrainings[1]').message, 'Non-empty string required');
    assert.equal(one(r.errors, 'weaponTrainings[2]').message, 'Non-empty string required');
    doc.weaponTrainings = [];

    doc.cybernetics = 'Bionic Eye';
    assert.equal(one(validateCharacter(doc).errors, 'cybernetics').message, 'Must be an array');
    doc.cybernetics = [42, { name: 'Bionic Arm', location: 7, notes: [] }, { name: 'Bionic Eye', ref: 'bad' }, { name: 'Ok', ref: 'dh2:cybernetic:bionic_eye', dsl: 'x' }];
    r = validateCharacter(doc);
    assert.match(one(r.errors, 'cybernetics[0]').message, /Must be a string or \{ name, location\?, notes\?, ref\?, dsl\? \}/);
    assert.equal(one(r.errors, 'cybernetics[1].location').message, 'String required');
    assert.equal(one(r.errors, 'cybernetics[1].notes').message, 'String required');
    assert.match(one(r.warnings, 'cybernetics[2].ref').message, /does not match/);
    doc.cybernetics = [];

    doc.extensions = [];
    assert.match(one(validateCharacter(doc).errors, 'extensions').message, /Must be an object of \{ <namespace>: any \}/);
    doc.extensions = null;
    assert.equal(at(validateCharacter(doc).errors, 'extensions').length, 1);
    doc.extensions = {};

    doc.player = 42;
    assert.equal(one(validateCharacter(doc).errors, 'player').message, 'String required');
    doc.player = 'Kirk';
    assert.match(one(validateCharacter(doc).warnings, 'player').message, /Player attribution present/);
    assert.equal(at(validateCharacter(doc, { allowPlayer: true }).warnings, 'player').length, 0);
    delete doc.player;

    doc.pools = [];
    assert.match(one(validateCharacter(doc).errors, 'pools').message, /Must be an object \(reserved\)/);
    doc.pools = null;
    assert.equal(at(validateCharacter(doc).errors, 'pools').length, 1);
    doc.pools = { profitFactor: 30 };
    assert.equal(at(validateCharacter(doc).errors, 'pools').length, 0);
});

test('schema: migrateCharacter leaves junk characteristics alone and passes newer documents through', () => {
    // v1 flat ints become objects; anything non-numeric is left for the validator
    const v1 = migrateCharacter({ schemaVersion: 1, kind: 'dh2.character', name: 'Old', characteristics: { ws: 35, bs: 'x', s: null } });
    assert.deepEqual(v1.characteristics.ws, { base: 35, advances: 0, modifiers: [] });
    assert.equal(v1.characteristics.bs, 'x', 'a non-numeric value is preserved verbatim');
    assert.equal(v1.characteristics.s, null);
    assert.equal(v1.schemaVersion, CHARACTER_SCHEMA_VERSION);

    // no schemaVersion / no kind at all → the case-0 seed
    const seeded = migrateCharacter({ name: 'Seed' });
    assert.equal(seeded.kind, 'dh2.character');
    assert.equal(seeded.schemaVersion, CHARACTER_SCHEMA_VERSION);
    assert.deepEqual(seeded.origin, { homeworld: null, background: null, role: null, eliteAdvances: [] });
    assert.equal(seeded.characteristics, undefined, 'migration never invents characteristics');

    // a document with characteristics that is not an object is left alone
    const odd = migrateCharacter({ schemaVersion: 1, characteristics: 'none' });
    assert.equal(odd.characteristics, 'none');
    // an ARRAY origin is discarded in favour of the canonical empty shape
    const arrOrigin = migrateCharacter({ schemaVersion: 3, origin: ['hive'] });
    assert.deepEqual(arrOrigin.origin, { homeworld: null, background: null, role: null, eliteAdvances: [] });

    // eliteAdvances: bare strings become { name }, objects pass through unchanged
    const elite = migrateCharacter({
        schemaVersion: 3,
        origin: { homeworld: 'Hive World', eliteAdvances: ['Psyker', { name: 'Untouchable', cost: 500 }] },
    });
    assert.deepEqual(elite.origin.homeworld, { name: 'Hive World' });
    assert.deepEqual(elite.origin.eliteAdvances, [{ name: 'Psyker' }, { name: 'Untouchable', cost: 500 }]);
    // a non-array eliteAdvances is replaced by an empty list
    assert.deepEqual(migrateCharacter({ schemaVersion: 3, origin: { eliteAdvances: 'Psyker' } }).origin.eliteAdvances, []);

    // NEWER than us: the default arm — untouched, and validate warns
    const future = migrateCharacter({ schemaVersion: 99, kind: 'dh2.character', name: 'Future' });
    assert.equal(future.schemaVersion, 99, 'a newer document is not downgraded');
    assert.equal(future.origin, undefined, 'no v4 defaults are injected into a newer document');
    assert.equal(migrateCharacter({ schemaVersion: 4, name: 'Cur' }).schemaVersion, 4);
});

test('schema: characterToCombatant defaults on a document with no weapons and no optional blocks', () => {
    const c = characterToCombatant({ name: 'Bare', characteristics: { ws: 35, bs: 40, s: 32, t: 41, ag: 30, wp: 30 } });
    assert.equal(c.weapon, undefined, 'no weapon at the requested index → undefined');
    assert.deepEqual(c.unnatural, {});
    assert.deepEqual(c.talents, []);
    assert.deepEqual(c.traits, []);
    assert.deepEqual(c.conditions, []);
    assert.deepEqual(c.circumstances, []);
    assert.equal(c.psyRating, 0);
    assert.equal(c.armour, 0);
    assert.equal(c.toughnessBonus, 4);
    assert.equal(c.unnaturalToughness, 0);
    assert.deepEqual(c.field, { rating: 0, overloadMax: 0 });

    // a weapon carrying only name+damage takes every per-field default
    const min = characterToCombatant({ name: 'Min', characteristics: {}, weapons: [{ name: 'Club', damage: '1d10' }] });
    assert.equal(min.weapon.isMelee, false);
    assert.equal(min.weapon.thrown, undefined);
    assert.equal(min.weapon.pen, 0);
    assert.equal(min.weapon.damageType, 'Impact');
    assert.deepEqual(min.weapon.rof, { single: true, burst: 0, full: 0 });
    assert.deepEqual(min.weapon.qualities, []);
    assert.equal(min.weapon.craftsmanship, 'Common');
    assert.equal(min.weapon.sbMultiplier, 0, 'a class-less weapon adds no Strength Bonus');

    // melee/thrown default the SB multiplier to 1; an explicit value wins
    const melee = characterToCombatant({ name: 'M', characteristics: {}, weapons: [{ name: 'Sword', damage: '1d10', class: 'melee' }] });
    assert.equal(melee.weapon.isMelee, true);
    assert.equal(melee.weapon.sbMultiplier, 1);
    const thrown = characterToCombatant({ name: 'T', characteristics: {}, weapons: [{ name: 'Knife', damage: '1d5', class: 'thrown', sbMultiplier: 0 }] });
    assert.equal(thrown.weapon.thrown, true);
    assert.equal(thrown.weapon.sbMultiplier, 0, 'an explicit 0 is honoured, not overwritten by the melee default');

    // rof.single === false is the only falsey spelling that disables single shots
    const noSingle = characterToCombatant({ name: 'N', characteristics: {}, weapons: [{ name: 'Cannon', damage: '3d10', rof: { single: false, burst: '3', full: 'x' } }] });
    assert.deepEqual(noSingle.weapon.rof, { single: false, burst: 3, full: 0 });

    // an out-of-range weaponIndex behaves like "no weapon"
    assert.equal(characterToCombatant({ name: 'B', weapons: [] }, { weaponIndex: 4 }).weapon, undefined);
    // an unknown armour location resolves to 0 rather than undefined
    assert.equal(characterToCombatant({ name: 'B', armour: { body: 5 } }, { location: 'wing' }).armour, 0);
});

// ======================================================= adapters: roll20 ====

test('roll20: accepts a JSON string, `attributes`, and a character with no attributes at all', () => {
    const fromString = fromRoll20(JSON.stringify({ name: 'Stringly', attribs: [{ name: 'WeaponSkill', current: 40 }] }));
    assert.equal(fromString.character.name, 'Stringly');
    assert.equal(fromString.character.characteristics.ws, 40);

    const altKey = fromRoll20({ name: 'AltKey', attributes: [{ name: 'Toughness', current: 35 }] });
    assert.equal(altKey.character.characteristics.t, 35, '`attributes` is accepted alongside `attribs`');

    const empty = fromRoll20({});
    assert.equal(empty.character.name, 'Roll20 import', 'a nameless character gets the placeholder name');
    assert.equal(empty.character.source.roll20CharacterId, null);
    assert.equal(empty.character.source.roll20Name, null);
    assert.equal(empty.character.schemaVersion, CHARACTER_SCHEMA_VERSION);
    assert.deepEqual(empty.character.weapons, []);
    assert.deepEqual(empty.unmapped, ['xp/aptitudes absent from Roll20 sheet (merge lane fills from xlsx)']);
});

test('roll20: an attribute with no name does not crash the mapper', () => {
    const r = fromRoll20({ name: 'Nameless', attribs: [{ current: 7 }, { name: 'TotallyUnknownAttr', current: 1 }] });
    assert.ok(r.unmapped.includes('TotallyUnknownAttr'), 'a genuinely unknown attribute IS reported');
    assert.equal(r.character.name, 'Nameless', 'the rest of the mapping still runs');
    // CHARACTERISED, NOT ENDORSED: a nameless attribute currently lands in
    // `unmapped` as a literal `undefined` (tools/adapters/roll20.mjs:392 pushes
    // `a.name` unguarded). See the coverage report — this is a defect, not a
    // contract; the assertion pins today's behaviour so a fix is a visible diff.
    assert.ok(r.unmapped.includes(undefined), 'today: the nameless attribute is reported as `undefined`');
});

test('roll20: legacy wounds/fate attributes carry max on the attribute, not a separate Max* key', () => {
    const r = fromRoll20({
        name: 'Legacy',
        attribs: [
            { name: 'wounds', current: 7, max: 12 },
            { name: 'fate', current: 1, max: 3 },
        ],
    });
    assert.equal(r.character.wounds.max, 12);
    assert.equal(r.character.wounds.current, 7);
    assert.deepEqual(r.character.fate, { max: 3, current: 1 });

    // …and with no max at all, current doubles as the max
    const noMax = fromRoll20({ name: 'NoMax', attribs: [{ name: 'wounds', current: 9 }, { name: 'fatepoints', current: 2 }] });
    assert.equal(noMax.character.wounds.max, 9);
    assert.equal(noMax.character.wounds.current, 9);
    assert.deepEqual(noMax.character.fate, { max: 2, current: 2 });
});

test('roll20: a named lore slot with no rank is assumed known at advances 1, with a note', () => {
    const r = fromRoll20({
        name: 'Scholar',
        attribs: [
            { name: 'ForbiddenLore1', current: 'Xenos' },      // no ForbiddenLoreRanks1
            { name: 'CommonLore1', current: 'Imperium' },
            { name: 'CommonLoreRanks1', current: 3 },
        ],
    });
    assert.deepEqual(r.character.skills['Forbidden Lore'].specialities.Xenos, { advances: 1, modifiers: [] });
    assert.deepEqual(r.character.skills['Common Lore'].specialities.Imperium, { advances: 3, modifiers: [] });
    assert.ok(r.unmapped.includes('Forbidden Lore (Xenos): slot has no rank — assumed known (advances 1)'));
    assert.ok(!r.unmapped.some((u) => u.startsWith('Common Lore (Imperium): slot has no rank')));
});

test('roll20: legacy weapon rows — name/weaponname/weapon keys, melee marker, unknown damage type', () => {
    const attribs = [
        { name: 'repeating_weapons_row1_weaponname', current: 'Legacy Blade' },
        { name: 'repeating_weapons_row1_class', current: 'Melee weapon' },
        { name: 'repeating_weapons_row1_damage', current: '1d10+2' },
        { name: 'repeating_weapons_row1_pen', current: '2' },

        { name: 'repeating_weapons_row2_weapon', current: 'Odd Gun' },
        { name: 'repeating_weapons_row2_damage', current: '2d10' },
        { name: 'repeating_weapons_row2_damagetype', current: 'sonic' },   // unknown initial
        { name: 'repeating_weapons_row2_rofburst', current: '3' },
        { name: 'repeating_weapons_row2_special', current: 'Reliable, Tearing' },

        { name: 'repeating_weapons_row3_name', current: 'Type-marked Club' },
        { name: 'repeating_weapons_row3_type', current: 'melee' },
        { name: 'repeating_weapons_row3_damage', current: '1d5' },

        { name: 'repeating_weapons_row4_name', current: '   ' },           // blank → skipped

        { name: 'repeating_weapons_row5_name', current: 'Bare Legacy Row' },   // no type at all
        { name: 'repeating_weapons_row5_damage', current: '1d10' },

        // a SHEET-vocabulary row (wpnnames) with no damage-type attribute
        { name: 'repeating_weapons_row6_wpnnames', current: 'Typeless Sheet Gun' },
        { name: 'repeating_weapons_row6_wpndmgnumdices', current: '1' },
        { name: 'repeating_weapons_row6_wpndmgdices', current: '10' },
        { name: 'repeating_weapons_row6_wpnranges', current: '30' },
    ];
    const { character, unmapped } = fromRoll20({ name: 'Legacy Armoury', attribs });
    assert.equal(character.weapons.length, 5, 'the blank row is dropped');
    const [blade, gun, club, bare, sheet] = character.weapons;
    assert.equal(bare.name, 'Bare Legacy Row');
    assert.equal(bare.damageType, 'Impact', 'a legacy row with no type at all defaults to Impact');
    assert.equal(bare.class, undefined);
    assert.equal(sheet.name, 'Typeless Sheet Gun');
    assert.equal(sheet.damage, '1d10+0', 'sheet rows compose the formula from components');
    assert.equal(sheet.damageType, 'Impact', 'a sheet row with no wpndmgtypes falls back to Impact');
    assert.equal(sheet.class, undefined, 'a ranged sheet row with no category is left unclassed');
    assert.ok(unmapped.includes('weapon "Typeless Sheet Gun": class not inferred (category "—" unrecognised)'));
    assert.equal(blade.name, 'Legacy Blade');
    assert.equal(blade.class, 'melee', 'the /melee/ marker in `class` still infers melee');
    assert.equal(blade.damage, '1d10+2');
    assert.equal(blade.pen, 2);
    assert.equal(gun.name, 'Odd Gun');
    assert.equal(gun.damageType, 'Impact', 'an unrecognised damage-type initial falls back to Impact');
    assert.equal(gun.rof.burst, 3);
    assert.deepEqual(gun.qualities, ['Reliable', 'Tearing']);
    assert.equal(gun.class, undefined, 'a legacy row with no melee marker gets no class');
    assert.equal(club.name, 'Type-marked Club');
    assert.equal(club.class, 'melee', 'the marker is read from `type` when `class` is absent');
});

test('roll20: the flat talentstring is the fallback only when there are no repeating talent rows', () => {
    const flat = fromRoll20({
        name: 'Old Sheet',
        attribs: [{ name: 'talentstring', current: 'Jaded. Hatred (Mutants). Sound Constitution ' }],
    });
    assert.deepEqual(flat.character.talents, ['Jaded', 'Hatred (Mutants)', 'Sound Constitution']);
    assert.ok(flat.unmapped.includes('talents parsed from flat talentstring (no repeating talents rows)'));
    assert.ok(!flat.unmapped.includes('talentstring'), 'the consumed twin is not reported unmapped');

    // with rows present the twin is consumed and ignored
    const rows = fromRoll20({
        name: 'New Sheet',
        attribs: [
            { name: 'repeating_talents_row1_talentnames', current: 'Mighty Shot' },
            { name: 'talentstring', current: 'Should.Be.Ignored' },
        ],
    });
    assert.deepEqual(rows.character.talents, ['Mighty Shot'], 'repeating rows win over the flat twin');
    assert.ok(!rows.unmapped.includes('talentstring'));
    assert.ok(!rows.unmapped.some((u) => String(u).includes('flat talentstring')));

    // an EMPTY talentstring with no rows leaves the list empty and adds no note
    const none = fromRoll20({ name: 'Blank', attribs: [{ name: 'talentstring', current: '' }] });
    assert.deepEqual(none.character.talents, []);
    assert.ok(!none.unmapped.some((u) => String(u).includes('flat talentstring')));
});

test('roll20: a blank traits row is skipped', () => {
    const { character } = fromRoll20({
        name: 'Mutant',
        attribs: [
            { name: 'repeating_traits_row1_name', current: 'Unnatural Strength' },
            { name: 'repeating_traits_row2_name', current: '  ' },
            { name: 'repeating_traits_row3_name', current: '' },
        ],
    });
    assert.deepEqual(character.traits, ['Unnatural Strength']);
});

test('roll20: fromRoll20Dump accepts a JSON string, rejects a non-envelope, and threads generated_at', () => {
    const envelope = { generated_at: '2026-07-23T00:00:00Z', characters: [{ name: 'A', attribs: [] }, { name: 'B', attribs: [] }] };
    const out = fromRoll20Dump(JSON.stringify(envelope));
    assert.equal(out.length, 2);
    assert.equal(out[0].character.source.exportedAt, '2026-07-23T00:00:00Z', 'generated_at seeds exportedAt');
    assert.equal(out[1].character.name, 'B');

    const overridden = fromRoll20Dump(envelope, { exportedAt: '1999-01-01' });
    assert.equal(overridden[0].character.source.exportedAt, '1999-01-01', 'an explicit exportedAt wins');

    const noStamp = fromRoll20Dump({ characters: [{ name: 'C', attribs: [] }] });
    assert.equal(noStamp[0].character.source.exportedAt, null);

    for (const bad of [{}, { characters: 'nope' }, null, '{"characters":{}}']) {
        assert.throws(() => fromRoll20Dump(bad),
            /Not a roll20\.character_dump\.v1 envelope \(no characters\[\]\)/, `expected a throw for ${JSON.stringify(bad)}`);
    }
});

// ================================================ adapters: google sheets ====

test('google-sheets: unknown keys are collected, not fatal', () => {
    const csv = [
        'key,value',
        '# a comment line,ignored',
        'name,Coverage Probe',
        'ws,42',
        'favourite colour,puce',
        'Warp Signature ,strong',
        '',
    ].join('\n');
    const { character, unknownKeys } = fromGoogleSheetCsv(csv);
    assert.equal(character.name, 'Coverage Probe');
    assert.equal(character.characteristics.ws, 42);
    assert.deepEqual(unknownKeys, ['favourite colour', 'Warp Signature'], 'unknown keys are trimmed and reported');
    assert.equal(validateCharacter(migrateCharacter(character)).ok, true, 'unknown keys do not break the document');
});

test('google-sheets: quoted values with embedded commas and escaped double-quotes', () => {
    const csv = [
        'name,"Vex, the ""Quiet"" One"',
        'talents,"Hatred (Mutants), Jaded"',
        'weapon1 name,"Autogun ""Old Faithful"""',
        'weapon1 damage,1d10+3',
        'weapon1 qualities,"Reliable, Tearing"',
    ].join('\n');
    const { character, unknownKeys } = fromGoogleSheetCsv(csv);
    assert.equal(character.name, 'Vex, the "Quiet" One', 'a doubled quote unescapes to one quote');
    assert.deepEqual(character.talents, ['Hatred (Mutants)', 'Jaded']);
    assert.equal(character.weapons.length, 1);
    assert.equal(character.weapons[0].name, 'Autogun "Old Faithful"');
    assert.deepEqual(character.weapons[0].qualities, ['Reliable', 'Tearing']);
    assert.deepEqual(unknownKeys, []);
});

test('google-sheets: a weapon row with no name is dropped and numbered weapons keep sheet order', () => {
    const csv = [
        'weapon2 name,Second',
        'weapon2 damage,1d10',
        'weapon1 name,First',
        'weapon1 damage,2d10',
        'weapon3 damage,1d5',      // no name → dropped
        'weapon3 pen,4',
    ].join('\n');
    const { character } = fromGoogleSheetCsv(csv);
    assert.deepEqual(character.weapons.map((w) => w.name), ['First', 'Second'], 'sorted by weapon number');
    assert.equal(character.weapons[0].damage, '2d10');
});

// ============================================================ builder-core ===

/** The Builder page's api contract: parsed body on 2xx, throw otherwise. */
async function api(method, path, body) {
    const r = dispatch(method, path, body);
    if (r.status >= 400) throw new Error(r.body?.error ?? `HTTP ${r.status}`);
    return r.body;
}

const builderDoc = () => ({
    schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: 'Coverage Builder',
    characteristics: { ws: 30, bs: 35, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 40, fel: 30 },
    aptitudes: ['General', 'Ballistic Skill', 'Finesse'],
    xp: { total: 1000, ledger: [] },
});

test('builder-core: groupAdvances covers every kind bucket, a tier-less talent and an unknown kind', () => {
    const groups = groupAdvances([
        { kind: 'other', name: 'Odd' },
        { kind: 'elite_advance', name: 'Psyker' },
        { kind: 'psychic_power', name: 'Smite' },
        { kind: 'psy_rating', name: 'PR 2' },
        { kind: 'talent', name: 'Tierless' },                 // no tier → "?"
        { kind: 'talent', name: 'Jaded', tier: 1 },
        { kind: 'skill', name: 'Dodge' },
        { kind: 'characteristic', name: 'WS advance 1' },
        { kind: 'aptitude_swap', name: 'Not a known kind' },  // unknown kind → raw label
    ]);
    assert.deepEqual(groups.map((g) => g.label), [
        'Characteristics', 'Skills', 'Talents — Tier ?', 'Talents — Tier 1',
        'Psy Rating', 'Psychic Powers', 'Elite Advances', 'aptitude_swap', 'Other',
    ], 'canonical group order; within a rank the tie-break is localeCompare');
    assert.deepEqual(groups.find((g) => g.label === 'Talents — Tier ?').entries.map((e) => e.name), ['Tierless']);
    assert.deepEqual(groups.find((g) => g.label === 'aptitude_swap').entries.map((e) => e.name), ['Not a known kind']);
    assert.deepEqual(groupAdvances([]), [], 'an empty advance list groups to nothing');
});

test('builder-core: undoLast on an empty stack is a no-op that does not re-hit the API', async () => {
    let calls = 0;
    const counting = (m, p, b) => { calls++; return api(m, p, b); };
    const s = new BuilderSession({ doc: builderDoc(), api: counting });
    await s.load();
    const afterLoad = calls;
    assert.equal(s.canUndo, false);
    const doc = s.doc;
    await s.undoLast();
    assert.equal(calls, afterLoad, 'no refresh is issued when there is nothing to undo');
    assert.equal(s.doc, doc, 'the document object is untouched');
});

test('builder-core: grantTrait creates the traits list and writes a bare { name } when no ref is given', async () => {
    const doc = builderDoc();
    assert.equal(doc.traits, undefined, 'the fixture starts with no traits key at all');
    const s = new BuilderSession({ doc, api });
    await s.load();
    await s.grantTrait({ name: 'Fear (1)' });
    assert.deepEqual(s.doc.traits, [{ name: 'Fear (1)' }], 'no ref → a bare { name } entry');
    await s.grantTrait({ name: 'Daemonic', ref: 'dh2:trait:daemonic' });
    assert.deepEqual(s.doc.traits[1], { name: 'Daemonic', ref: 'dh2:trait:daemonic' });
    assert.equal(s.doc.xp.ledger.length, 0, 'granted traits never touch the XP ledger');
    assert.equal(s.canUndo, false, 'a grant is not an undoable purchase');
    assert.equal(JSON.parse(s.exportJson()).traits.length, 2, 'the export carries the grants');
});
