/**
 * Test fixture standing in for the generated, git-ignored prose overlay
 * (api/data/chargen/prose.local.mjs). The `text` values here are INVENTED —
 * no rulebook prose lives in this repo (decision D-N); the tests only care
 * about the SHAPE of the map, so fake text is strictly better than real.
 */
export const PROSE = {
    'dh2:talent:fixture_alpha': {
        text: 'Fixture text alpha — not rulebook prose.',
        sha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        citation: { book: 'Core Rulebook', page: 123, source: 'src_dh2_core_p124' },
    },
    'dh2:trait:fixture_beta': {
        text: 'Fixture text beta — not rulebook prose.',
        sha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
        citation: { book: 'Enemies Within', page: null, source: 'src_dh2_within' },
    },
};
