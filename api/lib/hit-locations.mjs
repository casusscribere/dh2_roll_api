/**
 * Hit-location tables and lookup (DH2 core p.228, Table 7-6).
 *
 * This is DH2 reference DATA + the pure reversal mechanism, not a per-trait
 * interpretation, so it sits in the engine layer rather than under rules/.
 */

/** Reverse the digits of the attack roll to find the location. */
export function getHitLocationForRoll(roll) {
    const reversed = parseInt(String(roll).split('').reverse().join(''));
    const table = [
        { name: 'Head', min: 0, max: 10 },
        { name: 'Right Arm', min: 11, max: 20 },
        { name: 'Left Arm', min: 21, max: 30 },
        { name: 'Body', min: 31, max: 70 },
        { name: 'Right Leg', min: 71, max: 85 },
        { name: 'Left Leg', min: 86, max: 100 },
    ];
    return table.find((i) => reversed >= i.min && reversed <= i.max)?.name ?? 'Body';
}

/** Multiple-hit location chains (DH2 core Table 7-6 / hit-locations.mjs). */
export const ADDITIONAL_HIT_LOCATIONS = {
    'Head':      ['Head', 'Head', 'Right Arm', 'Body', 'Left Arm', 'Body'],
    'Right Arm': ['Right Arm', 'Right Arm', 'Body', 'Head', 'Body', 'Right Arm'],
    'Left Arm':  ['Left Arm', 'Left Arm', 'Body', 'Head', 'Body', 'Left Arm'],
    'Body':      ['Body', 'Body', 'Left Arm', 'Head', 'Right Arm', 'Body'],
    'Right Leg': ['Right Leg', 'Right Leg', 'Body', 'Right Arm', 'Head', 'Body'],
    'Left Leg':  ['Left Leg', 'Left Leg', 'Body', 'Left Arm', 'Head', 'Body'],
};

export const HIT_LOCATIONS = ['Head', 'Right Arm', 'Left Arm', 'Body', 'Right Leg', 'Left Leg'];
