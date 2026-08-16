/**
 * Transport-layer edge cases — node --test.
 *
 * server.test.mjs drives the *happy* paths of every route over real HTTP. This
 * file is its complement: it exercises `dispatch(method, path, body)`
 * (api/lib/api-router.mjs) directly — no port, no fetch — and concentrates on
 * the branches HTTP smoke tests never reach:
 *
 *   - method routing: unknown verbs (405), case-folding, the GET default;
 *   - the two 404 tables (a GET-only path POSTed to, and vice versa);
 *   - every error/throw path, asserting the *shape* of the response
 *     ({ status, body:{ error } }) — a route that 500s or 200s where it should
 *     400 is a real defect and only a shape assertion catches it;
 *   - POST /api/engage in full (all four phases + the unknown-phase throw),
 *     which the HTTP suite does not touch at all;
 *   - the encounter-merge and recharge-annotation branches of the router;
 *   - server.mjs's module-init guard (isMain), driven without binding a port.
 *
 * Determinism: every engine call that rolls dice is given `forcedRolls`, so the
 * assertions below are exact rather than "some number in a range".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../lib/api-router.mjs';
import { emptyEncounter, encounterActor } from '../lib/encounter.mjs';

// --- fixtures ----------------------------------------------------------------

/** Single-shot autogun; BS 70 so a forced d100 of 11 is a comfortable hit. */
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

/** Every path in the router's GET table (the same eight Express registers). */
const GET_PATHS = [
    '/api/weapons', '/api/options', '/api/characters', '/api/rules', '/api/dsl-docs',
    '/api/rules/source', '/api/chargen/pack', '/api/character/schema',
];

