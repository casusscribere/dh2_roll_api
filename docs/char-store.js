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
        /* ── custom characters (2026-08-27): ONE identity across pages ──────
         * Wizard-built / uploaded characters live in the same store under
         * 'custom:' ids, so Builder, Characters and Roll all list and edit
         * the SAME entity. Edits propagate: same-tab via the shared store,
         * cross-tab via the browser's storage event (see onChange). */
        isCustom(id) { return typeof id === 'string' && id.startsWith('custom:'); },
        /** Persist a NEW custom character; returns its id. */
        saveNew(doc) {
            const slug = String(doc?.name ?? 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'character';
            let id = `custom:${slug}`;
            const m = loadAll();
            for (let n = 2; m[id]; n++) id = `custom:${slug}-${n}`;
            m[id] = doc;
            saveAll(m);
            return id;
        },
        /** Every stored custom character: [{ id, name }]. */
        customList() {
            return Object.entries(loadAll())
                .filter(([id]) => this.isCustom(id))
                .map(([id, doc]) => ({ id, name: doc?.name ?? id }));
        },
        /** Fire cb when ANOTHER tab writes the store (live propagation). */
        onChange(cb) {
            window.addEventListener('storage', (ev) => { if (ev.key === KEY) cb(); });
        },
    };
})();
