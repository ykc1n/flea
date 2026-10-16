import { backup, DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, constants, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Database } from './store.js';

export async function backupArchive(db: Database, destination: string): Promise<void> {
  const target = resolve(destination);
  if (existsSync(target) || existsSync(target + '.partial')) throw new Error('Backup destination already exists');
  mkdirSync(dirname(target), { recursive: true });
  try { await backup(db, target + '.partial'); renameSync(target + '.partial', target); }
  finally { rmSync(target + '.partial', { force: true }); }
}

// Restore into a NEW deployment path; never overwrite live data or its WAL.
export function restoreArchive(snapshot: string, destination: string): void {
  const target = resolve(destination);
  if ([target, target + '-wal', target + '-shm', target + '.partial'].some(existsSync)) throw new Error('Restore destination must be new');
  const source = new DatabaseSync(resolve(snapshot), { readOnly: true });
  try {
    const check = source.prepare('PRAGMA integrity_check').get();
    if (check?.integrity_check !== 'ok' || !source.prepare("SELECT 1 FROM sqlite_master WHERE name='replays'").get()) throw new Error('Not a valid Flea snapshot');
  } finally { source.close(); }
  mkdirSync(dirname(target), { recursive: true });
  try { copyFileSync(resolve(snapshot), target + '.partial', constants.COPYFILE_EXCL); renameSync(target + '.partial', target); }
  finally { rmSync(target + '.partial', { force: true }); }
}
