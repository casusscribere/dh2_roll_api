/**
 * The two findings left open by the 2026-07-31 fix sweep.
 *
 * Both are worse than they were first reported:
 *
 *   forcedRolls — reported as "silently ignored". In fact `rollScript` indexes
 *   `forced[index]`, so a STRING is indexed by character: "5,10" forces die 1
 *   to 5 (from the character '5') and randomises the rest. A caller passing a
 *   comma-separated string — the obvious mistake — gets partly-deterministic
 *   results and no signal that anything is wrong. Silent-and-ignored would be
 *   benign; silent-and-half-applied is not.
 *
 *   applyOrigin's " or " split — reported as "mangled". Splitting the whole
 *   normalised string turns "Weapon Training (Flame or Las, Chain)" into
 *   ["weapon training (flame", "las, chain)"], neither of which is a talent.
 *   Only the parenthetical-stripping fallback made grant matching work at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { rollScript } from '../lib/dice.mjs';
import { dispatch } from '../lib/api-router.mjs';

// --------------------------------------------------------------- forcedRolls

test('rollScript accepts a proper array of forced results', () => {
    const rng = rollScript([5, 10]);
    assert.equal(Math.floor(rng(10) * 10) + 1, 5);
    assert.equal(Math.floor(rng(10) * 10) + 1, 10);
});

test('rollScript rejects a non-array rather than indexing it by character', () => {
    // "5,10"[0] === '5', so the old code forced die 1 to 5 and randomised the
    // rest — deterministic enough to look intentional, wrong enough to mislead.
    assert.throws(() => rollScript('5,10'), /forcedRolls/i);
    assert.throws(() => rollScript(42), /forcedRolls/i);
    assert.throws(() => rollScript({ 0: 5 }), /forcedRolls/i);
});

test('rollScript still accepts the documented empty/absent cases', () => {
    assert.doesNotThrow(() => rollScript());
    assert.doesNotThrow(() => rollScript([]));
    assert.doesNotThrow(() => rollScript(null));
    assert.doesNotThrow(() => rollScript(undefined));
});

test('a bad forcedRolls reaches the caller as a domain error, not a 500', () => {
    const res = dispatch('POST', '/api/test', { target: 40, forcedRolls: '5,10' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /forcedRolls/i);
    // The message must name the problem, not leak an internal one.
    assert.doesNotMatch(res.body.error, /Cannot read properties|is not iterable/);
});

test('a valid forcedRolls still drives the roll end to end', () => {
    const res = dispatch('POST', '/api/test', { target: 40, forcedRolls: [17] });
    assert.equal(res.status, 200);
    assert.equal(res.body.roll, 17);
});

// ------------------------------------------------------- origin grant parsing

test('an "X or Y" grant expands to one talent per alternative', async () => {
    const { originGrantedTalentsForTest } = await import('../lib/advancement.mjs');
    const granted = originGrantedTalentsForTest(
        { origin: { background: { name: 'B' } } },
        { backgrounds: [{ name: 'B', talentsGranted: ['Weapon Training (Flame or Las, Chain)'] }],
          roles: [] },
    );
    // The grant means Weapon Training in ONE of Flame / Las / Chain.
    assert.ok(granted.has('weapon training (flame)'), [...granted].join(' | '));
    assert.ok(granted.has('weapon training (las)'), [...granted].join(' | '));
    assert.ok(granted.has('weapon training (chain)'), [...granted].join(' | '));
});

test('the old mangled fragments are no longer produced', async () => {
    const { originGrantedTalentsForTest } = await import('../lib/advancement.mjs');
    const granted = originGrantedTalentsForTest(
        { origin: { background: { name: 'B' } } },
        { backgrounds: [{ name: 'B', talentsGranted: ['Weapon Training (Flame or Las, Chain)'] }],
          roles: [] },
    );
    assert.ok(!granted.has('weapon training (flame'), 'unterminated fragment leaked');
    assert.ok(!granted.has('las, chain)'), 'orphaned fragment leaked');
});

test('a plain "X or Y" grant with no parenthetical still splits', async () => {
    const { originGrantedTalentsForTest } = await import('../lib/advancement.mjs');
    const granted = originGrantedTalentsForTest(
        { origin: { background: { name: 'B' } } },
        { backgrounds: [{ name: 'B', talentsGranted: ['Hardy or Resistance'] }], roles: [] },
    );
    assert.ok(granted.has('hardy'));
    assert.ok(granted.has('resistance'));
});

test('a grant with no alternatives is unchanged', async () => {
    const { originGrantedTalentsForTest } = await import('../lib/advancement.mjs');
    const granted = originGrantedTalentsForTest(
        { origin: { background: { name: 'B' } } },
        { backgrounds: [{ name: 'B', talentsGranted: ['Quick Draw'] }], roles: [] },
    );
    assert.ok(granted.has('quick draw'));
});

test('the base name is still indexed, so existing matching keeps working', async () => {
    const { originGrantedTalentsForTest } = await import('../lib/advancement.mjs');
    const granted = originGrantedTalentsForTest(
        { origin: { background: { name: 'B' } } },
        { backgrounds: [{ name: 'B', talentsGranted: ['Weapon Training (Flame or Las, Chain)'] }],
          roles: [] },
    );
    assert.ok(granted.has('weapon training'), 'base-name fallback lost');
});
