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

/** The named seams in the roll/attack flows where effects may fire. */
export const CHECKPOINTS = Object.freeze({
    // --- to-hit test ---
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
    // --- defensive reaction ---
    PARRY: 'PARRY',                   // modifiers for a Parry (WS) test
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
    }

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
        if (eff.when && !eff.when(ctx)) continue;
        eff.apply(ctx);
        if (ctx && Array.isArray(ctx.log)) {
            ctx.log.push({ checkpoint, effect: eff.id ?? '(anonymous)', source: eff.source });
        }
    }
}
