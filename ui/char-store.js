/**
 * CharStore — browser-side character edits (localStorage), shared by the
 * Characters page (input mode writes here) and the Roll page (preset apply
 * reads the EFFECTIVE document: stored edits over the server baseline).
 *
 * One full edited document per roster id under 'dh2.charEdits'. Edits are
 * per-browser, like rule toggles — the server roster stays pristine
 * (regenerate any time with `npm run import:campaign`).
 */
const CharStore = (() => {
    const KEY = 'dh2.charEdits';
    const loadAll = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
    const saveAll = (m) => localStorage.setItem(KEY, JSON.stringify(m));
    return {
        /** The stored edited doc for id, or null. */
        get(id) { return id ? (loadAll()[id] ?? null) : null; },
        /** Persist a full edited document for id. */
        save(id, doc) { if (!id) return; const m = loadAll(); m[id] = doc; saveAll(m); },
        /** Drop the edits for id (back to the server baseline). */
        reset(id) { const m = loadAll(); delete m[id]; saveAll(m); },
        /** True if id has local edits. */
        edited(id) { return !!(id && loadAll()[id]); },
        /** Stored edits overlaid on the baseline (deep-cloned). */
        effective(id, baseline) {
            const stored = this.get(id);
            return structuredClone(stored ?? baseline);
        },
    };
})();
