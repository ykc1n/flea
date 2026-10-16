import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('storage budget pauses acquisition without removing published data', async () => {
  const { storageStatus, requireSpace } = await import('../src/storage.js');
  const root = mkdtempSync(resolve(tmpdir(), 'flea-storage-'));
  try {
    writeFileSync(resolve(root, 'archive.sqlite'), Buffer.alloc(1024));
    assert.equal(storageStatus(root, 1000, 0).paused, true);
    assert.throws(() => requireSpace(root, 1000, 0), /storage/i);
    assert.equal(storageStatus(root, 2000, 0).usedBytes, 1024);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
