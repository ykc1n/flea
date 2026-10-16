import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, unpack, type ReplayRow } from './store.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WEB = resolve(ROOT, 'web');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https://zero-k.info https://raw.githubusercontent.com; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

function json(response: ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

function staticFile(pathname: string, response: ServerResponse): void {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { json(response, { error: 'Invalid path' }, 400); return; }
  const requested = resolve(WEB, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!(requested === WEB || requested.startsWith(WEB + sep)) || !existsSync(requested) || !statSync(requested).isFile()) {
    json(response, { error: 'Not found' }, 404);
    return;
  }
  const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
  response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentTypes[extname(requested)] ?? 'application/octet-stream', 'Content-Length': statSync(requested).size });
  createReadStream(requested).on('error', error => { console.error(error); response.destroy(); }).pipe(response);
}

export function createFleaServer() {
  return createServer((request, response) => {
    if (request.method !== 'GET' || !request.url) { json(response, { error: 'Method not allowed' }, 405); return; }
    let url: URL;
    try { url = new URL(request.url, 'http://localhost'); } catch { json(response, { error: 'Invalid URL' }, 400); return; }
    if (!url.pathname.startsWith('/api/')) {
      try { staticFile(url.pathname, response); } catch (error) { console.error(error); json(response, { error: 'Static file unavailable' }, 500); }
      return;
    }
    let db: ReturnType<typeof connect> | undefined;
    try {
      db = connect();
      if (url.pathname === '/api/status') {
        const states = Object.fromEntries((db.prepare("SELECT key,value FROM state WHERE key IN ('last_scrape','scrape_error','storage','acquisition_pause')").all() as Array<{ key: string; value: string }>).map(row => [row.key, row.key === 'scrape_error' ? 'Discovery failed; see operator logs' : row.value]));
        const counts = Object.fromEntries((db.prepare('SELECT status,count(*) AS count FROM replays GROUP BY status').all() as Array<{ status: string; count: number }>).map(row => [row.status, row.count]));
        const active = db.prepare("SELECT id FROM replays WHERE status='processing' LIMIT 1").get();
        json(response, { states, counts, active: active?.id ?? null, processorConfigured: process.env.FLEA_PROCESSOR !== '' });
      } else if (url.pathname === '/api/replays') {
        const search = (url.searchParams.get('q') ?? '').toLowerCase();
        const mode = url.searchParams.get('mode') ?? '';
        const status = url.searchParams.get('status') ?? '';
        const offsetText = url.searchParams.get('offset') ?? '0';
        if (!/^\d+$/.test(offsetText)) { json(response, { error: 'Invalid offset' }, 400); return; }
        const offset = Number(offsetText);
        if (!Number.isSafeInteger(offset)) { json(response, { error: 'Invalid offset' }, 400); return; }
        // Search metadata (including players and battle ID), never raw telemetry.
        const where = `WHERE (?='' OR instr(lower(metadata),?)>0) AND (?='' OR json_extract(metadata,'$.mode')=?) AND (?='' OR status=?)`;
        const args = [search, search, mode, mode, status, status];
        const total = db.prepare(`SELECT count(*) AS total FROM replays ${where}`).get(...args)!.total;
        const items = (db.prepare(`SELECT id,metadata,status,error,summary FROM replays ${where} ORDER BY id DESC LIMIT 24 OFFSET ?`).all(...args, offset) as unknown as ReplayRow[]).map(row => unpack(row));
        json(response, { total, items });
      } else if (url.pathname.startsWith('/api/replays/')) {
        const idText = url.pathname.split('/').at(-1) ?? '';
        if (!/^\d+$/.test(idText) || !Number.isSafeInteger(Number(idText))) { json(response, { error: 'Invalid replay ID' }, 400); return; }
        const row = db.prepare('SELECT * FROM replays WHERE id=?').get(Number(idText)) as unknown as ReplayRow | undefined;
        row ? json(response, unpack(row, true)) : json(response, { error: 'Replay not found' }, 404);
      } else {
        json(response, { error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error(error);
      json(response, { error: 'Internal server error' }, 500);
    } finally {
      db?.close();
    }
  });
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = argument('--host', process.env.FLEA_HOST ?? '127.0.0.1');
  const port = Number(argument('--port', process.env.FLEA_PORT ?? '8080'));
  createFleaServer().listen(port, host, () => console.log(`Flea listening on http://${host}:${port}`));
}
