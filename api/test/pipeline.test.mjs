/**
 * Checkpoint-pipeline tests — node --test.
 *
 * Guards the step-1 restructure: the roll engine is pure mechanism and pulls
 * all rule interpretation from a Registry. These tests assert (a) the runner's
 * activation/ordering contract, (b) the default registry binds the built-in
 * rules to the expected checkpoints, and (c) a NEW rule can change a roll by
 * being added to a registry — with no engine change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, CHECKPOINTS, runCheckpoint } from '../lib/pipeline.mjs';
import { buildDefaultRegistry } from '../lib/rules/index.mjs';
import { rollDamage, resolveAttack, defaultRegistry } from '../lib/engine.mjs';
import { riggedDice, d100, die } from './helpers.mjs';

// --- runner: activation predicate + priority order ---------------------------
test('runCheckpoint fires only active effects, in priority order', () => {
    const order = [];
    const reg = new Registry()
        .add({ id: 'late', checkpoint: CHECKPOINTS.MODIFIERS, priority: 100, apply: () => order.push('late') })
        .add({ id: 'early', checkpoint: CHECKPOINTS.MODIFIERS, priority: 0, apply: () => order.push('early') })
        .add({ id: 'inactive', checkpoint: CHECKPOINTS.MODIFIERS, priority: 50, when: () => false, apply: () => order.push('inactive') });

    const ctx = { log: [] };
    runCheckpoint(reg, CHECKPOINTS.MODIFIERS, ctx);

    assert.deepEqual(order, ['early', 'late']);            // sorted, inactive skipped
    assert.deepEqual(ctx.log.map((l) => l.effect), ['early', 'late']);  // audit trail
});

test('Registry validates checkpoint + apply', () => {
    assert.throws(() => new Registry().add({ id: 'x', checkpoint: 'NOPE', apply: () => {} }));
    assert.throws(() => new Registry().add({ id: 'y', checkpoint: CHECKPOINTS.MODIFIERS }));
});

// --- default registry binds the built-in rules -------------------------------
test('default registry exposes the built-in rules at their checkpoints', () => {
    const idsAt = (cp) => defaultRegistry.at(cp).map((e) => e.id);
    assert.ok(idsAt(CHECKPOINTS.MODIFIERS).includes('action-modifier'));
    assert.ok(idsAt(CHECKPOINTS.POST_ROLL).includes('jam'));
    assert.ok(idsAt(CHECKPOINTS.DAMAGE_POOL).includes('tearing'));
    assert.ok(idsAt(CHECKPOINTS.PENETRATION).includes('melta'));
});

// --- extension: a new rule alters a roll without touching the engine ----------
test('a custom DAMAGE_MODS effect changes damage total via a custom registry', () => {
    const reg = buildDefaultRegistry().add({
        id: 'blessing',
        source: 'custom',
        checkpoint: CHECKPOINTS.DAMAGE_MODS,
        apply: (ctx) => { ctx.modifiers['blessing'] = 5; },
    });

    const base = rollDamage({ formula: '1d10' }, riggedDice([die(4, 10)]));
    const buffed = rollDamage({ formula: '1d10' }, riggedDice([die(4, 10)]), reg);

    assert.equal(base.total, 4);                 // default registry: no blessing
    assert.equal(buffed.total, 9);               // 4 + blessing(5)
    assert.equal(buffed.modifiers['blessing'], 5);
});

test('a custom MODIFIERS effect lands in the attack test via a custom registry', () => {
    const reg = buildDefaultRegistry().add({
        id: 'machine-spirit',
        source: 'custom',
        checkpoint: CHECKPOINTS.MODIFIERS,
        apply: (ctx) => { ctx.modifiers['machine spirit'] = 5; },
    });

    const r = resolveAttack({
        characteristics: { ws: 40, s: 30, t: 30 },
        weapon: { name: 'Sword', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', rof: { single: true, burst: 0, full: 0 }, qualities: [] },
        action: 'Standard Attack',
    }, riggedDice([d100(50), die(5, 10)]), reg);

    assert.equal(r.test.modifiers['machine spirit'], 5);
    assert.equal(r.test.modifiers.attack, 10);   // built-in rule still applied alongside
});
