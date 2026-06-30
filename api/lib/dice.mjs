/**
 * Pure dice + arithmetic primitives. No game-rule interpretation lives here —
 * this is mechanism only (the engine layer), safe to share with every flow.
 */

/** Roll a single dN. RNG is injectable so the engine stays deterministically
 *  testable. `sides`/`label` are passed to the rng so a tracing rng (rollScript)
 *  can record what each roll was for; Math.random and the test rng ignore them. */
export const d = (sides, rng = Math.random, label = '') => Math.floor(rng(sides, label) * sides) + 1;

/**
 * A recording, optionally-scripting RNG for the debug "force roll" feature.
 * Every `d(sides, rng, label)` call appends `{ index, sides, label, value, forced }`
 * to `.trace`. If `forced[index]` is a number, that die FACE is forced (clamped to
 * the die's range); otherwise the face is random. Returns the fraction that makes
 * `d(sides)` yield the chosen face, so it composes with the existing engine.
 */
export function rollScript(forced = [], base = Math.random) {
    const trace = [];
    const fn = (sides = 100, label = '') => {
        const index = trace.length;
        const f = forced[index];
        const want = (f !== null && f !== undefined && f !== '' && Number.isFinite(+f)) ? +f : null;
        const value = want !== null
            ? Math.min(sides, Math.max(1, Math.floor(want)))
            : Math.floor(base() * sides) + 1;
        trace.push({ index, sides, label, value, forced: want !== null });
        return (value - 0.5) / sides;
    };
    fn.trace = trace;
    return fn;
}

/** Parse "XdY+Z" / "XdY-Z" / "XdY". Returns {count, sides, flat} or null. */
export function parseDamageFormula(formula) {
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(formula));
    if (!m) return null;
    return {
        count: parseInt(m[1]),
        sides: parseInt(m[2]),
        flat: m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4]) : 0,
    };
}

/** Degrees helper — identical to Foundry roll-helpers.mjs getDegree(). */
export const getDegree = (a, b) => Math.floor(a / 10) - Math.floor(b / 10);
