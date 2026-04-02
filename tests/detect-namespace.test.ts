/**
 * Tests for detectNamespace
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { detectNamespace } from '../src/data-paths.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'photon-ns-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('detectNamespace:');

test('returns empty string for non-git directory', () => {
  const dir = makeTempDir();
  try {
    assert.equal(detectNamespace(dir), '');
  } finally {
    cleanup(dir);
  }
});

test('returns empty string for git repo without remote', () => {
  const dir = makeTempDir();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    assert.equal(detectNamespace(dir), '');
  } finally {
    cleanup(dir);
  }
});

test('extracts owner from HTTPS remote', () => {
  const dir = makeTempDir();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git remote add origin https://github.com/portel-dev/photons.git', {
      cwd: dir,
      stdio: 'ignore',
    });
    assert.equal(detectNamespace(dir), 'portel-dev');
  } finally {
    cleanup(dir);
  }
});

test('extracts owner from SSH remote', () => {
  const dir = makeTempDir();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git remote add origin git@github.com:arul-kumar/my-photons.git', {
      cwd: dir,
      stdio: 'ignore',
    });
    assert.equal(detectNamespace(dir), 'arul-kumar');
  } finally {
    cleanup(dir);
  }
});

test('extracts owner from HTTPS without .git suffix', () => {
  const dir = makeTempDir();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git remote add origin https://github.com/my-org/repo-name', {
      cwd: dir,
      stdio: 'ignore',
    });
    assert.equal(detectNamespace(dir), 'my-org');
  } finally {
    cleanup(dir);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
