/**
 * ST-1 — prose overlay + `GET /api/prose` + public `citation` fields
 * (docs/SOURCEBOOK_TEXT_PLAN_2026-07-29.md §2 decision D-N, §3 ST-1).
 *
 * D-N: verbatim GW text is GW-copyrighted expression and may exist ONLY in the
 * git-ignored overlay `api/data/chargen/prose.local.mjs`. Citations (book,
 * printed page, source id) are facts and ARE public. These tests gate both
 * halves: the overlay gate (present / absent) and the public citation shape.
 *
 * Nothing here contains rulebook prose — the fixture text is invented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProseOverlay, resetProseOverlayCache, bookLabel, citationOf } from '../lib/prose.mjs';
import { dispatch } from '../lib/api-router.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const FIXTURE = path.join(here, 'fixtures', 'prose.fixture.mjs');
const MISSING = path.join(here, 'fixtures', 'no-such-overlay.local.mjs');

/** Run `fn` with DH2_PROSE_OVERLAY pointed somewhere, cache reset either side. */
async function withOverlay(p, fn) {
    const prev = process.env.DH2_PROSE_OVERLAY;
    process.env.DH2_PROSE_OVERLAY = p;
    resetProseOverlayCache();
    try { return await fn(); }
    finally {
        if (prev === undefined) delete process.env.DH2_PROSE_OVERLAY;
        else process.env.DH2_PROSE_OVERLAY = prev;
        resetProseOverlayCache();
    }
}

// ---- (a) overlay present ---------------------------------------------------
test('loadProseOverlay: an existing overlay reports available with its entries', async () => {
    await withOverlay(FIXTURE, async () => {
        const out = await loadProseOverlay();
        assert.equal(out.available, true);
        assert.equal(out.count, 2);
        const entry = out.prose['dh2:talent:fixture_alpha'];
        assert.equal(typeof entry.text, 'string');
        assert.match(entry.sha256, /^sha256:[0-9a-f]{64}$/);
        assert.deepEqual(Object.keys(entry.citation).sort(), ['book', 'page', 'source']);
    });
});

test('loadProseOverlay: memoised — repeated calls return the same object', async () => {
    await withOverlay(FIXTURE, async () => {
        const a = await loadProseOverlay();
        const b = await loadProseOverlay();
        assert.equal(a, b);
    });
});

// ---- (b) overlay absent ----------------------------------------------------
test('loadProseOverlay: a missing overlay degrades to unavailable (never throws)', async () => {
    await withOverlay(MISSING, async () => {
        const out = await loadProseOverlay();
        assert.deepEqual(out, { available: false, count: 0, prose: {} });
    });
});

// ---- (c) the dispatch route ------------------------------------------------
test('GET /api/prose serves the overlay gate through dispatch (present)', async () => {
    await withOverlay(FIXTURE, async () => {
        const res = await dispatch('GET', '/api/prose');
        assert.equal(res.status, 200);
        assert.equal(res.body.available, true);
        assert.equal(res.body.count, 2);
        assert.equal(Object.keys(res.body.prose).length, 2);
    });
});

test('GET /api/prose serves the overlay gate through dispatch (absent)', async () => {
    await withOverlay(MISSING, async () => {
        const res = await dispatch('GET', '/api/prose');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { available: false, count: 0, prose: {} });
    });
});

test('dispatch stays synchronous for every non-prose route (no transport churn)', () => {
    const res = dispatch('GET', '/api/chargen/pack');
    assert.equal(res.status, 200);                       // not a promise
    assert.equal(res.body.packVersion, 1);
});

// ---- (d) public citation fields on the pack --------------------------------
const PACK_LISTS = ['homeworlds', 'backgrounds', 'roles', 'talents', 'traits', 'skills', 'eliteAdvances'];

test('pack: every entry carries a public citation { book, page, source }', () => {
    for (const list of PACK_LISTS) {
        for (const e of CHARGEN_PACK[list]) {
            const c = e.citation;
            assert.ok(c, `${list} ${e.ref}: no citation`);
            assert.deepEqual(Object.keys(c).sort(), ['book', 'page', 'source'], `${e.ref} citation keys`);
            assert.equal(typeof c.book, 'string', `${e.ref} citation.book`);
            assert.ok(c.book.length > 0, `${e.ref} citation.book empty`);
            assert.equal(typeof c.source, 'string', `${e.ref} citation.source`);
            assert.match(c.source, /^src_dh2_[a-z]+/, `${e.ref} citation.source`);
            assert.ok(c.page === null || Number.isInteger(c.page), `${e.ref} citation.page must be int-or-null`);
        }
    }
});

