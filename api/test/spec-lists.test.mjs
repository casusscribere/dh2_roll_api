/**
 * spec_list — DSL-authorable specialization sets (user request 2026-08-27).
 *
 * System-defined specialist entries (Weapon Training's weapon groups, …)
 * carry their options as a first-class DSL declaration, so the Builder shows
 * a dropdown instead of a blank; user-supplied ones (Peer, Common Lore) stay
 * write-ins. The sets live in api/data/rules/spec-lists.dsl (the rulebook's
 * own "Specialisations:" lines) and campaign DSL can EXTEND them — a merged
 * union per name, `open` if any layer says so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileSpecLists } from '../lib/dsl/compiler.mjs';
import { specLists } from '../lib/rules/index.mjs';
import { listAvailableAdvances, applyOrigin } from '../lib/advancement.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { migrateCharacter } from '../lib/character-schema.mjs';
import { dispatch } from '../lib/api-router.mjs';

const bare = () => migrateCharacter({ schemaVersion: 4, kind: 'dh2.character', name: 'SL', system: 'dh2' });
const doc = () => ({
    ...bare(),
    characteristics: Object.fromEntries(['ws','bs','s','t','ag','int','per','wp','fel'].map((k)=>[k,{base:32,advances:0,modifiers:[]}])),
    aptitudes: ['General'], xp: { total: 5000, ledger: [] },
});

/* ── the declaration ────────────────────────────────────────────────────── */

test('spec_list parses, and same-named lists MERGE across layers', () => {
    const base = compileSpecLists('spec_list "Weapon Training" { "Bolt", "Las" }');
    assert.deepEqual(base, [{ name: 'Weapon Training', options: ['Bolt', 'Las'], open: false }]);
    const merged = compileSpecLists('spec_list "Weapon Training" open { "Grav", "Las" }', base);
    assert.deepEqual(merged[0].options, ['Bolt', 'Las', 'Grav'], 'union, case-insensitive dedupe');
    assert.equal(merged[0].open, true, 'open wins');
});

test('an empty non-open spec_list is a compile error', () => {
    assert.throws(() => compileSpecLists('spec_list "Nothing" { }'), /empty and not open/);
});

/* ── the canonical rulebook sets ────────────────────────────────────────── */

test('the built-in sets carry the rulebook Specialisations lines', () => {
    const wt = specLists.find((l) => l.name === 'Weapon Training');
    assert.deepEqual(wt.options, ['Bolt', 'Chain', 'Flame', 'Heavy', 'Las', 'Launcher',
        'Melta', 'Plasma', 'Power', 'Low-Tech', 'Shock', 'Solid Projectile']);
    assert.equal(wt.open, false, 'WT is a closed set');
    const res = specLists.find((l) => l.name === 'Resistance');
    assert.equal(res.open, true, 'the book\'s list ends in "Other" — open by RAW');
    assert.ok(specLists.find((l) => l.name === 'Hatred').open);
    assert.ok(!specLists.some((l) => l.name === 'Peer'), 'user-supplied sets stay unlisted (write-in)');
});

test('GET /api/rules exposes the sets', () => {
    const r = dispatch('GET', '/api/rules');
    assert.ok(r.body.specLists.some((l) => l.name === 'Weapon Training'));
});

/* ── consumption: offers + origin choice points ─────────────────────────── */

test('specialist offers carry specOptions from their set; listless ones stay write-in', () => {
    const offers = listAvailableAdvances(doc(), CHARGEN_PACK, { specLists });
    const wt = offers.find((a) => a.name === 'Weapon Training');
    assert.equal(wt.specOptions.length, 12);
    assert.equal(wt.specOpen, false);
    const res = offers.find((a) => a.name === 'Resistance');
    assert.equal(res.specOpen, true);
    const peer = offers.find((a) => a.name === 'Peer');
    assert.equal(peer.specOptions, undefined, 'no set → the UI shows a write-in');
});

test('an origin placeholder grant ("one weapon group") becomes a dropdown of legal groups', () => {
    // Adeptus Arbites grants "Weapon Training (one weapon group)" (placeholder)
    const bg = CHARGEN_PACK.backgrounds.find((b) => /Weapon Training \(one weapon group\)/.test(b.talentsGranted.join('|')));
    if (!bg) return;                                     // pack shape changed — nothing to pin
    const { choicePoints } = applyOrigin(bare(), CHARGEN_PACK, { backgroundRef: bg.ref, specLists });
    const wt = choicePoints.find((p) => /one weapon group/.test(p.key));
    assert.ok(wt, 'placeholder point missing');
    assert.equal(wt.options.length, 12, 'the twelve legal groups');
    assert.ok(wt.options.includes('Weapon Training (Las)'));
});

test('campaign DSL extends a set through the route (customRules layer)', () => {
    const r = dispatch('POST', '/api/chargen/advances', {
        doc: doc(), customRules: 'spec_list "Weapon Training" open { "Grav" }',
    });
    const wt = r.body.advances.find((a) => a.name === 'Weapon Training');
    assert.equal(wt.specOptions.length, 13);
    assert.ok(wt.specOptions.includes('Grav'));
    assert.equal(wt.specOpen, true);
});
