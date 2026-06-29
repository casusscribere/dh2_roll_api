/**
 * Shared deterministic-RNG helpers for the DH2 engine tests.
 *
 * The engine's die roller is  d(sides, rng) = floor(rng() * sides) + 1.
 * To force a die to show value v on a roll of `sides`, rng must return a
 * number in [(v-1)/sides, v/sides). We use the midpoint (v-0.5)/sides.
 */

/**
 * Queue-driven RNG. Pass an array of { v, sides } in the exact order the
 * engine will consume dice. Each call shifts the next entry off the queue and
 * returns the fraction that makes d(sides) yield v.
 *
 * The queue is consumed in place, so build a fresh array per test.
 */
export const riggedDice = (queue) => () => {
    const next = queue.shift();
    if (next === undefined) {
        throw new Error('riggedDice queue exhausted — the engine asked for more dice than were queued');
    }
    const { v, sides } = next;
    return (v - 0.5) / sides;
};

/** Convenience: shorthand for a d100 attack/test roll. */
export const d100 = (v) => ({ v, sides: 100 });
/** Convenience: shorthand for a dN damage die. */
export const die = (v, sides) => ({ v, sides });
