import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('managed execution bounds logs and waits for timeout cleanup', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'flea-exec-'));
  try {
    const { execute } = await import('../src/execution.js');
    const log = resolve(directory, 'processor.log');
    await execute([process.execPath, '-e', 'console.log("hello")'], { log, timeout: 5 });
    assert.match(readFileSync(log, 'utf8'), /hello/);
    await assert.rejects(execute([process.execPath, '-e', 'setInterval(()=>{},1000)'], { log, timeout: 0.2 }), /timed out/);
    await execute([process.execPath, '-e', 'process.stdout.write("x".repeat(200000))'], { log, timeout: 5, logLimit: 1024 });
    assert.ok(readFileSync(log).length <= 1024);
    await assert.rejects(execute(['flea-nonexistent-program'], { log, timeout: 5 }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('restart recovery terminates the owned engine tree after worker death', async () => {
  const { recoverExecution } = await import('../src/execution.js');
  const directory = mkdtempSync(resolve(tmpdir(), 'flea-recovery-'));
  const log = resolve(directory, 'processor.log');
  const registry = resolve(directory, 'execution.json');
  const engine = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(child.pid);setInterval(()=>{},1000);`;
  const moduleURL = pathToFileURL(resolve('dist/src/execution.js')).href;
  const driver = spawn(process.execPath, ['--input-type=module', '-e', `import {execute} from ${JSON.stringify(moduleURL)};await execute(${JSON.stringify([process.execPath, '-e', engine])},${JSON.stringify({ log, registry, timeout: 20 })});`], { stdio: 'ignore', windowsHide: true });
  let descendant = 0;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { descendant = Number(readFileSync(log, 'utf8').trim()); } catch { /* still starting */ }
      if (descendant > 0) break;
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(descendant > 0, 'engine descendant started');
    const closed = new Promise<void>(done => driver.once('close', () => done()));
    driver.kill('SIGKILL'); await closed;
    await recoverExecution(registry);
    let live = true;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { process.kill(descendant, 0); } catch { live = false; break; }
      if (process.platform === 'linux') {
        try { if (readFileSync(`/proc/${descendant}/stat`, 'utf8').includes(') Z ')) { live = false; break; } } catch { live = false; break; }
      }
      await new Promise(done => setTimeout(done, 100));
    }
    assert.equal(live, false, 'orphaned engine cannot survive recovery');
  } finally {
    driver.kill('SIGKILL'); await recoverExecution(registry);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a successful command cannot abandon a detached engine descendant', async () => {
  const { execute } = await import('../src/execution.js');
  const directory = mkdtempSync(resolve(tmpdir(), 'flea-detached-'));
  const log = resolve(directory, 'processor.log');
  let pid = 0;
  try {
    const command = `const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',windowsHide:true});console.log(p.pid);p.unref();`;
    // POSIX descendants deliberately escaping the process group are outside the
    // supported processor contract; Windows Job Objects prohibit that escape.
    if (process.platform !== 'win32') return;
    await execute([process.execPath, '-e', command], { log, timeout: 15 });
    pid = Number(readFileSync(log, 'utf8').trim());
    assert.ok(pid > 0);
    await new Promise(done => setTimeout(done, 100));
    assert.throws(() => process.kill(pid, 0));
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already terminated */ } }
    rmSync(directory, { recursive: true, force: true });
  }
});
