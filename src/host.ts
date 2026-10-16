import { mkdirSync, appendFileSync, existsSync, statSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { terminate } from './execution.js';
import { dataRoot } from './storage.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const logs = resolve(dataRoot(), 'logs');
mkdirSync(logs, { recursive: true });
let stopping = false;
const children = new Set<ChildProcess>();
const timers = new Set<NodeJS.Timeout>();

function log(name: string, data: Buffer): void {
  const path = resolve(logs, name + '.log');
  if (existsSync(path) && statSync(path).size >= 1_000_000) {
    rmSync(path + '.1', { force: true });
    renameSync(path, path + '.1');
  }
  appendFileSync(path, data.subarray(0, 64_000));
}

function supervise(name: string, script: string): void {
  const start = () => {
    if (stopping) return;
    const child = spawn(process.execPath, [resolve(ROOT, 'dist', 'src', script)], {
      cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', windowsHide: true,
    });
    children.add(child);
    child.stdout.on('data', (data: Buffer) => { try { log(name, data); } catch (error) { console.error(error); void stop(); } });
    child.stderr.on('data', (data: Buffer) => { try { log(name, data); } catch (error) { console.error(error); void stop(); } });
    child.once('error', error => console.error(name + ' failed to start', error));
    child.once('close', () => {
      children.delete(child);
      if (!stopping) {
        const timer = setTimeout(() => { timers.delete(timer); start(); }, 5_000);
        timers.add(timer);
      }
    });
  };
  start();
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  await Promise.all([...children].map(async child => {
    if (!child.pid) return;
    if (process.platform === 'win32') await terminate(child.pid);
    else {
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.pid) void terminate(child.pid); }, 30_000);
      await new Promise<void>(done => child.once('close', () => { clearTimeout(timer); done(); }));
    }
  }));
}
process.on('SIGINT', () => { void stop().catch(console.error); });
process.on('SIGTERM', () => { void stop().catch(console.error); });
supervise('web', 'server.js');
supervise('worker', 'worker.js');
