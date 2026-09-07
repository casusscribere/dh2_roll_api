/**
 * Creation-flow validation + ledger replay (user request 2026-08-27; the
 * engine half of the integrated Builder creation panels).
 *
 * validateCreation(doc, pack) → findings[] covering the CREATION process:
 * unselected origin members, unresolved "A or B" choice points, ungenerated
 * characteristics, RAW range violations, unset wounds/fate, fate below the
 * home world's threshold, the Psyker/Untouchable combination. Merged into
 * validateBuild's report as `creation` (D-I stays untouched: `ok` still
 * reflects build errors only — legacy roster docs keep warning, but their
 * missing creation data now SHOWS).
 *
 * replayPurchases(doc, pack, entries) → { doc, conflicts[] } re-buys a ledger
 * against a (possibly re-derived) doc at CURRENT prices — the propagation
 * mechanism when an earlier creation step changes: aptitudes move, costs
 * reprice, and purchases that become illegal surface as conflicts instead of
 * silently vanishing or blocking the rebuild.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    validateCreation, validateBuild, replayPurchases, applyOrigin, applyAdvance,
    applyGrant, listAvailableAdvances, xpSummary,
} from '../lib/advancement.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { migrateCharacter } from '../lib/character-schema.mjs';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';

const bare = () => migrateCharacter({ schemaVersion: 4, kind: 'dh2.character', name: 'Probe', system: 'dh2' });

/** Stats as the rebuild pipeline would have re-applied them before replay. */
const withStats = (doc) => {
    doc.characteristics = Object.fromEntries(
        ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel']
            .map((k) => [k, { base: k === 'wp' ? 40 : 32, advances: 0, modifiers: [] }]));
    doc.influence = 22;
    doc.wounds = { max: 12, current: 12, critical: 0 };
    doc.fate = { max: 2, current: 2 };
    return doc;
};

/** A creation-complete doc: Feral World / Outcast / Desperado, manual stats. */
function completeDoc() {
    let { doc } = applyOrigin(bare(), CHARGEN_PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:desperado',
        choices: { roleTalent: 'Quick Draw', 'Enemy (chosen group)': 'Enforcers' },
    });
    doc.characteristics = Object.fromEntries(
        ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel']
            .map((k) => [k, { base: k === 'wp' ? 40 : 32, advances: 0, modifiers: [] }]));
    doc.influence = 22;
    doc.wounds = { max: 12, current: 12, critical: 0 };
    doc.fate = { max: 2, current: 2 };
    doc.tarot = { text: 'Trust in your fear.' };
    return doc;
}

/* ── validateCreation ───────────────────────────────────────────────────── */

test('a creation-complete doc has no creation findings', () => {
    assert.deepEqual(validateCreation(completeDoc(), CHARGEN_PACK), []);
});

test('unselected origin members are reported one by one', () => {
    const findings = validateCreation(bare(), CHARGEN_PACK).join('; ');
    assert.match(findings, /home world.*not selected/i);
    assert.match(findings, /background.*not selected/i);
    assert.match(findings, /role.*not selected/i);
});

test('an unresolved role talent choice point is reported', () => {
    const { doc } = applyOrigin(bare(), CHARGEN_PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:desperado',                       // no roleTalent choice
    });
    const findings = validateCreation(doc, CHARGEN_PACK).join('; ');
    assert.match(findings, /Catfall or Quick Draw/i);
});

test('ungenerated characteristics, unset wounds/fate and empty divination are reported', () => {
    const { doc } = applyOrigin(bare(), CHARGEN_PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:desperado',
        choices: { roleTalent: 'Quick Draw' },
    });
    const findings = validateCreation(doc, CHARGEN_PACK).join('; ');
    assert.match(findings, /characteristics.*not.*generated/i);
    assert.match(findings, /wounds.*not/i);
    assert.match(findings, /divination/i);
});

test('RAW-method values outside 27–45 are invalid; fate below the home-world threshold is flagged', () => {
    const doc = completeDoc();
    doc.extensions = { builder: { creation: { characteristics: { method: 'raw' } } } };
    doc.characteristics.ag.base = 55;
    doc.fate = { max: 1, current: 1 };                       // feral threshold is 2
    const findings = validateCreation(doc, CHARGEN_PACK).join('; ');
    assert.match(findings, /ag.*55.*27.*45/i);
    assert.match(findings, /fate.*below.*threshold/i);
});

test('holding both Psyker and Untouchable elite advances is an invalid combination', () => {
    const doc = completeDoc();
    doc.origin.eliteAdvances = [{ name: 'Psyker' }, { name: 'Untouchable' }];
    assert.match(validateCreation(doc, CHARGEN_PACK).join('; '), /Psyker.*Untouchable/i);
});

test('the /api/chargen/validate route carries the creation findings (validateBuild contract untouched)', async () => {
    const { dispatch } = await import('../lib/api-router.mjs');
    const legacy = structuredClone(CHARACTER_ROSTER[0].doc);
    const r = dispatch('POST', '/api/chargen/validate', { doc: legacy });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.creation));
    assert.match(r.body.creation.join('; '), /home world.*not selected/i);
    // the library report itself is unchanged — its many pin tests rely on it
    assert.ok(!('creation' in validateBuild(migrateCharacter(legacy), CHARGEN_PACK)));
});

