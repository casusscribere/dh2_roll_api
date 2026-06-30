/**
 * Static-build entry point: run the whole API in the browser.
 *
 * Bundled (esbuild, IIFE) into the GitHub Pages site as a classic <script> that
 * loads BEFORE the page's app script. It patches window.fetch so any request to
 * an `/api/*` path is answered in-process by the shared router (dispatch) instead
 * of going to a network server — the front-end code is unchanged and still does
 * `fetch('/api/resolve', …)`, but there is no server. Everything (the engine, the
 * DSL, the rule + weapon data) is compiled into the bundle.
 *
 * Non-/api/ requests (style.css, rules-store.js, navigation) fall through to the
 * real fetch untouched.
 */
import { dispatch } from './api-router.mjs';

(function installLocalApi() {
    if (typeof window === 'undefined' || !window.fetch) return;
    const realFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const apiPath = apiPathname(url);
        if (!apiPath) return realFetch(input, init);   // not an /api/ call → real network

        const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        let body = {};
        const raw = init.body ?? (typeof input === 'object' ? input.body : undefined);
        if (raw) { try { body = JSON.parse(raw); } catch { body = {}; } }

        const { status, body: out } = dispatch(method, apiPath, body);
        return new Response(JSON.stringify(out), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    // Mark that the local API is live (useful for debugging / a "static build" badge).
    window.__DH2_LOCAL_API__ = true;

    /** Extract the `/api/...` pathname from an absolute or relative URL, or null. */
    function apiPathname(u) {
        try {
            const parsed = new URL(u, window.location.href);
            return parsed.pathname.startsWith('/api/') ? parsed.pathname : null;
        } catch {
            const m = String(u).match(/\/api\/[^?#]*/);
            return m ? m[0] : null;
        }
    }
})();
