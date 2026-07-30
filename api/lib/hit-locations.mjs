/**
 * Hit-location tables and lookup (DH2 core p.226, Table 7–3).
 *
 * This is DH2 reference DATA + the pure reversal mechanism, not a per-trait
 * interpretation, so it sits in the engine layer rather than under rules/.
 */

/**
 * Reverse the digits of the attack roll to find the location.
 *
 * The roll is read as TWO digits (DH2 core p.226: "a roll of 20 becomes 02"),
 * so 07 reverses to 70 — Body, not Head. The version this was ported from
 * reversed the roll's string form, which is a no-op for a single-digit roll
 * and sent every roll of 02–09 to the Head.
 *
 * A roll of 100 yields "100" (padStart does not truncate) → "01" → 1 → Head;
 * `rules/combat.py` does the same, and a 100 always misses, so location is
 * never consulted for it in play. The `reversed === 0` guard is consequently
 * unreachable and is kept only to mirror combat.py line-for-line.
 */
export function getHitLocationForRoll(roll) {
    const s = String(roll).padStart(2, '0');
    let reversed = parseInt(s[1] + s[0], 10);
    if (reversed === 0) reversed = 100;
    const table = [
        { name: 'Head', min: 1, max: 10 },
        { name: 'Right Arm', min: 11, max: 20 },
        { name: 'Left Arm', min: 21, max: 30 },
        { name: 'Body', min: 31, max: 70 },
        { name: 'Right Leg', min: 71, max: 85 },
        { name: 'Left Leg', min: 86, max: 100 },
    ];
    return table.find((i) => reversed >= i.min && reversed <= i.max)?.name ?? 'Body';
}

/** Multiple-hit location chains (DH2 core Table 7–3 / hit-locations.mjs). */
export const ADDITIONAL_HIT_LOCATIONS = {
    'Head':      ['Head', 'Head', 'Right Arm', 'Body', 'Left Arm', 'Body'],
    'Right Arm': ['Right Arm', 'Right Arm', 'Body', 'Head', 'Body', 'Right Arm'],
    'Left Arm':  ['Left Arm', 'Left Arm', 'Body', 'Head', 'Body', 'Left Arm'],
    'Body':      ['Body', 'Body', 'Left Arm', 'Head', 'Right Arm', 'Body'],
    'Right Leg': ['Right Leg', 'Right Leg', 'Body', 'Right Arm', 'Head', 'Body'],
    'Left Leg':  ['Left Leg', 'Left Leg', 'Body', 'Left Arm', 'Head', 'Body'],
};

export const HIT_LOCATIONS = ['Head', 'Right Arm', 'Left Arm', 'Body', 'Right Leg', 'Left Leg'];
