import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function run(argv: string[], cwd: string, timeout: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Engine timed out')); }, timeout);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(`Engine exited with status ${code}`)); });
  });
}

const replay = resolve(argument('--replay'));
const output = resolve(argument('--output'));
const engineVersion = argument('--engine');
argument('--game');
const engines = JSON.parse(process.env.FLEA_ENGINES ?? '{}') as Record<string, string>;
const executable = process.argv.includes('--executable') ? argument('--executable') : engines[engineVersion];
if (!executable) throw new Error(`Exact engine ${engineVersion} is unavailable`);
const root = resolve(process.argv.includes('--root') ? argument('--root') : process.env.FLEA_ZK_ROOT ?? 'data/zero-k');
const widget = resolve(root, 'LuaUI', 'Widgets', 'flea_export.lua');
mkdirSync(resolve(root, 'LuaUI', 'Widgets'), { recursive: true });
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
copyFileSync(resolve(projectRoot, 'worker', 'flea_export.lua'), widget);
mkdirSync(resolve(root, 'LuaUI', 'Config'), { recursive: true });
const config = resolve(root, 'LuaUI', 'Config', 'ZK_data.lua');
// This root belongs exclusively to Flea, never to a personal lobby installation.
if (!existsSync(config)) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(config, 'return { ["Local Widgets Config"] = { localWidgets = true, localWidgetsFirst = false } }\n');
}
const exported = resolve(root, 'LuaUI', 'Logs', 'flea-events.jsonl');
rmSync(exported, { force: true });
await run([executable, '--write-dir', root, replay], root, Math.max(1, Number(process.env.FLEA_PROCESS_TIMEOUT ?? 3600) - 30) * 1000);
if (!existsSync(exported)) throw new Error('No export: enable local widgets and Flea Replay Export in the Zero-K installation');
copyFileSync(exported, output);
rmSync(exported, { force: true });
