/**
 * Tier 0-2 fixes from docs/FINDINGS_REMEDIATION_PLAN_2026-07-31.md, dh2_roll_api lane.
 *
 * Done by hand: three of the four agents dispatched for this tier were lost to
 * API errors mid-run, so the remaining work was completed directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { fromRoll20 } from '../../tools/adapters/roll20.mjs';
import { fromGoogleSheetCsv } from '../../tools/adapters/google-sheets.mjs';
import { migrateCharacter, validateCharacter } from '../lib/character-schema.mjs';

const doc = (r) => r.character ?? r.doc ?? r;
const r20 = (attribs) => doc(fromRoll20({ name: 'Probe', attribs }));

// ─────────────────────────────────────────────────────────────────── A-7 ────
// roll20.mjs:148 claimed "total-preserving either way (migrateCharacter
// normalises)". It does not: the adapter stamps schemaVersion 4, and the
// v1->v2 flat-int normalisation is gated on version, so a scalar emitted by
// the shorthand path stays scalar forever. Two shapes then coexist in
// documents that both claim v4 — the hazard that produced R-1 and R-7.

test('A-7: the upgrades path still emits the nested shape, total-preserving', () => {
    const c = r20([{ name: 'weaponskill', current: 38 },
                   { name: 'weaponskillupgrades', current: 2 }]).characteristics.ws;
    assert.deepEqual(c, { base: 28, advances: 2, modifiers: [] });
    assert.equal(c.base + 5 * c.advances, 38, 'total must be preserved');
});

test('A-7: the shorthand path now also emits nested, with the same total', () => {
    const c = r20([{ name: 'weaponskill', current: 38 }]).characteristics.ws;
    assert.equal(typeof c, 'object', 'a v4 document must not carry a flat int');
    assert.deepEqual(c, { base: 38, advances: 0, modifiers: [] });
});

test('A-7: google-sheets emits nested too', () => {
    const d = doc(fromGoogleSheetCsv('name,Probe\nws,38\n'));
    assert.deepEqual(d.characteristics.ws, { base: 38, advances: 0, modifiers: [] });
});

test('A-7: adapter output needs no migration to reach its own claimed shape', () => {
    // The old comment's promise, now actually true — and true WITHOUT relying
    // on migrateCharacter, which cannot fire on a v4-stamped document.
    const before = r20([{ name: 'weaponskill', current: 38 }]);
    const after = migrateCharacter(structuredClone(before));
    assert.deepEqual(after.characteristics.ws, before.characteristics.ws);
    assert.equal(validateCharacter(before).errors.length, 0);
});

test('A-7: every emitted characteristic is nested, not just ws', () => {
    const d = r20([{ name: 'weaponskill', current: 38 }, { name: 'ballisticskill', current: 30 },
                   { name: 'strength', current: 41 }, { name: 'toughness', current: 35 }]);
    for (const [k, v] of Object.entries(d.characteristics)) {
        assert.equal(typeof v, 'object', `${k} must be nested`);
        assert.equal(typeof v.base, 'number', `${k}.base`);
    }
});

// ─────────────────────────────────────────────────────────────────── A-4 ────

test('A-4: isMain compares the full resolved URL, not just a basename', async () => {
    const mod = await import('../../tools/migrate-dsl.mjs');
    assert.equal(typeof mod.migrateDsl, 'function', 'importing must not run the CLI');
    // The old guard matched any argv[1] merely NAMED migrate-dsl.mjs; the new
    // one compares pathToFileURL(argv[1]).href, so an unrelated script with
    // that basename cannot trigger it.
    const src = await import('node:fs').then((fs) =>
        fs.readFileSync(new URL('../../tools/migrate-dsl.mjs', import.meta.url), 'utf8'));
    assert.match(src, /pathToFileURL\(process\.argv\[1\]\)/);
    assert.doesNotMatch(src, /split\('\/'\)\.pop\(\)/);
});

// ─────────────────────────────────────────────────────────────────── A-6 ────

test('A-6: serve-static exports a directly-callable handler', async () => {
    const { handler } = await import('../../scripts/serve-static.mjs');
    assert.equal(typeof handler, 'function');
});

test('A-6: the handler serves index.html for / and 404s an unknown path', async () => {
    const { handler } = await import('../../scripts/serve-static.mjs');
    const call = (url) => new Promise((resolve) => {
        const chunks = [];
        const res = {
            statusCode: 200, headers: {},
            writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h || {}); },
            setHeader(k, v) { this.headers[k] = v; },
            end(body) { if (body) chunks.push(body); resolve({ status: this.statusCode, headers: this.headers }); },
        };
        handler({ url, method: 'GET' }, res);
    });
    assert.equal((await call('/')).status, 200);
    assert.equal((await call('/definitely-not-here.xyz')).status, 404);
});

test('A-6: path traversal is still refused', async () => {
    const { handler } = await import('../../scripts/serve-static.mjs');
    for (const url of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
        const status = await new Promise((resolve) => {
            const res = { statusCode: 200, writeHead(c) { this.statusCode = c; },
                          setHeader() {}, end() { resolve(this.statusCode); } };
            handler({ url, method: 'GET' }, res);
        });
        assert.notEqual(status, 200, `${url} must not serve a file`);
    }
});
