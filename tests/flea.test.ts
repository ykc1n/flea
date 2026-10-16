import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { analyze } from '../src/analysis.js';
import { listingIds, parseDetail } from '../src/scrape.js';
import { connect, unpack, upsert, recoverJobs, requeue, type Database, type ReplayRow } from '../src/store.js';
import { processOne } from '../src/worker.js';
import { createFleaServer } from '../src/server.js';
import type { EngineEvent, Replay } from '../src/types.js';

const fixtures = resolve('tests', 'fixtures');
let temporary: string;
let db: Database;
let replay: Replay;
const originalEnvironment = { ...process.env };

beforeEach(() => {
  temporary = mkdtempSync(resolve(tmpdir(), 'flea-'));
  process.env.FLEA_DB = resolve(temporary, 'db.sqlite');
  process.env.FLEA_DATA = temporary;
  delete process.env.FLEA_PROCESSOR;
  db = connect();
  replay = parseDetail(readFileSync(resolve(fixtures, 'battle.html'), 'utf8'), 2524251);
});

afterEach(() => {
  db.close();
  process.env = { ...originalEnvironment };
  rmSync(temporary, { recursive: true, force: true });
});

function makeExport(path: string, complete = true): void {
  const events: EngineEvent[] = [{ type: 'meta', mapWidth: 100, mapHeight: 100, fullView: true }, { type: 'player', team: 4, name: 'A' }, { type: 'finished', time: 8, team: 4, unitId: 1, unit: 'factoryspider', factory: true }, { type: 'finished', time: 12, team: 4, unitId: 3, unit: 'spiderscout', factory: false }, { type: 'position', time: 15, team: 4, unitId: 3, x: 10, z: 20 }];
  if (complete) events.push({ type: 'game_over', time: 20 });
  writeFileSync(path, events.map(event => JSON.stringify(event)).join('\n'));
}

test('parses real metadata', () => {
  assert.equal(replay.map, 'Absolution 2');
  assert.equal(replay.duration, 1020);
  assert.equal(replay.mode, '1v1');
  assert.deepEqual(replay.players.map(player => player.name), ['FitRaptor', 'joseph52626']);
  assert.equal(replay.players[0]?.rank, '0_0');
  assert.equal(replay.started, '2026-10-14T22:58:28Z');
  assert.match(replay.download ?? '', /\.sdfz/);
});

test('discovery deduplicates IDs', () => {
  const ids = listingIds(readFileSync(resolve(fixtures, 'battles.html'), 'utf8'));
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.includes(2524251));
});

test('upsert preserves analysis state', () => {
  upsert(db, replay);
  db.prepare("UPDATE replays SET status='ready' WHERE id=?").run(replay.id);
  upsert(db, replay);
  const row = db.prepare('SELECT status FROM replays').get() as { status: string };
  assert.equal(row.status, 'ready');
});

test('derives factory, production, and movement summaries', async () => {
  const path = resolve(temporary, 'events');
  makeExport(path);
  const result = await analyze(path);
  assert.equal(result.firstFactories['4']?.unit, 'factoryspider');
  assert.equal(result.unitCount, 2);
  assert.equal(result.movements['3']?.length, 1);
});

test('rejects incomplete exports', async () => {
  const path = resolve(temporary, 'events');
  makeExport(path, false);
  await assert.rejects(analyze(path), /Incomplete/);
});

test('rejects exports without explicit full spectator visibility', async () => {
  const path = resolve(temporary, 'events');
  makeExport(path);
  writeFileSync(path, readFileSync(path, 'utf8').replace(',"fullView":true', ''));
  await assert.rejects(analyze(path), /spectator/);
});

test('rejects malformed event identities, dimensions, and post-completion records', async () => {
  const path = resolve(temporary, 'events');
  for (const change of [
    (text: string) => text.replace('"mapWidth":100', '"mapWidth":-1'),
    (text: string) => text.replace('"unitId":1,', ''),
    (text: string) => text + '\n{"type":"team_died","time":21,"team":4}',
  ]) {
    makeExport(path);
    writeFileSync(path, change(readFileSync(path, 'utf8')));
    await assert.rejects(analyze(path));
  }
});

test('worker succeeds and avoids duplicate processing', async () => {
  upsert(db, replay);
  process.env.FLEA_PROCESSOR = '["processor", "{output}"]';
  const dependencies = {
    fetchReplay: async () => Buffer.from([0x1f, 0x8b, 1]),
    runProcessor: async (argv: string[]) => makeExport(argv.at(-1)!),
  };
  assert.equal(await processOne(db, dependencies), true);
  assert.equal(await processOne(db, dependencies), false);
  const row = db.prepare('SELECT * FROM replays').get() as unknown as ReplayRow;
  const result = unpack(row, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.unitCount, 2);
});

test('acquisition retries persist deadlines without consuming processing attempts', async () => {
  upsert(db, replay);
  process.env.FLEA_PROCESSOR = '["processor"]';
  const unavailable = async (): Promise<Buffer> => { throw new Error('download unavailable'); };
  let now = 1000;
  for (const wait of [300_000, 1_800_000, 21_600_000]) {
    assert.equal(await processOne(db, { fetchReplay: unavailable, now: () => now }), true);
    assert.equal(await processOne(db, { fetchReplay: unavailable, now: () => now }), false);
    now += wait;
  }
  const row = db.prepare('SELECT status,attempts FROM replays').get() as { status: string; attempts: number };
  assert.equal(row.status, 'blocked');
  assert.equal(row.attempts, 0);
});

