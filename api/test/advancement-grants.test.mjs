/**
 * Elite-advance grants, prerequisite coverage, manual overrides, and ledger
 * source notes (user request 2026-08-26; extends CB-2's advancement engine).
 *
 * 1. checkPrerequisites understands the EA-entry vocabularies: "Influence 50",
 *    "<X> elite advance", "<X> background" (talent-name and characteristic
 *    thresholds were already covered).
 * 2. Talents carrying `eliteAdvance` are hidden from the advance list until
 *    that EA is held (core p.86 "unlocked advances").
 * 3. Buying an EA applies its `instantChanges` as 0-XP ledger grants with a
 *    source note ("Elite Advance: <name>") — core p.86 "instant changes".
 * 4. applyGrant is the override door: anything can be added with prereqs
 *    ignored, and the source note says so.
 * 5. Every applyAdvance ledger entry now carries a `source` note.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    checkPrerequisites, eliteGrants, applyGrant, applyAdvance, listAvailableAdvances,
} from '../lib/advancement.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { dispatch } from '../lib/api-router.mjs';

const PSYKER_EA = CHARGEN_PACK.eliteAdvances.find((e) => e.id === 'psyker');
const SOB_EA = CHARGEN_PACK.eliteAdvances.find((e) => e.id === 'sister_of_battle');

/** A doc rich enough to buy the psyker EA. */
const psykerReady = (xp = 2000) => ({
    schemaVersion: 4, kind: 'dh2.character', name: 'Probe', system: 'dh2',
    characteristics: { ws: 30, bs: 30, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 42, fel: 30 },
    influence: 30, aptitudes: ['General'], talents: [], traits: [],
    origin: { homeworld: null, background: null, role: null, eliteAdvances: [] },
    xp: { total: xp, ledger: [] },
});

const eaAdvance = (doc, id) =>
    listAvailableAdvances(doc, CHARGEN_PACK).find((a) => a.kind === 'elite_advance' && a.ref.endsWith(id));

/* ── 1. prerequisite vocabularies ───────────────────────────────────────── */

test('prereqs: "Influence 50" checks the influence scalar', () => {
    const doc = psykerReady();
    doc.influence = 50;
    assert.equal(checkPrerequisites(doc, ['Influence 50']).met, true);
    doc.influence = 49;
    const r = checkPrerequisites(doc, ['Influence 50']);
    assert.equal(r.met, false);
    assert.match(r.problems[0], /unmet/);
});

test('prereqs: "<X> elite advance" checks origin.eliteAdvances', () => {
    const doc = psykerReady();
    assert.equal(checkPrerequisites(doc, ['Psyker elite advance']).met, false);
    doc.origin.eliteAdvances.push({ name: 'Psyker', ref: 'dh2:elite_advance:psyker' });
    assert.equal(checkPrerequisites(doc, ['Psyker elite advance']).met, true);
});

test('prereqs: "<X> background" checks origin.background', () => {
    const doc = psykerReady();
    assert.equal(checkPrerequisites(doc, ['Adepta Sororitas Background']).met, false);
    doc.origin.background = { name: 'Adepta Sororitas' };
    assert.equal(checkPrerequisites(doc, ['Adepta Sororitas Background']).met, true);
});

test('prereqs: the sister_of_battle EA gates on all three vocabularies at once', () => {
    const doc = psykerReady();
    doc.influence = 50;
    doc.origin.background = { name: 'Adepta Sororitas' };
    const a = eaAdvance(doc, 'sister_of_battle');
    assert.equal(a.prereqsMet, true, JSON.stringify(a.prereqProblems));
    assert.equal(a.cost, SOB_EA.xpCost);
});

test('prereqs: "No <X> elite advance" blocks in the negative direction (A Void in the Warp)', () => {
    const doc = psykerReady();
    let a = eaAdvance(doc, 'psyker');
    assert.equal(a.prereqsMet, true, JSON.stringify(a.prereqProblems));
    doc.origin.eliteAdvances.push({ name: 'Untouchable', ref: 'dh2:elite_advance:untouchable' });
    a = eaAdvance(doc, 'psyker');
    assert.equal(a.prereqsMet, false, 'an Untouchable took the Psyker EA');
    assert.match(a.prereqProblems.join(';'), /Untouchable/);
});

/* ── 2. EA-gated talents ────────────────────────────────────────────────── */

test('EA-unlocked talents are hidden until the elite advance is held', () => {
    const doc = psykerReady();
    const listed = () => listAvailableAdvances(doc, CHARGEN_PACK)
        .filter((a) => a.kind === 'talent' && a.name === 'Blessed Martyrdom');
    assert.equal(listed().length, 0, 'gated talent offered without its EA');
    doc.origin.eliteAdvances.push({ name: 'Sister of Battle', ref: SOB_EA.ref });
    assert.equal(listed().length, 1, 'gated talent missing after the EA is held');
});

/* ── 3. EA purchase applies instant changes as 0-XP grants ──────────────── */

test('eliteGrants parses the psyker instantChanges into structured grants', () => {
    const grants = eliteGrants(PSYKER_EA);
    assert.equal(grants.find((g) => g.kind === 'trait')?.name, 'Psyker');
    assert.equal(grants.find((g) => g.kind === 'aptitude')?.name, 'Psyker');
    assert.equal(grants.find((g) => g.kind === 'psy_rating')?.rating, 1);
    assert.equal(grants.filter((g) => g.kind === 'note').length, 2);   // exclusion + rogue clause
    assert.ok(grants.every((g) => g.raw), 'each grant keeps its source bullet');
});

