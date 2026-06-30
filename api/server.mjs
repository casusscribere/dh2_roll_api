/**
 * DH2 Roll API — minimalist Express server.
 * Run:  npm install && npm start   (default http://localhost:3210)
 *
 * The route behaviour lives in lib/api-router.mjs (dispatch), shared verbatim
 * with the static GitHub Pages build (see scripts/build-static.mjs). This file
 * is now just the HTTP transport + static file serving.
 */
import express from 'express';
import { realpathSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { dispatch } from './lib/api-router.mjs';
import { weaponsJson as weaponData } from './lib/rules/sources.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
// Serve the front-end (UI) from the sibling ui/ directory.
app.use(express.static(join(__dirname, '..', 'ui')));

const send = (res, { status, body }) => res.status(status).json(body);

// GET endpoints — reference data for building forms + the DSL reference.
for (const path of ['/api/weapons', '/api/options', '/api/rules', '/api/dsl-docs', '/api/rules/source']) {
    app.get(path, (req, res) => send(res, dispatch('GET', path)));
}

// POST endpoints — validate, single rolls, parry, full + stepped engagement.
//   /api/rules/validate           { rules: "<dsl text>" }       — parse-check
//   /api/test  /api/damage  /api/soak  /api/parry  /api/attack
//   /api/resolve                  full engagement (forcedRolls → rollTrace)
//   /api/engage                   one engagement phase (stepped UI)
for (const path of ['/api/rules/validate', '/api/test', '/api/damage', '/api/soak', '/api/parry', '/api/attack', '/api/resolve', '/api/engage']) {
    app.post(path, (req, res) => send(res, dispatch('POST', path, req.body ?? {})));
}

// Export the app so tests can mount it on an ephemeral port without listening.
export { app, weaponData };

// Start a server only when run directly (node server.mjs), not when imported.
// realpathSync canonicalises symlinks so the comparison holds under bind mounts.
const isMain = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();
if (isMain) {
    const PORT = process.env.PORT || 3210;
    app.listen(PORT, () => console.log(`DH2 Roll API listening on http://localhost:${PORT}`));
}
