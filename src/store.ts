import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Analysis, Replay, ReplayView } from './types.js';

export type Database = DatabaseSync;

export interface ReplayRow {
  id: number;
  metadata: string;
  status: string;
  analysis: string | null;
  error: string | null;
  attempts: number;
  updated: string;
  retry_at: number | null;
  acquisition_attempts: number;
  blocked_kind: string | null;
  started_at: number | null;
  summary: string | null;
}

export function connect(): Database {
  const path = process.env.FLEA_DB ?? resolve(process.env.FLEA_DATA ?? 'data', 'flea.sqlite3');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 30_000 });
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS replays (
      id INTEGER PRIMARY KEY, metadata TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      analysis TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) < 1) {
      db.exec(`ALTER TABLE replays ADD COLUMN retry_at INTEGER;
        ALTER TABLE replays ADD COLUMN acquisition_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE replays ADD COLUMN blocked_kind TEXT;
        ALTER TABLE replays ADD COLUMN started_at INTEGER;
        ALTER TABLE replays ADD COLUMN summary TEXT;`);
      for (const row of db.prepare('SELECT id,metadata,analysis FROM replays').iterate() as unknown as Iterable<ReplayRow>) {
        const metadata = JSON.parse(row.metadata) as Replay;
        const analysis = row.analysis ? JSON.parse(row.analysis) as Analysis : null;
        db.prepare('UPDATE replays SET started_at=?,summary=? WHERE id=?').run(battleTime(metadata.started), analysis ? JSON.stringify({ firstFactories: analysis.firstFactories, unitCount: analysis.unitCount }) : null, row.id);
      }
      db.exec(`UPDATE replays SET status='blocked',blocked_kind='processing',retry_at=0,error='Analysis needs attention' WHERE status='failed';
        CREATE INDEX replay_queue ON replays(status,retry_at,started_at,id);
        PRAGMA user_version=1;`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  return db;
}

// Zero-K archive timestamps without an explicit offset are interpreted as UTC.
// Missing/unparseable dates sort after dated battles, ordered by battle ID.
export function battleTime(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)) return null;
  const time = Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(time) ? time : null;
}

export function upsert(db: Database, replay: Replay): void {
  db.prepare(`
    INSERT INTO replays(id, metadata,started_at) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,started_at=excluded.started_at
  `).run(replay.id, JSON.stringify(replay), battleTime(replay.started));
}

export function unpack(row: ReplayRow, detail = false): ReplayView {
  const replay = JSON.parse(row.metadata) as Replay;
  const analysis = detail && row.analysis ? JSON.parse(row.analysis) as Analysis : null;
  const summary = row.summary ? JSON.parse(row.summary) as Pick<Analysis, 'firstFactories' | 'unitCount'> : analysis;
  const result: ReplayView = {
    ...replay,
    status: row.status,
    error: row.error,
    firstFactories: summary?.firstFactories ?? {},
    unitCount: summary?.unitCount ?? null,
  };
  if (detail) result.analysis = analysis;
  return result;
}

export function saveAnalysis(db: Database, id: number, analysis: Analysis): void {
  db.prepare("UPDATE replays SET status='ready',analysis=?,summary=?,error=NULL,blocked_kind=NULL,retry_at=NULL,updated=CURRENT_TIMESTAMP WHERE id=?")
    .run(JSON.stringify(analysis), JSON.stringify({ firstFactories: analysis.firstFactories, unitCount: analysis.unitCount }), id);
}

export function recoverJobs(db: Database): void {
  db.prepare(`UPDATE replays SET status=CASE WHEN attempts>=3 THEN 'blocked' ELSE 'queued' END,
    blocked_kind=CASE WHEN attempts>=3 THEN 'processing' ELSE NULL END,
    error=CASE WHEN attempts>=3 THEN 'Analysis interrupted on final attempt; operator retry required' ELSE NULL END,
    retry_at=NULL WHERE status='processing'`).run();
}

export function requeue(db: Database, id: number): number {
  return Number(db.prepare("UPDATE replays SET status='queued',attempts=0,acquisition_attempts=0,retry_at=NULL,blocked_kind=NULL,error=NULL,updated=CURRENT_TIMESTAMP WHERE id=? AND status IN ('blocked','failed')").run(id).changes);
}