/** Asserts an error response is *shaped* like one: 400 + a lone `error` string. */
const assertErrorShape = (res, { status = 400, match } = {}) => {
    assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}`);
    assert.ok(res.body && typeof res.body === 'object', 'error body must be an object');
    assert.equal(typeof res.body.error, 'string', 'error body must carry a string `error`');
    assert.ok(res.body.error.length > 0, '`error` must not be empty');
    if (match) assert.match(res.body.error, match);
};

// =============================================================================
// 1. Method routing
// =============================================================================

test('unknown HTTP verbs return 405 with the verb echoed — never 404 or 200', () => {
    for (const verb of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']) {
        const res = dispatch(verb, '/api/weapons', {});
        assert.deepEqual(res, { status: 405, body: { error: `Method ${verb} not allowed` } },
            `${verb} must be rejected as a method, not routed`);
    }
});

test('405 outranks 404: an unknown verb on an unknown path is still a method error', () => {
    // The verb is checked before the path table, so the client is told the real
    // problem instead of being sent hunting for a typo in the path.
    assert.deepEqual(dispatch('PUT', '/api/does-not-exist', {}),
        { status: 405, body: { error: 'Method PUT not allowed' } });
});

test('the verb is upper-cased before routing (lower-case clients still work)', () => {
    assert.equal(dispatch('get', '/api/weapons').status, 200);
    const soak = dispatch('post', '/api/soak', { damage: 10, penetration: 0, armour: 2, toughnessBonus: 3 });
    assert.equal(soak.status, 200);
    assert.equal(soak.body.usableArmour, 2);
    assert.equal(soak.body.reduction, 5);
    assert.equal(soak.body.woundsInflicted, 5);
    // mixed case too
    assert.equal(dispatch('PoSt', '/api/soak', { damage: 1 }).status, 200);
});

test('a missing, null or empty method falls back to GET', () => {
    for (const method of [undefined, null, '', 0, false]) {
        const res = dispatch(method, '/api/weapons');
        assert.equal(res.status, 200, `method ${JSON.stringify(method)} should default to GET`);
        assert.equal(res.body.count, 144);
    }
});

// =============================================================================
// 2. The 404 tables (GET and POST are separate namespaces)
// =============================================================================

test('GET an unknown path → 404 naming the path', () => {
    assert.deepEqual(dispatch('GET', '/api/nope'),
        { status: 404, body: { error: 'Unknown endpoint /api/nope' } });
});

test('POST an unknown path → 404 naming the path', () => {
    assert.deepEqual(dispatch('POST', '/api/nope', { anything: true }),
        { status: 404, body: { error: 'Unknown endpoint /api/nope' } });
});

test('the GET and POST tables are disjoint: cross-verb calls 404', () => {
    // /api/test is POST-only …
    assert.deepEqual(dispatch('GET', '/api/test'),
        { status: 404, body: { error: 'Unknown endpoint /api/test' } });
    assert.deepEqual(dispatch('GET', '/api/engage'),
        { status: 404, body: { error: 'Unknown endpoint /api/engage' } });
    // … and /api/weapons is GET-only.
    assert.deepEqual(dispatch('POST', '/api/weapons', {}),
        { status: 404, body: { error: 'Unknown endpoint /api/weapons' } });
    assert.deepEqual(dispatch('POST', '/api/options', {}),
        { status: 404, body: { error: 'Unknown endpoint /api/options' } });
});

test('paths are matched exactly — no trailing-slash, case or whitespace fuzz', () => {
    for (const path of ['/api/weapons/', '/API/weapons', '/api/Weapons', ' /api/weapons', 'api/weapons', '/api/weapons?x=1']) {
        const res = dispatch('GET', path);
        assert.equal(res.status, 404, `${JSON.stringify(path)} must not resolve to /api/weapons`);
        assert.equal(res.body.error, `Unknown endpoint ${path}`);
    }
});

// =============================================================================
// 3. The GET table
// =============================================================================

test('every GET endpoint answers 200 with a non-empty object body', () => {
    for (const path of GET_PATHS) {
        const res = dispatch('GET', path);
        assert.equal(res.status, 200, `${path} should be 200`);
        assert.ok(res.body && typeof res.body === 'object', `${path} should return an object`);
        assert.ok(Object.keys(res.body).length > 0, `${path} should not return {}`);
    }
});

test('GET ignores any body it is handed', () => {
    const withBody = dispatch('GET', '/api/options', { junk: true });
    const without = dispatch('GET', '/api/options');
    assert.equal(withBody.status, 200);
    assert.deepEqual(withBody.body.hitLocations, without.body.hitLocations);
});

// =============================================================================
// 4. POST error paths — status AND body shape
// =============================================================================

test('POST /api/engage with an unknown phase → 400, not 500 or 200', () => {
    const res = dispatch('POST', '/api/engage', { phase: 'teleport' });
    assertErrorShape(res, { match: /Unknown engagement phase 'teleport'/ });
    assert.deepEqual(Object.keys(res.body), ['error'], 'the throw→400 wrapper emits `error` only');
});

test('POST /api/engage with no phase at all → 400 (no silent default phase)', () => {
    assertErrorShape(dispatch('POST', '/api/engage', {}), { match: /Unknown engagement phase 'undefined'/ });
    assertErrorShape(dispatch('POST', '/api/engage'), { match: /Unknown engagement phase 'undefined'/ });
});

test('POST /api/damage → 400 on an unrollable formula (missing and unparseable)', () => {
    assertErrorShape(dispatch('POST', '/api/damage', {}), { match: /Cannot parse damage formula/ });
    assertErrorShape(dispatch('POST', '/api/damage', { formula: 'Special' }), { match: /Cannot parse damage formula "Special"/ });
    // the failure must not leak a half-built result alongside the error
    const res = dispatch('POST', '/api/damage', { formula: '???' });
    assert.deepEqual(Object.keys(res.body), ['error']);
});

test('POST /api/encounter/tick → 400 on an unknown upkeep phase', () => {
    assertErrorShape(dispatch('POST', '/api/encounter/tick', { phase: 'MIDNIGHT' }),
        { match: /Unknown upkeep phase 'MIDNIGHT'/ });
    assertErrorShape(dispatch('POST', '/api/encounter/tick', {}),
        { match: /Unknown upkeep phase/ });
});

test('POST /api/chargen/advance → 400 when the advance is missing or bogus', () => {
    assertErrorShape(dispatch('POST', '/api/chargen/advance', {}), { match: /unknown advance kind/ });
    assertErrorShape(dispatch('POST', '/api/chargen/advance', { advance: { kind: 'wishes' } }), { match: /unknown advance kind "wishes"/ });
});

test('POST /api/test → 400 when customRules do not compile (the DSL throw→400 path)', () => {
    assertErrorShape(dispatch('POST', '/api/test', {
        target: 40, customRules: 'miscellaneous "bad" { on NOWHERE then flag attack_failed }',
    }), { match: /Unknown checkpoint/ });
});

test('a rejected POST never returns a 2xx status with an error body', () => {
    const rejected = [
        ['/api/engage', { phase: 'nope' }],
        ['/api/damage', { formula: 'nope' }],
        ['/api/encounter/tick', { phase: 'nope' }],
        ['/api/chargen/advance', { advance: { kind: 'nope' } }],
    ];
    for (const [path, body] of rejected) {
        const res = dispatch('POST', path, body);
        assert.equal(res.status, 400, `${path} must answer 400`);
        assert.ok(!('ok' in res.body), `${path} error body must not masquerade as a success payload`);
    }
});

// =============================================================================
// 5. POST /api/engage — the four phases (api-router.mjs 129-151)
// =============================================================================

test('POST /api/engage phase "attack" rolls to hit and returns the forced trace', () => {
    const res = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(), forcedRolls: [11],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.weapon, 'Autogun');
    assert.equal(res.body.test.roll, 11);
    assert.equal(res.body.test.success, true);
    assert.equal(res.body.test.modifiedTarget, 80);           // BS 70 + Standard Attack's +10
    assert.equal(res.body.test.dos, 8);
    assert.deepEqual(res.body.rollTrace.map((t) => t.value), [11]);
    assert.ok(res.body.rollTrace.every((t) => t.forced === true));
});

test('POST /api/engage phase "damage" rolls damage for the held attack state', () => {
    const attack = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(), forcedRolls: [11],
    }).body;
    const res = dispatch('POST', '/api/engage', {
        phase: 'damage', attacker: gunner(), defender: mook(), state: { attack }, forcedRolls: [5],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.hits.length, 1);
    assert.equal(res.body.hits[0].damage.total, 5);
    assert.deepEqual(res.body.rollTrace.map((t) => t.value), [5]);
});

test('POST /api/engage phase "damage" with no state defaults to an empty attack (no hits)', () => {
    const res = dispatch('POST', '/api/engage', { phase: 'damage', attacker: gunner() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hits, []);
    assert.deepEqual(res.body.rollTrace, []);
});

test('POST /api/engage phase "evasion" rolls the reaction against the attack DoS', () => {
    const res = dispatch('POST', '/api/engage', {
        phase: 'evasion', attacker: gunner(), defender: mook(),
        state: { attack: { test: { dos: 3 } } }, forcedRolls: [25],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.reaction.mode, 'dodge');
    assert.equal(res.body.reaction.test.roll, 25);
    assert.equal(res.body.reaction.test.success, true);       // Ag 30 vs 25
    assert.equal(res.body.evaded, 2);                          // 1 + 1 DoS
    assert.deepEqual(res.body.rollTrace.map((t) => t.value), [25]);
});

test('POST /api/engage phase "evasion" with no state/defender defaults to dos 0 and no reaction', () => {
    const res = dispatch('POST', '/api/engage', { phase: 'evasion' });
    assert.equal(res.status, 200);
    assert.equal(res.body.reaction, null);
    assert.equal(res.body.evaded, 0);
    assert.deepEqual(res.body.rollTrace, []);
});

test('POST /api/engage phase "onhit" soaks the held hits and totals the wounds', () => {
    const attack = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(), forcedRolls: [11],
    }).body;
    const { hits } = dispatch('POST', '/api/engage', {
        phase: 'damage', attacker: gunner(), defender: mook(), state: { attack }, forcedRolls: [9],
    }).body;
    const res = dispatch('POST', '/api/engage', {
        phase: 'onhit', attacker: gunner(), defender: mook(),
        state: { attack: { ...attack, hits }, evaded: 0 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.hits.length, 1);
    assert.equal(res.body.hits[0].soak.woundsInflicted, 6);    // 9 damage − (0 armour + 3 TB)
    assert.equal(res.body.totalWounds, 6);
    assert.ok(!('encounter' in res.body), 'no encounter keys were supplied, so none is harvested');
});

test('POST /api/engage phase "onhit" with no state at all returns an empty, well-formed result', () => {
    const res = dispatch('POST', '/api/engage', { phase: 'onhit' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hits, []);
    assert.equal(res.body.totalWounds, 0);
    assert.equal(res.body.fieldDown, false);
});

test('POST /api/engage phase "onhit" harvests an encounter document when keys are supplied', () => {
    const attack = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(), forcedRolls: [11],
    }).body;
    const { hits } = dispatch('POST', '/api/engage', {
        phase: 'damage', attacker: gunner(), defender: mook(), state: { attack }, forcedRolls: [7],
    }).body;
    const res = dispatch('POST', '/api/engage', {
        phase: 'onhit', attacker: gunner(), defender: mook(),
        attackerKey: 'gunner', defenderKey: 'mook',
        state: { attack: { ...attack, hits }, evaded: 0 },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.encounter, 'attackerKey/defenderKey must produce an encounter document');
    assert.deepEqual(Object.keys(res.body.encounter.actors).sort(), ['gunner', 'mook']);
    assert.equal(res.body.encounter.actors.mook.wounds.taken, 4);   // 7 − 3 TB
});

test('POST /api/engage phase "attack" flags a weapon still on its Recharge cooldown', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'g', 'Gunner').cooldowns = { recharge: true };
    const res = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(),
        encounter: enc, attackerKey: 'g', defenderKey: 'm', forcedRolls: [11],
    });
    assert.equal(res.status, 200);
    const warn = res.body.effects.find((e) => e.name === 'Recharging');
    assert.ok(warn, 'the advisory Recharging effect must be attached to the attack');
    assert.match(warn.effect, /still recharging/);
});

test('POST /api/engage without a cooldown attaches no Recharging warning', () => {
    const res = dispatch('POST', '/api/engage', {
        phase: 'attack', attacker: gunner(), defender: mook(),
        encounter: emptyEncounter(), attackerKey: 'g', forcedRolls: [11],
    });
    assert.equal(res.status, 200);
    assert.ok(!res.body.effects.some((e) => e.name === 'Recharging'));
});

// =============================================================================
// 6. POST /api/resolve — the encounter-merge branches of the router
// =============================================================================

test('POST /api/resolve without encounter keys returns no encounter document', () => {
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(), forcedRolls: [11, 5, 90],
    });
    assert.equal(res.status, 200);
    assert.ok(!('encounter' in res.body), 'stateless callers must not be handed encounter state');
    assert.ok(Array.isArray(res.body.rollTrace));
});

test('POST /api/resolve with only an attackerKey still harvests both sides (defender defaults)', () => {
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(), attackerKey: 'g', forcedRolls: [11, 5, 90],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.encounter.actors).sort(), ['defender', 'g']);
});

test('POST /api/resolve with only a defenderKey still harvests both sides (attacker defaults)', () => {
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(), defenderKey: 'm', forcedRolls: [11, 5, 90],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.encounter.actors).sort(), ['attacker', 'm']);
    assert.equal(res.body.encounter.actors.m.name, 'Mook');
});

test('POST /api/resolve names the harvested attacker only when its weapon is named', () => {
    const named = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(), attackerKey: 'g', forcedRolls: [11, 5, 90],
    }).body;
    assert.equal(named.encounter.actors.g.name, 'Gunner');

    const anon = gunner();
    anon.weapon = { ...anon.weapon, name: '' };
    const unnamed = dispatch('POST', '/api/resolve', {
        attacker: anon, defender: mook(), attackerKey: 'g', forcedRolls: [11, 5, 90],
    }).body;
    assert.equal(unnamed.encounter.actors.g.name, 'g', 'falls back to the actor key');
});

test('POST /api/resolve snapshots characteristics, unnatural, talents and traits into the encounter', () => {
    const attacker = { ...gunner(), unnatural: { s: 1 }, talents: ['Ambidextrous'], traits: ['Brutal Charge (2)'] };
    const res = dispatch('POST', '/api/resolve', {
        attacker, defender: mook(), encounter: emptyEncounter(),
        attackerKey: 'g', defenderKey: 'm', forcedRolls: [11, 5, 90],
    });
    assert.equal(res.status, 200);
    const stats = res.body.encounter.actors.g.stats;
    assert.equal(stats.characteristics.bs, 70);
    assert.deepEqual(stats.unnatural, { s: 1 });
    assert.deepEqual(stats.talents, ['Ambidextrous']);
    assert.deepEqual(stats.traits, ['Brutal Charge (2)']);
    // the defender carried none of those — the optional snapshots stay empty
    assert.deepEqual(res.body.encounter.actors.m.stats.unnatural, {});
    assert.deepEqual(res.body.encounter.actors.m.stats.talents, []);
});

test('POST /api/resolve merges stored conditions into the incoming combatant', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'attacker', 'Torch').conditions.push({ name: 'On Fire' });
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(), encounter: enc, forcedRolls: [11, 5, 90],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.attack.test.modifiers.on_fire, -10);
});

/** Armour 6, no reaction — so the forced rolls are exactly [to-hit, damage]. */
const standingTarget = () => ({ name: 'Target', characteristics: { ag: 30, t: 30 }, armour: 6, toughnessBonus: 3 });

test('POST /api/resolve seeds persistent armour damage into the soak', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'd', 'Dee').armourDamage = { 'Right Arm': 4 };
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: standingTarget(), encounter: enc, defenderKey: 'd', forcedRolls: [11, 9],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.attack.hits[0].location, 'Right Arm');
    assert.equal(res.body.attack.hits[0].soak.armour, 2, '6 base AP − 4 persistent corrosion');
    assert.equal(res.body.attack.hits[0].soak.woundsInflicted, 4);   // 9 − (2 + 3)
});

test('POST /api/resolve with an empty armourDamage map leaves the armour untouched', () => {
    const enc = emptyEncounter();
    encounterActor(enc, 'd', 'Dee');                       // armourDamage: {}
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: standingTarget(), encounter: enc,
        defenderKey: 'd', forcedRolls: [11, 9],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.attack.hits[0].soak.armour, 6);
    assert.equal(res.body.attack.hits[0].soak.woundsInflicted, 0);   // 9 − (6 + 3)
});

test('POST /api/resolve: an encounter document with no `actors` map is rejected, not crashed into a 200', () => {
    // FINDING (documented, not fixed): api-router.mjs withEncounter() guards the
    // merge step with `enc?.actors` but the stats-snapshot loop below it calls
    // encounter.mjs encounterActor(), which dereferences `encounter.actors[key]`
    // unguarded (encounter.mjs:46). A partial document therefore surfaces a raw
    // TypeError ("Cannot read properties of undefined (reading 'attacker')")
    // through the throw→400 wrapper instead of a domain error. This test pins
    // the current contract: it is a 400, and it never half-succeeds.
    const res = dispatch('POST', '/api/resolve', {
        attacker: gunner(), defender: mook(),
        encounter: { schemaVersion: 1, kind: 'dh2.encounter', round: 1 },   // no `actors`
        forcedRolls: [11, 9],
    });
    assertErrorShape(res);
    assert.ok(!('attack' in res.body), 'a rejected engagement must not return partial results');
});

// =============================================================================
// 7. POST /api/rules/validate — the bespoke success/error shape
// =============================================================================

test('POST /api/rules/validate with no rules text compiles the empty program', () => {
    for (const body of [{}, { rules: '' }, { rules: null }, null, undefined]) {
        const res = dispatch('POST', '/api/rules/validate', body);
        assert.equal(res.status, 200, `${JSON.stringify(body)} should be an empty-but-valid program`);
        assert.deepEqual(res.body, { ok: true, count: 0, effects: [] });
    }
});

test('POST /api/rules/validate reports a DSL error with ok/error/message/line/col', () => {
    const res = dispatch('POST', '/api/rules/validate', {
        rules: 'talent "X" { on MODIFIERS then teleport 3 }',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(typeof res.body.error, 'string');
    assert.match(res.body.message, /Unknown action 'teleport'/);
    assert.equal(typeof res.body.line, 'number');
    assert.equal(typeof res.body.col, 'number');
    assert.deepEqual(Object.keys(res.body).sort(), ['col', 'error', 'line', 'message', 'ok']);
});

test('POST /api/rules/validate: a non-DSL failure still 400s, but carries no line/col', () => {
    // FINDING (documented, not fixed): `rules` is never type-checked, so a
    // non-string (a client sending a parsed object, say) reaches the tokenizer
    // and the resulting internal TypeError is echoed verbatim in `error`
    // ("Cannot read properties of undefined (reading 'flatMap')"). The status is
    // right (400) and the shape is right — only the message is an internal leak.
    for (const rules of [42, { name: 'x' }, ['talent "X" {}']]) {
        const res = dispatch('POST', '/api/rules/validate', { rules });
        assert.equal(res.status, 400, `rules=${JSON.stringify(rules)} must not be accepted`);
        assert.equal(res.body.ok, false);
        assert.equal(typeof res.body.error, 'string');
        assert.deepEqual(Object.keys(res.body).sort(), ['error', 'ok'],
            'the non-DslError branch must not invent line/col');
    }
});

test('POST /api/rules/validate reports `replaces` as an array, or null when absent', () => {
    const overriding = dispatch('POST', '/api/rules/validate', {
        rules: 'talent "Ovr" { replaces "dh2.core.mechanics/jam" on MODIFIERS then add modifier "x" = 1 }',
    });
    assert.equal(overriding.status, 200);
    assert.deepEqual(overriding.body.effects[0].replaces, ['dh2.core.mechanics/jam']);

    const plain = dispatch('POST', '/api/rules/validate', {
        rules: 'talent "Plain" { on MODIFIERS then add modifier "x" = 1 }',
    });
    assert.equal(plain.body.effects[0].replaces, null, 'absent `replaces` normalises to null, never undefined');
    assert.deepEqual(Object.keys(plain.body.effects[0]).sort(),
        ['checkpoint', 'id', 'name', 'priority', 'replaces', 'source']);
});

test('POST /api/rules/validate counts every compiled effect', () => {
    const res = dispatch('POST', '/api/rules/validate', {
        rules: 'talent "A" { on MODIFIERS then add modifier "a" = 1 }\n'
             + 'talent "B" { on MODIFIERS then add modifier "b" = 2 }',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, res.body.effects.length);
    assert.deepEqual(res.body.effects.map((e) => e.name), ['A', 'B']);
});

// =============================================================================
// 8. POST /api/character/validate — always 200, ok:false in the body
// =============================================================================

test('POST /api/character/validate returns 200 even for an invalid document', () => {
    const res = dispatch('POST', '/api/character/validate', { character: { kind: 'dh2.character', name: 'Bare' } });
    assert.equal(res.status, 200, 'validation failure is a result, not a transport error');
    assert.equal(res.body.ok, false);
    assert.ok(res.body.errors.length > 0);
    assert.ok(Array.isArray(res.body.warnings));
    assert.equal(res.body.character.name, 'Bare');
    assert.ok(!('combatant' in res.body), 'no combatant preview for an invalid document');
});

test('POST /api/character/validate accepts the document unwrapped as the body', () => {
    const doc = {
        schemaVersion: 4, kind: 'dh2.character', name: 'Unwrapped',
        characteristics: { ws: 30, bs: 35, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 },
    };
    const wrapped = dispatch('POST', '/api/character/validate', { character: doc });
    const bare = dispatch('POST', '/api/character/validate', doc);
    assert.equal(wrapped.status, 200);
    assert.equal(bare.status, 200);
    assert.equal(bare.body.ok, wrapped.body.ok);
    assert.equal(bare.body.character.name, 'Unwrapped');
    if (bare.body.ok) assert.ok(bare.body.combatant, 'a valid document gets a combatant preview');
});

test('POST /api/character/validate tolerates a null/absent body', () => {
    for (const body of [null, undefined, {}]) {
        const res = dispatch('POST', '/api/character/validate', body);
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, false);
        assert.ok(res.body.errors.some((e) => e.path === 'characteristics'));
    }
});

// =============================================================================
// 9. Optional-body POSTs and the `??` fallback chains
// =============================================================================

test('POST /api/config/check works with no body and reports warnings', () => {
    assert.deepEqual(dispatch('POST', '/api/config/check'), { status: 200, body: { warnings: [] } });
    assert.deepEqual(dispatch('POST', '/api/config/check', null), { status: 200, body: { warnings: [] } });
    const res = dispatch('POST', '/api/config/check', { talents: ['Lightning Attack'], characteristics: {} });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.warnings));
});

test('POST /api/chargen/advances accepts `doc`, the legacy `character` alias, or nothing', () => {
    const doc = {
        schemaVersion: 4, kind: 'dh2.character', name: 'Alias',
        characteristics: { ws: 30, bs: 35, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 },
        aptitudes: ['General', 'Ballistic Skill'], xp: { total: 1000, ledger: [] },
    };
    const viaDoc = dispatch('POST', '/api/chargen/advances', { doc });
    const viaAlias = dispatch('POST', '/api/chargen/advances', { character: doc });
    const viaNothing = dispatch('POST', '/api/chargen/advances', {});

    assert.equal(viaDoc.status, 200);
    assert.equal(viaAlias.status, 200);
    assert.equal(viaNothing.status, 200);
    assert.deepEqual(viaAlias.body.xp, viaDoc.body.xp, '`character` is a true alias for `doc`');
    assert.equal(viaDoc.body.xp.remaining, 1000);
    assert.equal(viaNothing.body.xp.total, 0, 'an absent document degrades to an empty character');
    assert.ok(viaDoc.body.advances.length > 0);
});

test('POST /api/chargen/{origin,validate} default a missing doc to an empty character', () => {
    const origin = dispatch('POST', '/api/chargen/origin', {});
    assert.equal(origin.status, 200);
    assert.equal(origin.body.doc.kind, 'dh2.character');

    const validated = dispatch('POST', '/api/chargen/validate', {});
    assert.equal(validated.status, 200);
    assert.deepEqual(validated.body.xp, { total: 0, spent: 0, remaining: 0 });
});

test('POST /api/chargen/advance passes `confirmed` through as a boolean', () => {
    const doc = {
        schemaVersion: 4, kind: 'dh2.character', name: 'Buyer',
        characteristics: { ws: 30, bs: 35, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 },
        aptitudes: ['General', 'Ballistic Skill'], xp: { total: 1000, ledger: [] },
    };
    const advance = dispatch('POST', '/api/chargen/advances', { doc })
        .body.advances.find((a) => a.kind === 'characteristic' && a.ref === 'bs');
    const res = dispatch('POST', '/api/chargen/advance', { doc, advance, confirmed: 'yes' });
    assert.equal(res.status, 200);
    assert.equal(res.body.doc.characteristics.bs.advances, 1);
    assert.equal(res.body.xp.spent, advance.cost);
});

// =============================================================================
// 10. Endpoints that roll dice honour (and only honour) forcedRolls
// =============================================================================

test('forcedRolls are optional on /api/test, /api/attack and /api/parry', () => {
    // with a forced roll → exact; without → still a well-formed 200
    const forced = dispatch('POST', '/api/test', { target: 50, forcedRolls: [42] });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.roll, 42);

    for (const path of ['/api/test', '/api/attack', '/api/parry']) {
        const res = dispatch('POST', path, { target: 50, characteristics: { ws: 40, bs: 40, s: 30, t: 30 } });
        assert.equal(res.status, 200, `${path} must work without forcedRolls`);
    }
});

// =============================================================================
// 11. api/server.mjs — the isMain guard, exercised without binding a port
// =============================================================================

/**
 * server.mjs decides whether to bind a port by comparing import.meta.url with
 * realpathSync(process.argv[1]). Imported by a test (as in server.test.mjs) it
 * stays silent; run as `node api/server.mjs` it listens. Only the silent half is
 * observable from an ordinary import, so here the noisy half is driven directly:
 * process.argv[1] is pointed at server.mjs and Express's listen is stubbed on the
 * application prototype BEFORE the app is constructed (express() copies the
 * prototype's descriptors onto each new app), so no socket is ever bound.
 *
 * Both globals are restored in `finally`, and this file gets its own process
 * under node --test, so nothing leaks into the HTTP suite.
 */
test('server.mjs starts a listener on the default port when it is the process entry point', async () => {
    const express = (await import('express')).default;
    const proto = express.application;
    const originalListen = Object.getOwnPropertyDescriptor(proto, 'listen');
    const originalArgv = process.argv[1];
    const originalPort = process.env.PORT;
    const originalLog = console.log;

    const listens = [];
    const logged = [];
    Object.defineProperty(proto, 'listen', {
        value(...args) {
            listens.push(args);
            const cb = args.at(-1);
            if (typeof cb === 'function') cb();
            return { close(done) { if (done) done(); } };
        },
        writable: true, configurable: true, enumerable: false,
    });
    console.log = (...args) => logged.push(args.join(' '));

    try {
        // argv[1] resolves (through realpathSync) to server.mjs itself → isMain.
        process.argv[1] = new URL('../server.mjs', import.meta.url).pathname;
        delete process.env.PORT;
        const mod = await import('../server.mjs');

        assert.equal(listens.length, 1, 'run directly, server.mjs must start listening');
        assert.equal(listens[0][0], 3210, 'PORT is unset, so the documented default 3210 applies');
        assert.match(logged.join('\n'), /listening on http:\/\/localhost:3210/);

        // the module's public surface, from the same instance (no second import,
        // which would fork the coverage record for this file)
        assert.equal(typeof mod.app, 'function', 'the Express app is exported as a request handler');
        assert.equal(mod.weaponData.count, 144);
        assert.equal(mod.weaponData.weapons.length, 144);
    } finally {
        console.log = originalLog;
        Object.defineProperty(proto, 'listen', originalListen);
        process.argv[1] = originalArgv;
        if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
    }
});

