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

/* ═══════════════════════════════════════════════════════════════════════════
 * CB-4 — the creation wizard (DOM-free; builder.html renders what this holds).
 *
 * RAW (core p.31–35, verified against the corpus text dumps):
 * - a characteristic is 2d10 + 25 (the campaign's "experienced" variant);
 *   a home-world "+" characteristic rolls 3d10 and keeps the HIGHEST two, a
 *   "−" characteristic keeps the lowest two (pack encodes ±3); Influence is
 *   the tenth rolled characteristic;
 * - ONE characteristic may be rerolled, second result kept (D-K also allows
 *   manual entry; the method is recorded for auditability);
 * - wounds roll the home world's formula ("9+1d5"); Emperor's Blessing rolls
 *   1d10 and grants +1 Fate threshold when the roll ≥ the listed value.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const WIZARD_STEPS = [
    'homeWorld', 'background', 'role', 'characteristics', 'woundsFate',
    'divination', 'startingXp', 'details', 'validate', 'done',
];

const WIZ_CHAR_KEYS = ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'];
/** pack characteristicModifiers key → doc key ('Inf' → the influence scalar). */
const PACK_MOD_KEY = {
    WS: 'ws', BS: 'bs', S: 's', T: 't', Ag: 'ag',
    Int: 'int', Per: 'per', WP: 'wp', Fel: 'fel', Inf: 'influence',
};
const ORIGIN_STEP = { homeWorld: 'homeworldRef', background: 'backgroundRef', role: 'roleRef' };

