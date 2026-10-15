"""Explicitly opt-in illustrative match; never presented as real telemetry."""
from pathlib import Path
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from flea.store import connect, upsert
from flea.analysis import analyze


def seed():
    db=connect()
    replay={'id':1,'title':'Flea interface demonstration','map':'Absolution 2',
            'mapImage':'https://zero-k.info/Resources/Absolution_2.minimap.jpg',
            'players':[{'id':1,'name':'Scout (demo)','rank':'demo','team':1},{'id':2,'name':'Pathfinder (demo)','rank':'demo','team':2}],
            'mode':'1v1','duration':360,'engine':'illustrative','game':'Demo telemetry',
            'started':'Demo','rating':'Demonstration','source':'https://zero-k.info/Battles','download':None,'demo':True}
    upsert(db,replay)
    events=[{'type':'meta','mapWidth':8192,'mapHeight':8192},
            {'type':'player','team':0,'lobbyId':1,'name':'Scout (demo)'},
            {'type':'player','team':1,'lobbyId':2,'name':'Pathfinder (demo)'}]
    for team in range(2):
        events.append({'type':'finished','unit':'factorycloak' if team==0 else 'factoryspider','name':'Cloakbot Factory' if team==0 else 'Spider Factory','unitId':100+team,'team':team,'time':20+team*6,'factory':True,'x':1000+team*6000,'z':1000+team*6000})
        for unit in range(12):
            uid=team*1000+unit
            events.append({'type':'finished','unit':'cloakraid' if team==0 else 'spiderscout','name':'Glaive' if team==0 else 'Flea','unitId':uid,'team':team,'time':40+unit*15,'factory':False})
            for t in range(40+unit*15,361,5):
                progress=min(1,(t-40-unit*15)/300)
                events.append({'type':'position','unitId':uid,'team':team,'time':t,'x':(1000+progress*6000) if team==0 else (7000-progress*6000),'z':1000+team*6000+(unit-6)*70})
    events.append({'type':'destroyed','unit':'spiderscout','name':'Flea','unitId':1000,'team':1,'time':235})
    events.append({'type':'game_over','time':360})
    path=Path('data/demo.jsonl');path.parent.mkdir(exist_ok=True);path.write_text('\n'.join(json.dumps(e) for e in events))
    result=analyze(path)
    db.execute("UPDATE replays SET analysis=?,status='ready' WHERE id=1",(json.dumps(result),));db.commit();db.close()
    print('Added clearly labeled demonstration replay #1')

if __name__=='__main__': seed()
