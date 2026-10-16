import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { acquire } from '../src/acquisition.js';
import { execute } from '../src/execution.js';
import { fetchBytes, parseDetail } from '../src/scrape.js';
import { requireSpace } from '../src/storage.js';
import { connect, upsert, unpack, type ReplayRow } from '../src/store.js';
import { processOne } from '../src/worker.js';

const [rootArg, idArg, runArg] = process.argv.slice(2);
const id = Number(idArg), run = Number(runArg);
if (!rootArg || !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(run) || run <= 0) {
  throw new Error('Usage: benchmark-case <benchmark-root> <battle-id> <run-number>');
}
const root = resolve(rootArg), directory = resolve(root, `${id}-run-${run}`);
if (existsSync(directory)) throw new Error('Benchmark case directory already exists');
mkdirSync(directory, { recursive: true });
process.env.FLEA_DATA = root;
process.env.FLEA_DB = resolve(directory, 'flea.sqlite3');
process.env.FLEA_ZK_ROOT = resolve(root, 'zero-k');
delete process.env.FLEA_PROCESSOR;

function bytes(path: string): number {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => {
    if (entry.isSymbolicLink()) throw new Error('Benchmark directories must not contain symlinks');
    const child = resolve(path, entry.name);
    return sum + (entry.isDirectory() ? bytes(child) : statSync(child).size);
  }, 0);
}
const stages: Record<string, number> = {};
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  writeFileSync(resolve(root, 'phase.json'), JSON.stringify({ id, run, phase: name }));
  const start = performance.now();
  try { return await fn(); } finally { stages[name] = (performance.now() - start) / 1000; }
}
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const cacheBefore = bytes(process.env.FLEA_ZK_ROOT);
const start = performance.now();
let result: Record<string, unknown> = { id, run, directory,
  replayAlreadyCached: existsSync(resolve(root, 'jobs', String(id), 'replay.sdfz')) };
const db = connect();
try {
  const replay = await timed('metadata', async () => parseDetail((await fetchBytes(`https://zero-k.info/Battles/Detail/${id}`, undefined, controller.signal)).toString(), id));
  upsert(db, replay);
  await timed('pipeline', () => processOne(db, {
    signal: controller.signal,
    fetchReplay: (url, limit) => timed('replayDownload', () => fetchBytes(url, limit, controller.signal)),
    acquire: (...args) => timed('acquisition', () => acquire(...args)),
    runProcessor: async (argv, log, timeout) => {
      await timed('engine', () => execute(argv, {
        log, timeout, signal: controller.signal, registry: resolve(root, 'execution.json'), checkStorage: requireSpace,
      }));
      result.engineExitedSuccessfully = true;
      // Preserve evidence before production ingestion can discard an invalid export.
      copyFileSync(resolve(root, 'jobs', String(id), 'events.jsonl'), resolve(directory, 'telemetry.jsonl'));
      writeFileSync(resolve(root, 'phase.json'), JSON.stringify({ id, run, phase: 'validationPublication' }));
    },
  }));
  const row = unpack(db.prepare('SELECT * FROM replays WHERE id=?').get(id) as unknown as ReplayRow, true);
  result = { ...result, status: row.status, error: row.error, map: row.map, metadataPlayers: row.players.length,
    telemetryPlayerTeams: row.analysis ? Object.keys(row.analysis.players).length : null,
    engine: row.engine, game: row.game, simulatedSeconds: row.analysis?.duration,
    completedUnits: row.unitCount, fullView: row.analysis?.meta.fullView };
  if (row.status !== 'ready') process.exitCode = 1;
} catch (error) {
  result = { ...result, status: 'failed', error: String(error) };
  process.exitCode = 1;
} finally {
  db.close();
  const totalSeconds = (performance.now() - start) / 1000;
  for (const [source, name] of [
    [resolve(root, 'jobs', String(id), 'processor.log'), 'processor.log'],
    [resolve(root, 'jobs', String(id), 'acquisition.log'), 'acquisition.log'],
    [resolve(root, 'zero-k', 'infolog.txt'), 'infolog.txt'],
  ]) { if (source && name && existsSync(source)) copyFileSync(source, resolve(directory, name)); }
  const cacheAfter = bytes(process.env.FLEA_ZK_ROOT);
  result = { ...result, totalSeconds, stages, cacheBeforeBytes: cacheBefore, cacheAfterBytes: cacheAfter,
    cacheGrowthBytes: cacheAfter - cacheBefore, retainedCaseBytes: bytes(directory),
    simulatedSecondsPerEngineSecond: stages.engine && typeof result.simulatedSeconds === 'number' ? result.simulatedSeconds / stages.engine : null };
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
