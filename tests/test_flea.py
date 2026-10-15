import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from flea.scrape import parse_detail, listing_ids
from flea.store import connect, upsert, unpack
from flea.analysis import analyze
from flea.worker import process_one

FIXTURES=Path(__file__).parent/'fixtures'

class FleaTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'FLEA_DB':self.tmp.name+'/db.sqlite','FLEA_DATA':self.tmp.name})
        self.env.start()
        self.db=connect()
        self.replay=parse_detail((FIXTURES/'battle.html').read_text(),2524251)
    def tearDown(self):
        self.db.close();self.env.stop();self.tmp.cleanup()
    def test_real_metadata(self):
        r=self.replay
        self.assertEqual(r['map'],'Absolution 2')
        self.assertEqual(r['duration'],1020)
        self.assertEqual(r['mode'],'1v1')
        self.assertEqual([p['name'] for p in r['players']],['FitRaptor','joseph52626'])
        self.assertEqual(r['players'][0]['rank'],'0_0')
        self.assertIn('.sdfz',r['download'])
    def test_discovery_deduplicates_ids(self):
        ids=listing_ids((FIXTURES/'battles.html').read_text())
        self.assertEqual(len(ids),len(set(ids)))
        self.assertIn(2524251,ids)
    def test_upsert_preserves_analysis_state(self):
        upsert(self.db,self.replay)
        self.db.execute("UPDATE replays SET status='ready' WHERE id=?",(self.replay['id'],))
        self.db.commit();upsert(self.db,self.replay)
        self.assertEqual(self.db.execute('SELECT status FROM replays').fetchone()[0],'ready')
    def make_export(self,path,complete=True):
        events=[{'type':'meta','mapWidth':100,'mapHeight':100},{'type':'player','team':4,'name':'A'},
                {'type':'finished','time':8,'team':4,'unit':'factoryspider','factory':True},
                {'type':'finished','time':12,'team':4,'unit':'spiderscout','factory':False},
                {'type':'position','time':15,'team':4,'unitId':3,'x':10,'z':20}]
        if complete:events.append({'type':'game_over','time':20})
        Path(path).write_text('\n'.join(json.dumps(e) for e in events))
    def test_first_factory_production_and_movements(self):
        path=Path(self.tmp.name)/'events';self.make_export(path)
        a=analyze(path)
        self.assertEqual(a['firstFactories']['4']['unit'],'factoryspider')
        self.assertEqual(a['unitCount'],2)
        self.assertEqual(len(a['movements']['3']),1)
    def test_reject_incomplete_export(self):
        path=Path(self.tmp.name)/'events';self.make_export(path,False)
        with self.assertRaisesRegex(ValueError,'Incomplete'):analyze(path)
    def test_worker_success_and_duplicate_avoidance(self):
        upsert(self.db,self.replay)
        def run(argv,**kwargs):self.make_export(argv[-1])
        with patch.dict(os.environ,{'FLEA_PROCESSOR':'["processor", "{output}"]'}),patch('flea.worker.fetch',return_value=b'\x1f\x8bdata'),patch('flea.worker.subprocess.run',side_effect=run):
            self.assertTrue(process_one(self.db));self.assertFalse(process_one(self.db))
        result=unpack(self.db.execute('SELECT * FROM replays').fetchone(),True)
        self.assertEqual(result['status'],'ready')
        self.assertEqual(result['unitCount'],2)
    def test_worker_retries_and_stops(self):
        upsert(self.db,self.replay)
        with patch.dict(os.environ,{'FLEA_PROCESSOR':'["processor"]'}),patch('flea.worker.fetch',side_effect=ValueError('download unavailable')):
            for _ in range(3):self.assertTrue(process_one(self.db))
            self.assertFalse(process_one(self.db))
        row=self.db.execute('SELECT * FROM replays').fetchone()
        self.assertEqual(row['status'],'failed');self.assertEqual(row['attempts'],3)
    def test_no_processor_leaves_queued(self):
        upsert(self.db,self.replay)
        with patch.dict(os.environ,{'FLEA_PROCESSOR':''}):self.assertFalse(process_one(self.db))
        self.assertEqual(self.db.execute('SELECT status FROM replays').fetchone()[0],'queued')

if __name__=='__main__':unittest.main()
