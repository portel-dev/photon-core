/**
 * Memory Namespace Stability — regression for the kith bug.
 *
 * Reported on @portel/photon@1.22.0: a flat photon in a project dir with
 * a git remote wrote memory to `.data/<photon>/memory/...` on first
 * load, then after a daemon restart wrote to
 * `.data/<git-owner>/<photon>/memory/...` instead — orphaning the old
 * data with no warning.
 *
 * Under the Option B contract (docs/internals/PHOTON-DIR-AND-NAMESPACE.md),
 * a photon's namespace is a pure function of the file's position relative
 * to PHOTON_DIR. Git state must never influence data paths.
 *
 * These tests pin both halves of the contract:
 *   1. A flat photon resolves to namespace '' (or 'local' on the lite
 *      loader's normalization), regardless of any git remote in the
 *      enclosing directory.
 *   2. The compatibility shim migrates pre-fix data sitting under a
 *      stale namespace bucket back to the canonical path on first read.
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { MemoryProvider } from '../src/memory.js';
import { detectNamespace, getPhotonMemoryDir } from '../src/data-paths.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

function makeFakeGitRemote(dir: string, owner: string, repo: string): void {
  // git won't recognize a bare config without HEAD — use a real init.
  execSync('git init -q', { cwd: dir });
  execSync(`git remote add origin git@github.com:${owner}/${repo}.git`, { cwd: dir });
}

async function runTests(): Promise<void> {
  console.log('\nMemory namespace stability (kith regression):');

  await test('detectNamespace still parses a git remote (helper unchanged)', () => {
    // Sanity check: the helper itself isn't broken; it's just no longer
    // called by the runtime path resolution.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-ns-detect-'));
    try {
      makeFakeGitRemote(tmp, 'Arul-', 'kith');
      assert.equal(detectNamespace(tmp), 'Arul-');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test(
    'MemoryProvider with empty namespace writes under the canonical bucket regardless of git remote',
    async () => {
      const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-ns-flat-'));
      // Pretend this project dir is a git repo with an Arul- owner — the
      // exact shape of the kith reporter's setup. The runtime must NOT
      // pick this up.
      makeFakeGitRemote(baseDir, 'Arul-', 'kith');
      const prevDir = process.env.PHOTON_DIR;
      process.env.PHOTON_DIR = baseDir;
      try {
        // Pass empty namespace explicitly — what loader.resolveNamespace
        // returns for a flat photon at the baseDir root.
        const mem = new MemoryProvider('kith-sync', undefined, '');
        await mem.set('syncState', { lastRunAt: 1234 });

        // The file must land under .data/kith-sync/memory/ — NOT under
        // .data/Arul-/kith-sync/memory/.
        const expected = getPhotonMemoryDir('', 'kith-sync', baseDir);
        const stranded = getPhotonMemoryDir('Arul-', 'kith-sync', baseDir);
        assert.equal(fs.existsSync(path.join(expected, 'syncState.json')), true);
        assert.equal(fs.existsSync(path.join(stranded, 'syncState.json')), false);
      } finally {
        if (prevDir === undefined) delete process.env.PHOTON_DIR;
        else process.env.PHOTON_DIR = prevDir;
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    }
  );

  await test(
    'Pre-fix data under a git-owner bucket migrates to the canonical path on first read',
    async () => {
      const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-ns-stranded-'));
      makeFakeGitRemote(baseDir, 'Arul-', 'kith');
      const prevDir = process.env.PHOTON_DIR;
      process.env.PHOTON_DIR = baseDir;
      try {
        // Simulate the pre-fix layout: data was written under
        // .data/Arul-/kith-sync/memory/syncState.json.
        const strandedDir = getPhotonMemoryDir('Arul-', 'kith-sync', baseDir);
        fs.mkdirSync(strandedDir, { recursive: true });
        fs.writeFileSync(
          path.join(strandedDir, 'syncState.json'),
          JSON.stringify({ lastRunAt: 9999 })
        );

        // First read after the fix uses the canonical (empty-namespace)
        // path. The compatibility shim should locate the stranded data
        // and return it.
        const mem = new MemoryProvider('kith-sync', undefined, '');
        const result = await mem.get('syncState');
        assert.deepEqual(result, { lastRunAt: 9999 });

        // The shim should also have moved the directory to the canonical
        // location so the next session doesn't depend on it.
        const canonical = getPhotonMemoryDir('', 'kith-sync', baseDir);
        assert.equal(fs.existsSync(path.join(canonical, 'syncState.json')), true);
      } finally {
        if (prevDir === undefined) delete process.env.PHOTON_DIR;
        else process.env.PHOTON_DIR = prevDir;
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    }
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void runTests();
