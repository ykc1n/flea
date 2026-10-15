import json
import os
import sqlite3
from pathlib import Path


def connect():
    path = Path(os.environ.get('FLEA_DB', 'data/flea.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS replays (
        id INTEGER PRIMARY KEY, metadata TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        analysis TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
    ''')
    return db


def upsert(db, replay):
    db.execute('INSERT INTO replays(id,metadata) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata',
               (replay['id'], json.dumps(replay)))
    db.commit()


def unpack(row, detail=False):
    result = json.loads(row['metadata'])
    result.update(status=row['status'], error=row['error'])
    analysis = json.loads(row['analysis']) if row['analysis'] else None
    result['firstFactories'] = analysis['firstFactories'] if analysis else {}
    result['unitCount'] = analysis['unitCount'] if analysis else None
    if detail:
        result['analysis'] = analysis
    return result
