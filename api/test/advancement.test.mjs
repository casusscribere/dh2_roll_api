/**
 * Advancement engine (Task CB-2): aptitude matching (General always held),
 * cost lookups against the real chargen pack (Tables 2-2/2-4/2-6, corpus
 * advancement.json), prerequisite gating (warn-and-confirm), atomic
 * applyAdvance (mechanical change + typed ledger entry), applyOrigin chargen
 * grants with choice points, validateBuild reconciliation (D-I), and the
 * /api/chargen/* dispatch routes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCharacter, validateCharacter } from '../lib/character-schema.mjs';
import { CHARGEN_PACK as PACK } from '../data/chargen/pack.mjs';
import {
    aptitudeMatches, advanceCost, xpSummary, checkPrerequisites,
    listAvailableAdvances, applyAdvance, applyOrigin, validateBuild,
} from '../lib/advancement.mjs';
import { dispatch } from '../lib/api-router.mjs';

const mk = (aptitudes = [], xpTotal = 1000) => {
    const d = emptyCharacter('Adv Test');
    d.aptitudes = aptitudes.map((name) => ({ name, source: 'extra' }));
    d.xp = { total: xpTotal, ledger: [] };
    return d;
};

test('aptitude matching: General is always held; duplicates never double-count', () => {
    const d = mk(['Weapon Skill']);
    assert.equal(aptitudeMatches(d, ['Weapon Skill', 'Offence']), 1);
    assert.equal(aptitudeMatches(d, ['Agility', 'General']), 1);           // General for free
    assert.equal(aptitudeMatches(mk(['Offence', 'Weapon Skill']), ['Weapon Skill', 'Offence']), 2);
    d.aptitudes.push({ name: 'Weapon Skill', source: 'role' });            // duplicate held
    assert.equal(aptitudeMatches(d, ['Weapon Skill', 'Offence']), 1);
});

test('advanceCost: rulebook table lookups (values from corpus advancement.json)', () => {
    const c = PACK.costs;
    assert.equal(advanceCost(PACK, { kind: 'characteristic', matches: 2, rank: 1 }), c.characteristic.matches_2[0]);
    assert.equal(advanceCost(PACK, { kind: 'characteristic', matches: 0, rank: 5 }), c.characteristic.matches_0[4]);
    assert.equal(advanceCost(PACK, { kind: 'skill', matches: 1, rank: 2 }), c.skill.matches_1[1]);
    assert.equal(advanceCost(PACK, { kind: 'talent', matches: 2, tier: 1 }), c.talent.tier_1.matches_2);
    assert.equal(advanceCost(PACK, { kind: 'psy_rating', rank: 3 }), 600); // 200 × new rating
    assert.equal(advanceCost(PACK, { kind: 'elite_advance', cost: 750 }), 750);
    assert.throws(() => advanceCost(PACK, { kind: 'characteristic', matches: 2, rank: 6 }), /rank/);
    assert.throws(() => advanceCost(PACK, { kind: 'characteristic', matches: 3, rank: 1 }), /matches/);
    assert.throws(() => advanceCost(PACK, { kind: 'talent', matches: 0, tier: 4 }), /tier/);
});

test('checkPrerequisites: characteristic thresholds, psy rating, talents, "or", prose', () => {
    const d = mk();
    d.characteristics.ag = { base: 35, advances: 0, modifiers: [] };
    d.talents = ['Ambidextrous'];
    assert.deepEqual(checkPrerequisites(d, ['Ag 30']), { met: true, problems: [] });
    assert.equal(checkPrerequisites(d, ['Ag 40']).met, false);
    assert.equal(checkPrerequisites(d, ['Ambidextrous']).met, true);
    assert.equal(checkPrerequisites(d, ['Ag 40 or Ambidextrous']).met, true);   // alternative held
    d.psy = { rating: 2, class: 'bound', sustained: 0 };
    assert.equal(checkPrerequisites(d, ['Psy Rating 2']).met, true);
    const prose = checkPrerequisites(d, ['Approval of the Inquisitor']);
    assert.equal(prose.met, true);                                         // warn-and-confirm, never block
    assert.match(prose.problems[0], /unverified/);
});

test('listAvailableAdvances: costed, affordability-flagged, rank-sequential', () => {
    const d = mk(['Weapon Skill', 'Offence'], 300);
    const list = listAvailableAdvances(d, PACK);
    const ws = list.find((a) => a.kind === 'characteristic' && a.ref === 'ws');
    assert.equal(ws.rank, 1);
    assert.equal(ws.matches, 2);
    assert.equal(ws.cost, PACK.costs.characteristic.matches_2[0]);
    assert.equal(ws.affordable, true);
    const expensive = list.filter((a) => a.cost > 300);
    assert.ok(expensive.length > 0 && expensive.every((a) => !a.affordable));
    const jaded = list.find((a) => a.kind === 'talent' && a.name === 'Jaded');
    assert.ok(jaded, 'corpus talent offered');
    assert.ok(list.some((a) => a.kind === 'skill' && /new speciality/.test(a.name)));
    assert.ok(!list.some((a) => a.kind === 'psy_rating'), 'non-psyker gets no psy advances');
});

test('applyAdvance: atomic (counts + typed ledger), XP-gated, no rank skipping, no duplicates', () => {
    const d = mk(['Weapon Skill', 'Offence'], 1000);
    d.characteristics.wp = { base: 40, advances: 0, modifiers: [] };   // meets Jaded's "WP 40"
    const list = listAvailableAdvances(d, PACK);
    const ws1 = list.find((a) => a.kind === 'characteristic' && a.ref === 'ws');
    const { doc: d2, entry } = applyAdvance(d, PACK, ws1);
    assert.equal(d.characteristics.ws.advances, 0, 'input untouched');
    assert.equal(d2.characteristics.ws.advances, 1);
    assert.deepEqual({ kind: entry.kind, ref: entry.ref, rank: entry.rank, matches: entry.matches, cost: entry.cost },
        { kind: 'characteristic', ref: 'ws', rank: 1, matches: 2, cost: ws1.cost });
    assert.equal(xpSummary(d2).spent, ws1.cost);
    assert.ok(validateCharacter(d2).ok);

    // rank skipping rejected
    assert.throws(() => applyAdvance(d, PACK, { ...ws1, rank: 2 }), /skips/);
    // insufficient XP rejected
    const broke = mk([], 0);
    assert.throws(() => applyAdvance(broke, PACK, ws1), /insufficient XP/);
    // duplicate talent rejected; unmet parsed prereqs gate unless confirmed
    const jaded = listAvailableAdvances(d2, PACK).find((a) => a.name === 'Jaded');
    const { doc: d3 } = applyAdvance(d2, PACK, jaded);
    assert.ok(d3.talents.some((t) => t.name === 'Jaded' && t.ref === 'dh2:talent:jaded'));
    assert.throws(() => applyAdvance(d3, PACK, jaded), /already held/);
    const gated = { kind: 'talent', ref: 'dh2:talent:x', name: 'X', tier: 1, matches: 0, cost: 100, prereqsMet: false, prereqProblems: ['unmet prerequisite: "Ag 40"'] };
    assert.throws(() => applyAdvance(d3, PACK, gated), /prerequisites unmet/);
    const { doc: d4 } = applyAdvance(d3, PACK, gated, { confirmed: true });
    assert.ok(d4.talents.some((t) => t.name === 'X'), 'confirmed override');
});

test('applyAdvance: specialist skill needs a speciality; psy rating needs a psyker path', () => {
    const d = mk([], 1000);
    const list = listAvailableAdvances(d, PACK);
    const newSpec = list.find((a) => a.kind === 'skill' && /Scholastic Lore/.test(a.name) && a.speciality === null);
    assert.throws(() => applyAdvance(d, PACK, newSpec), /speciality/);
    const { doc: d2 } = applyAdvance(d, PACK, { ...newSpec, speciality: 'Occult', name: 'Scholastic Lore' });
    assert.equal(d2.skills['Scholastic Lore'].specialities.Occult.advances, 1);
});

test('applyOrigin: hand-computed starting character (Feral World / Outcast / Assassin)', () => {
    const d = emptyCharacter('Origin Test');
    const res = applyOrigin(d, PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:assassin',
        choices: { roleTalent: 'Leap Up' },
    });
    const o = res.doc;
    assert.equal(o.origin.homeworld.ref, 'dh2:home_world:feral_world');
    assert.equal(o.fate.max, 2);                                          // Feral World fate threshold
    assert.equal(res.emperorsBlessing, 3);
    assert.equal(res.woundsFormula, '9+1d5');
    assert.ok(o.aptitudes.some((a) => a.name === 'Toughness' && a.source === 'homeworld'));
    assert.ok(o.aptitudes.some((a) => a.source === 'background'));
    assert.ok(o.talents.some((t) => t.name === 'Leap Up'));
    assert.equal(o.xp.total, PACK.startingXp);
    // "X or Y" role aptitudes surface as choices when unanswered
    assert.ok(res.choicesNeeded.some((c) => c.kind === 'aptitude' && c.options.length === 2));
    assert.ok(validateCharacter(o).ok, JSON.stringify(validateCharacter(o).errors));
});

test('validateBuild: fully-typed ledgers reconcile exactly (errors); legacy docs warn only', () => {
    const d = mk(['Weapon Skill', 'Offence'], 1000);
    const ws1 = listAvailableAdvances(d, PACK).find((a) => a.ref === 'ws');
    const { doc: good } = applyAdvance(d, PACK, ws1);
    assert.ok(validateBuild(good, PACK).ok);

    const broken = structuredClone(good);
    broken.characteristics.ws.advances = 3;                               // counts drifted from ledger
    const r1 = validateBuild(broken, PACK);
    assert.equal(r1.ok, false, 'typed ledger mismatch is an error');

    broken.xp.ledger.push({ name: 'mystery import', cost: 0 });           // untyped entry → legacy doc
    const r2 = validateBuild(broken, PACK);
    assert.equal(r2.ok, true, 'legacy docs warn, never error');
    assert.ok(r2.warnings.length > 0);

    const over = mk([], 100);
    over.xp.ledger.push({ name: 'too much', cost: 500 });
    assert.equal(validateBuild(over, PACK).ok, false, 'overspend always errors');
});

test('dispatch routes: /api/chargen/advances, /advance, /origin, /validate', async () => {
    const doc = mk(['Weapon Skill', 'Offence'], 1000);
    const list = await dispatch('POST', '/api/chargen/advances', { doc });
    assert.equal(list.status, 200);
    assert.ok(list.body.advances.length > 0);
    assert.equal(list.body.xp.remaining, 1000);

    const ws1 = list.body.advances.find((a) => a.ref === 'ws');
    const buy = await dispatch('POST', '/api/chargen/advance', { doc, advance: ws1 });
    assert.equal(buy.status, 200);
    assert.equal(buy.body.doc.characteristics.ws.advances, 1);
    assert.equal(buy.body.xp.spent, ws1.cost);

    const origin = await dispatch('POST', '/api/chargen/origin', { doc, homeworldRef: 'dh2:home_world:hive_world' });
    assert.equal(origin.status, 200);
    assert.equal(origin.body.doc.origin.homeworld.name, 'Hive World');

    const val = await dispatch('POST', '/api/chargen/validate', { doc: buy.body.doc });
    assert.equal(val.status, 200);
    assert.equal(val.body.ok, true);

    const bad = await dispatch('POST', '/api/chargen/advance', { doc, advance: { ...ws1, rank: 4 } });
    assert.equal(bad.status, 400);
});
