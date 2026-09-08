/**
 * Psychic strength reference tables (DH2 core, Chapter VI) — native rule DATA
 * the power.* pipeline reads, kept in the rules layer like the combat-action
 * tables in combat-actions.mjs. The engine flow (engine.mjs resolveFocusPower)
 * owns the mechanism; the numbers live here.
 *
 *  - Table 6–1 Psychic Strength (p.195): how far each class of psyker may PUSH
 *    the effective psy rating above the base rating. The per-class Phenomena
 *    modifiers from the same table are DSL content (data/rules/psychic.dsl).
 *  - Psychic Bolts (p.198): hit counts for the Bolt / Barrage / Storm / Blast
 *    attack modes, capped at the effective psy rating.
 */

/** id → { label, maxPush, note }. Order = the UI's dropdown order. */
export const PSYKER_CLASSES = Object.freeze({
    bound: { label: 'Bound (sanctioned psykers, Astropaths, Librarians, sorcerers)', maxPush: 2, note: 'Phenomena on doubles; pushing (up to +2) triggers Phenomena on anything but doubles.' },
    unbound: { label: 'Unbound (wyrds, unsanctioned psykers, mortal sorcerers)', maxPush: 4, note: '+10 to Phenomena on doubles; pushing (up to +4) rolls Phenomena at +5 per point added.' },
    daemonic: { label: 'Daemonic (psychic Daemons, Daemonhosts, Daemon Princes)', maxPush: 3, note: '+10 to Phenomena; pushing (up to +3) at +10 per point; unaffected unless the result is Perils of the Warp.' },
});

/** Maximum push for a class id (unknown/none → 0). */
export const maxPushFor = (cls) => PSYKER_CLASSES[String(cls ?? '').toLowerCase()]?.maxPush ?? 0;

/** Psyker classes as a list for /api/options. */
export const psykerClassList = () => Object.entries(PSYKER_CLASSES).map(([id, c]) => ({ id, ...c }));

/** Psychic attack modes (p.198) → hit count on a SUCCESSFUL Focus Power test.
 *  `null` = every target in the area (Blast). Barrage/Storm cap at the
 *  effective psy rating. */
export const PSYCHIC_ATTACK_MODES = Object.freeze({
    bolt: { label: 'Psychic Bolt', hits: () => 1, note: 'one hit; Dodged like a ranged attack' },
    barrage: { label: 'Psychic Barrage', hits: (dos, pr) => Math.min(pr, 1 + Math.floor(Math.max(0, dos - 1) / 2)), note: 'one hit + one per two extra DoS, max the effective psy rating; first hit on the chosen target, the rest within 2 m' },
    storm: { label: 'Psychic Storm', hits: (dos, pr) => Math.min(pr, dos), note: 'one hit per DoS, max the effective psy rating; Dodged like auto-fire' },
    blast: { label: 'Psychic Blast', hits: () => null, note: 'every target within the radius is hit; Dodged like an area-effect attack' },
});

/** Hits for an attack mode: 0 on a failed test; null for Blast (area). */
export function psychicHits(mode, success, dos, effectivePsyRating) {
    const m = PSYCHIC_ATTACK_MODES[String(mode ?? '').toLowerCase()];
    if (!m) return undefined;
    if (!success) return 0;
    return m.hits(dos, Math.max(1, effectivePsyRating));
}
