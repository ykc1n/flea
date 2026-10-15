"""Hourly discovery plus a persistent retryable engine-processing queue."""
import argparse
import json
import logging
import os
from pathlib import Path
import subprocess
import time
from .store import connect
from .scrape import scrape, fetch
from .analysis import analyze

log = logging.getLogger('flea.worker')


def process_one(db):
    # An argv JSON array, never a shell command. Engine/version provisioning is operator-owned.
    command = os.environ.get('FLEA_PROCESSOR')
    if not command:
        return False
    with db:
        row = db.execute("SELECT * FROM replays WHERE status IN ('queued','failed') AND attempts < 3 ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return False
        db.execute("UPDATE replays SET status='processing',attempts=attempts+1,error=NULL,updated=CURRENT_TIMESTAMP WHERE id=?", (row['id'],))
    data = json.loads(row['metadata'])
    work = Path(os.environ.get('FLEA_DATA', 'data')).resolve() / 'jobs' / str(row['id'])
    work.mkdir(parents=True, exist_ok=True)
    replay, output = work / 'replay.sdfz', work / 'events.jsonl'
    try:
        if not replay.exists():
            raw = fetch(data['download'], limit=256_000_000)
            if raw[:2] != b'\x1f\x8b' and raw[:15] != b'spring demofile':
                raise ValueError('Download is not a Spring demo')
            temporary = replay.with_suffix('.partial')
            temporary.write_bytes(raw)
            temporary.replace(replay)
        output.unlink(missing_ok=True)
        replacements = {'replay': str(replay), 'output': str(output), 'work': str(work),
                        'engine': data.get('engine') or '', 'game': data.get('game') or '', 'id': str(row['id'])}
        argv = json.loads(command)
        if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv):
            raise ValueError('FLEA_PROCESSOR must be a JSON argv array')
        argv = [a.format(**replacements) for a in argv]
        with open(work / 'processor.log', 'w') as logfile:
            subprocess.run(argv, check=True, timeout=int(os.environ.get('FLEA_PROCESS_TIMEOUT', '3600')),
                           stdout=logfile, stderr=subprocess.STDOUT)
        result = analyze(output)
        db.execute("UPDATE replays SET status='ready',analysis=?,error=NULL,updated=CURRENT_TIMESTAMP WHERE id=?",
                   (json.dumps(result), row['id']))
    except Exception as e:
        log.exception('Processing battle %s failed', row['id'])
        db.execute("UPDATE replays SET status='failed',error=?,updated=CURRENT_TIMESTAMP WHERE id=?", (str(e), row['id']))
    db.commit()
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='Scrape and drain queue once')
    parser.add_argument('--pages', type=int, default=3)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    # Single worker lock; do not recover another live worker's jobs.
    import fcntl
    lock_path = Path(os.environ.get('FLEA_DB', 'data/flea.sqlite3')).with_suffix('.worker.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db = connect()
        db.execute("UPDATE replays SET status='queued' WHERE status='processing'")
        db.commit()
        next_scrape = 0
        while True:
            if time.monotonic() >= next_scrape:
                try:
                    log.info('Discovered %s replays', scrape(db, max(1, min(50, args.pages))))
                    db.execute("DELETE FROM state WHERE key='scrape_error'")
                    db.commit()
                except Exception as e:
                    log.exception('Discovery failed')
                    db.execute("INSERT OR REPLACE INTO state VALUES('scrape_error',?)", (str(e),))
                    db.commit()
                next_scrape = time.monotonic() + 3600
            if process_one(db):
                continue
            if args.once:
                break
            time.sleep(10)


if __name__ == '__main__':
    main()
