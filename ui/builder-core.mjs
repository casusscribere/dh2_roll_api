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

    /** Re-list available advances + XP summary; migrates the doc engine-side.
     *  includeHeld: origin-granted / already-held talents come back flagged so
     *  the panel can grey them out instead of hiding them. */
    async refresh() {
        const r = await this.api('POST', '/api/chargen/advances', { doc: this.doc, includeHeld: true });
        this.advances = r.advances;
        this.xp = r.xp;
    }

    /**
     * Buy one advance. The engine applies it atomically (mechanical change +
     * typed ledger entry); on success the session holds the returned doc and a
     * pre-purchase snapshot for undo. Throws (doc untouched) on unaffordable/
     * duplicate/rank-skip; pass confirmed=true to override prereq warnings.
     */
    async buy(advance, { confirmed = false, override = false } = {}) {
        const snapshot = JSON.stringify(this.doc);
        const r = await this.api('POST', '/api/chargen/advance', { doc: this.doc, advance, confirmed, override });
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

    /** Traits are never purchased in DH2, but every applied trait still
     *  lands in the audit trail: a 0-XP ledger entry whose source is the
     *  user's note, defaulting to the override indicator. */
    async grantTrait({ name, ref, note } = {}) {
        const r = await this.api('POST', '/api/chargen/grant', {
            doc: this.doc,
            grant: { kind: 'trait', name, ...(ref && { ref }) },
            source: (note ?? '').trim() || 'manual override',
        });
        this.doc = r.doc;
        await this.refresh();
        return r.entry;
    }

    /**
     * The GM/override door: add ANY content with prerequisites ignored, at
     * 0 XP — the ledger entry's source says "manual override" so the audit
     * trail is honest. grant: { kind, name, ref?, rank?, speciality?, rating? }
     */
    async grantOverride(grant) {
        const snapshot = JSON.stringify(this.doc);
        const r = await this.api('POST', '/api/chargen/grant',
            { doc: this.doc, grant, source: 'manual override' });
        this._undo.push(snapshot);
        this.doc = r.doc;
        await this.refresh();
        return r.entry;
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
 * CB-4 (revised 2026-08-27) — the creation session, integrated with editing.
 *
 * The wizard is no longer a one-way corridor. Its state is a persistent
 * CREATION RECIPE at `doc.extensions.builder.creation` — selections, the
 * characteristic values + method, the recorded wounds/blessing dice,
 * divination, equipment — and every mutation re-persists it. Because the
 * recipe is a pure derivation record, ANY earlier step can change at any
 * time: rebuild() re-derives the doc from the recipe (origin → stored
 * characteristic values → wounds/fate recomputed from the RECORDED rolls
 * against the new home world → divination → equipment) and then REPLAYS the
 * XP ledger at current prices (POST /api/chargen/replay) — purchases that
 * become illegal surface in state.conflicts, never silently vanish.
 *
 * Edit mode: createWizard({ doc }) loads an existing character. A wizard-born
 * doc restores its recipe and propagates fully. A doc WITHOUT a recipe
 * (roster imports) shows its creation choices read from the document; origin
 * selections apply as engine DELTAS onto the live doc (nothing to re-derive
 * from), and stat edits write directly — validateCreation reports what is
 * missing or inconsistent either way.
 *
 * RAW facts unchanged from the first cut (core p.31–35, corpus-verified):
 * 2d10+25; ± home-world characteristics roll 3d10 keep-highest/lowest-two;
 * Influence is the tenth roll; ONE reroll, second result kept; wounds roll
 * the formula; Emperor's Blessing 1d10 ≥ value → +1 Fate threshold.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const WIZARD_STEPS = [
    'homeWorld', 'background', 'role', 'characteristics', 'woundsFate',
    'divination', 'startingXp', 'equipment', 'details', 'validate', 'done',
];

export const WIZ_CHAR_KEYS = ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'];
/** pack characteristicModifiers key → doc key ('Inf' → the influence scalar). */
const PACK_MOD_KEY = {
    WS: 'ws', BS: 'bs', S: 's', T: 't', Ag: 'ag',
    Int: 'int', Per: 'per', WP: 'wp', Fel: 'fel', Inf: 'influence',
};
const ORIGIN_STEP = { homeWorld: 'homeworldRef', background: 'backgroundRef', role: 'roleRef' };

const emptySelections = () => ({ homeworldRef: null, backgroundRef: null, roleRef: null, choices: {} });

/** The persisted recipe carried at doc.extensions.builder.creation. */
const recipeOfState = (state) => ({
    selections: structuredClone(state.selections),
    characteristics: state.characteristics ? structuredClone(state.characteristics) : null,
    woundsFate: state.woundsFate ? structuredClone(state.woundsFate) : null,
    divination: state.divination,
    divinationRoll: state.divinationRoll ? structuredClone(state.divinationRoll) : null,
    equipment: state.equipment ? structuredClone(state.equipment) : null,
    completed: !!state.completed,
});

/**
 * Parse one starting-equipment kit item into its pick-one options.
 * "Lasgun (or laspistol and sword)" → Lasgun | laspistol + sword;
 * "Shotgun or shock maul" → one of two; a plain item is its own single option.
 */
export function parseKitItem(text) {
    const paren = /^(.*?)\s*\(or\s+(.+)\)\s*$/i.exec(text);
    if (paren) {
        return { text, options: [
            { label: paren[1].trim(), items: [paren[1].trim()] },
            { label: paren[2].trim(), items: paren[2].split(/\s+and\s+/i).map((s) => s.trim()) },
        ] };
    }
    const parts = text.split(/\s+or\s+/i).map((s) => s.trim());
    return { text, options: parts.map((p) => ({ label: p, items: [p] })) };
}

export function createWizard({ pack, api, rng = Math.random, doc = null } = {}) {
    const d = (sides) => 1 + Math.floor(rng() * sides);

    const state = {
        step: 'homeWorld',
        selections: emptySelections(),
        pendingChoices: [],
        originInfo: null,
        characteristics: null,        // { method, values, rerolled }
        woundsFate: null,             // { woundsRoll, blessingRoll, blessed }
        divination: '',
        divinationRoll: null,         // { roll, choices } — Table 2-9, recorded dice
        divinationPending: [],        // unresolved divination choice points
        divinationInfo: null,         // { range, ref, citation, manual } of the rolled row
        equipment: null,              // { added: [{name, notes?}], kitApplied? }
        details: { name: '' },
        doc: null,
        conflicts: [],                // replay conflicts from the last rebuild
        hasRecipe: true,              // false = extant doc without a creation recipe
        completed: false,             // finished creations LOCK the CC steps (GM override to revise)
        finished: false,
    };

    /* ---- edit mode: restore or derive state from an existing doc ---------- */
    if (doc) {
        state.doc = doc;
        state.details.name = doc.name ?? '';
        const rec = doc.extensions?.builder?.creation ?? null;
        if (rec) {
            Object.assign(state.selections, rec.selections ?? {});
            state.characteristics = rec.characteristics ?? null;
            state.woundsFate = rec.woundsFate ?? null;
            state.divination = rec.divination ?? '';
            state.divinationRoll = rec.divinationRoll ?? null;
            state.equipment = rec.equipment ?? null;
            state.completed = !!rec.completed;
        } else {
            state.hasRecipe = false;
            state.completed = true;      // a played character is past creation
            const refOf = (m) => (m && typeof m === 'object' ? m.ref ?? null : null);
            state.selections.homeworldRef = refOf(doc.origin?.homeworld);
            state.selections.backgroundRef = refOf(doc.origin?.background);
            state.selections.roleRef = refOf(doc.origin?.role);
            const values = {};
            for (const k of WIZ_CHAR_KEYS) {
                const c = doc.characteristics?.[k];
                values[k] = (typeof c === 'number' ? c : c?.base) ?? 0;
            }
            values.influence = doc.influence ?? 0;
            state.characteristics = { method: null, values, rerolled: null };
            if (doc.wounds?.max > 0 || doc.fate?.max > 0) {
                state.woundsFate = { woundsRoll: null, blessingRoll: null, blessed: null };
            }
            state.divination = doc.tarot?.text ?? doc.tarot?.card ?? '';
            if ((doc.gear ?? []).length) state.equipment = { added: [] };
        }
        state.finished = false;
    }

    const persistRecipe = () => {
        if (!state.doc || !state.hasRecipe) return;
        state.doc.extensions = state.doc.extensions ?? {};
        state.doc.extensions.builder = {
            ...(state.doc.extensions.builder ?? {}),
            creation: recipeOfState(state),
        };
    };

    /** Finished creations lock the CC-specific steps. A GM override unlocks
     *  one action AND logs it: a 0-XP ledger note sourced "manual override",
     *  so post-completion revisions always show in the audit trail. */
    const assertEditable = (what, override) => {
        if (!state.completed) return () => {};
        if (!override) throw new Error(`creation is complete — "${what}" is locked (enable the GM override to revise; the revision is logged)`);
        return () => {
            state.doc.xp ??= { total: 0, ledger: [] };
            (state.doc.xp.ledger ??= []).push({
                name: `creation revised: ${what}`, cost: 0, kind: 'other', grantKind: 'note',
                source: 'manual override', date: new Date().toISOString().slice(0, 10),
            });
        };
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
            : !s.equipment ? 'startingXp'      // XP spend, then Equip Acolyte (core stage 4)
            : !s.details.name ? 'details'
            : s.finished ? 'done' : 'validate';
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

    const applyWoundsFate = () => {
        if (!state.woundsFate || !state.originInfo) return;
        const m = /^(\d+)\+1d5$/.exec(state.originInfo.woundsFormula ?? '');
        if (m && state.woundsFate.woundsRoll != null) {
            const wounds = Number(m[1]) + state.woundsFate.woundsRoll;
            state.doc.wounds = { max: wounds, current: wounds, critical: 0 };
        }
        if (state.woundsFate.blessingRoll != null) {
            const blessed = state.woundsFate.blessingRoll >= (state.originInfo.emperorsBlessing ?? 11);
            state.woundsFate.blessed = blessed;
            const fate = (state.originInfo.fateThreshold ?? 0) + (blessed ? 1 : 0);
            state.doc.fate = { max: fate, current: fate };
        }
    };

    /**
     * Re-derive the doc from the recipe and replay the ledger — the
     * propagation path for recipe docs. Any step can change; everything
     * downstream recomputes; illegal purchases land in state.conflicts.
     */
    const rebuild = async () => {
        const priorLedger = state.doc?.xp?.ledger ?? [];
        const priorGear = state.equipment?.added ?? [];
        const r = await api('POST', '/api/chargen/origin', {
            doc: { schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: state.details.name || state.doc?.name || 'Unnamed' },
            ...state.selections,
        });
        state.doc = r.doc;
        state.pendingChoices = r.choicesNeeded ?? [];
        state.originInfo = {
            woundsFormula: r.woundsFormula,
            fateThreshold: r.fateThreshold,
            emperorsBlessing: r.emperorsBlessing,
            characteristicModifiers: r.characteristicModifiers ?? {},
            choicePoints: r.choicePoints ?? [],
        };
        if (state.characteristics?.values) writeCharacteristics(state.characteristics.values);
        applyWoundsFate();
        if (state.divinationRoll && state.characteristics?.values) {
            const dr = await api('POST', '/api/chargen/divination', {
                doc: state.doc, roll: state.divinationRoll.roll,
                choices: state.divinationRoll.choices ?? {},
            });
            state.doc = dr.doc;
            state.divinationPending = dr.pendingChoices ?? [];
            state.divinationInfo = { range: dr.range, ref: dr.ref, citation: dr.citation, manual: dr.manual };
        }
        if (state.divination) state.doc.tarot = { text: state.divination };
        for (const g of priorGear) {
            (state.doc.gear ??= []).push({ name: g.name, ...(g.notes && { notes: g.notes }), equipped: g.equipped !== false });
        }
        if (priorLedger.length) {
            const rp = await api('POST', '/api/chargen/replay', { doc: state.doc, entries: priorLedger });
            state.doc = rp.doc;
            state.conflicts = rp.conflicts ?? [];
            state.xp = rp.xp;
        } else {
            state.conflicts = [];
        }
        persistRecipe();
    };

    /** Choice-point KEYS attached to one origin member — read from the
     *  ENGINE-computed points of the outgoing selection (one legality-aware
     *  expansion, no second parser here), plus any pending choices the engine
     *  attributed to that member's source. */
    const SOURCE_MEMBER = { homeworld: 'homeworldRef', background: 'backgroundRef', role: 'roleRef' };
    const choiceKeysFor = (memberKey) => {
        const keys = (state.originInfo?.choicePoints ?? [])
            .filter((c) => c.member === memberKey).map((c) => c.key);
        for (const c of state.pendingChoices ?? []) {
            if (c.key && SOURCE_MEMBER[c.source] === memberKey) keys.push(c.key);
        }
        return keys;
    };

    /** Origin delta for extant docs with no recipe: apply the ONE changed
     *  member onto the live doc (nothing recorded to re-derive from). */
    const applyOriginDelta = async (memberKey, ref) => {
        const r = await api('POST', '/api/chargen/origin', {
            doc: state.doc, [memberKey]: ref, choices: state.selections.choices,
        });
        state.doc = r.doc;
        state.pendingChoices = r.choicesNeeded ?? [];
        state.originInfo = {
            woundsFormula: r.woundsFormula, fateThreshold: r.fateThreshold,
            emperorsBlessing: r.emperorsBlessing, characteristicModifiers: r.characteristicModifiers ?? {},
            choicePoints: r.choicePoints ?? [],
        };
    };

    return {
        steps: WIZARD_STEPS,
        state,

        /** Origin steps pick a pack entry (+ choice-point answers) — at ANY
         *  time; the woundsFate step rolls; equipment adds gear. */
        async choose(stepId, choice = {}, { override = false } = {}) {
            const logRevision = (stepId in ORIGIN_STEP || stepId === 'woundsFate')
                ? assertEditable(stepId, override)
                : () => {};
            if (ORIGIN_STEP[stepId]) {
                const memberKey = ORIGIN_STEP[stepId];
                if (choice.ref !== undefined && choice.ref !== state.selections[memberKey]) {
                    // a member change RESCINDS every choice attached to the
                    // outgoing selection (its keys are meaningless now)
                    for (const k of choiceKeysFor(memberKey)) {
                        delete state.selections.choices[k];
                    }
                    state.selections[memberKey] = choice.ref;
                }
                Object.assign(state.selections.choices, choice.choices ?? {});
                if (state.hasRecipe) await rebuild();
                else await applyOriginDelta(memberKey, state.selections[memberKey]);
            } else if (stepId === 'equipment') {
                const added = state.equipment?.added ?? [];
                for (const g of choice.gear ?? []) {
                    if (!g?.name) continue;
                    (state.doc.gear ??= []).push({
                        name: g.name,
                        ...(g.notes && { notes: g.notes }),
                        ...(g.weight !== undefined && { weight: g.weight }),
                        equipped: g.equipped !== false,
                    });
                    added.push({ name: g.name, ...(g.notes && { notes: g.notes }) });
                }
                state.equipment = {
                    added,
                    kitApplied: !!(state.equipment?.kitApplied || choice.kit),
                };
                persistRecipe();
            } else if (stepId === 'woundsFate') {
                if (!state.originInfo) throw new Error('choose an origin first');
                const m = /^(\d+)\+1d5$/.exec(state.originInfo.woundsFormula ?? '');
                if (!m) throw new Error(`unrecognised wounds formula "${state.originInfo.woundsFormula}"`);
                state.woundsFate = { woundsRoll: d(5), blessingRoll: d(10), blessed: null };
                applyWoundsFate();
                persistRecipe();
            } else {
                throw new Error(`choose() does not drive the "${stepId}" step`);
            }
            logRevision();
            persistRecipe();
            advanceStep();
        },

        /** D-K: RAW roll (one reroll, kept) or manual entry; method recorded.
         *  Callable again at any time — a re-roll-everything or a manual edit
         *  replaces the values and keeps the audit trail honest. */
        rollCharacteristics({ method = 'raw', values, rerollIndex, override = false } = {}) {
            if (!state.doc) throw new Error('choose an origin first');
            const logRevision = assertEditable('characteristics', override);
            if (method === 'manual') {
                state.characteristics = { method, values: { ...values }, rerolled: null };
                writeCharacteristics(state.characteristics.values);
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
            logRevision();
            persistRecipe();
            advanceStep();
        },

        /** Edit one characteristic value in place (manual tweak — the method
         *  flips to 'manual' because the rolled provenance no longer holds). */
        setCharacteristic(key, value, { override = false } = {}) {
            const logRevision = assertEditable(`characteristic ${key}`, override);
            logRevision._pending = true;
            if (!state.characteristics) state.characteristics = { method: 'manual', values: {}, rerolled: null };
            state.characteristics.values[key] = value;
            if (state.characteristics.method === 'raw') state.characteristics.method = 'manual';
            writeCharacteristics(state.characteristics.values);
            logRevision();
            persistRecipe();
        },

        setDivination(text, { override = false } = {}) {
            const logRevision = assertEditable('divination', override);
            state.divination = text ?? '';
            state.doc.tarot = text ? { text } : {};
            logRevision();
            persistRecipe();
            advanceStep();
        },

        /** Roll on Table 2-9 (recorded dice, like wounds & fate) and apply the
         *  row's mechanical effects through the engine. Re-rolling replaces the
         *  recorded roll and REBUILDS, so the old row's modifiers never stack. */
        async rollDivination({ override = false } = {}) {
            const logRevision = assertEditable('divination', override);
            if (!state.characteristics?.values) throw new Error('generate characteristics first');
            state.divinationRoll = { roll: d(100), choices: {} };
            state.divination = '';
            if (state.hasRecipe) {
                await rebuild();
            } else {
                // no recipe to re-derive from: keep the pre-divination doc so a
                // re-roll or a choice resolution re-applies from a clean base
                state._preDivinationDoc ??= structuredClone(state.doc);
                const dr = await api('POST', '/api/chargen/divination', {
                    doc: state._preDivinationDoc, roll: state.divinationRoll.roll,
                });
                state.doc = dr.doc;
                state.divinationPending = dr.pendingChoices ?? [];
                state.divinationInfo = { range: dr.range, ref: dr.ref, citation: dr.citation, manual: dr.manual };
            }
            const c = state.divinationInfo?.citation;
            state.divination = `Table 2-9 roll ${state.divinationRoll.roll}`
                + (c ? ` (${c.book} p.${c.page})` : '');
            state.doc.tarot = { text: state.divination };
            logRevision();
            persistRecipe();
            advanceStep();
            return state.divinationInfo;
        },

        /** Resolve one divination choice point (pick-a-characteristic, the
         *  Resistance spec, the Hatred write-in). */
        async setDivinationChoice(key, value, { override = false } = {}) {
            const logRevision = assertEditable('divination', override);
            if (!state.divinationRoll) throw new Error('roll a divination first');
            state.divinationRoll.choices[key] = value;
            if (state.hasRecipe) {
                await rebuild();
            } else {
                const base = state._preDivinationDoc ?? state.doc;
                const dr = await api('POST', '/api/chargen/divination', {
                    doc: base, roll: state.divinationRoll.roll,
                    choices: state.divinationRoll.choices,
                });
                state.doc = dr.doc;
                state.divinationPending = dr.pendingChoices ?? [];
            }
            logRevision();
            persistRecipe();
        },

        /** The CB-3 advancement API, on the wizard's doc. */
        async advances() {
            const r = await api('POST', '/api/chargen/advances', { doc: state.doc });
            state.xp = r.xp;
            return r.advances;
        },
        async buy(advance, { confirmed = false, override = false } = {}) {
            const r = await api('POST', '/api/chargen/advance',
                { doc: state.doc, advance, confirmed, override, source: 'Creation' });
            state.doc = r.doc;
            state.xp = r.xp;
            persistRecipe();
            return r.entry;
        },

        /** Every choice point of the currently-selected origin members, with
         *  its current value — resolved points INCLUDED (pickers persist and
         *  reset only when their member changes). ENGINE-computed: one
         *  legality-aware expansion serves core, UI, and validator alike. */
        choicePoints() {
            return state.originInfo?.choicePoints ?? [];
        },

        /** The Equip Acolyte guidance: background kit class + RAW acquisition
         *  allowance (one Scarce-or-better item per point of Influence bonus). */
        equipmentInfo() {
            const bg = pack.backgrounds.find((b) => b.ref === state.selections.backgroundRef);
            return {
                startingEquipmentClass: bg?.startingEquipmentClass ?? '',
                // the RAW kit (Core box, corpus-extracted): each item parsed
                // into its pick-one options for the UI's dropdowns
                kit: (bg?.startingEquipment ?? []).map(parseKitItem),
                kitApplied: !!state.equipment?.kitApplied,
                acquisitions: Math.floor((state.doc?.influence ?? 0) / 10),
            };
        },

        setDetails({ name } = {}) {
            if (name) { state.details.name = name; state.doc.name = name; }
            persistRecipe();
            advanceStep();
        },

        /** Validate (build + creation findings) and close the session. */
        async finish() {
            state.completed = true;
            persistRecipe();
            const build = await api('POST', '/api/chargen/validate', { doc: state.doc });
            const character = await api('POST', '/api/character/validate', { character: state.doc });
            state.finished = true;
            advanceStep();
            return { doc: state.doc, validation: { build, character } };
        },
    };
}
