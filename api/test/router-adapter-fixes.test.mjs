/**
 * Fixes for four defects reported in docs/DH2_ROLL_API_FINDINGS_2026-07-30.md
 * — node --test, no port bound, no network.
 *
 *   D-5  api-router.mjs withEncounter(): the merge step was guarded with
 *        `enc?.actors` and the stats-snapshot loop below it with only `enc`,
 *        so an encounter document carrying no `actors` map reached
 *        encounterActor() (encounter.mjs) and blew up on an unguarded
 *        `encounter.actors[key]`. Fixed by honouring encounterActor()'s own
 *        documented get-or-create contract (it now creates the map as well as
 *        the entry) and collapsing the router's two guards into one.
 *   D-6  /api/rules/validate handed `body.rules` to compile() untyped, so a
 *        non-string leaked the tokenizer's internal TypeError as the domain
 *        error. The same hole existed on EVERY endpoint that takes
 *        `customRules` / `disabledRules`; both are now type-checked centrally.
 *   D-8  adapters/roll20.mjs pushed a literal `undefined` into the user-facing
 *        `unmapped` gap list for an attribute with no name.
 *   D-13 tools/import-campaign.mjs parseWeaponBlock() ignored its `unmapped`
 *        parameter; a named ARMAMENTS block that failed to parse vanished.
 *
 * The characterization tests that pinned the OLD behaviour for D-5/D-6/D-8
 * live in router-coverage.test.mjs and engine-rules-coverage.test.mjs and were
 * updated in the same change (they now assert the fixed behaviour).
 *
 * Determinism: every dice-rolling call is given `forcedRolls`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../lib/api-router.mjs';
import { emptyEncounter, encounterActor, tickEncounter } from '../lib/encounter.mjs';
import { fromRoll20 } from '../../tools/adapters/roll20.mjs';
import { parseGrids } from '../../tools/import-campaign.mjs';

// --- fixtures ----------------------------------------------------------------

const gunner = () => ({
    name: 'Gunner',
    characteristics: { bs: 70, s: 30, t: 30 },
    weapon: {
        name: 'Autogun', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact',
        rof: { single: true, burst: 2, full: 0 }, qualities: [],
    },
    action: 'Standard Attack', rangeBand: 'Normal Range',
});

const mook = () => ({
    name: 'Mook', characteristics: { ag: 30, t: 30 },
    armour: 0, toughnessBonus: 3, evasion: { mode: 'dodge' },
});

/** An encounter document that never got an `actors` map — the D-5 trigger. */
const actorlessEncounter = () => ({ schemaVersion: 1, kind: 'dh2.encounter', round: 1 });

