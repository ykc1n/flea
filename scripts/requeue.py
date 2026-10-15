import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from flea.store import connect
p=argparse.ArgumentParser();p.add_argument('battle_id',type=int);args=p.parse_args()
with connect() as db:
    result=db.execute("UPDATE replays SET status='queued',attempts=0,error=NULL WHERE id=? AND status='failed'",(args.battle_id,))
    print(f'Requeued {result.rowcount} failed replay(s).')
