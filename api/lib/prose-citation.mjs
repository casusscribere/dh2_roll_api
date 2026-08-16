/**
 * Public citation facts (ST-1, decision D-N).
 *
 * Split out from prose.mjs deliberately: these two helpers are PURE and carry no
 * copyrighted expression, so they ship everywhere — including the public Pages
 * bundle, where prose.mjs itself is replaced by a cite-only stub
 * (scripts/build-static.mjs). Book name + printed page + corpus source id are
 * facts; only `description_verbatim` is restricted.
 */

/** Book label per `<book>` token of a `src_dh2_<book>_p<NN>` source id. */
const BOOK_LABELS = {
    core: 'Core Rulebook',
    forgotten: 'Forgotten Gods',
    within: 'Enemies Within',
    without: 'Enemies Without',
    beyond: 'Enemies Beyond',
    errata: 'Errata',
    faq: 'FAQ',
};

/** Human book name for a corpus source id, or null when the token is unknown.
 *  Page-less ids exist in the corpus (e.g. the `ace` role → `src_dh2_without`). */
export function bookLabel(sourceId) {
    const m = /^src_dh2_([a-z]+)/.exec(String(sourceId ?? ''));
    return (m && BOOK_LABELS[m[1]]) ?? null;
}

/**
 * Public citation for a corpus entry: `{ book, page, source }`.
 *
 * The `_text_*` pair points at where the DESCRIPTION text sits, which is often a
 * different page from the entry's stat-table `_source` — so the pair is taken
 * whole (source AND page together) and never mixed. `page` is the PRINTED book
 * page (`_text_book_page` / `_book_page`), int or null.
 */
export function citationOf(entry) {
    const e = entry ?? {};
    const useText = e._text_source !== undefined && e._text_source !== null;
    const source = (useText ? e._text_source : e._source) ?? null;
    const page = (useText ? e._text_book_page : e._book_page) ?? null;
    return {
        book: bookLabel(source),
        page: Number.isInteger(page) ? page : null,
        source: source === null ? null : String(source),
    };
}
