import type { Database } from './store.js';
import { upsert } from './store.js';
import type { Player, Replay } from './types.js';

const BASE = 'https://zero-k.info';

export async function fetchBytes(url: string, limit = 4_000_000, signal?: AbortSignal): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.hostname !== 'zero-k.info' || parsed.protocol !== 'https:') throw new Error('Only HTTPS zero-k.info URLs are allowed');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    let current = parsed;
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      const replayBlob = parsed.pathname.startsWith('/replays/') && current.hostname === 'zerok.blob.core.windows.net' && current.pathname.startsWith('/replays/');
      if (current.protocol !== 'https:' || (current.hostname !== 'zero-k.info' && !replayBlob) || current.username || current.password || (current.port && current.port !== '443')) throw new Error('Unexpected redirect');
      response = await fetch(current, {
        headers: { 'User-Agent': 'Flea/1.0 (Zero-K replay archive)' },
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects >= 4) throw new Error('Too many redirects');
      current = new URL(location, current);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${parsed.pathname}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > limit) throw new Error('Response exceeds size limit');
    if (!response.body) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > limit) throw new Error('Response exceeds size limit');
      chunks.push(data);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value: string): string {
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return names[code.toLowerCase()] ?? entity;
  });
}

export function clean(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).join(' ');
}

export function listingIds(source: string): number[] {
  return [...new Set([...source.matchAll(/\/Battles\/Detail\/(\d+)/g)].map(match => Number(match[1])))];
}

export function parseDetail(source: string, battleId: number): Replay {
  const fields: Record<string, string> = {};
  for (const match of source.matchAll(/<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/gis)) {
    fields[clean(match[1]!).replace(/:$/, '')] = clean(match[2]!);
  }
  const mapMatch = source.match(/title=["']\$map\$(.*?)["']/i);
  const image = source.match(/<img[^>]+src=["']([^"']+\.minimap\.jpg)/i);
  const replay = source.match(/href=["'](\/replays\/[^"']+\.sdfz)/i);
  const recorded = replay?.[1]?.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  const players: Player[] = [];
  const teams = source.split(/<div[^>]+class=["'][^"']*battle_spec[^"']*["'][^>]*>/i).slice(1);
  teams.forEach((block, index) => {
    if (/>\s*Spectators\s*</i.test(block)) return;
    const teamMatch = block.match(/Team\s+(\d+)/i);
    for (const match of block.matchAll(/<img[^>]+src=['"](\/img\/ranks\/([^'"]+)\.png)['"][^>]*>\s*<a[^>]+href=['"]\/Users\/Detail\/(\d+)['"][^>]*>(.*?)<\/a>/gis)) {
      players.push({
        id: Number(match[3]),
        name: clean(match[4]!),
        rank: match[2],
        rankIcon: BASE + match[1],
        team: teamMatch ? Number(teamMatch[1]) : index + 1,
      });
    }
  });
  const duration = fields['Duration'] ?? '';
  const units: Record<string, number> = { hour: 3600, minute: 60, second: 1 };
  const seconds = [...duration.matchAll(/(\d+)\s+(hour|minute|second)/g)]
    .reduce((sum, match) => sum + Number(match[1]) * units[match[2]!]!, 0);
  const teamCount = new Set(players.map(player => player.team)).size;
  let mode = fields['Bots'] === 'True' ? 'Co-op' : players.length === 2 && teamCount === 2 ? '1v1' : 'Teams';
  if (teamCount > 2) mode = 'FFA';
  return {
    id: battleId,
    title: fields['Title'] ?? `Battle ${battleId}`,
    map: mapMatch ? clean(mapMatch[1]!) : 'Unknown map',
    mapImage: image ? new URL(decodeHtml(image[1]!), BASE).href : null,
    players,
    mode,
    duration: seconds,
    engine: fields['Engine version'] ?? null,
    game: fields['Game version'] ?? null,
    started: recorded ? `${recorded[1]}T${recorded[2]}:${recorded[3]}:${recorded[4]}Z` : fields['Started'] ?? null,
    rating: fields['Rating'] ?? 'Unrated',
    source: `${BASE}/Battles/Detail/${battleId}`,
    download: replay ? new URL(decodeHtml(replay[1]!), BASE).href : null,
  };
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function scrape(db: Database, pages = 3, signal?: AbortSignal): Promise<number> {
  let count = 0;
  const seen = new Set<number>();
  for (let page = 0; page < pages; page += 1) {
    const suffix = page ? `?offset=${page * 40}` : '';
    const ids = listingIds((await fetchBytes(`${BASE}/Battles${suffix}`, undefined, signal)).toString());
    if (!ids.length) throw new Error('Replay listing returned no battle IDs; source markup may have changed');
    if (!ids.some(id => !seen.has(id))) break;
    ids.forEach(id => seen.add(id));
    for (const id of ids) {
      signal?.throwIfAborted();
      if (db.prepare('SELECT 1 FROM replays WHERE id=?').get(id)) continue;
      await sleep(1_000);
      const replay = parseDetail((await fetchBytes(`${BASE}/Battles/Detail/${id}`, undefined, signal)).toString(), id);
      upsert(db, replay);
      count += 1;
    }
    await sleep(1_000);
  }
  db.prepare("INSERT OR REPLACE INTO state VALUES('last_scrape',datetime('now'))").run();
  return count;
}
