/**
 * InstanceStore Tests
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InstanceStore } from '../src/instance-store.js';

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

const testDir = path.join(os.tmpdir(), `photon-instance-store-${Date.now()}`);

function cleanup() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

async function testBasicOperations() {
  console.log('\nBasic Operations:');

  await test('save and load state', async () => {
    const store = new InstanceStore('test-photon', { baseDir: testDir });
    await store.save('default', { items: ['a', 'b'], count: 2 });
    const state = await store.load<{ items: string[]; count: number }>('default');
    assert.deepEqual(state, { items: ['a', 'b'], count: 2 });
  });

  await test('load returns null for missing instance', async () => {
    const store = new InstanceStore('nonexistent', { baseDir: testDir });
    const state = await store.load('missing');
    assert.equal(state, null);
  });

  await test('save overwrites existing state', async () => {
    const store = new InstanceStore('test-photon', { baseDir: testDir });
    await store.save('default', { v: 1 });
    await store.save('default', { v: 2 });
    const state = await store.load<{ v: number }>('default');
    assert.deepEqual(state, { v: 2 });
  });

  await test('exists returns true for saved instance', async () => {
    const store = new InstanceStore('test-photon', { baseDir: testDir });
    await store.save('check-exists', { ok: true });
    assert.equal(await store.exists('check-exists'), true);
  });

  await test('exists returns false for missing instance', async () => {
    const store = new InstanceStore('test-photon', { baseDir: testDir });
    assert.equal(await store.exists('never-created'), false);
  });

  await test('delete removes instance state', async () => {
    const store = new InstanceStore('test-photon', { baseDir: testDir });
    await store.save('to-delete', { temp: true });
    assert.equal(await store.exists('to-delete'), true);
    const deleted = await store.delete('to-delete');
    assert.equal(deleted, true);
    assert.equal(await store.exists('to-delete'), false);
  });

  await test('delete returns false for missing instance', async () => {
    const store = new InstanceStore('test-photon', { baseDir: testDir });
    const deleted = await store.delete('never-existed');
    assert.equal(deleted, false);
  });
}

async function testListing() {
  console.log('\nListing:');

  await test('list returns all instances', async () => {
    const store = new InstanceStore('list-test', { baseDir: testDir });
    await store.save('alpha', { n: 1 });
    await store.save('beta', { n: 2 });
    await store.save('gamma', { n: 3 });
    const instances = await store.list();
    assert.deepEqual(instances.sort(), ['alpha', 'beta', 'gamma']);
  });

  await test('list returns empty for new photon', async () => {
    const store = new InstanceStore('empty-photon', { baseDir: testDir });
    const instances = await store.list();
    assert.deepEqual(instances, []);
  });
}

async function testCurrentInstance() {
  console.log('\nCurrent Instance:');

  await test('getCurrent returns default when unset', async () => {
    const store = new InstanceStore('current-test', { baseDir: testDir });
    const current = await store.getCurrent();
    assert.equal(current, 'default');
  });

  await test('setCurrent and getCurrent roundtrip', async () => {
    const store = new InstanceStore('current-test', { baseDir: testDir });
    await store.setCurrent('production');
    const current = await store.getCurrent();
    assert.equal(current, 'production');
  });

  await test('load defaults to current instance', async () => {
    const store = new InstanceStore('current-load', { baseDir: testDir });
    await store.setCurrent('staging');
    await store.save('staging', { env: 'staging' });
    const state = await store.load<{ env: string }>();
    assert.deepEqual(state, { env: 'staging' });
  });
}

async function testStaticPaths() {
  console.log('\nStatic Paths:');

  await test('statePath follows convention', () => {
    const p = InstanceStore.statePath('kanban', 'work', '/base');
    assert.equal(p, path.join('/base', 'state', 'kanban', 'work.json'));
  });

  await test('statePath defaults to "default" for empty name', () => {
    const p = InstanceStore.statePath('kanban', '', '/base');
    assert.equal(p, path.join('/base', 'state', 'kanban', 'default.json'));
  });

  await test('contextPath follows convention', () => {
    const p = InstanceStore.contextPath('kanban', '/base');
    assert.equal(p, path.join('/base', 'context', 'kanban.json'));
  });
}

async function main() {
  console.log('InstanceStore Tests');
  console.log('='.repeat(40));

  try {
    await testBasicOperations();
    await testListing();
    await testCurrentInstance();
    await testStaticPaths();
  } finally {
    cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
