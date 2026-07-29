/**
 * CB-3 builder logic (headless): ui/builder-core.mjs drives the exact
 * /api/chargen/* calls the Builder page makes, here wired straight into
 * dispatch. The page is a thin renderer over this module, so these tests are
 * the builder's behavioural contract (undo, grouping, export) without a DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../lib/api-router.mjs';
import { BuilderSession, groupAdvances } from '../../ui/builder-core.mjs';
import { migrateCharacter, validateCharacter } from '../lib/character-schema.mjs';

/** api adapter with the page's contract: parsed body on 2xx, throw otherwise. */
async function api(method, path, body) {
    const r = dispatch(method, path, body);
    if (r.status >= 400) throw new Error(r.body?.error ?? `HTTP ${r.status}`);
    return r.body;
}

function freshDoc() {
    return {
        schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: 'Builder Test',
        characteristics: { ws: 30, bs: 35, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 40, fel: 30 },
        aptitudes: ['General', 'Ballistic Skill', 'Finesse'],
        xp: { total: 1000, ledger: [] }
    };
}

test('groupAdvances buckets by kind and splits talents by tier', () => {
    const advances = [
        { kind: 'characteristic', ref: 'ws', name: 'WS advance 1', cost: 500 },
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', cost: 300 },
        { kind: 'talent', ref: 'dh2:talent:jaded', name: 'Jaded', tier: 1, cost: 200 },
        { kind: 'talent', ref: 'dh2:talent:mighty_shot', name: 'Mighty Shot', tier: 2, cost: 400 },
        { kind: 'elite_advance', ref: 'dh2:elite_advance:psyker', name: 'Psyker', cost: 300 }
    ];
    const groups = groupAdvances(advances);
    const labels = groups.map(g => g.label);
    assert.ok(labels.includes('Characteristics'));
    assert.ok(labels.includes('Skills'));
    assert.ok(labels.includes('Talents — Tier 1'));
    assert.ok(labels.includes('Talents — Tier 2'));
    assert.ok(labels.includes('Elite Advances'));
    const t1 = groups.find(g => g.label === 'Talents — Tier 1');
    assert.deepEqual(t1.entries.map(e => e.name), ['Jaded']);
});

test('session.load populates advances and xp summary', async () => {
    const s = new BuilderSession({ doc: freshDoc(), api });
    await s.load();
    assert.equal(s.xp.remaining, 1000);
    assert.ok(s.advances.length > 0);
    assert.ok(s.advances.some(a => a.kind === 'characteristic'));
});

test('session.buy applies an advance: doc mutates, ledger grows, xp drops, list refreshes', async () => {
    const s = new BuilderSession({ doc: freshDoc(), api });
    await s.load();
    const bs1 = s.advances.find(a => a.kind === 'characteristic' && a.ref === 'bs');
    assert.ok(bs1.affordable);
    await s.buy(bs1);
    assert.equal(s.doc.characteristics.bs.advances, 1);
    assert.equal(s.doc.xp.ledger.length, 1);
    assert.equal(s.xp.remaining, 1000 - bs1.cost);
    // list refreshed: the same ref now offers rank 2
    const bs2 = s.advances.find(a => a.kind === 'characteristic' && a.ref === 'bs');
    assert.equal(bs2.rank, 2);
});

test('session.buy rejects an unaffordable advance and leaves the doc untouched', async () => {
    const doc = freshDoc();
    doc.xp.total = 0;
    const s = new BuilderSession({ doc, api });
    await s.load();
    const any = s.advances.find(a => a.kind === 'characteristic');
    const before = JSON.stringify(s.doc);
    await assert.rejects(() => s.buy(any));
    assert.equal(JSON.stringify(s.doc), before);
});

test('session.undoLast restores the exact pre-purchase doc', async () => {
    const s = new BuilderSession({ doc: freshDoc(), api });
    await s.load();
    const snapshot = JSON.stringify(s.doc);
    const adv = s.advances.find(a => a.affordable && a.prereqsMet);
    await s.buy(adv);
    assert.notEqual(JSON.stringify(s.doc), snapshot);
    assert.equal(s.canUndo, true);
    await s.undoLast();
    assert.equal(JSON.stringify(s.doc), snapshot);
    assert.equal(s.canUndo, false);
    assert.equal(s.xp.remaining, 1000);
});

test('session.grantTrait writes a {name, ref} trait with no ledger entry', async () => {
    const s = new BuilderSession({ doc: freshDoc(), api });
    await s.load();
    await s.grantTrait({ name: 'Dark-sight', ref: 'dh2:trait:dark_sight' });
    assert.deepEqual(s.doc.traits.at(-1), { name: 'Dark-sight', ref: 'dh2:trait:dark_sight' });
    assert.equal((s.doc.xp.ledger ?? []).length, 0);
});

test('session.validate returns the build report', async () => {
    const s = new BuilderSession({ doc: freshDoc(), api });
    await s.load();
    const report = await s.validate();
    assert.equal(typeof report.ok, 'boolean');
    assert.ok(Array.isArray(report.errors));
});

test('session.exportJson round-trips through migrate + validate with zero errors', async () => {
    const s = new BuilderSession({ doc: freshDoc(), api });
    await s.load();
    await s.buy(s.advances.find(a => a.affordable && a.prereqsMet));
    const text = s.exportJson();
    const doc = migrateCharacter(JSON.parse(text));
    const v = validateCharacter(doc);
    assert.ok(v.ok, JSON.stringify(v.errors));
    assert.equal(doc.name, 'Builder Test');
});
