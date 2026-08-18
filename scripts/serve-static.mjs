/**
 * Preview the built static site (./docs) exactly as GitHub Pages would — a plain
 * static file server with NO /api backend. If the UI works against this, it will
 * work on Pages. Run:  npm run serve:static   (default http://localhost:8080)
 */
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, normalize, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = process.env.DH2_DOCS_DIR ?? join(__dirname, '..', 'docs');
const PORT = process.env.PORT || 8080;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/**
 * The request handler, exported so it can be exercised directly.
 *
 * This used to be an anonymous callback passed straight to createServer, with
 * .listen() called at MODULE SCOPE — so merely importing this file bound a
 * port, and the route/MIME logic was reachable only by intercepting
 * http.createServer. A test that imported it simply hung.
 */
export async function handler(req, res) {
    try {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        let rel = normalize(urlPath).replace(/^(\.\.[\\/])+/, '');
        if (rel === '/' || rel === '\\') rel = '/index.html';
        let file = join(docsDir, rel);
        const s = await stat(file).catch(() => null);
        if (s && s.isDirectory()) file = join(file, 'index.html');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
    }
}

/** Bind the port. Exported so a test can cover this without faking argv. */
export function main() {
    return createServer(handler).listen(PORT,
        () => console.log(`Static docs/ served at http://localhost:${PORT} (no API backend)`));
}

// Only bind a port when invoked as a script, never on import.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