test('buying the Psyker EA grants trait/aptitude/psy rating at 0 XP with EA source notes', () => {
    const doc = psykerReady();
    const { doc: d } = applyAdvance(doc, CHARGEN_PACK, eaAdvance(doc, 'psyker'));
    assert.ok(d.origin.eliteAdvances.some((e) => e.name === 'Psyker'));
    assert.ok(d.traits.some((t) => (t.name ?? t) === 'Psyker'), 'Psyker trait not granted');
    assert.ok(d.aptitudes.some((a) => (a.name ?? a) === 'Psyker'), 'Psyker aptitude not granted');
    assert.equal(d.psy.rating, 1, 'psy rating not granted');

    const ledger = d.xp.ledger;
    assert.equal(ledger[0].name, 'Psyker');
    assert.equal(ledger[0].cost, 300);
    const grants = ledger.slice(1);
    assert.ok(grants.length >= 4, JSON.stringify(ledger));
    for (const g of grants) {
        assert.equal(g.cost, 0, `grant not 0 XP: ${JSON.stringify(g)}`);
        assert.equal(g.source, 'Elite Advance: Psyker');
    }
});

test('after buying the Psyker EA, psy rating advances unlock at 200 × new rating', () => {
    const doc = psykerReady();
    const { doc: d } = applyAdvance(doc, CHARGEN_PACK, eaAdvance(doc, 'psyker'));
    const pr = listAvailableAdvances(d, CHARGEN_PACK).find((a) => a.kind === 'psy_rating');
    assert.ok(pr, 'psy rating advance not offered');
    assert.equal(pr.rank, 2);
    assert.equal(pr.cost, 400);
});

/* ── 4. the manual override door ────────────────────────────────────────── */

test('applyGrant adds a talent with prereqs ignored, 0 XP, and the override marked in source', () => {
    const doc = psykerReady();
    // Jaded needs WP 40 — give an override doc that FAILS it, to prove bypass
    doc.characteristics.wp = 30;
    const { doc: d, entry } = applyGrant(doc, CHARGEN_PACK,
        { kind: 'talent', name: 'Jaded', ref: 'dh2:talent:jaded' }, { source: 'manual override' });
    assert.ok(d.talents.some((t) => (t.name ?? t) === 'Jaded'));
    assert.equal(entry.cost, 0);
    assert.match(entry.source, /manual override/);
    assert.equal(doc.talents.length, 0, 'input doc mutated');
});

test('applyGrant covers traits, skill ranks and psy rating', () => {
    let d = psykerReady();
    ({ doc: d } = applyGrant(d, CHARGEN_PACK, { kind: 'trait', name: 'Soul Bound' }, { source: 'manual override' }));
    ({ doc: d } = applyGrant(d, CHARGEN_PACK, { kind: 'skill', name: 'Dodge', rank: 2 }, { source: 'manual override' }));
    ({ doc: d } = applyGrant(d, CHARGEN_PACK, { kind: 'skill', name: 'Common Lore', speciality: 'Imperium', rank: 1 }, { source: 'manual override' }));
    ({ doc: d } = applyGrant(d, CHARGEN_PACK, { kind: 'psy_rating', rating: 3 }, { source: 'manual override' }));
    assert.ok(d.traits.some((t) => (t.name ?? t) === 'Soul Bound'));
    assert.equal(d.skills.Dodge.advances, 2);
    assert.equal(d.skills['Common Lore'].specialities.Imperium.advances, 1);
    assert.equal(d.psy.rating, 3);
    assert.equal(d.xp.ledger.length, 4);
    assert.ok(d.xp.ledger.every((e) => e.cost === 0 && /manual override/.test(e.source)));
});

test('applyAdvance with override:true bypasses an unmet prerequisite and notes it', () => {
    const doc = psykerReady();
    doc.characteristics.wp = 30;                      // Jaded needs WP 40
    const jaded = listAvailableAdvances(doc, CHARGEN_PACK)
        .find((a) => a.kind === 'talent' && a.name === 'Jaded');
    assert.equal(jaded.prereqsMet, false, 'fixture assumption');
    assert.throws(() => applyAdvance(doc, CHARGEN_PACK, jaded), /prerequisites unmet/);
    const { doc: d, entry } = applyAdvance(doc, CHARGEN_PACK, jaded, { override: true });
    assert.ok(d.talents.some((t) => (t.name ?? t) === 'Jaded'));
    assert.equal(entry.cost, jaded.cost, 'override still pays the normal XP cost');
    assert.match(entry.source, /manual override/);
});

/* ── 5. source notes on every purchase ──────────────────────────────────── */

test('applyAdvance ledger entries carry a source note (default and caller-supplied)', () => {
    const doc = psykerReady();
    const ag = listAvailableAdvances(doc, CHARGEN_PACK).find((a) => a.kind === 'characteristic' && a.ref === 'ag');
    const { entry: e1 } = applyAdvance(doc, CHARGEN_PACK, ag);
    assert.equal(e1.source, 'Advancement');
    const { entry: e2 } = applyAdvance(doc, CHARGEN_PACK, ag, { source: 'Creation' });
    assert.equal(e2.source, 'Creation');
});

/* ── the route ──────────────────────────────────────────────────────────── */

test('POST /api/chargen/grant applies a grant through dispatch', () => {
    const r = dispatch('POST', '/api/chargen/grant', {
        doc: psykerReady(),
        grant: { kind: 'talent', name: 'Jaded', ref: 'dh2:talent:jaded' },
        source: 'manual override',
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.doc.talents.some((t) => (t.name ?? t) === 'Jaded'));
    assert.equal(r.body.entry.cost, 0);
    assert.match(r.body.entry.source, /manual override/);
});
