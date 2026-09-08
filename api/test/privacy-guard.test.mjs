/**
 * D9 privacy guard (user request 2026-09-08): player names and personal
 * information never ship in this PUBLIC repo's artifacts.
 *
 * Three layers:
 *  1. STRUCTURAL (always runs — CI-safe): roster documents carry no
 *     player-identifying keys; no email addresses in the committed data
 *     modules; the importer holds no player-name literals (they moved to the
 *     git-ignored tools/campaign-roster.local.mjs) and refuses to run
 *     without the local config; the local files are actually git-ignored.
 *  2. DENYLIST (skipped when tools/campaign-roster.local.mjs is absent — a
 *     fresh clone/CI cannot and must not have the names): every listed name
 *     is absent from every DATA artifact (roster, pack, docs/ bundle).
 *  3. DOUBTS: heuristic findings are the scanner's job
 *     (`node tools/privacy-scan.mjs`) — logged to _privacy_review.local.json
 *     for the USER to rule on. The suite WARNS about open doubts but only
 *     FAILS on certainties, so an unruled doubt blocks publishing decisions,
 *     not development.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let local = null;
try { local = await import('../../tools/campaign-roster.local.mjs'); } catch { /* CI / fresh clone */ }
const NO_LOCAL = !local;

/* ── 1. structural (always) ─────────────────────────────────────────────── */

test('roster documents carry no player-identifying keys', () => {
    const PLAYER_KEYS = /^(player|playername|owner|ownedby|email|discord)$/i;
    const hits = [];
    const walk = (node, path) => {
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node)) {
            if (PLAYER_KEYS.test(k)) hits.push(`${path}.${k}`);
            walk(v, `${path}.${k}`);
        }
    };
    for (const r of CHARACTER_ROSTER) walk(r, r.id);
    walk(CHARGEN_PACK, 'pack');
    assert.deepEqual(hits, []);
});

test('no email addresses in the committed data modules', () => {
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    for (const rel of ['api/data/characters/roster.mjs', 'api/data/chargen/pack.mjs']) {
        const found = [...read(rel).matchAll(EMAIL)].map((m) => m[0])
            .filter((e) => !/noreply|example\.com/.test(e));
        assert.deepEqual(found, [], rel);
    }
});

test('the importer names no player: literals moved to the git-ignored local config', () => {
    const src = read('tools/import-campaign.mjs');
    assert.match(src, /campaign-roster\.local\.mjs/, 'importer loads the local config');
    assert.ok(!/ROSTER_DIRS\s*=\s*\[\s*['"]/.test(src), 'no inline ROSTER_DIRS literal');
    // the historical leak shape: PLAYER_NAMES defined as an inline regex
    // carrying a name ALTERNATION (the never-matching /(?!x)x/g fallback is
    // fine — names must only ever arrive via the local-config import)
    assert.ok(!/PLAYER_NAMES\s*=\s*\/[^/\n]*\|[^/\n]*\//.test(src), 'no inline PLAYER_NAMES name-alternation literal');
});

test('the local privacy files are git-ignored', () => {
    const out = execFileSync('git', ['check-ignore',
        'tools/campaign-roster.local.mjs', '_privacy_review.local.json'],
    { cwd: root, encoding: 'utf8' });
    assert.match(out, /campaign-roster\.local\.mjs/);
    assert.match(out, /_privacy_review\.local\.json/);
});

/* ── 2. denylist over data artifacts (campaign machine only) ────────────── */

test('no denylisted player name in any DATA artifact', { skip: NO_LOCAL && 'no local denylist (CI/fresh clone)' }, () => {
    const files = ['api/data/characters/roster.mjs', 'api/data/chargen/pack.mjs'];
    const docsDir = join(root, 'docs');
    if (existsSync(docsDir)) {
        for (const f of readdirSync(docsDir)) {
            const p = join(docsDir, f);
            if (!statSync(p).isDirectory() && /\.(html|js|mjs)$/.test(f)) files.push(`docs/${f}`);
        }
    }
    const hits = [];
    for (const rel of files) {
        const text = read(rel);
        for (const name of local.playerNames) {
            const re = new RegExp(`\\b${name}\\b`, 'i');
            const m = re.exec(text);
            // the user's own name in their own published domain/URL is a
            // scanner-level doubt, not a data leak — data files should not
            // even carry URLs with it, so keep the assertion strict except
            // for the Pages bundle's self-referential links
            if (m) hits.push(`${rel}: "${name}"`);
        }
    }
    assert.deepEqual(hits, []);
});

/* ── 3. doubts: warn, never fail the suite ──────────────────────────────── */

test('open privacy doubts are surfaced (warning only — the user rules on them)', () => {
    const reviewPath = join(root, '_privacy_review.local.json');
    if (!existsSync(reviewPath)) return;
    const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
    const open = (review.entries ?? []).filter((e) => e.verdict !== 'ok');
    if (open.length) {
        console.warn(`⚠ privacy: ${open.length} unruled doubt(s) in _privacy_review.local.json — run node tools/privacy-scan.mjs and validate before publishing.`);
    }
    assert.ok(true);
});
