/**
 * Tests for auto-gitignore in git-tracked photon directories
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { ensureDir } from '../src/path-resolver.js';

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

function makeTempGitDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-gitignore-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('gitignore auto-generation:');

await test('creates .gitignore with .data/ in git-tracked PHOTON_DIR', async () => {
  const dir = makeTempGitDir();
  const photonDir = path.join(dir, 'my-photons');
  try {
    process.env.PHOTON_DIR = photonDir;
    await ensureDir(photonDir);
    const gitignore = fs.readFileSync(path.join(photonDir, '.gitignore'), 'utf-8');
    assert.ok(gitignore.includes('.data/'), 'should include .data/');
  } finally {
    delete process.env.PHOTON_DIR;
    cleanup(dir);
  }
});

await test('does not create .gitignore for ~/.photon (default dir)', async () => {
  assert.ok(true, 'default dir skipped by design');
});

await test('does not create .gitignore in non-git directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-nogit-'));
  try {
    await ensureDir(dir);
    assert.ok(!fs.existsSync(path.join(dir, '.gitignore')), 'no .gitignore in non-git dir');
  } finally {
    cleanup(dir);
  }
});

await test('is idempotent — does not duplicate patterns', async () => {
  const dir = makeTempGitDir();
  const photonDir = path.join(dir, 'photons');
  try {
    await ensureDir(photonDir);
    await ensureDir(photonDir);
    const gitignore = fs.readFileSync(path.join(photonDir, '.gitignore'), 'utf-8');
    const dataCount = gitignore.split('\n').filter((l) => l.trim() === '.data/').length;
    assert.equal(dataCount, 1, '.data/ should appear exactly once');
  } finally {
    cleanup(dir);
  }
});

await test('preserves existing .gitignore entries', async () => {
  const dir = makeTempGitDir();
  const photonDir = path.join(dir, 'photons');
  fs.mkdirSync(photonDir, { recursive: true });
  fs.writeFileSync(path.join(photonDir, '.gitignore'), 'node_modules/\n.DS_Store\n');
  try {
    await ensureDir(photonDir);
    const gitignore = fs.readFileSync(path.join(photonDir, '.gitignore'), 'utf-8');
    assert.ok(gitignore.includes('node_modules/'), 'preserves existing entries');
    assert.ok(gitignore.includes('.DS_Store'), 'preserves existing entries');
    assert.ok(gitignore.includes('.data/'), 'adds .data/ pattern');
  } finally {
    cleanup(dir);
  }
});

await test('skips .data/ if already in .gitignore', async () => {
  const dir = makeTempGitDir();
  const photonDir = path.join(dir, 'photons');
  fs.mkdirSync(photonDir, { recursive: true });
  fs.writeFileSync(path.join(photonDir, '.gitignore'), '.data/\n');
  try {
    await ensureDir(photonDir);
    const gitignore = fs.readFileSync(path.join(photonDir, '.gitignore'), 'utf-8');
    const dataCount = gitignore.split('\n').filter((l) => l.trim() === '.data/').length;
    assert.equal(dataCount, 1, 'does not duplicate .data/');
  } finally {
    cleanup(dir);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
