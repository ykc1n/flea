import { runCloudBattle } from '../src/cloud-job.js';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
try {
  const manifest = await runCloudBattle({
    id: Number(process.argv[2] ?? process.env.FLEA_BATTLE_ID),
    bucket: process.env.FLEA_RESULTS_BUCKET ?? '',
    scratch: process.env.FLEA_SCRATCH ?? '/scratch', signal: controller.signal,
  });
  if (manifest.status !== 'ready') process.exitCode = 1;
} catch (error) { console.error(error); process.exitCode = 1; }
