#!/usr/bin/env bun
/**
 * Serve the marketing site at `marketing/` over a tiny Bun static server.
 *
 * Usage:
 *   bun run dev:www          # http://127.0.0.1:5180/
 *   PORT=4000 bun run dev:www
 *   bun run dev:www --open   # auto-open in default browser
 *
 * No build step. No bundler. The marketing site is hand-written HTML + CSS
 * that loads its assets relative to `marketing/`, so this server just maps
 * URL paths to files on disk.
 */

import { resolve, join, extname } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '..', 'marketing');
const PORT = Number(process.env.PORT ?? 5180);
const HOST = process.env.HOST ?? '127.0.0.1';
const OPEN = process.argv.includes('--open');

if (!existsSync(ROOT)) {
  console.error(`[dev:www] marketing/ not found at ${ROOT}`);
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

function safeJoin(rootAbs: string, urlPath: string): string | null {
  // Strip query/hash, decode, normalize.
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = resolve(rootAbs, '.' + (clean === '/' ? '/index.html' : clean));
  if (!candidate.startsWith(rootAbs)) return null;
  return candidate;
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    let path = safeJoin(ROOT, url.pathname);
    if (!path) return new Response('Forbidden', { status: 403 });

    if (existsSync(path) && statSync(path).isDirectory()) {
      path = join(path, 'index.html');
    }
    if (!existsSync(path)) {
      // SPA-style fallback so /foo without a file still serves the homepage.
      path = join(ROOT, 'index.html');
      if (!existsSync(path)) return new Response('Not found', { status: 404 });
    }

    const ext = extname(path).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    return new Response(Bun.file(path), {
      headers: {
        'content-type': type,
        'cache-control': 'no-store',
      },
    });
  },
});

const origin = `http://${server.hostname}:${server.port}`;
console.log(`[dev:www] serving marketing/ at ${origin}`);
console.log(`[dev:www] root: ${ROOT}`);

if (OPEN) {
  const opener = process.platform === 'darwin' ? 'open'
               : process.platform === 'win32'  ? 'start'
               : 'xdg-open';
  Bun.spawn([opener, origin], { stdout: 'ignore', stderr: 'ignore' });
}
