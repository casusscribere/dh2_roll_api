/**
 * Table 2-9: Divinations — MECHANICAL interpretations, keyed by the row's
 * d100 range low bound (matching `pack.divinations[].range[0]`).
 *
 * App-authored encodings of the rulebook effects (Core pp.84-85): the verbatim
 * prophecy/effect text itself is D-N material and never appears here — it
 * lives in the corpus and reaches local builds via the prose overlay
 * (`dh2:divination:<lo>`). What this file carries is the same class of
 * mechanical fact the pack already publishes (characteristic deltas, talent
 * names, aptitude-style lists).
 *
 * Op vocabulary (applyDivination, api/lib/advancement.mjs):
 *   { char: { per: 5, ag: -3 } }                    unconditional characteristic modifiers
 *   { charChoice: { options: ['ag','int'], delta } } player picks ONE characteristic
 *   { talent: 'Jaded', fallback: { char: {...} } }  grant — or fallback when already held
 *   { talent: 'Resistance', specOptions: [...] }    specialist grant with fixed spec choices
 *   { talent: 'Hatred', specOpen: true }            specialist grant, write-in spec
 *   { skill: 'Dodge', fallback: { char: {...} } }   Known-skill (rank 1) grant or fallback
 *   { disorder: 'Phobia' }                          Mental Disorder gained
 *   { fate: 1 }                                     Fate threshold bump
 * Row flag `manual: true` = the row (or its remainder) is a session-conditional
 * or table-roll rule the engine cannot track; the Builder shows a
 * consult-the-book note (full text on local builds via the prose overlay).
 */
export const DIVINATION_EFFECTS = {
    1:   { ops: [], manual: true },                                     // roll on Table 8-15: Malignancies
    2:   { ops: [{ char: { per: 5 } }, { disorder: 'Phobia' }] },
    6:   { ops: [{ talent: 'Jaded', fallback: { char: { wp: 2 } } }] },
    10:  { ops: [{ char: { ag: -3 } }], manual: true },                 // + once-per-session crit escape
    14:  { ops: [{ talent: 'Hatred', specOpen: true, fallback: { char: { s: 2 } } }] },
    18:  { ops: [{ charChoice: { options: ['ag', 'int'], delta: 3 } },
                 { charChoice: { options: ['ws', 'bs'], delta: -3 } }] },
    22:  { ops: [{ talent: 'Quick Draw', fallback: { char: { ag: 2 } } }] },
    26:  { ops: [{ char: { per: 3 } }], manual: true },                 // + per-session Corruption rider
    30:  { ops: [{ char: { int: -3 } }], manual: true },                // + per-session Corruption rider
    34:  { ops: [{ charChoice: { options: ['fel', 's'], delta: 3 } },
                 { charChoice: { options: ['t', 'wp'], delta: -3 } }] },
    39:  { ops: [], manual: true },                                     // Mental Disorder selection rule
    44:  { ops: [{ charChoice: { options: ['t', 'wp'], delta: 3 } },
                 { charChoice: { options: ['fel', 's'], delta: -3 } }] },
    50:  { ops: [], manual: true },                                     // Malignancy selection rule
    55:  { ops: [{ charChoice: { options: ['ws', 'bs'], delta: 3 } },
                 { charChoice: { options: ['ag', 'int'], delta: -3 } }] },
    60:  { ops: [{ char: { per: -3 } }], manual: true },                // + per-session Insanity rider
    64:  { ops: [{ char: { wp: 3 } }], manual: true },                  // + per-session Insanity rider
    68:  { ops: [{ char: { per: 2 } }], manual: true },                 // + Awareness re-roll vs Surprise
    72:  { ops: [{ char: { t: -3 } }], manual: true },                  // + once-per-session +20 rider
    76:  { ops: [{ talent: 'Resistance', specOptions: ['Cold', 'Heat', 'Fear'],
                   fallback: { char: { t: 2 } } }] },
    80:  { ops: [], manual: true },                                     // per-session Fatigue reduction
    84:  { ops: [{ talent: 'Keen Intuition', fallback: { char: { int: 2 } } }] },
    88:  { ops: [{ skill: 'Dodge', fallback: { char: { ag: 2 } } }] },
    92:  { ops: [{ talent: 'Clues from the Crowds', fallback: { char: { fel: 2 } } }] },
    96:  { ops: [], manual: true },                                     // once-ever Fate-burn escape
    100: { ops: [{ fate: 1 }] },
};
