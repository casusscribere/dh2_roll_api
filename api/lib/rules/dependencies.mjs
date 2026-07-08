/**
 * Talent/trait prerequisite table (RAW — DH2 core Chapter IV) + the dependency
 * checker behind the Roll page's Warnings/errors log.
 *
 * The table is enumerated AHEAD of the DSL: entries may name subjects or
 * prerequisites that have no DSL rule yet (Hammer Blow, Hip Shooting, Double
 * Tap, …). The checker only reports a violation when BOTH sides are checkable:
 *   - the SUBJECT must be active in the supplied configuration;
 *   - a talent/trait prerequisite is SKIPPED unless it is a DSL-known name
 *     (the `known` lists — /api/rules talents[]/traits[]);
 *   - a characteristic prerequisite is SKIPPED when that characteristic was
 *     not supplied (the Roll page only knows WS/BS/S/T for the attacker).
 * Authoring the DSL rule later makes a pre-enumerated dependency live with no
 * checker change. All name matching is spelling-blind (normName).
 *
 * Requirement forms (the `requires` array):
 *   'Name'                            — a talent/trait by name
 *   { characteristic: 'ws', min: 40 } — a characteristic threshold
 *   { anyOf: [req, req, …] }          — satisfied by any one branch
 */
import { normName, entryName } from './_util.mjs';

export const DEPENDENCIES = {
    talents: {
        // --- in the DSL today -------------------------------------------------
        'Ambidextrous':      { requires: [{ characteristic: 'ag', min: 30 }] },
        'Swift Attack':      { page: 131, requires: [{ characteristic: 'ws', min: 30 }] },
        'Lightning Attack':  { page: 129, requires: ['Swift Attack'] },
        'Two-Weapon Master': { page: 132, requires: ['Ambidextrous', 'Two-Weapon Wielder', { characteristic: 'ag', min: 45 }, { anyOf: [{ characteristic: 'bs', min: 40 }, { characteristic: 'ws', min: 40 }] }] },
        'Crushing Blow':     { page: 125, requires: [{ characteristic: 'ws', min: 40 }] },
        'Mighty Shot':       { page: 130, requires: [{ characteristic: 'bs', min: 40 }] },
        'Marksman':          { page: 130, requires: [{ characteristic: 'bs', min: 35 }] },
        'Precision Killer':  { page: 130, requires: [{ anyOf: [{ characteristic: 'bs', min: 40 }, { characteristic: 'ws', min: 40 }] }] },
        'Die Hard':          { page: 125, requires: [{ characteristic: 'wp', min: 40 }] },
        'Iron Jaw':          { page: 128, requires: [{ characteristic: 't', min: 40 }] },
        // Hatred, Two-Weapon Wielder: Prerequisite "—" (none).
        // --- enumerated in advance of the DSL ----------------------------------
        'Hammer Blow':       { requires: ['Crushing Blow'] },
        'Double Tap':        { page: 125, requires: ['Two-Weapon Wielder'] },
        'Hip Shooting':      { page: 128, requires: [{ characteristic: 'bs', min: 40 }, { characteristic: 'ag', min: 40 }] },
        'Deathdealer':       { page: 125, requires: [{ anyOf: [{ characteristic: 'bs', min: 45 }, { characteristic: 'ws', min: 45 }] }] },
    },
    // DH2 traits are innate — none of the authored ones carry prerequisites.
    // The structure is here so trait dependencies can be enumerated the same way.
    traits: {},
};

/** Active-list membership: entry names may carry levels/specialisations
 *  ("Hatred (Mutants)" satisfies "Hatred"); spelling-blind. */
const hasActive = (list, name) =>
    (list ?? []).some((x) => normName(entryName(x)).startsWith(normName(name)));

/**
 * Check an active configuration against DEPENDENCIES.
 * config = { talents?: [], traits?: [], characteristics?: { ws, bs, … } }
 * known  = { talents?: [], traits?: [] } — the DSL-known names; a talent/trait
 *          prerequisite outside these lists is skipped, per the contract above.
 * Returns [{ subject, kind, requirement, message, page }] — empty = no conflicts.
 */
export function checkDependencies(config = {}, known = {}) {
    const knownNames = new Set([...(known.talents ?? []), ...(known.traits ?? [])].map(normName));
    const chars = config.characteristics ?? {};
    const activeAll = [...(config.talents ?? []), ...(config.traits ?? [])];

    // → { checkable, ok, text } — `checkable: false` = skip (outside the DSL /
    //   characteristic not supplied), never a warning.
    const evalReq = (req) => {
        if (typeof req === 'string') {
            if (!knownNames.has(normName(req))) return { checkable: false };
            return { checkable: true, ok: hasActive(activeAll, req), text: `the ${req} talent` };
        }
        if (req.anyOf) {
            const subs = req.anyOf.map(evalReq).filter((s) => s.checkable);
            if (!subs.length) return { checkable: false };
            return { checkable: true, ok: subs.some((s) => s.ok), text: subs.map((s) => s.text).join(' or ') };
        }
        if (req.characteristic) {
            const v = chars[req.characteristic];
            if (v == null || v === '') return { checkable: false };
            return { checkable: true, ok: Number(v) >= req.min, text: `${req.characteristic.toUpperCase()} ${req.min}` };
        }
        return { checkable: false };
    };

    const warnings = [];
    for (const [kind, table, list] of [
        ['talent', DEPENDENCIES.talents, config.talents],
        ['trait', DEPENDENCIES.traits, config.traits],
    ]) {
        for (const [subject, entry] of Object.entries(table)) {
            if (!hasActive(list, subject)) continue;   // subject not in the configuration
            for (const req of entry.requires ?? []) {
                const r = evalReq(req);
                if (r.checkable && !r.ok) {
                    warnings.push({
                        subject, kind, requirement: r.text, page: entry.page ?? null,
                        message: `${subject} requires ${r.text}${entry.page ? ` (p.${entry.page})` : ''} — missing from the active configuration`,
                    });
                }
            }
        }
    }
    return warnings;
}