test('pack: a known talent cites the right book and printed page', () => {
    const jaded = CHARGEN_PACK.talents.find((t) => t.id === 'jaded');
    assert.ok(jaded, 'jaded talent missing from the pack');
    assert.equal(jaded.citation.book, 'Core Rulebook');
    assert.ok(Number.isInteger(jaded.citation.page));
});

// ---- (e) book-label mapping ------------------------------------------------
test('bookLabel maps every DH2 source-id book token', () => {
    assert.equal(bookLabel('src_dh2_core_p124'), 'Core Rulebook');
    assert.equal(bookLabel('src_dh2_forgotten_p12'), 'Forgotten Gods');
    assert.equal(bookLabel('src_dh2_within_p12'), 'Enemies Within');
    assert.equal(bookLabel('src_dh2_without_p12'), 'Enemies Without');
    assert.equal(bookLabel('src_dh2_beyond_p12'), 'Enemies Beyond');
    assert.equal(bookLabel('src_dh2_errata_p1'), 'Errata');
    assert.equal(bookLabel('src_dh2_faq_p1'), 'FAQ');
    assert.equal(bookLabel('src_dh2_without'), 'Enemies Without');   // page-less ids exist (roles: ace)
    assert.equal(bookLabel('src_dh2_bogus_p1'), null);
    assert.equal(bookLabel(undefined), null);
});

test('citationOf prefers the text provenance pair, falling back to the entry pair', () => {
    assert.deepEqual(
        citationOf({ _source: 'src_dh2_core_p200', _book_page: 199, _text_source: 'src_dh2_core_p124', _text_book_page: 123 }),
        { book: 'Core Rulebook', page: 123, source: 'src_dh2_core_p124' });
    assert.deepEqual(
        citationOf({ _source: 'src_dh2_within_p88', _book_page: 87 }),
        { book: 'Enemies Within', page: 87, source: 'src_dh2_within_p88' });
    assert.deepEqual(
        citationOf({ _source: 'src_dh2_without' }),
        { book: 'Enemies Without', page: null, source: 'src_dh2_without' });
    assert.deepEqual(citationOf({}), { book: null, page: null, source: null });
});

// ---- D-N: the overlay must never be committed or built into the Pages site --
test('D-N: the overlay path is git-ignored', () => {
    const gitignore = readFileSync(path.join(repo, '.gitignore'), 'utf8');
    assert.match(gitignore, /api\/data\/chargen\/(prose\.local\.mjs|\*\.local\.mjs)/,
        '.gitignore must exclude the prose overlay');
});

test('D-N: build-static excludes the overlay from the Pages bundle', () => {
    const src = readFileSync(path.join(repo, 'scripts', 'build-static.mjs'), 'utf8');
    // The static build resolves api/lib/prose.mjs to a generated browser stub,
    // so neither the overlay nor a dynamic import of it can enter docs/.
    assert.match(src, /prose\\?\.mjs\$/, 'build-static must alias prose.mjs for the browser bundle');
    assert.match(src, /prose\.browser\.mjs/, 'build-static must emit the browser prose stub');
    assert.ok(!/prose\.local/.test(src.replace(/prose\.local\.mjs is never/g, '')),
        'build-static must not reference the overlay file at all');
});

test('D-N: the built Pages site carries no verbatim text and no overlay reference', () => {
    const docs = path.join(repo, 'docs');
    if (!existsSync(docs)) return;                       // build:static not run here
    for (const name of readdirSync(docs)) {
        const p = path.join(docs, name);
        if (statSync(p).isDirectory()) continue;
        const txt = readFileSync(p, 'utf8');
        for (const needle of ['description_verbatim', 'prose.local', 'NEVER COMMIT (decision D-N)']) {
            assert.ok(!txt.includes(needle), `docs/${name} contains "${needle}"`);
        }
    }
});
