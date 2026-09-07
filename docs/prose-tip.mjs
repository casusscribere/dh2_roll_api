/**
 * Prose hover cards (ST-2, Phase 4/E-5) — resolver + hover panel.
 *
 * TOP HALF IS DOM-FREE (api/test/prose-tip.test.mjs drives it headless):
 * resolveTip merges, in priority order,
 *   1. the prose overlay (GET /api/prose): verbatim rulebook text — present on
 *      local builds only (decision D-N: public surfaces CITE, private QUOTE);
 *   2. ST-4 in-doc `description`/`citation` on CUSTOM entries (their text
 *      travels in the document, never by ref);
 *   3. the chargen pack's public `citation` facts.
 * On the Pages build the overlay reports available:false and the card shows
 * the citation plus "text available in local builds".
 *
 * DOM wiring lives ONLY in mount(): delegated hover/focus on any element
 * carrying `data-ref` (canon) or `data-tip-text`/`data-tip-cite` (custom
 * entries render their in-doc text straight into the attributes).
 */

const PACK_CITATION_LISTS = [
    'talents', 'traits', 'skills', 'homeworlds', 'backgrounds', 'roles', 'eliteAdvances',
];

/** 'Core Rulebook p.120' | 'Enemies Without' (page-less) | null. */
export function formatCitation(citation) {
    if (!citation || !citation.book) return null;
    return citation.page != null ? `${citation.book} p.${citation.page}` : citation.book;
}

/** The pack entry carrying a given ref, across every citation-bearing list. */
export function packEntryByRef(pack, ref) {
    if (!pack || !ref) return null;
    for (const list of PACK_CITATION_LISTS) {
        const hit = (pack[list] ?? []).find((e) => e.ref === ref);
        if (hit) return hit;
    }
    return null;
}

const stripParen = (x) => String(x ?? '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();

/** Best-effort ref for a display NAME (roster docs carry bare strings).
 *  Exact name first, then the parenthetical-stripped base — so
 *  "Weapon Training (Las)" finds the Weapon Training specialist talent. */
export function refForName(pack, name) {
    if (!pack || !name) return null;
    const target = String(name).trim().toLowerCase();
    for (const list of PACK_CITATION_LISTS) {
        const hit = (pack[list] ?? []).find((e) => String(e.name).toLowerCase() === target);
        if (hit) return hit.ref;
    }
    const base = stripParen(name);
    if (!base) return null;
    for (const list of PACK_CITATION_LISTS) {
        const hit = (pack[list] ?? []).find((e) => stripParen(e.name) === base);
        if (hit) return hit.ref;
    }
    return null;
}

/**
 * @param {string|object} refOrEntry  A corpus ref, or an entry object
 *        (custom entries carry ST-4 description/citation; canon entries a ref).
 * @param {{prose?: {available: boolean, prose: object}, pack?: object}} ctx
 * @returns {{text: string|null, citation: string|null, hint: string|null}}
 */
export function resolveTip(refOrEntry, { prose, pack } = {}) {
    if (refOrEntry && typeof refOrEntry === 'object') {
        const e = refOrEntry;
        if (e.description) return { text: e.description, citation: formatCitation(e.citation), hint: null };
        if (e.ref) return resolveTip(e.ref, { prose, pack });
        return { text: null, citation: formatCitation(e.citation), hint: null };
    }
    const ref = String(refOrEntry ?? '');
    if (!ref) return { text: null, citation: null, hint: null };
    const overlayEntry = prose?.available ? prose.prose?.[ref] : null;
    const packEntry = packEntryByRef(pack, ref);
    if (overlayEntry) {
        return {
            text: overlayEntry.text ?? null,
            citation: formatCitation(overlayEntry.citation ?? packEntry?.citation),
            hint: null,
        };
    }
    if (packEntry) {
        return {
            text: null,
            citation: formatCitation(packEntry.citation),
            hint: prose?.available ? null : 'text available in local builds',
        };
    }
    return { text: null, citation: null, hint: null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * DOM wiring — everything below touches document/window; tests never call it.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Attach the hover panel to `root` (default: document.body). Elements opt in
 * with `data-ref="dh2:talent:jaded"` (canon) or `data-tip-text`/`data-tip-cite`
 * (custom entries). One panel per page; hover and keyboard focus both open it.
 * @param {{root?: Element, api?: (m: string, p: string) => Promise<any>}} opts
 *        `api` must resolve GET routes (the pages' fetch wrapper qualifies).
 */
export function mount({ root = document.body, api } = {}) {
    let prose = null;                       // fetched once, on first hover
    let pack = null;
    let panel = null;
    let pending = 0;

    const ensurePanel = () => {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.className = 'prose-tip';
        panel.setAttribute('role', 'tooltip');
        panel.hidden = true;
        document.body.appendChild(panel);
        return panel;
    };

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const show = (el, tip) => {
        if (!tip.text && !tip.citation) return;
        const p = ensurePanel();
        p.innerHTML = [
            tip.text && `<div class="pt-text">${esc(tip.text)}</div>`,
            tip.citation && `<div class="pt-cite">${esc(tip.citation)}</div>`,
            tip.hint && `<div class="pt-hint">${esc(tip.hint)}</div>`,
        ].filter(Boolean).join('');
        const r = el.getBoundingClientRect();
        p.style.left = `${Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 340)}px`;
        p.style.top = `${r.bottom + window.scrollY + 6}px`;
        p.hidden = false;
    };

    const hide = () => { if (panel) panel.hidden = true; };

    const tipFor = async (el) => {
        if (el.dataset.tipText || el.dataset.tipCite) {
            return { text: el.dataset.tipText || null, citation: el.dataset.tipCite || null, hint: null };
        }
        if (!prose) {
            const seq = ++pending;
            [prose, pack] = await Promise.all([
                api('GET', '/api/prose').catch(() => ({ available: false, prose: {} })),
                api('GET', '/api/chargen/pack').catch(() => null),
            ]);
            if (seq !== pending) return null;             // a later hover superseded us
        }
        const ref = el.dataset.ref
            || (el.dataset.tipname ? refForName(pack, el.dataset.tipname) : '');
        return resolveTip(ref, { prose, pack });
    };

    const over = async (ev) => {
        const el = ev.target.closest?.('[data-ref], [data-tipname], [data-tip-text], [data-tip-cite]');
        if (!el || !root.contains(el)) return;
        const tip = await tipFor(el);
        if (tip) show(el, tip);
    };

    root.addEventListener('mouseover', over);
    root.addEventListener('focusin', over);
    root.addEventListener('mouseout', (ev) => {
        if (ev.target.closest?.('[data-ref], [data-tipname], [data-tip-text], [data-tip-cite]')) hide();
    });
    root.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
}
