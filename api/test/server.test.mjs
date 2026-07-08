/**
 * HTTP endpoint tests — node --test.
 *
 * Boots the Express app (imported from server.mjs, which does NOT auto-listen)
 * on an ephemeral port and exercises every route with the global fetch client.
 * Deterministic assertions where the math is fixed (soak); structural/invariant
 * assertions where the engine rolls real dice (test/damage/attack); plus the
 * 400 error path through the handle() wrapper.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server.mjs';

let server, base;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

const postJson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

// --- GET /api/weapons --------------------------------------------------------
test('GET /api/weapons returns the 144-profile corpus', async () => {
    const res = await fetch(`${base}/api/weapons`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 144);
    assert.equal(body.weapons.length, 144);
    assert.ok(body.weapons[0].id && body.weapons[0].damage);
});

// --- GET /api/options --------------------------------------------------------
test('GET /api/options returns actions, ranges, aim modes, locations', async () => {
    const res = await fetch(`${base}/api/options`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.actions) && body.actions.length === 10);   // + Suppressing Fire (Semi)/(Full)
    assert.ok(body.actions[0].name && typeof body.actions[0].modifier === 'number');
    assert.ok(body.actions.every((a) => typeof a.melee === 'boolean' && typeof a.ranged === 'boolean'), 'melee/ranged flags drive the UI radio filter');
    assert.equal(body.rangeBands['Point Blank'], 30);
    assert.equal(body.aimModes.Full, 20);
    assert.deepEqual(body.hitLocations, ['Head', 'Right Arm', 'Left Arm', 'Body', 'Right Leg', 'Left Leg']);
});

// --- POST /api/test ----------------------------------------------------------
test('POST /api/test returns a well-formed roll result', async () => {
    const res = await postJson('/api/test', { target: 50, modifiers: { difficulty: 10 } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.roll >= 1 && body.roll <= 100);
    assert.equal(body.target, 50);
    assert.equal(body.modifiedTarget, 60);
    assert.equal(typeof body.success, 'boolean');
});

test('POST /api/test caps the modifier total at +60', async () => {
    const res = await postJson('/api/test', { target: 30, modifiers: { a: 100, b: 50 } });
    const body = await res.json();
    assert.equal(body.modifierTotal, 60);
});

// --- POST /api/damage --------------------------------------------------------
test('POST /api/damage rolls a parseable formula', async () => {
    const res = await postJson('/api/damage', { formula: '1d10+5' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.formula, '1d10+5');
    assert.ok(body.total >= 6 && body.total <= 15);
    assert.ok(Array.isArray(body.dice.kept));
});

test('POST /api/damage returns 400 on an unparseable formula', async () => {
    const res = await postJson('/api/damage', { formula: 'Special' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Cannot parse/);
});

// --- POST /api/soak (deterministic) ------------------------------------------
test('POST /api/soak computes wounds deterministically', async () => {
    const res = await postJson('/api/soak', { damage: 12, penetration: 4, armour: 6, toughnessBonus: 3 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usableArmour, 2);
    assert.equal(body.reduction, 5);
    assert.equal(body.woundsInflicted, 7);
});

// --- POST /api/attack --------------------------------------------------------
test('POST /api/attack resolves a full attack and echoes inputs', async () => {
    const res = await postJson('/api/attack', {
        characteristics: { ws: 35, bs: 42, s: 34, t: 36 },
        weapon: {
            name: 'Bolt Pistol', isMelee: false, damage: '1d10+5', pen: 4,
            damageType: 'Explosive', rof: { single: true, burst: 2, full: 0 },
            qualities: ['Tearing'], sbMultiplier: 0,
        },
        action: 'Semi-Auto Burst', aim: 'None', rangeBand: 'Short Range',
        target: { armour: 4, toughnessBonus: 3 },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.weapon, 'Bolt Pistol');
    assert.equal(body.action, 'Semi-Auto Burst');
    assert.ok('test' in body && Array.isArray(body.hits));
    // when the attack lands, soak is reported and totalWounds is a number
    if (body.test.success && body.hits.length) {
        assert.equal(typeof body.totalWounds, 'number');
        assert.ok('soak' in body.hits[0]);
    }
});

test('POST /api/attack with an unknown action falls back to Standard Attack', async () => {
    const res = await postJson('/api/attack', {
        characteristics: { ws: 40, s: 30, t: 30 },
        weapon: { name: 'Knife', isMelee: true, damage: '1d5', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Nonsense Action',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.weapon, 'Knife');
    assert.ok('test' in body);
});

// --- GET /api/rules ----------------------------------------------------------
test('GET /api/rules lists selectable names by category', async () => {
    const res = await fetch(`${base}/api/rules`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.talents.includes('Ambidextrous'));
    assert.ok(body.talents.includes('Two-Weapon Wielder'));
    assert.ok(body.qualities.includes('Tearing'));
    assert.ok(body.qualities.includes('Melta'));
    assert.ok(body.traits.includes('Brutal Charge'));
    assert.ok(body.statuses.includes('On Fire'));
    assert.ok(body.statuses.includes('Full Aim'));
});

// --- GET /api/rules/source ---------------------------------------------------
test('GET /api/rules/source returns the built-in DSL source by category', async () => {
    const res = await fetch(`${base}/api/rules/source`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.builtins));
    const qualities = body.builtins.find((b) => b.file === 'weapon-qualities.dsl');
    assert.ok(qualities, 'weapon-qualities.dsl present');
    assert.match(qualities.source, /quality "Tearing"/);
    assert.ok(body.builtins.some((b) => b.file === 'traits.dsl'));
    assert.ok(body.builtins.some((b) => b.file === 'conditions.dsl'));
    assert.ok(body.builtins.some((b) => b.file === 'circumstances.dsl'));
    // per-rule list for the toggle UI
    assert.ok(Array.isArray(body.rules));
    assert.ok(body.rules.some((r) => r.id === 'tearing' && r.category === 'Weapon qualities'));
});

test('POST /api/attack with disabledRules suppresses a built-in rule', async () => {
    const base = {
        characteristics: { ws: 70, s: 0, t: 30 },
        weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Tearing'] },
        action: 'Standard Attack',
    };
    const res = await postJson('/api/attack', { ...base, disabledRules: ['tearing'] });
    assert.equal(res.status, 200);
    const body = await res.json();
    if (body.test.success && body.hits.length) {
        assert.equal(body.hits[0].damage.tearing, false);      // Tearing was disabled
        assert.equal(body.hits[0].damage.dice.rolled.length, 1);
    }
});

// --- POST /api/rules/validate ------------------------------------------------
test('POST /api/rules/validate accepts a well-formed rule', async () => {
    const res = await postJson('/api/rules/validate', {
        rules: 'talent "Blessed" { on MODIFIERS when has_talent("Blessed") then add modifier "faith" = 5 }',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 1);
    assert.equal(body.effects[0].name, 'Blessed');
    assert.equal(body.effects[0].checkpoint, 'MODIFIERS');
});

test('POST /api/rules/validate reports a parse error with line/col', async () => {
    const res = await postJson('/api/rules/validate', { rules: 'talent "X" { on MODIFIERS then teleport 3 }' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.message, /Unknown action 'teleport'/);
    assert.equal(typeof body.line, 'number');
});

test('POST /api/rules/validate rejects an unknown fact (safety)', async () => {
    const res = await postJson('/api/rules/validate', { rules: 'miscellaneous "x" { on MODIFIERS when secret then flag attack_failed }' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /Unknown fact 'secret'/);
});

// --- POST /api/attack with talents + customRules -----------------------------
test('POST /api/attack honours talents and returns an audit log', async () => {
    const res = await postJson('/api/attack', {
        characteristics: { bs: 50, s: 30, t: 30 },
        weapon: { name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Standard Attack',
        combat: { dualWielding: true },
        talents: ['Two-Weapon Wielder', 'Ambidextrous'],
    });
    const body = await res.json();
    assert.equal(body.test.modifiers.two_weapon, -10);          // Ambidextrous reduced the penalty
    assert.ok(Array.isArray(body.log));
    assert.ok(body.log.some((l) => l.effect.startsWith('ambidextrous')));  // a branch of the Ambidextrous rule fired
});

test('POST /api/attack applies a custom rule supplied as DSL text', async () => {
    const res = await postJson('/api/attack', {
        characteristics: { bs: 50, s: 30, t: 30 },
        weapon: { name: 'Pistol', isMelee: false, damage: '1d10', pen: 0, damageType: 'Impact', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Standard Attack',
        customRules: 'miscellaneous "Squad Buff" { on MODIFIERS then add modifier "squad" = 10 }',
    });
    const body = await res.json();
    assert.equal(body.test.modifiers.squad, 10);
});

test('POST /api/attack returns 400 on invalid customRules', async () => {
    const res = await postJson('/api/attack', {
        characteristics: { bs: 50 },
        weapon: { name: 'Pistol', isMelee: false, damage: '1d10', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        customRules: 'miscellaneous "bad" { on NOWHERE then flag attack_failed }',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Unknown checkpoint/);
});

// --- static pages ------------------------------------------------------------
test('serves the home, roll and rules pages plus shared assets', async () => {
    for (const [path, marker] of [
        ['/', 'DH2 Roll Servitor'],
        ['/roll.html', 'Full Attack Resolution'],
        ['/rules.html', 'Add a custom rule'],
        ['/style.css', '--gold'],
        ['/rules-store.js', 'RulesStore'],
    ]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.status, 200, `${path} should be 200`);
        assert.match(await res.text(), new RegExp(marker));
    }
});

// --- POST /api/resolve -------------------------------------------------------
test('POST /api/resolve resolves an engagement (attack → reaction → soak)', async () => {
    const res = await postJson('/api/resolve', {
        attacker: {
            characteristics: { ws: 40, bs: 50, s: 35, t: 30 },
            weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: ['Concussive (2)'] },
            action: 'Standard Attack',
        },
        defender: {
            characteristics: { ws: 30, ag: 40, t: 35, s: 30 }, armour: 4, toughnessBonus: 3,
            evasion: { mode: 'dodge' }, field: { rating: 30, overloadMax: 5 },
        },
        options: { autoResolveTests: true },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('attack' in body && 'defender' in body);
    assert.ok('test' in body.attack);
    if (body.attack.test.success) assert.ok(body.reaction); // a reaction was attempted
});

// --- unknown route -----------------------------------------------------------
test('GET unknown route returns 404', async () => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
});
