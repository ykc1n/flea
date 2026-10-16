import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchBytes, parseDetail } from '../src/scrape.js';
import { connect, upsert, unpack, type ReplayRow } from '../src/store.js';
import { processOne } from '../src/worker.js';

const id = Number(process.argv[2]);
if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Usage: npm run verify -- <battle-id> [new-data-directory]');
const directory = resolve(process.argv[3] ?? `data/verification-${Date.now()}`);
if (existsSync(directory)) throw new Error('Verification requires a new data directory');
mkdirSync(directory, { recursive: true });
process.env.FLEA_DATA = directory;
process.env.FLEA_DB = resolve(directory, 'flea.sqlite3');
process.env.FLEA_ZK_ROOT = resolve(directory, 'zero-k');
delete process.env.FLEA_PROCESSOR;
const replay = parseDetail((await fetchBytes(`https://zero-k.info/Battles/Detail/${id}`)).toString(), id);
const db = connect();
try {
  upsert(db, replay);
  await processOne(db);
  const result = unpack(db.prepare('SELECT * FROM replays WHERE id=?').get(id) as unknown as ReplayRow, true);
  if (result.status !== 'ready') throw new Error(`Verification blocked: ${result.error}. Operator logs: ${directory}`);
  console.log(JSON.stringify({ id, status: result.status, players: result.analysis?.players, fullView: result.analysis?.meta.fullView, duration: result.analysis?.duration, unitCount: result.unitCount, firstFactories: result.firstFactories, directory }, null, 2));
} finally { db.close(); }
