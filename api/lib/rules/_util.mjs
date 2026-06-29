/**
 * Shared helpers for reading weapon-quality strings ("Tearing", "Proven (3)",
 * "Vengeful 9"). Used only by rule modules — this is interpretation support,
 * not engine mechanism, so it lives under rules/.
 */

/** True if any quality string starts with `name` (case-insensitive). */
export const hasQuality = (qualities, name) =>
    (qualities ?? []).some((q) => String(q).toLowerCase().startsWith(name.toLowerCase()));

/** Parse the numeric level out of a quality like "Proven (3)" / "Vengeful 9". */
export const qualityLevel = (qualities, name, fallback) => {
    const q = (qualities ?? []).map(String).find((x) => x.toLowerCase().startsWith(name.toLowerCase()));
    if (!q) return fallback;
    const m = /\((\d+)\)/.exec(q) ?? /\s(\d+)$/.exec(q);
    return m ? parseInt(m[1]) : fallback;
};
