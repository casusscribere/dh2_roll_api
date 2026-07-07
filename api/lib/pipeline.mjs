/**
 * Checkpoint pipeline — the engine's extension mechanism.
 *
 * The roll/attack flows in engine.mjs own the control flow and the universal
 * d100 / damage / soak math. At fixed *checkpoints* they invoke every effect a
 * Registry has bound to that checkpoint, letting rule interpretations (traits,
 * talents, weapon qualities — see lib/rules/) read and mutate a shared context
 * WITHOUT the engine knowing anything about the specific rule.
 *
 * This file contains ZERO game-rule content. It is pure plumbing.
 */

/**
 * The named seams where effects may fire, grouped into PIPELINES (Phase 3 /
 * DSL_ARCHITECTURE.md F3). The `attack` pipeline is the DEFAULT namespace — its
 * checkpoint ids stay unqualified ("MODIFIERS") for v1 compatibility, and the
 * compiler normalises an explicit `attack.` prefix away. Every other pipeline
 * uses qualified ids ("test.MODIFIERS"). New pipelines land here as they are
 * built: `test` (generic characteristic/skill tests) now; `power`, `upkeep`,
 * `ship_attack` per the roadmap.
 */
export const CHECKPOINTS = Object.freeze({
    // --- attack pipeline (default namespace) — to-hit test ---
    MODIFIERS: 'MODIFIERS',           // accumulate to-hit modifiers before the d100
    POST_ROLL: 'POST_ROLL',           // after the d100: jam / overheat / all-out, may cancel success
    ON_MISS: 'ON_MISS',               // after a missed attack (e.g. Blast scatter)
    // --- hit count ---
    HIT_COUNT_MULT: 'HIT_COUNT_MULT', // multiply extra hits (runs before the RoF cap)
    HIT_COUNT_BONUS: 'HIT_COUNT_BONUS', // add flat extra hits (runs after the RoF cap)
    // --- per hit ---
    PENETRATION: 'PENETRATION',       // adjust penetration
    // --- per-hit damage roll ---
    DAMAGE_POOL: 'DAMAGE_POOL',       // shape the dice pool (extra dice, keep-highest)
    DIE_ADJUST: 'DIE_ADJUST',         // per-die transforms + Righteous Fury threshold
    DAMAGE_MODS: 'DAMAGE_MODS',       // add flat / bonus-dice damage modifiers
    ON_HIT: 'ON_HIT',                 // per hit, after soak: on-hit target effects (Concussive, Crippling)
    // --- defensive reaction ---
    PARRY: 'PARRY',                   // modifiers for a Parry (WS) test
    POST_PARRY: 'POST_PARRY',         // after the Parry test, once success is known (Power Field weapon destruction)
    EVASION: 'EVASION',               // modifiers for a Dodge (Ag) evasion test
    // --- test pipeline: generic characteristic / skill tests (d100 box, Fear,
    //     acquisition, …). Rules gate on test_name / has_talent / conditions. ---
    TEST_MODIFIERS: 'test.MODIFIERS', // accumulate modifiers before a generic test
    TEST_POST_ROLL: 'test.POST_ROLL', // after a generic test resolves (narrative effects, may cancel)
    // --- upkeep pipeline (Phase 4): per-actor ticks against the EncounterState.
    //     Rules read the actor's active conditions and declare damage / tests;
    //     the engine owns duration decrement, severity decay, and cooldowns. ---
    UPKEEP_TURN_START: 'upkeep.TURN_START', // start of the actor's turn (On Fire burns, …)
    UPKEEP_TURN_END: 'upkeep.TURN_END',     // end of the actor's turn (Toxified test, cooldowns clear)
    UPKEEP_ROUND_END: 'upkeep.ROUND_END',   // end of the round (Haywire decay, durations tick)
});

/** pipeline → its checkpoint ids (unqualified ids belong to `attack`). */
export const PIPELINES = Object.freeze({
    attack: Object.values(CHECKPOINTS).filter((c) => !c.includes('.')),
    test: Object.values(CHECKPOINTS).filter((c) => c.startsWith('test.')),
    upkeep: Object.values(CHECKPOINTS).filter((c) => c.startsWith('upkeep.')),
});

const CHECKPOINT_SET = new Set(Object.values(CHECKPOINTS));

/**
 * An Effect is the unit a rule contributes:
 *   { id, source, checkpoint, priority?, when?(ctx), apply(ctx) }
 * - `when` is the ACTIVATION predicate ("is this rule in effect right now?").
 *   Omitted ⇒ always active.
 * - `apply` performs the mutation on the context.
 * - `priority` orders effects within a checkpoint (lower first; default 0).
 *   Convention: injectors ~0–49, additive bonuses ~50–99, cancellers/clamps 100+.
 */
export class Registry {
    constructor() {
        this._buckets = new Map();
        this._seq = 0;
        this._tables = new Map();   // name → compiled roll_table (for the roll_on action)
    }

    /** Register a compiled roll_table (keyed case-insensitively by name). */
    addTable(table) {
        if (table && table.name) this._tables.set(String(table.name).toLowerCase(), table);
        return this;
    }
    addTables(tables = []) { for (const t of tables) this.addTable(t); return this; }
    /** Look up a roll_table by name (case-insensitive), or undefined. */
    table(name) { return this._tables.get(String(name ?? '').toLowerCase()); }
    tables() { return [...this._tables.values()]; }

    add(effect) {
        if (!effect || typeof effect.apply !== 'function' || !CHECKPOINT_SET.has(effect.checkpoint)) {
            throw new Error(`Invalid effect: needs a known checkpoint and an apply() (got ${effect?.id ?? effect})`);
        }
        const e = { priority: 0, ...effect, _seq: this._seq++ };
        if (!this._buckets.has(e.checkpoint)) this._buckets.set(e.checkpoint, []);
        this._buckets.get(e.checkpoint).push(e);
        return this;
    }

    addAll(effects = []) {
        for (const e of effects) this.add(e);
        return this;
    }

    /** Effects bound to a checkpoint, ordered by (priority, insertion). */
    at(checkpoint) {
        const list = this._buckets.get(checkpoint) ?? [];
        return [...list].sort((a, b) => (a.priority - b.priority) || (a._seq - b._seq));
    }

    all() {
        return [...this._buckets.values()].flat();
    }
}

/**
 * Fire every active effect at `checkpoint` against `ctx`, in priority order.
 * Each firing is appended to ctx.log (if present) for an explainable roll trace.
 */
export function runCheckpoint(registry, checkpoint, ctx) {
    for (const eff of registry.at(checkpoint)) {
        // a `suppress "Name"` action earlier in this run can skip a later effect by
        // name (e.g. Overheats suppressing the baseline Jam mechanic).
        if (ctx?.suppressed?.has(eff.name)) continue;
        if (eff.when && !eff.when(ctx)) continue;
        eff.apply(ctx);
        if (ctx && Array.isArray(ctx.log)) {
            ctx.log.push({ checkpoint, effect: eff.id ?? '(anonymous)', source: eff.source });
        }
    }
}
