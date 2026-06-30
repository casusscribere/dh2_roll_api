/**
 * Preview the built static site (./docs) exactly as GitHub Pages would — a plain
 * static file server with NO /api backend. If the UI works against this, it will
 * work on Pages. Run:  npm run serve:static   (default http://localhost:8080)
 */
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, normalize, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'docs');
const PORT = process.env.PORT || 8080;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
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
}).listen(PORT, () => console.log(`Static docs/ served at http://localhost:${PORT} (no API backend)`));
