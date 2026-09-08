/**
 * D9 privacy scanner (user request 2026-09-08): prove that no player name or
 * personal information ships in this PUBLIC repo's artifacts — and when in
 * DOUBT, log the finding and make the user rule on it rather than deciding.
 *
 * Scope (public surfaces): committed data modules (roster, pack), the tools/
 * and scripts/ sources, the ui/ pages, the docs/ Pages bundle, and the
 * top-level markdown docs.
 *
 * Three verdict classes:
 *   CERTAIN  — exits 1 immediately (a denylisted player name, an email, a
 *              `player`-keyed roster field). Fix the artifact.
 *   DOUBT    — heuristic hits (parenthesized capitalized tokens in workbook
 *              filenames, phone-shaped numbers). Appended to
 *              _privacy_review.local.json (git-ignored) with verdict:null;
 *              exits 1 with a validation prompt until the user records
 *              verdict "ok" (false positive, stays) or fixes the artifact.
 *   OK       — a doubt the user has acknowledged; silenced thereafter.
 *
 * The player-name denylist lives in tools/campaign-roster.local.mjs
 * (git-ignored). Without it the scanner still runs the structural checks —
 * that is what CI gets. Run: `node tools/privacy-scan.mjs`.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = join(root, '_privacy_review.local.json');

// ---- what counts as a public surface ---------------------------------------
const SCAN_FILES = [];
const addTree = (rel, exts) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) continue;
        if (exts.some((e) => f.endsWith(e)) && !f.endsWith('.local.mjs')) SCAN_FILES.push(p);
    }
};
addTree('api/data/characters', ['.mjs']);
addTree('api/data/chargen', ['.mjs']);          // .local.mjs excluded above (git-ignored overlay)
addTree('tools', ['.mjs']);
addTree('scripts', ['.mjs']);
addTree('ui', ['.html', '.mjs', '.js']);
addTree('docs', ['.html', '.js', '.mjs']);      // the Pages bundle, when built
addTree('.', ['.md']);

// ---- denylist (local, git-ignored) -----------------------------------------
let playerNames = null;
try { ({ playerNames } = await import('./campaign-roster.local.mjs')); } catch { /* CI / fresh clone */ }

// ---- findings --------------------------------------------------------------
const certain = [];
const doubts = [];
const seen = new Set();
const doubt = (id, file, detail) => {
    if (seen.has(id)) return;
    seen.add(id);
    doubts.push({ id, file: relative(root, file), detail, verdict: null });
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\d.\w])(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?![\d.])/g;
// the historical leak pattern: a parenthesized capitalized token inside an
// .xlsx/.gsheet filename (workbook folders were "<Player>(<chars>)")
const WORKBOOK_PAREN = /"[^"\n]*\(([A-Z][a-z]{2,})[^)"]*\)[^"\n]*\.(xlsx|gsheet)"/g;

for (const file of SCAN_FILES) {
    const text = readFileSync(file, 'utf8');
    const relFile = relative(root, file);

    if (playerNames) {
        for (const name of playerNames) {
            const re = new RegExp(`\\b${name}\\b`, 'gi');
            let m;
            while ((m = re.exec(text)) !== null) {
                const line = text.slice(0, m.index).split('\n').length;
                const ctx = text.split('\n')[line - 1].trim().slice(0, 120);
                // Certainty by surface: a denylisted name inside a DATA
                // artifact (roster, pack, the Pages bundle) is a leak, full
                // stop. In prose docs and tool sources the same first name can
                // be a legitimate public attribution (e.g. an upstream
                // author) or the user's own published domain — those are
                // DOUBTS: logged once, ruled on by the user (verdict "ok"
                // silences; anything else gets fixed).
                const isData = /^(api\/data|docs)\//.test(relFile.replace(/\\/g, '/'));
                if (isData) certain.push({ file: relFile, line, detail: `player name "${name}" in: ${ctx}` });
                else doubt(`name:${name}:${relFile}:${line}`, file, `"${name}" in: ${ctx}`);
            }
        }
    }
    for (const m of text.matchAll(EMAIL)) {
        if (/noreply|example\.com|users\.noreply/.test(m[0])) continue;
        certain.push({ file: relFile, detail: `email address: ${m[0]}` });
    }
    for (const m of text.matchAll(PHONE)) {
        doubt(`phone:${m[0]}:${relFile}`, file, `phone-shaped: "${m[0]}"`);
    }
    for (const m of text.matchAll(WORKBOOK_PAREN)) {
        doubt(`workbook:${m[1]}:${relFile}`, file, `parenthesized name-like token in workbook path: ${m[0].slice(0, 100)}`);
    }
}

// roster docs must be structurally player-free
const { CHARACTER_ROSTER } = await import('../api/data/characters/roster.mjs');
const PLAYER_KEYS = /^(player|playername|owner|ownedby|email|discord)$/i;
const walk = (node, path, hits) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, hits)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
        if (PLAYER_KEYS.test(k)) hits.push(`${path}.${k}`);
        walk(v, `${path}.${k}`, hits);
    }
};
for (const r of CHARACTER_ROSTER) {
    const hits = [];
    walk(r, r.id, hits);
    for (const h of hits) certain.push({ file: 'api/data/characters/roster.mjs', detail: `player-identifying key: ${h}` });
}

// ---- doubt log: merge with the user's prior verdicts -----------------------
let review = { _readme: 'D9 privacy doubt log (git-ignored). For each entry set verdict: "ok" (false positive — acknowledged, stays) after checking, or fix the artifact and re-run node tools/privacy-scan.mjs.', entries: [] };
if (existsSync(REVIEW)) review = JSON.parse(readFileSync(REVIEW, 'utf8'));
const byId = new Map(review.entries.map((e) => [e.id, e]));
let newDoubts = 0;
for (const d of doubts) {
    const prior = byId.get(d.id);
    if (prior?.verdict === 'ok') continue;
    if (!prior) { review.entries.push(d); newDoubts++; }
}
const open = review.entries.filter((e) => e.verdict !== 'ok');
writeFileSync(REVIEW, JSON.stringify(review, null, 2) + '\n');

// ---- report ----------------------------------------------------------------
const scanned = SCAN_FILES.length;
if (certain.length) {
    console.error(`✗ PRIVACY: ${certain.length} CERTAIN finding(s) in public artifacts (${scanned} files scanned):`);
    for (const c of certain) console.error(`  ${c.file}${c.line ? `:${c.line}` : ''} — ${c.detail}`);
}
if (open.length) {
    console.error(`⚠ PRIVACY: ${open.length} unacknowledged doubt(s) (${newDoubts} new) — VALIDATE THEM:`);
    for (const d of open) console.error(`  [${d.id}] ${d.file} — ${d.detail}`);
    console.error(`  → review ${relative(root, REVIEW)}: set "verdict": "ok" on false positives, or fix the artifact; then re-run.`);
}
if (!certain.length && !open.length) {
    console.log(`✓ privacy scan clean: ${scanned} public files, ${playerNames ? `${playerNames.length}-name denylist` : 'NO local denylist (structural checks only — run on the campaign machine for the full scan)'}, ${review.entries.length} acknowledged doubt(s).`);
}
process.exit(certain.length || open.length ? 1 : 0);
