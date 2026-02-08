/**
 * Scoped Memory System Tests
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemoryProvider } from '../src/memory.js';

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

// Use temp directories for tests
const testDataDir = path.join(os.tmpdir(), `photon-memory-data-${Date.now()}`);
const testSessionsDir = path.join(os.tmpdir(), `photon-memory-sessions-${Date.now()}`);
process.env.PHOTON_DATA_DIR = testDataDir;
process.env.PHOTON_SESSIONS_DIR = testSessionsDir;

async function testPhotonScope() {
  console.log('\nPhoton Scope (default):');

  await test('set and get a value', async () => {
    const mem = new MemoryProvider('test-photon');
    await mem.set('greeting', 'hello world');
    const val = await mem.get<string>('greeting');
    assert.equal(val, 'hello world');
  });

  await test('get returns null for missing key', async () => {
    const mem = new MemoryProvider('test-photon');
    const val = await mem.get('nonexistent');
    assert.equal(val, null);
  });

  await test('set overwrites existing value', async () => {
    const mem = new MemoryProvider('test-photon');
    await mem.set('counter', 1);
    await mem.set('counter', 2);
    const val = await mem.get<number>('counter');
    assert.equal(val, 2);
  });

  await test('stores complex objects', async () => {
    const mem = new MemoryProvider('test-photon');
    const data = {
      items: [
        { id: '1', text: 'Buy milk', done: false },
        { id: '2', text: 'Walk dog', done: true },
      ],
      meta: { total: 2, version: 3 },
    };
    await mem.set('tasks', data);
    const val = await mem.get<typeof data>('tasks');
    assert.deepEqual(val, data);
  });

  await test('has returns true for existing key', async () => {
    const mem = new MemoryProvider('test-photon');
    await mem.set('exists', true);
    assert.ok(await mem.has('exists'));
    assert.ok(!(await mem.has('does-not-exist')));
  });

  await test('delete removes a key', async () => {
    const mem = new MemoryProvider('test-photon');
    await mem.set('temp', 'value');
    assert.ok(await mem.has('temp'));

    const deleted = await mem.delete('temp');
    assert.ok(deleted);
    assert.ok(!(await mem.has('temp')));

    const again = await mem.delete('temp');
    assert.ok(!again);
  });

  await test('keys lists all keys', async () => {
    const mem = new MemoryProvider('keys-test');
    await mem.set('alpha', 1);
    await mem.set('beta', 2);
    await mem.set('gamma', 3);

    const keys = await mem.keys();
    assert.ok(keys.includes('alpha'));
    assert.ok(keys.includes('beta'));
    assert.ok(keys.includes('gamma'));
    assert.equal(keys.length, 3);
  });

  await test('clear removes all keys', async () => {
    const mem = new MemoryProvider('clear-test');
    await mem.set('a', 1);
    await mem.set('b', 2);

    await mem.clear();
    const keys = await mem.keys();
    assert.equal(keys.length, 0);
  });

  await test('getAll returns all key-value pairs', async () => {
    const mem = new MemoryProvider('getall-test');
    await mem.set('x', 10);
    await mem.set('y', 20);

    const all = await mem.getAll<number>();
    assert.equal(all.x, 10);
    assert.equal(all.y, 20);
  });

  await test('update atomically modifies a value', async () => {
    const mem = new MemoryProvider('update-test');
    await mem.set('count', 5);

    const result = await mem.update<number>('count', (n) => (n ?? 0) + 1);
    assert.equal(result, 6);

    const val = await mem.get<number>('count');
    assert.equal(val, 6);
  });

  await test('update initializes from null', async () => {
    const mem = new MemoryProvider('update-init-test');
    const result = await mem.update<number>('fresh', (n) => (n ?? 0) + 1);
    assert.equal(result, 1);
  });
}

async function testIsolation() {
  console.log('\nIsolation:');

  await test('different photons have isolated storage', async () => {
    const mem1 = new MemoryProvider('photon-a');
    const mem2 = new MemoryProvider('photon-b');

    await mem1.set('shared-key', 'from-a');
    await mem2.set('shared-key', 'from-b');

    assert.equal(await mem1.get('shared-key'), 'from-a');
    assert.equal(await mem2.get('shared-key'), 'from-b');
  });
}

async function testGlobalScope() {
  console.log('\nGlobal Scope:');

  await test('global scope is shared across photons', async () => {
    const mem1 = new MemoryProvider('photon-x');
    const mem2 = new MemoryProvider('photon-y');

    await mem1.set('shared', 'global-value', 'global');
    const val = await mem2.get<string>('shared', 'global');
    assert.equal(val, 'global-value');

    await mem1.delete('shared', 'global');
  });
}

async function testSessionScope() {
  console.log('\nSession Scope:');

  await test('requires sessionId', async () => {
    const mem = new MemoryProvider('session-photon');
    await assert.rejects(
      async () => mem.get('key', 'session'),
      /Session ID required/
    );
  });

  await test('isolates by session', async () => {
    const mem1 = new MemoryProvider('session-photon', 'session-1');
    const mem2 = new MemoryProvider('session-photon', 'session-2');

    await mem1.set('pref', 'dark', 'session');
    await mem2.set('pref', 'light', 'session');

    assert.equal(await mem1.get('pref', 'session'), 'dark');
    assert.equal(await mem2.get('pref', 'session'), 'light');
  });

  await test('sessionId can be updated dynamically', async () => {
    const mem = new MemoryProvider('dyn-session');
    mem.sessionId = 'sess-abc';
    await mem.set('val', 42, 'session');

    assert.equal(await mem.get('val', 'session'), 42);

    mem.sessionId = 'sess-def';
    assert.equal(await mem.get('val', 'session'), null);
  });
}

async function testEdgeCases() {
  console.log('\nEdge Cases:');

  await test('keys returns empty for nonexistent photon', async () => {
    const mem = new MemoryProvider('nonexistent-photon');
    const keys = await mem.keys();
    assert.deepEqual(keys, []);
  });

  await test('sanitizes key names with special characters', async () => {
    const mem = new MemoryProvider('sanitize-test');
    await mem.set('my/weird:key', 'value');
    const val = await mem.get<string>('my/weird:key');
    assert.equal(val, 'value');
  });
}

(async () => {
  console.log('Scoped Memory System Tests\n' + '='.repeat(50));

  await testPhotonScope();
  await testIsolation();
  await testGlobalScope();
  await testSessionScope();
  await testEdgeCases();

  // Cleanup
  fs.rmSync(testDataDir, { recursive: true, force: true });
  fs.rmSync(testSessionsDir, { recursive: true, force: true });
  delete process.env.PHOTON_DATA_DIR;
  delete process.env.PHOTON_SESSIONS_DIR;

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nAll memory tests passed!');
})();
