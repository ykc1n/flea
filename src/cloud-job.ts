import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { fetchBytes, parseDetail } from './scrape.js';
import { connect, upsert, unpack, type ReplayRow } from './store.js';
import { processOne, type WorkerDependencies } from './worker.js';
import type { Replay } from './types.js';

export interface CloudJobOptions { id: number; bucket: string; scratch: string; signal?: AbortSignal }
export interface CloudJobDependencies {
  metadata?: (id: number, signal?: AbortSignal) => Promise<Replay>;
  worker?: WorkerDependencies;
  upload?: (name: string, body: Buffer, contentType: string, contentEncoding?: string) => Promise<void>;
}

/** One explicit battle per execution. Local SQLite is scratch, never the cloud queue. */
export async function runCloudBattle(options: CloudJobOptions, dependencies: CloudJobDependencies = {}) {
  if (!Number.isSafeInteger(options.id) || options.id <= 0) throw new Error('A positive battle ID is required');
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(options.bucket)) throw new Error('A Cloud Storage bucket name is required');
  if (Number(process.env.CLOUD_RUN_TASK_COUNT ?? '1') !== 1) throw new Error('Configure exactly one task per execution');
  options.signal?.throwIfAborted();
  const scratch = resolve(options.scratch);
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(join(scratch, 'battle-'));
  process.env.FLEA_DATA = work;
  process.env.FLEA_DB = resolve(work, 'flea.sqlite3');
  process.env.FLEA_ZK_ROOT = resolve(work, 'zero-k');
  delete process.env.FLEA_PROCESSOR;
  const prefix = `results/${options.id}/${randomUUID()}`;
  const storage = dependencies.upload ? undefined : new Storage();
  const upload = dependencies.upload ?? (async (name, body, contentType, contentEncoding) => {
    await storage!.bucket(options.bucket).file(name).save(body, {
      resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType, ...(contentEncoding ? { contentEncoding } : {}) },
    });
  });
  const db = connect();
  let status = 'failed', error: string | null = null, result: string | null = null;
  try {
    const metadata = await (dependencies.metadata ?? (async (id, signal) => parseDetail((await fetchBytes(`https://zero-k.info/Battles/Detail/${id}`, undefined, signal)).toString(), id)))(options.id, options.signal);
    if (metadata.id !== options.id) throw new Error('Battle metadata ID does not match the requested job');
    upsert(db, metadata);
    await processOne(db, { ...dependencies.worker, signal: options.signal });
    const row = unpack(db.prepare('SELECT * FROM replays WHERE id=?').get(options.id) as unknown as ReplayRow, true);
    status = row.status === 'ready' ? 'ready' : 'blocked';
    error = row.status === 'ready' ? null : row.error ?? 'Processing could not start; see private execution logs';
    if (row.status === 'ready') {
      const name = `${prefix}/replay.json.gz`;
      await upload(name, gzipSync(JSON.stringify({ schemaVersion: 1, replay: row })), 'application/json', 'gzip');
      result = `gs://${options.bucket}/${name}`;
    }
  } catch (failure) {
    console.error('Cloud battle failed', failure);
    status = 'failed';
    error = 'Cloud processing failed; see private execution logs';
  } finally { db.close(); }
  // Persist bounded diagnostics before the commit marker. The bucket stays private.
  for (const name of ['acquisition.log', 'processor.log']) {
    const path = resolve(work, 'jobs', String(options.id), name);
    if (existsSync(path)) await upload(`${prefix}/${name}`, readFileSync(path).subarray(0, 1_000_000), 'text/plain');
  }
  const manifest = { schemaVersion: 1, id: options.id, status, error, result,
    execution: process.env.CLOUD_RUN_EXECUTION ?? null, completedAt: new Date().toISOString() };
  // A manifest is visible only after every referenced result object is durable.
  const manifestName = `${prefix}/manifest.json`;
  await upload(manifestName, Buffer.from(JSON.stringify(manifest)), 'application/json');
  console.log(JSON.stringify({ ...manifest, manifest: `gs://${options.bucket}/${manifestName}` }));
  return manifest;
}
