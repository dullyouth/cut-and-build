// Static file server for the PWA. The app itself is fully client-side (data lives
// in the browser via IndexedDB) — this just serves the files so you can load the
// app on your Mac or push it to your phone over the network. Zero dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { networkInterfaces } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    // SPA fallback
    try {
      const idx = await readFile(join(PUBLIC, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(idx);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  }
});

function lanIP() {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  💪 Cut & Build\n`);
  console.log(`     On this Mac:   http://localhost:${PORT}`);
  console.log(`     On your phone: http://${lanIP()}:${PORT}   (same WiFi)`);
  console.log(`\n  For an installable offline app on iPhone, serve over HTTPS — see README.\n`);
});
