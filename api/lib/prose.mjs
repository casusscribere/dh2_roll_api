/**
 * Prose overlay + citation helpers (ST-1,
 * monorepo docs/SOURCEBOOK_TEXT_PLAN_2026-07-29.md §2 decision D-N, §3 ST-1).
 *
 * Decision D-N — public surfaces CITE, private surfaces QUOTE:
 *   - Verbatim rulebook text is GW-copyrighted expression. It NEVER enters this
 *     (public) repo's git history, `api/data/chargen/pack.mjs`, or the committed
 *     Pages build in `docs/`. Its only home is the GENERATED, GIT-IGNORED
 *     overlay `api/data/chargen/prose.local.mjs` (`npm run sync:chargen`).
 *   - Citations — book, printed page, corpus source id — are FACTS and are
 *     public; they ride on every pack entry as `citation`.
 *
 * The overlay is therefore OPTIONAL at runtime, exactly like the merged campaign
 * roster (D-C/D9): `loadProseOverlay()` dynamically imports it and degrades to
 * `{ available: false, count: 0, prose: {} }` when it is absent — a fresh clone,
 * CI, and the Pages deployment all take that branch.
 *
 * PORTABILITY: this module is bundled into the engine library
 * (`scripts/build-engine-lib.mjs`, esbuild platform "neutral"), so it uses NO
 * node builtins — only `import.meta.url`, a guarded `process.env` read, and a
 * dynamic `import()` of a computed specifier (which esbuild leaves alone).
 * The browser/Pages build replaces this module wholesale with a stub that always
 * reports unavailable (`scripts/build-static.mjs`).
 *
 * Test seam: `DH2_PROSE_OVERLAY` overrides the overlay location (absolute path,
 * or any URL/relative specifier); `resetProseOverlayCache()` clears the memo.
 */

// Public citation facts live in their own module so the Pages stub can re-export
// them verbatim (they are not restricted content); re-exported here so callers
// have one prose entry point.
export { bookLabel, citationOf } from './prose-citation.mjs';

/** The overlay-absent answer. Frozen: it is handed straight to the transport. */
const UNAVAILABLE = Object.freeze({ available: false, count: 0, prose: Object.freeze({}) });

/** Memo, keyed by resolved specifier (so a test can point at a fixture). */
const CACHE = new Map();

/** Resolve where the overlay should be imported from (an absolute URL string). */
export function proseOverlaySpecifier() {
    const override = (typeof process !== 'undefined' && process.env && process.env.DH2_PROSE_OVERLAY) || '';
    if (override) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(override)) return override;          // already a URL
        const norm = override.replace(/\\/g, '/');
        if (norm.startsWith('/')) return `file://${norm}`;                   // POSIX absolute
        if (/^[A-Za-z]:\//.test(norm)) return `file:///${norm}`;             // Windows absolute
        return new URL(norm, import.meta.url).href;                          // relative to api/lib/
    }
    return new URL('../data/chargen/prose.local.mjs', import.meta.url).href;
}

/**
 * Load the git-ignored prose overlay. Async + memoised (per specifier).
 * Never throws: a missing or broken overlay is the normal public-deployment state.
 *
 * @returns {Promise<{available: boolean, count: number, prose: object}>}
 */
export async function loadProseOverlay() {
    const spec = proseOverlaySpecifier();
    if (CACHE.has(spec)) return CACHE.get(spec);
    let result = UNAVAILABLE;
    try {
        const mod = await import(spec);
        const prose = mod?.PROSE;
        if (prose && typeof prose === 'object') {
            result = { available: true, count: Object.keys(prose).length, prose };
        }
    } catch {
        result = UNAVAILABLE;                 // absent overlay → cite-only mode
    }
    CACHE.set(spec, result);
    return result;
}

/** Drop the memo (tests that re-point `DH2_PROSE_OVERLAY`). */
export function resetProseOverlayCache() {
    CACHE.clear();
}
