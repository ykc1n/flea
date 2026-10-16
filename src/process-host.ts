import { spawn } from 'node:child_process';

// The unique token in this wrapper's command line lets recovery identify its
// persisted PID without killing an unrelated process after PID reuse.
const argv = JSON.parse(process.argv[3] ?? '[]') as string[];
let started = false;
process.once('message', () => {
  started = true;
  const child = spawn(argv[0]!, argv.slice(1), { stdio: 'inherit', windowsHide: true });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('close', code => { process.exitCode = code ?? 1; if (process.connected) process.disconnect(); });
});
process.once('disconnect', () => { if (!started) process.exitCode = 1; });