test('no processor leaves replay queued', async () => {
  upsert(db, replay);
  process.env.FLEA_PROCESSOR = '';
  assert.equal(await processOne(db), false);
  const row = db.prepare('SELECT status FROM replays').get() as { status: string };
  assert.equal(row.status, 'queued');
});

test('worker processes oldest battle first and public details redact failures', async () => {
  upsert(db, { ...replay, id: 200, started: '2026-01-02T00:00:00Z' });
  upsert(db, { ...replay, id: 100, started: '2026-01-01T00:00:00Z' });
  process.env.FLEA_PROCESSOR = '["processor", "{id}"]';
  let selected = '';
  await processOne(db, {
    fetchReplay: async () => Buffer.from([0x1f, 0x8b]),
    runProcessor: async argv => { selected = argv[1]!; throw new Error('private C:/secret/path'); },
  });
  assert.equal(selected, '100');
  const server = createFleaServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const port = (server.address() as { port: number }).port;
    const result = await (await fetch(`http://127.0.0.1:${port}/api/replays/100`)).json() as { status: string; error: string };
    assert.equal(result.status, 'blocked');
    assert.doesNotMatch(result.error, /secret|private|C:\//);
  } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
});

test('archive pagination never loads full telemetry and rejects unsafe offsets', async () => {
  for (let id = 1; id <= 30; id++) upsert(db, { ...replay, id });
  db.prepare("UPDATE replays SET analysis='not valid json'").run();
  const server = createFleaServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const response = await fetch(url + '/api/replays?offset=24');
    assert.equal(response.status, 200);
    const page = await response.json() as { total: number; items: Array<{ id: number }> };
    assert.equal(page.total, 30);
    assert.deepEqual(page.items.map(item => item.id), [6, 5, 4, 3, 2, 1]);
    assert.equal((await fetch(url + '/api/replays?offset=999999999999999999999')).status, 400);
  } finally { await new Promise<void>(done => server.close(() => done())); }
});

test('final interrupted processing remains blocked and operator retry resets it', async () => {
  upsert(db, replay);
  db.prepare("UPDATE replays SET status='processing',attempts=3").run();
  recoverJobs(db);
  db.close(); db = connect();
  process.env.FLEA_PROCESSOR = '["processor", "{output}"]';
  const dependencies = { fetchReplay: async () => Buffer.from([0x1f, 0x8b]), runProcessor: async (argv: string[]) => makeExport(argv[1]!) };
  assert.equal(await processOne(db, dependencies), false);
  assert.equal(unpack(db.prepare('SELECT * FROM replays').get() as unknown as ReplayRow).status, 'blocked');
  assert.equal(requeue(db, replay.id), 1);
  assert.equal(await processOne(db, dependencies), true);
  assert.equal(unpack(db.prepare('SELECT * FROM replays').get() as unknown as ReplayRow, true).unitCount, 2);
});

test('consistent backup restores metadata and published telemetry', async () => {
  const { backupArchive, restoreArchive } = await import('../src/backup.js');
  upsert(db, replay);
  process.env.FLEA_PROCESSOR = '["processor", "{output}"]';
  await processOne(db, { fetchReplay: async () => Buffer.from([0x1f, 0x8b]), runProcessor: async argv => makeExport(argv[1]!) });
  const snapshot = resolve(temporary, 'snapshot.sqlite');
  const restored = resolve(temporary, 'restored.sqlite');
  await backupArchive(db, snapshot);
  restoreArchive(snapshot, restored);
  const original = process.env.FLEA_DB; process.env.FLEA_DB = restored;
  const recovered = connect();
  try { assert.equal(unpack(recovered.prepare('SELECT * FROM replays').get() as unknown as ReplayRow, true).unitCount, 2); }
  finally { recovered.close(); process.env.FLEA_DB = original; }
});

test('automatic acquisition feeds the native runner and publishes validated results', async () => {
  upsert(db, replay);
  let acquired = false;
  await processOne(db, {
    fetchReplay: async () => Buffer.from([0x1f, 0x8b]),
    acquire: async requested => { assert.equal(requested.engine, '2026.07.04'); acquired = true; return { engine: 'exact-headless', root: 'dedicated-cache' }; },
    runProcessor: async argv => { assert.equal(acquired, true); assert.ok(argv.includes('exact-headless')); makeExport(argv[argv.indexOf('--output') + 1]!); },
  });
  const server = createFleaServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const result = await (await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/replays/${replay.id}`)).json() as { status: string; unitCount: number };
    assert.equal(result.status, 'ready'); assert.equal(result.unitCount, 2);
  } finally { await new Promise<void>(done => server.close(() => done())); }
});

test('large valid exports do not exceed JavaScript argument limits', async () => {
  const path = resolve(temporary, 'large.jsonl');
  writeFileSync(path, '{"type":"meta","mapWidth":100,"mapHeight":100,"fullView":true}\n' + '{"type":"team_died","team":0,"time":1}\n'.repeat(200_000) + '{"type":"game_over","time":2}');
  const result = await analyze(path);
  assert.equal(result.duration, 2); assert.equal(result.events.length, 200_001);
});
