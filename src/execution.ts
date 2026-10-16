import { spawn, execFile } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export class ExecutionOwnershipError extends Error {}

export async function terminate(pid: number, token?: string): Promise<void> {
  if (process.platform === 'win32') {
    if (token) {
      const wrapper = fileURLToPath(new URL('./process-host.ps1', import.meta.url));
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-Token', token, '-Cleanup'], { windowsHide: true, timeout: 40_000 });
    }
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
  if (command.includes(record.token) && /process-host\.(js|ps1)/.test(command)) await terminate(record.pid, record.token);
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
  const windows = process.platform === 'win32';
  const wrapper = fileURLToPath(new URL(windows ? './process-host.ps1' : './process-host.js', import.meta.url));
  const command = windows ? 'powershell.exe' : process.execPath;
  const args = windows ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-Token', token, '-Payload', Buffer.from(JSON.stringify(argv)).toString('base64')] : [wrapper, token, JSON.stringify(argv)];
  const child = spawn(command, args, {
    cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: windows ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'ipc'], detached: !windows, windowsHide: true,
  });
  let ownershipResolved = !child.pid;
  let failure: Error | undefined;
  let written = 0;
  let killing: Promise<void> | undefined;
  let rejectOwnership!: (error: Error) => void;
  const ownershipFailure = new Promise<never>((_done, reject) => { rejectOwnership = reject; });
  void ownershipFailure.catch(() => {});
  const kill = (error: Error) => {
    failure ??= error;
    if (child.pid && !killing) {
      killing = terminate(child.pid, token);
      void killing.catch(error => rejectOwnership(new ExecutionOwnershipError('Engine termination failed', { cause: error })));
    }
  };
  const log = (data: Buffer) => {
    try {
      const remaining = Math.max(0, (options.logLimit ?? 1_000_000) - written);
      if (remaining) written += writeSync(descriptor, data.subarray(0, remaining));
    } catch (error) { kill(error as Error); }
  };
  child.stdout!.on('data', log);
  child.stderr!.on('data', log);
  child.stdin?.on('error', () => { /* Early wrapper exit is reported through close. */ });
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
    if (windows) child.stdin!.end('start\n'); else child.send('start');
    const code = await Promise.race([completed, ownershipFailure]);
    if (killing) await killing;
    if (code === 125) throw new ExecutionOwnershipError('Windows owner could not confirm descendant termination');
    // Remove remaining descendants even if a command abandoned them on success.
    if (process.platform !== 'win32' && child.pid) await terminate(child.pid);
    ownershipResolved = true;
    if (failure) throw failure;
    if (code !== 0) throw new Error(`Processor exited with status ${code}`);
  } catch (error) {
    if (!ownershipResolved && child.pid) {
      try { await terminate(child.pid, token); await completed.catch(() => {}); ownershipResolved = true; }
      catch (terminationError) { throw new ExecutionOwnershipError('Engine ownership could not be resolved; worker must stop', { cause: terminationError }); }
    }
    throw error;
  } finally {
    clearTimeout(timer); clearInterval(monitor);
    options.signal?.removeEventListener('abort', abort);
    closeSync(descriptor);
    if (ownershipResolved && options.registry && existsSync(options.registry)) unlinkSync(options.registry);
  }
}
