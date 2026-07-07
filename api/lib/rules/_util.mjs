/**
 * Canonical levelled-entry helpers for qualities / talents / traits.
 *
 * Stage 1 (see DSL_ARCHITECTURE.md F5): the canonical INTERNAL form of a
 * levelled entry is `{ name, level }` — display strings like "Proven (3)" or
 * "Vengeful 9" are parsed ONCE at the API boundary (canonList, applied where
 * RollContexts are built). Every reader here still tolerates raw strings, so
 * uncanonicalised paths and legacy callers keep working; new code should treat
 * `{ name, level }` as the shape (it is also 1:1 with Foundry's attackSpecial
 * items). Used only by rule modules — interpretation support, not engine
 * mechanism, so it lives under rules/.
 */

/** The display name of an entry: `{ name }` object or raw string. */
export const entryName = (x) => (x && typeof x === 'object') ? String(x.name ?? '') : String(x ?? '');

/** Parse "Name (3)" / "Name 3" → { name, level }; objects pass through. */
export const canonEntry = (x) => {
    if (x && typeof x === 'object') {
        return { name: String(x.name ?? ''), level: x.level ?? null };
    }
    const s = String(x ?? '').trim();
    const m = /\((\d+)\)\s*$/.exec(s) ?? /\s(\d+)$/.exec(s);
    return m
        ? { name: s.slice(0, m.index).trim(), level: parseInt(m[1]) }
        : { name: s, level: null };
};

/** Canonicalise a mixed list of strings / objects to [{ name, level }] . */
export const canonList = (list) => (list ?? []).map(canonEntry);

/** The numeric level of an entry, or null (object `.level`, or parsed from a string). */
export const entryLevel = (x) => {
    if (x && typeof x === 'object') return x.level ?? null;
    const m = /\((\d+)\)/.exec(String(x ?? '')) ?? /\s(\d+)$/.exec(String(x ?? ''));
    return m ? parseInt(m[1]) : null;
};

/** True if any entry's name starts with `name` (case-insensitive prefix match,
 *  so "Proven (3)" and { name: "Proven", level: 3 } both satisfy "Proven"). */
export const hasQuality = (qualities, name) =>
    (qualities ?? []).some((q) => entryName(q).toLowerCase().startsWith(String(name).toLowerCase()));

/** The level of the first entry matching `name`, or `fallback` if absent/unlevelled. */
export const qualityLevel = (qualities, name, fallback) => {
    const q = (qualities ?? []).find((x) => entryName(x).toLowerCase().startsWith(String(name).toLowerCase()));
    if (q === undefined) return fallback;
    return entryLevel(q) ?? fallback;
};