/** Same shape assertion router-coverage.test.mjs uses: 400 + a lone `error`. */
const assertErrorShape = (res, { status = 400, match } = {}) => {
    assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}`);
    assert.ok(res.body && typeof res.body === 'object', 'error body must be an object');
    assert.equal(typeof res.body.error, 'string', 'error body must carry a string `error`');
    assert.ok(res.body.error.length > 0, '`error` must not be empty');
    if (match) assert.match(res.body.error, match);
};

/** No domain error may echo a JS engine TypeError. */
const assertNoInternalLeak = (message) => {
    assert.doesNotMatch(String(message), /Cannot read properties|is not iterable|is not a function|undefined \(reading/,
        'the message must be a domain error, not an internal TypeError');
};

// =============================================================================
// D-5 — an encounter document with no `actors` map
// =============================================================================

test('D-5: encounterActor() creates the actors map as well as the entry', () => {
    const enc = actorlessEncounter();
    const a = encounterActor(enc, 'attacker', 'Gunner');
    assert.deepEqual(Object.keys(enc.actors), ['attacker']);
    assert.equal(a.name, 'Gunner');
    assert.deepEqual(a.conditions, []);
    assert.deepEqual(a.wounds, { taken: 0 });
    // idempotent: a second get returns the same entry, never a fresh one
    a.wounds.taken = 4;
    assert.equal(encounterActor(enc, 'attacker').wounds.taken, 4);
});

test('D-5: POST /api/resolve accepts an actors-less encounter and returns a normalised one', () => {
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(),
        encounter: actorlessEncounter(),
        forcedRolls: [11, 9],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.attack, 'the engagement resolves');
    assert.ok(res.body.encounter?.actors, 'the harvested document carries an actors map');
    // the stats snapshot that the asymmetric guard used to crash on
    assert.equal(res.body.encounter.actors.attacker.stats.characteristics.bs, 70);
    assert.equal(res.body.encounter.actors.defender.stats.characteristics.ag, 30);
});

test('D-5: POST /api/engage accepts an actors-less encounter', () => {
    const res = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(),
        encounter: actorlessEncounter(), forcedRolls: [11],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.test.roll, 11);
});

test('D-5: tickEncounter tolerates a document with no actors map', () => {
    const { encounter, events } = tickEncounter(actorlessEncounter(), 'ROUND_END');
    assert.deepEqual(events, []);
    assert.deepEqual(encounter.actors, {});
    assert.equal(encounter.round, 2, 'the round still advances');

    const res = dispatch('POST', '/api/encounter/tick', { encounter: actorlessEncounter(), phase: 'ROUND_END' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.encounter.actors, {});
});

test('D-5: a fully-populated encounter is unaffected by the normalisation', () => {
    const enc = emptyEncounter();
    const a = encounterActor(enc, 'd', 'Dee');
    a.armourDamage['Right Arm'] = 4;        // the location a forced to-hit of 11 strikes
    a.conditions.push({ name: 'On Fire', severity: null, duration: 2, location: null });
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(),
        defender: { name: 'Target', characteristics: { ag: 30, t: 30 }, armour: 6, toughnessBonus: 3 },
        encounter: enc, defenderKey: 'd', forcedRolls: [11, 9],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.attack.hits[0].soak.armour, 2, '6 base AP − 4 persistent corrosion still applies');
});

// =============================================================================
// D-6 — unchecked body fields that used to leak internal TypeErrors
// =============================================================================

test('D-6: POST /api/rules/validate rejects a non-string `rules` with a domain message', () => {
    const cases = [[42, 'number'], [{ name: 'x' }, 'object'], [['talent "X" {}'], 'array'], [true, 'boolean']];
    for (const [rules, typeName] of cases) {
        const res = dispatch('POST', '/api/rules/validate', { rules });
        assert.equal(res.status, 400, `rules=${JSON.stringify(rules)} must not be accepted`);
        assert.equal(res.body.ok, false);
        assert.deepEqual(Object.keys(res.body).sort(), ['error', 'ok'],
            'the non-DslError branch must not invent line/col');
        assert.match(res.body.error, /`rules` must be a string of DSL text/);
        assert.match(res.body.error, new RegExp(`received ${typeName}`));
        assertNoInternalLeak(res.body.error);
    }
});

test('D-6: null/absent `rules` still compiles the empty program (unchanged)', () => {
    for (const body of [{}, { rules: '' }, { rules: null }, null, undefined]) {
        const res = dispatch('POST', '/api/rules/validate', body);
        assert.equal(res.status, 200, `${JSON.stringify(body)} should be an empty-but-valid program`);
        assert.deepEqual(res.body, { ok: true, count: 0, effects: [] });
    }
});

/** Every endpoint that builds a rule registry from the body. */
const REGISTRY_ENDPOINTS = [
    ['/api/test', { target: 50 }],
    ['/api/damage', { formula: '1d10' }],
    ['/api/parry', { characteristics: { ws: 40 } }],
    ['/api/attack', { characteristics: { bs: 50 } }],
    ['/api/resolve', { attacker: { characteristics: { bs: 50 } }, defender: {} }],
    ['/api/engage', { phase: 'attack', attacker: { characteristics: { bs: 50 } } }],
    ['/api/encounter/tick', { encounter: emptyEncounter(), phase: 'ROUND_END' }],
];

test('D-6 (same class): a non-string `customRules` is a domain error on every registry endpoint', () => {
    for (const [path, base] of REGISTRY_ENDPOINTS) {
        for (const [customRules, typeName] of [[42, 'number'], [{ a: 1 }, 'object'], [['x'], 'array']]) {
            const res = dispatch('POST', path, { ...base, customRules, forcedRolls: [50] });
            assertErrorShape(res, { match: /`customRules` must be a string of DSL text/ });
            assert.match(res.body.error, new RegExp(`received ${typeName}`));
            assertNoInternalLeak(res.body.error);
        }
    }
});

test('D-6 (same class): a non-array `disabledRules` is a domain error on every registry endpoint', () => {
    for (const [path, base] of REGISTRY_ENDPOINTS) {
        for (const [disabledRules, typeName] of [[42, 'number'], ['dh2.core/jam', 'string'], [{ a: 1 }, 'object']]) {
            const res = dispatch('POST', path, { ...base, disabledRules, forcedRolls: [50] });
            assertErrorShape(res, { match: /`disabledRules` must be an array of rule ids/ });
            assert.match(res.body.error, new RegExp(`received ${typeName}`));
            assertNoInternalLeak(res.body.error);
        }
    }
});

test('D-6: well-typed customRules/disabledRules keep working on every registry endpoint', () => {
    const rules = 'talent "Zeal" { on MODIFIERS then add modifier "zeal" = 10 }';
    for (const [path, base] of REGISTRY_ENDPOINTS) {
        for (const extra of [{}, { customRules: rules }, { customRules: '', disabledRules: [] },
            { customRules: null, disabledRules: null }, { disabledRules: ['dh2.core.mechanics/jam'] }]) {
            const res = dispatch('POST', path, { ...base, ...extra, forcedRolls: [50] });
            assert.equal(res.status, 200, `${path} ${JSON.stringify(extra)} → ${JSON.stringify(res.body)}`);
        }
    }
});

test('D-6: a genuinely broken customRules program still reports the DSL error, not a type error', () => {
    const res = dispatch('POST', '/api/test', { target: 50, customRules: 'talent "X" { on MODIFIERS then teleport 3 }' });
    assertErrorShape(res, { match: /teleport/ });
});

// =============================================================================
// D-8 — a nameless Roll20 attribute in the user-facing `unmapped` gap list
// =============================================================================

test('D-8: a nameless attribute is reported with a placeholder, never as `undefined`', () => {
    const r = fromRoll20({
        name: 'Nameless',
        attribs: [{ current: 7 }, { name: '', current: 3 }, { name: '   ', current: 4 },
            { name: 'TotallyUnknownAttr', current: 1 }],
    });
    assert.ok(r.unmapped.includes('TotallyUnknownAttr'), 'a genuinely unknown attribute is still reported');
    assert.ok(!r.unmapped.includes(undefined), 'no literal undefined reaches the gap list');
    assert.ok(r.unmapped.every((u) => typeof u === 'string' && u.trim().length > 0),
        `every gap entry must render: ${JSON.stringify(r.unmapped)}`);
    assert.equal(r.unmapped.filter((u) => u === '(unnamed attribute)').length, 3,
        'each nameless/blank attribute is reported once — the gap is not silently dropped');
    assert.equal(r.character.name, 'Nameless', 'the rest of the mapping still runs');
});

// =============================================================================
// D-13 — parseWeaponBlock()'s unused `unmapped` parameter
// =============================================================================

test('D-13: a named ARMAMENTS block that fails to parse is recorded in source.unmapped', () => {
    const sheet = [
        ['[Name]'],
        [],
        ['ARMAMENTS'],
        ['Name:'],
        ['Hellgun'],
        ['Quality', 'RoF', 'Range'],
        ['Good', 'S/3/10', '100m'],
        ['Damage', 'Pen', 'Clip'],
        ['1d10+4 E', '4', '40'],
        [],
        ['Name:'],
        ['Broken Block'],
        ['NotQuality'],                    // no Quality row → dropped
        [],
        ['Name:'],
        ['No Damage Row'],
        ['Quality', 'RoF'],
        ['Normal', '3'],
        ['Nothing'],                       // no Damage row → dropped
        [],
        ['Name:'],
        ['Placeholder Gun'],
        ['Quality', 'RoF'],
        ['Common', 'S/-/-'],
        ['Damage', 'Pen', 'Clip'],
        ['—', '', ''],                     // no damage formula → dropped
        [],
        ['Name:'],
        [''],                              // a blank template block: nothing to lose
        ['NotQuality'],
        [],
    ];
    const doc = parseGrids({ sheet }, 'Tester.xlsx');
    assert.deepEqual(doc.weapons.map((w) => w.name), ['Hellgun'], 'only the parseable block imports');
    const gaps = doc.source.unmapped;
    for (const dropped of ['Broken Block', 'No Damage Row', 'Placeholder Gun']) {
        assert.ok(gaps.some((u) => u.includes(dropped)),
            `${dropped} must be recorded as a gap: ${JSON.stringify(gaps)}`);
    }
    assert.ok(gaps.every((u) => typeof u === 'string' && u.length > 0));
    assert.equal(gaps.filter((u) => /weapon block/.test(u)).length, 3,
        'an empty template block is not reported — it carries nothing to lose');
});
