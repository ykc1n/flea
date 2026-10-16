import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, InvalidExport } from './analysis.js';
import { fetchBytes, scrape } from './scrape.js';
import { connect, recoverJobs, saveAnalysis, type Database, type ReplayRow } from './store.js';
import { execute, recoverExecution, ExecutionOwnershipError } from './execution.js';
import { acquire } from './acquisition.js';
import { cacheRoot, cleanupJobs, dataRoot, positiveSetting, reclaimIdleCache, requireSpace, storageStatus, StoragePaused } from './storage.js';
import type { Replay } from './types.js';

export interface WorkerDependencies {
  fetchReplay?: (url: string, limit: number) => Promise<Buffer>;
  runProcessor?: (argv: string[], logPath: string, timeout: number) => Promise<void>;
  acquire?: typeof acquire;
  now?: () => number;
  signal?: AbortSignal;
}
const registry = () => resolve(dataRoot(), 'execution.json');
const setState = (db: Database, key: string, value: string) => db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').run(key, value);

function failurePolicy(error: unknown, processing: boolean, row: ReplayRow, now: number) {
  const attempts = row.attempts + Number(processing);
  if (error instanceof InvalidExport) return { kind: 'processing', reason: 'Replay telemetry is incomplete or invalid; operator retry required', retry: null, acquisitionIncrement: 0 };
  if (error instanceof StoragePaused) return { kind: 'storage', reason: 'Analysis paused for available storage', retry: processing && attempts >= 3 ? null : now + 60_000, acquisitionIncrement: 0 };
  if (processing) return { kind: 'processing', reason: 'Replay analysis failed; see operator logs', retry: attempts >= 3 ? null : now + 60_000, acquisitionIncrement: 0 };
  return { kind: 'acquisition', reason: 'Replay dependencies could not be acquired; acquisition will retry', retry: now + ([300_000, 1_800_000][row.acquisition_attempts] ?? 21_600_000), acquisitionIncrement: 1 };
}

export async function processOne(db: Database, dependencies: WorkerDependencies = {}): Promise<boolean> {
  dependencies.signal?.throwIfAborted();
  const now = dependencies.now ?? Date.now;
  // An explicitly empty custom command disables analysis for metadata-only use.
  if (process.env.FLEA_PROCESSOR === '') return false;
  if (!db.prepare("SELECT 1 FROM replays WHERE status='processing'").get()) {
    const ready = db.prepare("SELECT id FROM replays WHERE status='ready'").all() as Array<{ id: number }>;
    reclaimIdleCache(new Set(ready.map(row => row.id)));
  }
  const storage = storageStatus();
  setState(db, 'storage', JSON.stringify(storage));
  if (storage.paused) { setState(db, 'acquisition_pause', storage.reason!); return false; }
  db.prepare("DELETE FROM state WHERE key='acquisition_pause'").run();
  const row = db.prepare("UPDATE replays SET status='processing',error=NULL,updated=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM replays WHERE (status='queued' OR (status='blocked' AND retry_at IS NOT NULL AND retry_at<=?)) AND attempts<3 AND NOT EXISTS (SELECT 1 FROM replays WHERE status='processing') ORDER BY started_at IS NULL,started_at,id LIMIT 1) RETURNING *").get(now()) as unknown as ReplayRow | undefined;
  if (!row) return false;
  const work = resolve(dataRoot(), 'jobs', String(row.id));
  const replayPath = resolve(work, 'replay.sdfz');
  const outputPath = resolve(work, 'events.jsonl');
  let processing = false;
  try {
    const replay = JSON.parse(row.metadata) as Replay;
    mkdirSync(work, { recursive: true });
    if (!existsSync(replayPath)) {
      if (!replay.download) throw new Error('Replay has no download URL');
      const raw = await (dependencies.fetchReplay ?? ((url, limit) => fetchBytes(url, limit, dependencies.signal)))(replay.download, 256_000_000);
      if (!(raw[0] === 0x1f && raw[1] === 0x8b) && raw.subarray(0, 15).toString() !== 'spring demofile') throw new Error('Download is not a Spring demo');
      requireSpace();
      const temporary = replayPath + '.partial';
      writeFileSync(temporary, raw);
      requireSpace();
      renameSync(temporary, replayPath);
    }
    rmSync(outputPath, { force: true });
    let argv: string[];
    if (process.env.FLEA_PROCESSOR) {
      const replacements: Record<string, string> = { replay: replayPath, output: outputPath, work, engine: replay.engine ?? '', game: replay.game ?? '', id: String(row.id) };
      const parsed: unknown = JSON.parse(process.env.FLEA_PROCESSOR);
      if (!Array.isArray(parsed) || !parsed.length || !parsed.every(value => typeof value === 'string')) throw new Error('FLEA_PROCESSOR must be a JSON argv array');
      argv = (parsed as string[]).map(value => value.replace(/\{(replay|output|work|engine|game|id)\}/g, (_, key: string) => replacements[key]!));
    } else {
      const acquired = await (dependencies.acquire ?? acquire)(replay, resolve(work, 'acquisition.log'), dependencies.signal);
      argv = [process.execPath, fileURLToPath(new URL('../scripts/run-engine.js', import.meta.url)), '--replay', replayPath, '--output', outputPath, '--engine', replay.engine!, '--game', replay.game!, '--executable', acquired.engine, '--root', acquired.root];
    }
    dependencies.signal?.throwIfAborted();
    processing = true;
    db.prepare('UPDATE replays SET attempts=attempts+1 WHERE id=?').run(row.id);
    const timeout = positiveSetting('FLEA_PROCESS_TIMEOUT', 3600);
    if (dependencies.runProcessor) await dependencies.runProcessor(argv, resolve(work, 'processor.log'), timeout);
    else await execute(argv, { log: resolve(work, 'processor.log'), timeout, signal: dependencies.signal, registry: registry(), checkStorage: requireSpace });
    const result = await analyze(outputPath);
    saveAnalysis(db, row.id, result);
    // Only discard source artifacts after the published analysis is durable.
    for (const path of [replayPath, outputPath]) { try { rmSync(path, { force: true }); } catch (error) { console.error('Deferred job cleanup', error); } }
  } catch (error) {
    if (error instanceof ExecutionOwnershipError) throw error;
    console.error('Processing battle ' + row.id + ' failed', error);
    const policy = failurePolicy(error, processing, row, now());
    db.prepare("UPDATE replays SET status='blocked',error=?,blocked_kind=?,retry_at=?,acquisition_attempts=acquisition_attempts+?,updated=CURRENT_TIMESTAMP WHERE id=?")
      .run(policy.reason, policy.kind, policy.retry, policy.acquisitionIncrement, row.id);
    rmSync(outputPath, { force: true });
    rmSync(replayPath + '.partial', { force: true });
    if (policy.kind === 'storage') setState(db, 'acquisition_pause', policy.reason);
  }
  setState(db, 'storage', JSON.stringify(storageStatus()));
  return true;
}

function acquireLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const descriptor = openSync(path, 'wx');
    writeFileSync(descriptor, String(process.pid));
    return () => { closeSync(descriptor); try { unlinkSync(path); } catch { /* already removed */ } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(path, 'utf8').trim());
    if (pid > 0) {
      try { process.kill(pid, 0); }
      catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe;
        unlinkSync(path);
        return acquireLock(path);
      }
      throw new Error('Another Flea worker is running (PID ' + pid + ')');
    }
    // Never remove a newly-created lock whose owner has not written its PID yet.
    throw new Error('Worker lock has no valid owner; inspect before removing it');
  }
}

export async function runWorker(options: { once?: boolean; pages?: number } = {}): Promise<void> {
  const release = acquireLock(resolve(process.env.FLEA_DB ?? resolve(dataRoot(), 'flea.sqlite3')) + '.worker.lock');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let db: Database | undefined;
  let discovery: Promise<void> | undefined;
  try {
    await recoverExecution(registry());
    await recoverExecution(resolve(cacheRoot(), 'acquisition-process.json'));
    rmSync(resolve(cacheRoot(), 'LuaUI', 'Logs', 'flea-events.jsonl'), { force: true });
    db = connect();
    recoverJobs(db);
    cleanupJobs();
    let nextDiscovery = 0;
    while (!controller.signal.aborted) {
      if (!discovery && Date.now() >= nextDiscovery) {
        const current = db;
        discovery = scrape(current, Math.max(1, Math.min(50, options.pages ?? 3)), controller.signal)
          .then(count => { console.log('Discovered ' + count + ' replays'); current.prepare("DELETE FROM state WHERE key='scrape_error'").run(); })
          .catch(error => { if (!controller.signal.aborted) { console.error('Discovery failed', error); setState(current, 'scrape_error', 'Discovery failed; see operator logs'); } })
          .finally(() => { nextDiscovery = Date.now() + 3_600_000; discovery = undefined; });
      }
      if (options.once && discovery) await discovery;
      if (await processOne(db, { signal: controller.signal })) continue;
      if (options.once) break;
      await new Promise<void>(done => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); done(); };
        const timer = setTimeout(finish, 10_000);
        controller.signal.addEventListener('abort', finish, { once: true });
      });
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally {
    controller.abort();
    await discovery;
    db?.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--pages');
  const pages = index >= 0 ? Number(process.argv[index + 1]) : 3;
  if (!Number.isInteger(pages) || pages < 1 || pages > 50) throw new Error('--pages must be between 1 and 50');
  runWorker({ once: process.argv.includes('--once'), pages }).catch(error => { console.error(error); process.exitCode = 1; });
}