/* ── grantKind rides the ledger (faithful replay) ───────────────────────── */

test('applyGrant records grantKind so trait/aptitude grants replay as themselves', () => {
    const { doc, entry } = applyGrant(completeDoc(), CHARGEN_PACK,
        { kind: 'trait', name: 'Sturdy' }, { source: 'manual override' });
    assert.equal(entry.grantKind, 'trait');
    assert.equal(doc.xp.ledger.at(-1).grantKind, 'trait');
});

/* ── replayPurchases ────────────────────────────────────────────────────── */

test('a ledger replays cleanly onto the same origin: same mechanics, same costs', () => {
    let doc = completeDoc();
    doc.xp = { total: 1000, ledger: [] };
    const buy = (find) => {
        const a = listAvailableAdvances(doc, CHARGEN_PACK).find(find);
        ({ doc } = applyAdvance(doc, CHARGEN_PACK, a, { source: 'Creation' }));
    };
    buy((a) => a.kind === 'characteristic' && a.ref === 'ag');          // 100 (Ag+Finesse held)
    buy((a) => a.kind === 'skill' && a.name === 'Dodge' && a.rank === 1); // 100
    buy((a) => a.kind === 'talent' && a.name === 'Jaded');              // 300 (Defence)
    const entries = doc.xp.ledger;

    const base = completeDoc();
    base.xp = { total: 1000, ledger: [] };
    const { doc: replayed, conflicts } = replayPurchases(base, CHARGEN_PACK, entries);
    assert.deepEqual(conflicts, []);
    assert.equal(replayed.characteristics.ag.advances, 1);
    assert.equal(replayed.skills.Dodge.advances, 1);
    assert.ok(replayed.talents.some((t) => (t.name ?? t) === 'Jaded'));
    assert.equal(xpSummary(replayed).spent, 500);
    assert.ok(replayed.xp.ledger.every((e) => e.source === 'Creation'));
});

test('changing the origin REPRICES the replay: lost aptitudes raise costs', () => {
    let doc = completeDoc();
    doc.xp = { total: 1000, ledger: [] };
    const ag = listAvailableAdvances(doc, CHARGEN_PACK).find((a) => a.kind === 'characteristic' && a.ref === 'ag');
    assert.equal(ag.cost, 100);                              // Desperado: Agility + Finesse
    ({ doc } = applyAdvance(doc, CHARGEN_PACK, ag, { source: 'Creation' }));

    // re-derive with a role that grants NEITHER Agility nor Finesse
    const { doc: newOrigin } = applyOrigin(bare(), CHARGEN_PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:chirurgeon',
    });
    withStats(newOrigin);
    newOrigin.xp = { total: 1000, ledger: [] };
    const { doc: replayed, conflicts } = replayPurchases(newOrigin, CHARGEN_PACK, doc.xp.ledger);
    assert.deepEqual(conflicts, []);
    assert.equal(replayed.characteristics.ag.advances, 1, 'the purchase itself survives');
    assert.equal(replayed.xp.ledger[0].cost, 500, 'repriced at 0 aptitude matches');
});

test('a purchase that becomes a duplicate of a new origin grant surfaces as a conflict, not a crash', () => {
    let doc = completeDoc();
    doc.xp = { total: 1000, ledger: [] };
    const qd = listAvailableAdvances(doc, CHARGEN_PACK).find((a) => a.kind === 'talent' && a.name === 'Catfall');
    ({ doc } = applyAdvance(doc, CHARGEN_PACK, qd, { source: 'Creation' }));

    // new origin GRANTS Catfall via the role talent choice → the buy is now a dup
    const { doc: newOrigin } = applyOrigin(bare(), CHARGEN_PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:desperado',
        choices: { roleTalent: 'Catfall' },
    });
    withStats(newOrigin);
    newOrigin.xp = { total: 1000, ledger: [] };
    const { doc: replayed, conflicts } = replayPurchases(newOrigin, CHARGEN_PACK, doc.xp.ledger);
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0], /Catfall/);
    assert.equal(xpSummary(replayed).spent, 0, 'the conflicted purchase is not silently charged');
});

test('elite-advance grant echoes are skipped on replay (the EA re-applies them itself)', () => {
    let doc = completeDoc();
    doc.characteristics.wp.base = 42;
    doc.xp = { total: 1000, ledger: [] };
    const ea = listAvailableAdvances(doc, CHARGEN_PACK).find((a) => a.kind === 'elite_advance' && a.name === 'Psyker');
    ({ doc } = applyAdvance(doc, CHARGEN_PACK, ea, { source: 'Creation' }));
    const grantCount = doc.xp.ledger.filter((e) => e.source === 'Elite Advance: Psyker').length;
    assert.ok(grantCount >= 4, 'fixture assumption');

    const base = completeDoc();
    base.characteristics.wp.base = 42;
    base.xp = { total: 1000, ledger: [] };
    const { doc: replayed, conflicts } = replayPurchases(base, CHARGEN_PACK, doc.xp.ledger);
    assert.deepEqual(conflicts, []);
    assert.equal(replayed.psy.rating, 1);
    assert.equal(replayed.xp.ledger.filter((e) => e.source === 'Elite Advance: Psyker').length,
        grantCount, 'grants regenerated exactly once, not doubled');
});
