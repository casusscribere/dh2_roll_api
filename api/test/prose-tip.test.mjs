/**
 * ST-2 (Phase 4, E-5): prose hover cards — the RESOLVER, headless.
 *
 * ui/prose-tip.mjs is DOM-free at the top (resolveTip / formatCitation /
 * packEntryByRef); the hover panel lives behind mount(), which these tests
 * never call. The resolver merges three sources in priority order:
 *   1. the prose overlay (GET /api/prose — verbatim text, local builds only);
 *   2. ST-4 in-doc description/citation on CUSTOM entries;
 *   3. the pack's public citation facts (always present).
 * On the public Pages build the overlay reports available:false and the card
 * degrades to citation + "text available in local builds" — decision D-N.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTip, formatCitation, packEntryByRef } from '../../ui/prose-tip.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { loadProseOverlay } from '../lib/prose.mjs';

const CITE = { book: 'Core Rulebook', page: 124, source: 'src_dh2_core_p125' };
const OVERLAY = { available: true, count: 1, prose: { 'dh2:talent:catfall': { text: 'Fall softly.', citation: CITE } } };
const NO_OVERLAY = { available: false, count: 0, prose: {} };

test('canon ref with the overlay available → verbatim text + formatted citation, no hint', () => {
    const tip = resolveTip('dh2:talent:catfall', { prose: OVERLAY, pack: CHARGEN_PACK });
    assert.equal(tip.text, 'Fall softly.');
    assert.equal(tip.citation, 'Core Rulebook p.124');
    assert.equal(tip.hint, null);
});

test('canon ref, overlay unavailable → no text, pack citation, the local-builds hint', () => {
    const tip = resolveTip('dh2:talent:jaded', { prose: NO_OVERLAY, pack: CHARGEN_PACK });
    assert.equal(tip.text, null);
    assert.match(tip.citation, /^Core Rulebook/);
    assert.equal(tip.hint, 'text available in local builds');
});

test('custom entry with in-doc description → its text and its citation, no hint, no ref resolution', () => {
    const tip = resolveTip(
        { name: 'House Talent', description: 'My homebrew text.', citation: { book: 'House Rules', page: null } },
        { prose: NO_OVERLAY, pack: CHARGEN_PACK });
    assert.equal(tip.text, 'My homebrew text.');
    assert.equal(tip.citation, 'House Rules');
    assert.equal(tip.hint, null);
});

test('a canon BY-REF entry object resolves through its ref', () => {
    const tip = resolveTip({ name: 'Catfall', ref: 'dh2:talent:catfall' },
        { prose: OVERLAY, pack: CHARGEN_PACK });
    assert.equal(tip.text, 'Fall softly.');
});

test('unknown ref → all nulls', () => {
    assert.deepEqual(resolveTip('dh2:talent:no_such_thing', { prose: NO_OVERLAY, pack: CHARGEN_PACK }),
        { text: null, citation: null, hint: null });
    assert.deepEqual(resolveTip('', { prose: OVERLAY, pack: CHARGEN_PACK }),
        { text: null, citation: null, hint: null });
});

test('formatCitation: page and page-less forms; nulls stay null', () => {
    assert.equal(formatCitation(CITE), 'Core Rulebook p.124');
    assert.equal(formatCitation({ book: 'Enemies Without', page: null }), 'Enemies Without');
    assert.equal(formatCitation(null), null);
    assert.equal(formatCitation({}), null);
});

test('packEntryByRef finds entries across every citation-bearing pack list', () => {
    assert.equal(packEntryByRef(CHARGEN_PACK, 'dh2:talent:jaded')?.name, 'Jaded');
    assert.equal(packEntryByRef(CHARGEN_PACK, 'dh2:home_world:feral_world')?.name, 'Feral World');
    assert.equal(packEntryByRef(CHARGEN_PACK, 'dh2:elite_advance:psyker')?.name, 'Psyker');
    assert.equal(packEntryByRef(CHARGEN_PACK, 'dh2:skill:dodge')?.name, 'Dodge');
    assert.equal(packEntryByRef(CHARGEN_PACK, 'nope:nope:nope'), null);
});

test('the REAL local overlay (when present) resolves a canon talent with matching citation', async () => {
    const prose = await loadProseOverlay();
    if (!prose.available) return;                    // CI / fresh clone: cite-only, covered above
    const tip = resolveTip('dh2:talent:catfall', { prose, pack: CHARGEN_PACK });
    assert.ok(tip.text && tip.text.length > 50, 'verbatim paragraph expected');
    assert.equal(tip.citation, 'Core Rulebook p.124');
    assert.equal(tip.hint, null);
});

test('refForName: exact and parenthetical-stripped lookups for bare-string roster entries', async () => {
    const { refForName } = await import('../../ui/prose-tip.mjs');
    assert.equal(refForName(CHARGEN_PACK, 'Jaded'), 'dh2:talent:jaded');
    assert.equal(refForName(CHARGEN_PACK, 'jaded'), 'dh2:talent:jaded');
    assert.equal(refForName(CHARGEN_PACK, 'Weapon Training (Las)'),
        refForName(CHARGEN_PACK, 'Weapon Training'), 'specialist base match');
    assert.equal(refForName(CHARGEN_PACK, 'No Such Talent At All'), null);
});
