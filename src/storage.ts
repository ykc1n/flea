import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export class StoragePaused extends Error {}
export function dataRoot(): string { return resolve(process.env.FLEA_DATA ?? 'data'); }
export function positiveSetting(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

function size(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('Managed storage cannot contain symbolic links');
  return stat.isDirectory() ? readdirSync(path).reduce((sum, child) => sum + size(resolve(path, child)), 0) : stat.size;
}

export function storageStatus(root = dataRoot(), budget = positiveSetting('FLEA_STORAGE_BYTES', 50_000_000_000), reserve = positiveSetting('FLEA_RESERVE_BYTES', 5_000_000_000)) {
  mkdirSync(root, { recursive: true });
  const usedBytes = size(root);
  const fs = statfsSync(root);
  const freeBytes = fs.bavail * fs.bsize;
  const reason = usedBytes >= budget ? 'Managed storage budget reached' : freeBytes < reserve ? 'Host free-space reserve reached' : null;
  return { usedBytes, freeBytes, budgetBytes: budget, reserveBytes: reserve, paused: Boolean(reason), reason };
}

export function requireSpace(root = dataRoot(), budget?: number, reserve?: number): void {
  const status = storageStatus(root, budget, reserve);
  if (status.paused) throw new StoragePaused(status.reason!);
}

// Reserve from a measured starting point rather than rescanning thousands of
// Rapid pool files for every network chunk. Native writers are monitored too.
export function spaceGuard(): (bytes: number) => void {
  const root = dataRoot();
  const initial = storageStatus(root);
  let remaining = initial.budgetBytes - initial.usedBytes;
  if (initial.paused) throw new StoragePaused(initial.reason!);
  return bytes => {
    remaining -= bytes;
    const fs = statfsSync(root);
    if (remaining < 0 || fs.bavail * fs.bsize < initial.reserveBytes) throw new StoragePaused('Available storage is insufficient for acquisition');
  };
}

export function cacheRoot(): string {
  const root = dataRoot();
  const cache = resolve(process.env.FLEA_ZK_ROOT ?? resolve(root, 'zero-k'));
  if (!cache.startsWith(root + sep)) throw new Error('FLEA_ZK_ROOT must be a dedicated directory inside FLEA_DATA');
  return cache;
}

export function cleanupJobs(activeId?: number, readyIds: ReadonlySet<number> = new Set()): void {
  const jobs = resolve(dataRoot(), 'jobs');
  if (!existsSync(jobs)) return;
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const name of readdirSync(jobs)) {
    if (!/^\d+$/.test(name) || Number(name) === activeId) continue;
    const job = resolve(jobs, name);
    if (!lstatSync(job).isDirectory()) continue;
    for (const filename of readdirSync(job)) {
      const path = resolve(job, filename);
      const disposable = filename.endsWith('.partial') || filename === 'events.jsonl' || (filename === 'replay.sdfz' && readyIds.has(Number(name))) || (['processor.log', 'acquisition.log'].includes(filename) && lstatSync(path).mtimeMs < cutoff);
      if (disposable) { try { rmSync(path, { force: true }); } catch (error) { console.error('Deferred cleanup', error); } }
    }
  }
}

// The worker owns this entire cache and calls this only between jobs. Evicting
// the whole idle cache preserves package/pool dependencies as a coherent set.
export function reclaimIdleCache(readyIds: ReadonlySet<number> = new Set()): void {
  cleanupJobs(undefined, readyIds);
  if (storageStatus().paused) {
    const cache = cacheRoot();
    // Check symlinks before recursively removing anything in managed storage.
    size(cache);
    rmSync(cache, { recursive: true, force: true });
  }
}
