/**
 * Pure dice + arithmetic primitives. No game-rule interpretation lives here —
 * this is mechanism only (the engine layer), safe to share with every flow.
 */

/** Roll a single dN. RNG is injectable so the engine stays deterministically testable. */
export const d = (sides, rng = Math.random) => Math.floor(rng() * sides) + 1;

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
