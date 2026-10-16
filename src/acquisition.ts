import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { open, type ZipFile, type Entry } from 'yauzl';
import { cacheRoot, requireSpace, spaceGuard } from './storage.js';
import { execute } from './execution.js';
import type { Replay } from './types.js';

export class DependencyUnavailable extends Error {}

async function download(url: string, target: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new DependencyUnavailable(`Engine download HTTP ${response.status}`);
  let bytes = 0;
  const guard = spaceGuard();
  try {
    await pipeline(response.body, new Transform({ transform(chunk: Buffer, _encoding, next) {
      try {
        bytes += chunk.length;
        if (bytes > 256_000_000) throw new DependencyUnavailable('Engine archive exceeds limit');
        guard(chunk.length); next(null, chunk);
      } catch (error) { next(error as Error); }
    } }), createWriteStream(target, { flags: 'wx' }));
  } catch (error) { rmSync(target, { force: true }); throw error; }
}

async function extract(archive: string, destination: string): Promise<void> {
  const zip = await new Promise<ZipFile>((done, reject) => open(archive, { lazyEntries: true, validateEntrySizes: true }, (error, file) => error ? reject(error) : done(file!)));
  let total = 0, entries = 0;
  const guard = spaceGuard();
  try {
    await new Promise<void>((done, reject) => {
      zip.on('error', reject); zip.on('end', done);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          if (++entries > 20_000 || (total += entry.uncompressedSize) > 1_000_000_000) throw new DependencyUnavailable('Engine extraction limit exceeded');
          const target = resolve(destination, entry.fileName);
          if (!target.startsWith(destination + sep) || /[\\:\0]/.test(entry.fileName) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new DependencyUnavailable('Unsafe engine archive entry');
          if (entry.fileName.endsWith('/')) mkdirSync(target, { recursive: true });
          else {
            mkdirSync(dirname(target), { recursive: true });
            const input = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (error, stream) => error ? rej(error) : res(stream!)));
            await pipeline(input, new Transform({ transform(chunk: Buffer, _encoding, next) { try { guard(chunk.length); next(null, chunk); } catch (error) { next(error as Error); } } }), createWriteStream(target, { flags: 'wx' }));
            if (process.platform !== 'win32') chmodSync(target, 0o755);
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
}

export async function acquire(replay: Replay, log: string, signal?: AbortSignal): Promise<{ engine: string; root: string }> {
  if (!replay.engine || !replay.game || !replay.map || replay.map === 'Unknown map') throw new DependencyUnavailable('Replay dependency metadata is missing');
  if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw new DependencyUnavailable('Automatic engines currently require Windows or Linux x64');
  const root = cacheRoot();
  const hash = createHash('sha256').update(replay.engine).digest('hex');
  const directory = resolve(root, 'engine', hash);
  const binary = process.platform === 'win32' ? 'spring-headless.exe' : 'spring-headless';
  if (!existsSync(resolve(directory, 'complete'))) {
    const staging = directory + '.partial';
    mkdirSync(dirname(directory), { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging);
    const archive = directory + '.zip.partial';
    rmSync(archive, { force: true });
    try {
      await download(`https://zero-k.info/engine/${process.platform === 'win32' ? 'win64' : 'linux64'}/${encodeURIComponent(replay.engine)}.zip`, archive, signal);
      await extract(archive, staging);
      if (!existsSync(resolve(staging, binary))) throw new DependencyUnavailable('Exact engine has no headless executable');
      writeFileSync(resolve(staging, 'complete'), replay.engine);
      rmSync(directory, { recursive: true, force: true });
      renameSync(staging, directory);
    } finally { rmSync(archive, { force: true }); rmSync(staging, { recursive: true, force: true }); }
  }
  const downloader = resolve(directory, process.platform === 'win32' ? 'pr-downloader.exe' : 'pr-downloader');
  if (!existsSync(downloader)) throw new DependencyUnavailable('Exact engine lacks its content downloader');
  await execute([downloader, '--filesystem-writepath', root, '--download-game', replay.game, '--download-map', replay.map], {
    cwd: root, timeout: 1800, log, signal, registry: resolve(root, 'acquisition-process.json'), checkStorage: requireSpace,
    env: { PRD_RAPID_USE_STREAMER: 'false', PRD_DISABLE_CERT_CHECK: 'false' },
  });
  return { engine: resolve(directory, binary), root };
}
