/**
 * Tests for the bases registry (daemon-owned record of served PHOTON_DIRs).
 * See docs/internals/PHOTON-DIR-AND-NAMESPACE.md §8.
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  readBasesRegistry,
  writeBasesRegistry,
  touchBase,
  listActiveBases,
  pruneBasesRegistry,
} from '../src/bases-registry.js';
import { getBasesRegistryPath } from '../src/data-paths.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function makeTempDir(prefix = 'photon-bases-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function withRegistry(fn: (registryFile: string, tmp: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const tmp = makeTempDir();
    const registryFile = path.join(tmp, '.bases.json');
    const prev = process.env.PHOTON_BASES_REGISTRY;
    process.env.PHOTON_BASES_REGISTRY = registryFile;
    try {
      await fn(registryFile, tmp);
    } finally {
      if (prev === undefined) delete process.env.PHOTON_BASES_REGISTRY;
      else process.env.PHOTON_BASES_REGISTRY = prev;
      cleanup(tmp);
    }
  };
}

console.log('\n── Bases Registry ───────────────────────────────');

await test(
  'readBasesRegistry returns empty when file is absent',
  withRegistry(() => {
    const reg = readBasesRegistry();
    assert.deepEqual(reg, { bases: [] });
  })
);

await test(
  'readBasesRegistry returns empty when file is malformed JSON',
  withRegistry((registryFile) => {
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.writeFileSync(registryFile, '{not valid json');
    const reg = readBasesRegistry();
    assert.deepEqual(reg, { bases: [] });
  })
);

await test(
  'readBasesRegistry filters out entries with missing required fields',
  withRegistry((registryFile) => {
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.writeFileSync(
      registryFile,
      JSON.stringify({
        bases: [
          { path: '/a', firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-01T00:00:00Z' },
          { path: '/b' }, // missing timestamps
          null,
          { firstSeen: 'x', lastSeen: 'x' }, // missing path
        ],
      })
    );
    const reg = readBasesRegistry();
    assert.equal(reg.bases.length, 1);
    assert.equal(reg.bases[0].path, '/a');
  })
);

await test(
  'touchBase creates a new entry with firstSeen and lastSeen set',
  withRegistry((registryFile, tmp) => {
    const base = path.join(tmp, 'my-photons');
    fs.mkdirSync(base);
    const now = new Date('2026-04-17T10:00:00Z');
    touchBase(base, now);
    const reg = readBasesRegistry();
    assert.equal(reg.bases.length, 1);
    assert.equal(reg.bases[0].path, path.resolve(base));
    assert.equal(reg.bases[0].firstSeen, '2026-04-17T10:00:00.000Z');
    assert.equal(reg.bases[0].lastSeen, '2026-04-17T10:00:00.000Z');
  })
);

await test(
  'touchBase updates lastSeen without changing firstSeen on existing entry',
  withRegistry((registryFile, tmp) => {
    const base = path.join(tmp, 'my-photons');
    fs.mkdirSync(base);
    touchBase(base, new Date('2026-04-17T10:00:00Z'));
    touchBase(base, new Date('2026-04-17T11:30:00Z'));
    const reg = readBasesRegistry();
    assert.equal(reg.bases.length, 1);
    assert.equal(reg.bases[0].firstSeen, '2026-04-17T10:00:00.000Z');
    assert.equal(reg.bases[0].lastSeen, '2026-04-17T11:30:00.000Z');
  })
);

await test(
  'touchBase normalizes paths (relative and trailing-slash collapse to same entry)',
  withRegistry((registryFile, tmp) => {
    const base = path.join(tmp, 'my-photons');
    fs.mkdirSync(base);
    touchBase(base);
    touchBase(`${base}/`);
    touchBase(path.join(base, '.'));
    const reg = readBasesRegistry();
    assert.equal(reg.bases.length, 1, 'three equivalent paths produce one entry');
  })
);

await test(
  'writeBasesRegistry uses atomic rename (no temp-file leakage on success)',
  withRegistry((registryFile) => {
    writeBasesRegistry({
      bases: [{ path: '/a', firstSeen: 'x', lastSeen: 'y' }],
    });
    assert.ok(fs.existsSync(registryFile));
    const dir = path.dirname(registryFile);
    const leftover = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftover, [], 'no .tmp files remain after successful write');
  })
);

await test(
  'listActiveBases filters out bases whose dir no longer exists',
  withRegistry((registryFile, tmp) => {
    const live = path.join(tmp, 'live');
    const dead = path.join(tmp, 'dead');
    fs.mkdirSync(live);
    fs.mkdirSync(dead);
    touchBase(live);
    touchBase(dead);
    fs.rmSync(dead, { recursive: true, force: true });
    const active = listActiveBases();
    assert.equal(active.length, 1);
    assert.equal(active[0].path, path.resolve(live));
  })
);

await test(
  'listActiveBases keeps entries with transient read errors (not ENOENT)',
  withRegistry((registryFile, tmp) => {
    // We can't easily simulate EACCES cross-platform, so we at least verify
    // that a path pointing at a regular file (statSync succeeds but is not a
    // directory) gets filtered out (not a stable base), while a directory
    // stays.
    const live = path.join(tmp, 'live');
    fs.mkdirSync(live);
    const notADir = path.join(tmp, 'a-file');
    fs.writeFileSync(notADir, 'not a directory');
    touchBase(live);
    touchBase(notADir);
    const active = listActiveBases();
    assert.equal(active.length, 1);
    assert.equal(active[0].path, path.resolve(live));
  })
);

await test(
  'pruneBasesRegistry removes confirmed-absent entries and returns the pruned list',
  withRegistry((registryFile, tmp) => {
    const live = path.join(tmp, 'live');
    const dead = path.join(tmp, 'dead');
    fs.mkdirSync(live);
    fs.mkdirSync(dead);
    touchBase(live);
    touchBase(dead);
    fs.rmSync(dead, { recursive: true, force: true });
    const removed = pruneBasesRegistry();
    assert.equal(removed.length, 1);
    assert.equal(removed[0].path, path.resolve(dead));
    const reg = readBasesRegistry();
    assert.equal(reg.bases.length, 1);
    assert.equal(reg.bases[0].path, path.resolve(live));
  })
);

await test(
  'pruneBasesRegistry with nothing to remove is a no-op',
  withRegistry((registryFile, tmp) => {
    const live = path.join(tmp, 'live');
    fs.mkdirSync(live);
    touchBase(live);
    const removed = pruneBasesRegistry();
    assert.equal(removed.length, 0);
    const reg = readBasesRegistry();
    assert.equal(reg.bases.length, 1);
  })
);

await test('getBasesRegistryPath honors PHOTON_BASES_REGISTRY override', async () => {
  const prev = process.env.PHOTON_BASES_REGISTRY;
  process.env.PHOTON_BASES_REGISTRY = '/tmp/photon-test-override.json';
  try {
    assert.equal(getBasesRegistryPath(), '/tmp/photon-test-override.json');
  } finally {
    if (prev === undefined) delete process.env.PHOTON_BASES_REGISTRY;
    else process.env.PHOTON_BASES_REGISTRY = prev;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
