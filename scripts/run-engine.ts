import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function run(argv: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', code => { code === 0 ? resolvePromise() : reject(new Error(`Engine exited with status ${code}`)); });
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
  writeFileSync(config, 'return { ["Local Widgets Config"] = { localWidgets = true, localWidgetsFirst = false } }\n');
}
const engineConfig = resolve(root, 'springsettings.cfg');
if (!existsSync(engineConfig)) writeFileSync(engineConfig, '');
// Isolation scans only the write root, so expose this exact engine's base assets.
cpSync(resolve(dirname(executable), 'base'), resolve(root, 'base'), { recursive: true });
const exported = resolve(root, 'LuaUI', 'Logs', 'flea-events.jsonl');
rmSync(exported, { force: true });
// The managed execution owner controls this runner and its engine as one tree.
await run([executable, '--only-local', '--isolation', '--isolation-dir', root, '--config', engineConfig, '--write-dir', root, replay], root);
if (!existsSync(exported)) throw new Error('No export: enable local widgets and Flea Replay Export in the Zero-K installation');
copyFileSync(exported, output);
rmSync(exported, { force: true });