export function createWizard({ pack, api, rng = Math.random }) {
    const d = (sides) => 1 + Math.floor(rng() * sides);

    const state = {
        step: 'homeWorld',
        selections: { homeworldRef: null, backgroundRef: null, roleRef: null, choices: {} },
        pendingChoices: [],
        originInfo: null,
        characteristics: null,        // { method, values, rerolled }
        woundsFate: null,             // { woundsRoll, blessingRoll, blessed }
        divination: '',
        details: { name: '' },
        doc: null,
        finished: false,
    };

    const advanceStep = () => {
        const s = state;
        state.step =
            !s.selections.homeworldRef ? 'homeWorld'
            : !s.selections.backgroundRef ? 'background'
            : (!s.selections.roleRef || s.pendingChoices.length) ? 'role'
            : !s.characteristics ? 'characteristics'
            : !s.woundsFate ? 'woundsFate'
            : !s.divination ? 'divination'
            : !s.details.name ? 'startingXp'   // XP + details close out together
            : s.finished ? 'done' : 'validate';
    };

    /** Re-derive the doc from a bare stub through POST /api/chargen/origin —
     *  idempotent, so revisiting an origin step never half-applies. */
    const applyOrigin = async () => {
        const r = await api('POST', '/api/chargen/origin', {
            doc: { schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: state.details.name || 'Unnamed' },
            ...state.selections,
        });
        state.doc = r.doc;
        state.pendingChoices = r.choicesNeeded ?? [];
        state.originInfo = {
            woundsFormula: r.woundsFormula,
            fateThreshold: r.fateThreshold,
            emperorsBlessing: r.emperorsBlessing,
            characteristicModifiers: r.characteristicModifiers ?? {},
        };
    };

    /** Direction (+1/−1/0) of the home-world modifier for a doc key. */
    const modDirection = (docKey) => {
        for (const [packKey, v] of Object.entries(state.originInfo?.characteristicModifiers ?? {})) {
            if (PACK_MOD_KEY[packKey] === docKey) return Math.sign(v);
        }
        return 0;
    };

    /** One RAW characteristic: 2d10+25; ± home-world chars roll 3 dice and
     *  keep the highest/lowest two. */
    const rollOne = (docKey) => {
        const dir = modDirection(docKey);
        const dice = Array.from({ length: dir === 0 ? 2 : 3 }, () => d(10));
        dice.sort((a, b) => a - b);
        const kept = dir >= 0 ? dice.slice(-2) : dice.slice(0, 2);
        return 25 + kept[0] + kept[1];
    };

    const writeCharacteristics = (values) => {
        state.doc.characteristics ??= {};       // a migrated v4 stub carries no defaults
        for (const k of WIZ_CHAR_KEYS) {
            state.doc.characteristics[k] = { base: values[k], advances: 0, modifiers: [] };
        }
        if (values.influence !== undefined) state.doc.influence = values.influence;
    };

    return {
        steps: WIZARD_STEPS,
        state,

        /** Origin steps pick a pack entry (+ choice-point answers); the
         *  woundsFate step rolls the formula and the Blessing. */
        async choose(stepId, choice = {}) {
            if (ORIGIN_STEP[stepId]) {
                if (state.characteristics) throw new Error('origin is locked once characteristics are set — restart the wizard to change it');
                state.selections[ORIGIN_STEP[stepId]] = choice.ref ?? state.selections[ORIGIN_STEP[stepId]];
                Object.assign(state.selections.choices, choice.choices ?? {});
                await applyOrigin();
            } else if (stepId === 'woundsFate') {
                const m = /^(\d+)\+1d5$/.exec(state.originInfo?.woundsFormula ?? '');
                if (!m) throw new Error(`unrecognised wounds formula "${state.originInfo?.woundsFormula}"`);
                const woundsRoll = d(5);
                const wounds = Number(m[1]) + woundsRoll;
                const blessingRoll = d(10);
                const blessed = blessingRoll >= (state.originInfo.emperorsBlessing ?? 11);
                const fate = (state.originInfo.fateThreshold ?? 0) + (blessed ? 1 : 0);
                state.doc.wounds = { max: wounds, current: wounds, critical: 0 };
                state.doc.fate = { max: fate, current: fate };
                state.woundsFate = { woundsRoll, blessingRoll, blessed };
            } else {
                throw new Error(`choose() does not drive the "${stepId}" step`);
            }
            advanceStep();
        },

        /** D-K: RAW roll (one reroll, kept) or manual entry; method recorded. */
        rollCharacteristics({ method = 'raw', values, rerollIndex } = {}) {
            if (!state.doc) throw new Error('choose an origin first');
            if (method === 'manual') {
                state.characteristics = { method, values: { ...values }, rerolled: null };
                writeCharacteristics(values);
            } else if (rerollIndex !== undefined) {
                if (!state.characteristics) throw new Error('roll first');
                if (state.characteristics.rerolled) throw new Error('RAW allows exactly one reroll (second result kept)');
                state.characteristics.values[rerollIndex] = rollOne(rerollIndex);
                state.characteristics.rerolled = rerollIndex;
                writeCharacteristics(state.characteristics.values);
            } else {
                const rolled = {};
                for (const k of WIZ_CHAR_KEYS) rolled[k] = rollOne(k);
                rolled.influence = rollOne('influence');
                state.characteristics = { method: 'raw', values: rolled, rerolled: null };
                writeCharacteristics(rolled);
            }
            advanceStep();
        },

        setDivination(text) {
            state.divination = text ?? '';
            state.doc.tarot = text ? { text } : {};
            advanceStep();
        },

        /** The CB-3 advancement API, on the wizard's doc. */
        async advances() {
            const r = await api('POST', '/api/chargen/advances', { doc: state.doc });
            state.xp = r.xp;
            return r.advances;
        },
        async buy(advance, { confirmed = false } = {}) {
            const r = await api('POST', '/api/chargen/advance', { doc: state.doc, advance, confirmed });
            state.doc = r.doc;
            state.xp = r.xp;
            return r.entry;
        },

        setDetails({ name } = {}) {
            if (name) { state.details.name = name; state.doc.name = name; }
            advanceStep();
        },

        /** Persist the audit trail into the doc, validate, close the wizard. */
        async finish() {
            state.doc.extensions = state.doc.extensions ?? {};
            state.doc.extensions.builder = {
                ...(state.doc.extensions.builder ?? {}),
                wizard: {
                    selections: structuredClone(state.selections),
                    characteristics: {
                        method: state.characteristics?.method ?? null,
                        rerolled: state.characteristics?.rerolled ?? null,
                    },
                    woundsFate: state.woundsFate,
                },
            };
            const build = await api('POST', '/api/chargen/validate', { doc: state.doc });
            const character = await api('POST', '/api/character/validate', { character: state.doc });
            state.finished = true;
            advanceStep();
            return { doc: state.doc, validation: { build, character } };
        },
    };
}
