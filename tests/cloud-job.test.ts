import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runCloudBattle, type CloudJobDependencies } from '../src/cloud-job.js';
import { parseDetail } from '../src/scrape.js';

let scratch: string;
const environment = { ...process.env };
beforeEach(() => {
  scratch = mkdtempSync(resolve(tmpdir(), 'flea-cloud-'));
  process.env.FLEA_RESERVE_BYTES = '1';
  process.env.CLOUD_RUN_TASK_COUNT = '1';
});
afterEach(() => { process.env = { ...environment }; rmSync(scratch, { recursive: true, force: true }); });
const options = () => ({ id: 2524251, bucket: 'private-flea-results', scratch });
function dependencies(complete = true): CloudJobDependencies {
  return {
    metadata: async id => parseDetail(readFileSync('tests/fixtures/battle.html', 'utf8'), id),
    worker: {
      fetchReplay: async () => Buffer.from([0x1f, 0x8b, 0]),
      acquire: async () => ({ root: scratch, engine: 'fake-engine' }),
      runProcessor: async argv => {
        const events = [{ type: 'meta', mapWidth: 100, mapHeight: 100, fullView: true, positionSampleSeconds: 60 },
          { type: 'finished', time: 8, team: 0, unitId: 1, unit: 'factorycloak', factory: true }];
        if (complete) events.push({ type: 'game_over', time: 60 } as typeof events[number]);
        writeFileSync(argv[argv.indexOf('--output') + 1]!, events.map(event => JSON.stringify(event)).join('\n'));
      },
    },
  };
}

test('cloud job uploads validated analysis before its durable ready manifest', async () => {
  const objects: Array<{ name: string; body: Buffer }> = [];
  const result = await runCloudBattle(options(), { ...dependencies(), upload: async (name, body) => { objects.push({ name, body }); } });
  assert.equal(result.status, 'ready');
  assert.match(result.result!, /^gs:\/\/private-flea-results\/results\/2524251\//);
  const replay = JSON.parse(gunzipSync(objects[0]!.body).toString()).replay;
  assert.equal(replay.analysis.meta.fullView, true);
  assert.equal(replay.analysis.meta.positionSampleSeconds, 60);
  assert.equal(replay.unitCount, 1);
  assert.ok(objects.at(-1)!.name.endsWith('/manifest.json'));
  assert.equal(JSON.parse(objects.at(-1)!.body.toString()).result, result.result);
});

test('cloud job never publishes a ready result for an invalid engine export', async () => {
  const names: string[] = [];
  const result = await runCloudBattle(options(), { ...dependencies(false), upload: async name => { names.push(name); } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.result, null);
  assert.equal(names.some(name => name.endsWith('/replay.json.gz')), false);
});

test('failed result upload cannot produce a ready manifest', async () => {
  const manifests: Array<{ status: string; result: string | null }> = [];
  const result = await runCloudBattle(options(), { ...dependencies(), upload: async (name, body) => {
    if (name.endsWith('/replay.json.gz')) throw new Error('Storage unavailable');
    if (name.endsWith('/manifest.json')) manifests.push(JSON.parse(body.toString()));
  } });
  assert.equal(result.status, 'failed');
  assert.deepEqual(manifests.map(item => [item.status, item.result]), [['failed', null]]);
});

test('manifest upload failure rejects execution, and duplicate task fanout is rejected', async () => {
  await assert.rejects(runCloudBattle(options(), { ...dependencies(), upload: async name => {
    if (name.endsWith('/manifest.json')) throw new Error('Commit failed');
  } }), /Commit failed/);
  process.env.CLOUD_RUN_TASK_COUNT = '2';
  await assert.rejects(runCloudBattle(options(), dependencies()), /exactly one task/);
});
