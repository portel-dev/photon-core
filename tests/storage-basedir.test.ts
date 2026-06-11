/**
 * Regression: storage() must resolve under the loader-pinned _baseDir.
 *
 * memory and schedule already pass this._baseDir to their providers; storage()
 * called getPhotonDataDir(ns, name) without it, so the path fell back to
 * process.env.PHOTON_DIR (or ~/.photon) at call time. A photon loaded from
 * one base directory could read and write storage under a different one
 * depending on which process touched it later — same drift class as the
 * memory baseDir bug.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Photon } from '../src/base.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

class ConcretePhoton extends Photon {
  exposeStorage(subpath: string): string {
    return this.storage(subpath);
  }
}

async function main(): Promise<void> {
  console.log('Photon base class — storage() baseDir pinning:');

  const pinnedBase = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-pinned-'));
  const envBase = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-env-'));
  const savedEnv = process.env.PHOTON_DIR;

  try {
    await test('storage() resolves under _baseDir even when PHOTON_DIR differs', async () => {
      process.env.PHOTON_DIR = envBase;

      const p = new ConcretePhoton();
      p._baseDir = pinnedBase;
      p._photonFilePath = path.join(pinnedBase, 'demo.photon.ts');
      p._photonName = 'demo';
      p._photonNamespace = 'local';

      const dir = p.exposeStorage('auth');
      assert.ok(
        dir.startsWith(pinnedBase),
        `storage() drifted to env-derived base:\n      got      ${dir}\n      expected under ${pinnedBase}`
      );
    });
  } finally {
    if (savedEnv === undefined) delete process.env.PHOTON_DIR;
    else process.env.PHOTON_DIR = savedEnv;
    fs.rmSync(pinnedBase, { recursive: true, force: true });
    fs.rmSync(envBase, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
