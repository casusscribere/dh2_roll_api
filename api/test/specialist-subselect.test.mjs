/**
 * Specialist sub-selections (user request 2026-08-27, item 3).
 *
 * ENGINE: specialist talents (Weapon Training, Peer, Hatred, …) purchase with
 * a specialization exactly like specialist skills do — the offer is flagged,
 * the purchase requires a sub-selection, different specs coexist, the same
 * spec twice is a duplicate.
 *
 * DSL: the sub-specialty mechanism is NORMALIZED PREFIX MATCHING on
 * has_talent (rules/_util normName + prefix semantics) — pinned here through
 * the LIVE engine so both directions hold: a base-name gate matches every
 * specialization (built-in keywords like "(Melee)" and user-entered text
 * alike), and a full-name gate matches only its own spec.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listAvailableAdvances, applyAdvance } from '../lib/advancement.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { dispatch } from '../lib/api-router.mjs';

const doc = (talents = []) => ({
    schemaVersion: 4, kind: 'dh2.character', name: 'Spec Probe', system: 'dh2',
    characteristics: { ws: 30, bs: 30, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 },
    aptitudes: ['General'], talents, traits: [],
    origin: { homeworld: null, background: null, role: null, eliteAdvances: [] },
    xp: { total: 5000, ledger: [] },
});

const wtOffer = (d) => listAvailableAdvances(d, CHARGEN_PACK)
    .find((a) => a.kind === 'talent' && a.name === 'Weapon Training');

/* ── engine ─────────────────────────────────────────────────────────────── */

test('specialist talents are flagged in the advance list', () => {
    const a = wtOffer(doc());
    assert.equal(a.specialist, true);
    const jaded = listAvailableAdvances(doc(), CHARGEN_PACK).find((x) => x.name === 'Jaded');
    assert.equal(jaded.specialist, undefined);
});

test('a specialist talent purchase REQUIRES a specialization (like specialist skills)', () => {
    const d = doc();
    assert.throws(() => applyAdvance(d, CHARGEN_PACK, wtOffer(d)), /specialist talent.*specialization/i);
});

test('the specialization rides the purchase: name, ledger, and doc all carry it', () => {
    const d = doc();
    const { doc: d2, entry } = applyAdvance(d, CHARGEN_PACK, { ...wtOffer(d), speciality: 'Las' });
    assert.ok(d2.talents.some((t) => (t.name ?? t) === 'Weapon Training (Las)'));
    assert.equal(entry.name, 'Weapon Training (Las)');
});

test('different specializations coexist; the SAME one twice is a duplicate', () => {
    let d = doc();
    ({ doc: d } = applyAdvance(d, CHARGEN_PACK, { ...wtOffer(d), speciality: 'Las' }));
    ({ doc: d } = applyAdvance(d, CHARGEN_PACK, { ...wtOffer(d), speciality: 'Bolt' }));
    assert.equal(d.talents.length, 2);
    assert.throws(() => applyAdvance(d, CHARGEN_PACK, { ...wtOffer(d), speciality: 'Bolt' }), /already held/);
});

test('a parenthesized name satisfies the gate too (ledger replay path)', () => {
    const d = doc();
    const { doc: d2 } = applyAdvance(d, CHARGEN_PACK, { ...wtOffer(d), name: 'Weapon Training (Melee)' });
    assert.ok(d2.talents.some((t) => (t.name ?? t) === 'Weapon Training (Melee)'));
});

/* ── DSL prefix semantics, through the live engine ──────────────────────── */

const CR_BASE = 'talent "WT Boon" { on test.MODIFIERS when has_talent("Weapon Training") then add modifier "wt" = 10 }';
const CR_SPEC = 'talent "Las Boon" { on test.MODIFIERS when has_talent("Weapon Training (Las)") then add modifier "las" = 5 }';

const judged = (talents, customRules) => dispatch('POST', '/api/test', {
    target: 40, testName: 'Probe', talents, customRules, forcedRolls: [35],
}).body;

test('DSL: a base-name gate matches EVERY specialization — keyword or user-entered', () => {
    for (const t of ['Weapon Training (Las)', 'Weapon Training (Melee)', 'Weapon Training (Grox Prod)']) {
        assert.equal(judged([t], CR_BASE).modifiedTarget, 50, t);
    }
    assert.equal(judged(['Jaded'], CR_BASE).modifiedTarget, 40, 'no false positives');
});

test('DSL: a full-name gate matches ONLY its own specialization', () => {
    assert.equal(judged(['Weapon Training (Las)'], CR_SPEC).modifiedTarget, 45);
    assert.equal(judged(['Weapon Training (Bolt)'], CR_SPEC).modifiedTarget, 40);
});

test('DSL: user-entered lore-keyed gating works the same way (full-name prefix)', () => {
    const rule = 'talent "Occult Peer" { on test.MODIFIERS when has_talent("Peer (Occult Scholars)") then add modifier "peer" = 10 }';
    assert.equal(judged(['Peer (Occult Scholars)'], rule).modifiedTarget, 50);
    assert.equal(judged(['Peer (Underworld)'], rule).modifiedTarget, 40);
});
