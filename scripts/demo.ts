import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../src/analysis.js';
import { connect, upsert, saveAnalysis } from '../src/store.js';
import type { EngineEvent, Replay } from '../src/types.js';

const replay: Replay = { id: 1, title: 'Flea interface demonstration', map: 'Absolution 2', mapImage: 'https://zero-k.info/Resources/Absolution_2.minimap.jpg', players: [{ id: 1, name: 'Scout (demo)', rank: 'demo', team: 1 }, { id: 2, name: 'Pathfinder (demo)', rank: 'demo', team: 2 }], mode: '1v1', duration: 360, engine: 'illustrative', game: 'Demo telemetry', started: 'Demo', rating: 'Demonstration', source: 'https://zero-k.info/Battles', download: null, demo: true };
const events: EngineEvent[] = [{ type: 'meta', mapWidth: 8192, mapHeight: 8192, fullView: true }, { type: 'player', team: 0, lobbyId: 1, name: 'Scout (demo)' }, { type: 'player', team: 1, lobbyId: 2, name: 'Pathfinder (demo)' }];
for (let team = 0; team < 2; team += 1) {
  events.push({ type: 'finished', unit: team === 0 ? 'factorycloak' : 'factoryspider', name: team === 0 ? 'Cloakbot Factory' : 'Spider Factory', unitId: 100 + team, team, time: 20 + team * 6, factory: true, x: 1000 + team * 6000, z: 1000 + team * 6000 });
  for (let unit = 0; unit < 12; unit += 1) {
    const unitId = team * 1000 + unit;
    events.push({ type: 'finished', unit: team === 0 ? 'cloakraid' : 'spiderscout', name: team === 0 ? 'Glaive' : 'Flea', unitId, team, time: 40 + unit * 15, factory: false });
    for (let time = 40 + unit * 15; time <= 360; time += 5) {
      const progress = Math.min(1, (time - 40 - unit * 15) / 300);
      events.push({ type: 'position', unitId, team, time, x: team === 0 ? 1000 + progress * 6000 : 7000 - progress * 6000, z: 1000 + team * 6000 + (unit - 6) * 70 });
    }
  }
}
events.push({ type: 'destroyed', unit: 'spiderscout', name: 'Flea', unitId: 1000, team: 1, time: 235 }, { type: 'game_over', time: 360 });
const path = resolve('data', 'demo.jsonl');
mkdirSync('data', { recursive: true });
writeFileSync(path, events.map(event => JSON.stringify(event)).join('\n'));
const db = connect();
upsert(db, replay);
saveAnalysis(db, 1, await analyze(path));
db.close();
console.log('Added clearly labeled demonstration replay #1');
