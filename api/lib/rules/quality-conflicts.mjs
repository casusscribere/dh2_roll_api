/**
 * Weapon-quality conflict detection (the "which qualities override" system).
 *
 * Some DH2 weapon qualities are opposed and mutually exclusive — a weapon should
 * never carry more than one member of an axis (e.g. Accurate vs Inaccurate). The
 * project does NOT collapse these onto a single numeric severity scale, because
 * the opposed qualities are ASYMMETRIC: they fire at different checkpoints and
 * carry different side-effects (Accurate adds an aim bonus AND bonus damage,
 * while Inaccurate merely nullifies the Aim action; Unwieldy forbids Parry
 * entirely while Unbalanced only penalises it). Forcing them onto one axis would
 * distort the rules. Instead:
 *
 *   1. Each quality is its own self-contained rule (one per quality).
 *   2. When two qualities legitimately write the SAME context field (e.g.
 *      Reliable/Unreliable both set jam_threshold), the checkpoint `priority`
 *      ordering — and, where one quality should override another outright, the
 *      `suppress "Name"` action (e.g. Overheats suppressing the Jam mechanic) —
 *      determine the winner deterministically.
 *   3. A weapon carrying more than one member of a mutually-exclusive group is a
 *      DATA error, surfaced here as a warning effect rather than silently
 *      double-applied. We do not auto-resolve it: the author should fix the data.
 *
 * This module is the concrete embodiment of rule (3): a load-registered check
 * that runs first at POST_ROLL and emits a "Quality conflict" note naming any
 * mutually-exclusive qualities found together.
 */
import { CHECKPOINTS } from '../pipeline.mjs';
import { hasQuality } from './_util.mjs';

/** Mutually-exclusive weapon-quality groups (DH2 core p.144–150). Listed in
 *  descending severity within each axis, for documentation. */
export const EXCLUSION_GROUPS = [
    { axis: 'accuracy', members: ['Accurate', 'Inaccurate'] },
    { axis: 'reliability', members: ['Reliable', 'Unreliable'] },
    { axis: 'wieldiness', members: ['Unwieldy', 'Unbalanced', 'Balanced'] },
];

/** Return the conflicts present on a quality list: [{ axis, members:[…] }, …]. */
export function findQualityConflicts(qualities = []) {
    const out = [];
    for (const g of EXCLUSION_GROUPS) {
        const present = g.members.filter((m) => hasQuality(qualities, m));
        if (present.length > 1) out.push({ axis: g.axis, members: present });
    }
    return out;
}

/**
 * A single native effect, registered into every registry. Runs first at
 * POST_ROLL (priority −100), where ctx.effects already exists, and appends a
 * warning for each mutually-exclusive group the weapon over-populates.
 */
export const qualityConflictEffects = [
    {
        id: 'quality-conflict-check',
        source: 'mechanic',
        name: 'Quality conflict check',
        checkpoint: CHECKPOINTS.POST_ROLL,
        priority: -100,
        when: (ctx) => findQualityConflicts(ctx.qualities).length > 0,
        apply: (ctx) => {
            for (const c of findQualityConflicts(ctx.qualities)) {
                (ctx.effects ??= []).push({
                    name: 'Quality conflict',
                    effect: `Mutually-exclusive ${c.axis} qualities on one weapon: ${c.members.join(' + ')}. `
                        + 'These are opposed in DH2 RAW — a weapon should carry at most one. '
                        + 'Their rules will both fire and may compound; correct the weapon data.',
                });
            }
        },
    },
];
