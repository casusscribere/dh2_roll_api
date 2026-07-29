/**
 * Builder page logic (CB-3), DOM-free. The page (builder.html) renders what
 * this module holds; api/test/builder-core.test.mjs drives it against dispatch
 * directly. `api(method, path, body)` must resolve to the parsed response body
 * and throw on HTTP errors — both the fetch wrapper (page) and the dispatch
 * wrapper (tests, Foundry) satisfy that.
 */

const KIND_LABEL = {
    characteristic: 'Characteristics',
    skill: 'Skills',
    psy_rating: 'Psy Rating',
    psychic_power: 'Psychic Powers',
    elite_advance: 'Elite Advances',
    other: 'Other'
};

/** Group an advances list for display: kind buckets, talents split by tier. */
export function groupAdvances(advances) {
    const buckets = new Map();
    for (const a of advances) {
        const label = a.kind === 'talent' ? `Talents — Tier ${a.tier ?? '?'}` : (KIND_LABEL[a.kind] ?? a.kind);
        if (!buckets.has(label)) buckets.set(label, []);
        buckets.get(label).push(a);
    }
    const order = (label) => {
        if (label === 'Characteristics') return 0;
        if (label === 'Skills') return 1;
        if (label.startsWith('Talents')) return 2;
        if (label === 'Psy Rating') return 3;
        if (label === 'Psychic Powers') return 4;
        if (label === 'Elite Advances') return 5;
        return 6;
    };
    return [...buckets.entries()]
        .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
        .map(([label, entries]) => ({ label, entries }));
}

export class BuilderSession {
    /** @param {{doc: object, api: (m: string, p: string, b?: object) => Promise<any>}} opts */
    constructor({ doc, api }) {
        this.api = api;
        this.doc = doc;
        this.advances = [];
        this.xp = { total: 0, spent: 0, remaining: 0 };
        this.pack = null;
        this._undo = [];          // pre-purchase doc snapshots (JSON strings)
    }

    get canUndo() { return this._undo.length > 0; }

    /** Fetch the chargen pack (once) and the advance list for the current doc. */
    async load() {
        if (!this.pack) this.pack = await this.api('GET', '/api/chargen/pack');
        await this.refresh();
    }

    /** Re-list available advances + XP summary; migrates the doc engine-side. */
    async refresh() {
        const r = await this.api('POST', '/api/chargen/advances', { doc: this.doc });
        this.advances = r.advances;
        this.xp = r.xp;
    }

    /**
     * Buy one advance. The engine applies it atomically (mechanical change +
     * typed ledger entry); on success the session holds the returned doc and a
     * pre-purchase snapshot for undo. Throws (doc untouched) on unaffordable/
     * duplicate/rank-skip; pass confirmed=true to override prereq warnings.
     */
    async buy(advance, { confirmed = false } = {}) {
        const snapshot = JSON.stringify(this.doc);
        const r = await this.api('POST', '/api/chargen/advance', { doc: this.doc, advance, confirmed });
        this._undo.push(snapshot);
        this.doc = r.doc;
        await this.refresh();
        return r.entry;
    }

    /** Revert the last purchase from the held snapshot. */
    async undoLast() {
        if (!this._undo.length) return;
        this.doc = JSON.parse(this._undo.pop());
        await this.refresh();
    }

    /** Traits are never purchased in DH2 — grants bypass the XP ledger. */
    async grantTrait({ name, ref }) {
        this.doc.traits = this.doc.traits ?? [];
        this.doc.traits.push(ref ? { name, ref } : { name });
        await this.refresh();
    }

    /** Ledger↔stats reconciliation report (validateBuild engine-side). */
    async validate() {
        return await this.api('POST', '/api/chargen/validate', { doc: this.doc });
    }

    /** Download payload: the current doc, pretty-printed. */
    exportJson() {
        return JSON.stringify(this.doc, null, 2);
    }
}
