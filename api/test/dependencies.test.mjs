/**
 * Talent/trait prerequisite checker (rules/dependencies.mjs) — the Warnings/
 * errors log. Prerequisites outside the DSL-known name lists and
 * characteristics that were not supplied are SKIPPED, never warned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDependencies, DEPENDENCIES } from '../lib/rules/dependencies.mjs';
import { availableTalents, availableTraits } from '../lib/rules/index.mjs';
import { dispatch } from '../lib/api-router.mjs';

const KNOWN = { talents: availableTalents, traits: availableTraits };

test('Lightning Attack without Swift Attack is a conflict; with it, clean', () => {
    const bad = checkDependencies({ talents: ['Lightning Attack'] }, KNOWN);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].subject, 'Lightning Attack');
    assert.match(bad[0].message, /Swift Attack.*p\.129/);
    const good = checkDependencies({ talents: ['Lightning Attack', 'Swift Attack'] }, KNOWN);
    assert.equal(good.length, 0);
});

test('a prerequisite NOT in the DSL is skipped (enumerated in advance)', () => {
    // Same configuration, but pretend Swift Attack has no DSL rule yet: the
    // Lightning Attack entry stays in the table, the checker just skips it.
    const known = { talents: availableTalents.filter((t) => t !== 'Swift Attack'), traits: [] };
    const skipped = checkDependencies({ talents: ['Lightning Attack'] }, known);
    assert.equal(skipped.length, 0);
});

test('characteristic prerequisites: checked when supplied, skipped when not', () => {
    // Die Hard needs WP 40 — the Roll page never supplies wp, so no warning…
    assert.equal(checkDependencies({ talents: ['Die Hard'], characteristics: { ws: 30 } }, KNOWN).length, 0);
    // …but a supplied wp below 40 warns.
    const low = checkDependencies({ talents: ['Die Hard'], characteristics: { wp: 30 } }, KNOWN);
    assert.equal(low.length, 1);
    assert.match(low[0].message, /WP 40/);
    assert.equal(checkDependencies({ talents: ['Die Hard'], characteristics: { wp: 45 } }, KNOWN).length, 0);
});

test('anyOf: satisfied by either branch, warned only when all checkable branches fail', () => {
    const fail = checkDependencies({ talents: ['Precision Killer (Ranged)'], characteristics: { bs: 30, ws: 30 } }, KNOWN);
    assert.equal(fail.length, 1);
    assert.match(fail[0].message, /BS 40 or WS 40/);
    assert.equal(checkDependencies({ talents: ['Precision Killer (Ranged)'], characteristics: { bs: 30, ws: 45 } }, KNOWN).length, 0);
    // neither branch supplied → skip entirely
    assert.equal(checkDependencies({ talents: ['Precision Killer (Ranged)'] }, KNOWN).length, 0);
});

test('Two-Weapon Master reports each missing prerequisite separately', () => {
    const w = checkDependencies({ talents: ['Two-Weapon Master'], characteristics: { ag: 30, ws: 30, bs: 30 } }, KNOWN);
    const subjects = w.map((x) => x.requirement);
    assert.ok(subjects.some((s) => /Ambidextrous/.test(s)));
    assert.ok(subjects.some((s) => /Two-Weapon Wielder/.test(s)));
    assert.ok(subjects.some((s) => /AG 45/.test(s)));
    assert.ok(subjects.some((s) => /BS 40 or WS 40/.test(s)));
    const clean = checkDependencies({
        talents: ['Two-Weapon Master', 'Ambidextrous', 'Two-Weapon Wielder'],
        characteristics: { ag: 50, ws: 45 },
    }, KNOWN);
    assert.equal(clean.length, 0);
});

test('spelling-blind on both sides: lightning_attack satisfied by SwiftAttack', () => {
    const w = checkDependencies({ talents: ['lightning_attack', 'SwiftAttack'] }, KNOWN);
    assert.equal(w.length, 0);
    const bad = checkDependencies({ talents: ['LightningAttack'] }, KNOWN);
    assert.equal(bad.length, 1);
});

test('advance-enumerated subjects work the moment they are toggled: Hammer Blow ← Crushing Blow', () => {
    // Hammer Blow has no DSL rule, but its dependency is pre-enumerated and
    // Crushing Blow IS DSL-known — toggling Hammer Blow without it warns.
    assert.ok(DEPENDENCIES.talents['Hammer Blow']);
    const w = checkDependencies({ talents: ['Hammer Blow'] }, KNOWN);
    assert.equal(w.length, 1);
    assert.match(w[0].message, /Crushing Blow/);
});

test('POST /api/config/check wires the checker to the DSL-known names', () => {
    const res = dispatch('POST', '/api/config/check', { talents: ['Lightning Attack'], characteristics: {} });
    const body = res.body ?? res;
    assert.equal(body.warnings.length, 1);
    assert.equal(body.warnings[0].subject, 'Lightning Attack');
});
