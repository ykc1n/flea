import { spawn, execFile } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function terminate(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    try { await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); }
    catch (error) {
      try { process.kill(pid, 0); } catch { return; }
      throw error;
    }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
}

export async function recoverExecution(registry: string): Promise<void> {
  if (!existsSync(registry)) return;
  const record = JSON.parse(readFileSync(registry, 'utf8')) as { pid: number; token: string };
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !/^[a-f\d-]{36}$/.test(record.token)) throw new Error('Invalid execution registry');
  let command = '';
  if (process.platform === 'win32') {
    const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}').CommandLine`], { windowsHide: true });
    command = result.stdout;
  } else {
    try { command = readFileSync(`/proc/${record.pid}/cmdline`, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (command.includes(record.token) && command.includes('process-host.js')) await terminate(record.pid);
  unlinkSync(registry);
}

export interface ExecutionOptions {
  log: string;
  timeout: number;
  cwd?: string;
  signal?: AbortSignal;
  registry?: string;
  logLimit?: number;
  checkStorage?: () => void;
  env?: NodeJS.ProcessEnv;
}

export async function execute(argv: string[], options: ExecutionOptions): Promise<void> {
  if (!argv.length || !argv.every(value => typeof value === 'string') || !Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('Invalid execution configuration');
  options.signal?.throwIfAborted();
  mkdirSync(dirname(options.log), { recursive: true });
  if (options.registry) await recoverExecution(options.registry);
  const descriptor = openSync(options.log, 'w');
  const token = randomUUID();
  const wrapper = fileURLToPath(new URL('./process-host.js', import.meta.url));
  const child = spawn(process.execPath, [wrapper, token, JSON.stringify(argv)], {
    cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32', windowsHide: true,
  });
  let failure: Error | undefined;
  let written = 0;
  let killing: Promise<void> | undefined;
  const kill = (error: Error) => {
    failure ??= error;
    if (child.pid) killing ??= terminate(child.pid);
    // Attach immediately; the result is awaited after close below.
    void killing?.catch(() => {});
  };
  const log = (data: Buffer) => {
    try {
      const remaining = Math.max(0, (options.logLimit ?? 1_000_000) - written);
      if (remaining) written += writeSync(descriptor, data.subarray(0, remaining));
    } catch (error) { kill(error as Error); }
  };
  child.stdout!.on('data', log);
  child.stderr!.on('data', log);
  const completed = new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  void completed.catch(() => {});
  const abort = () => kill(new Error('Execution cancelled'));
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => kill(new Error(`Execution timed out after ${options.timeout} seconds`)), options.timeout * 1000);
  const monitor = setInterval(() => { try { options.checkStorage?.(); } catch (error) { kill(error as Error); } }, 1000);
  try {
    if (options.registry && child.pid) {
      mkdirSync(dirname(options.registry), { recursive: true });
      writeFileSync(options.registry, JSON.stringify({ pid: child.pid, token }));
    }
    // The wrapper cannot start its engine until ownership is durable.
    child.send('start');
    const code = await completed;
    if (killing) await killing;
    // Remove remaining descendants even if a command abandoned them on success.
    if (process.platform !== 'win32' && child.pid) await terminate(child.pid);
    if (failure) throw failure;
    if (code !== 0) throw new Error(`Processor exited with status ${code}`);
  } catch (error) {
    if (child.pid) await terminate(child.pid);
    await completed.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer); clearInterval(monitor);
    options.signal?.removeEventListener('abort', abort);
    closeSync(descriptor);
    if (options.registry && existsSync(options.registry)) unlinkSync(options.registry);
  }
}
