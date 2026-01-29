/**
 * Lock Helper Tests
 *
 * Tests for withLock(), setLockManager(), and getLockManager()
 */

import assert from 'node:assert/strict';
import {
  withLock,
  setLockManager,
  getLockManager,
} from '../src/decorators.js';
import type { LockManager } from '../src/decorators.js';

// ============================================================================
// Test runner
// ============================================================================

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

// ============================================================================
// Mock Lock Manager
// ============================================================================

class MockLockManager implements LockManager {
  calls: { method: string; args: unknown[] }[] = [];
  held: Set<string> = new Set();
  shouldFail = false;

  async acquire(lockName: string, timeout?: number): Promise<boolean> {
    this.calls.push({ method: 'acquire', args: [lockName, timeout] });
    if (this.shouldFail || this.held.has(lockName)) return false;
    this.held.add(lockName);
    return true;
  }

  async release(lockName: string): Promise<boolean> {
    this.calls.push({ method: 'release', args: [lockName] });
    this.held.delete(lockName);
    return true;
  }
}

// ============================================================================
// Tests
// ============================================================================

async function testWithoutManager() {
  console.log('\nwithLock (no manager):');

  // Ensure no manager is set
  setLockManager(null);

  await test('executes function normally', async () => {
    let executed = false;
    await withLock('test-lock', async () => {
      executed = true;
    });
    assert.ok(executed);
  });

  await test('returns function result', async () => {
    const result = await withLock('test-lock', async () => 42);
    assert.equal(result, 42);
  });
}

async function testWithManager() {
  console.log('\nwithLock (with manager):');

  await test('acquire → fn → release call order', async () => {
    const mock = new MockLockManager();
    setLockManager(mock);

    const order: string[] = [];
    await withLock('my-lock', async () => {
      order.push('fn');
    });

    assert.equal(mock.calls[0].method, 'acquire');
    assert.equal(mock.calls[0].args[0], 'my-lock');
    assert.equal(order[0], 'fn');
    assert.equal(mock.calls[1].method, 'release');
    assert.equal(mock.calls[1].args[0], 'my-lock');

    setLockManager(null);
  });

  await test('returns fn result', async () => {
    const mock = new MockLockManager();
    setLockManager(mock);

    const result = await withLock('lock', async () => 'hello');
    assert.equal(result, 'hello');

    setLockManager(null);
  });

  await test('releases lock on throw', async () => {
    const mock = new MockLockManager();
    setLockManager(mock);

    await assert.rejects(
      () => withLock('lock', async () => { throw new Error('boom'); }),
      { message: 'boom' }
    );

    const releaseCalls = mock.calls.filter(c => c.method === 'release');
    assert.equal(releaseCalls.length, 1);

    setLockManager(null);
  });

  await test('passes timeout to acquire', async () => {
    const mock = new MockLockManager();
    setLockManager(mock);

    await withLock('lock', async () => {}, 5000);
    assert.equal(mock.calls[0].args[1], 5000);

    setLockManager(null);
  });
}

async function testEdgeCases() {
  console.log('\nwithLock (edge cases):');

  await test('acquire failure throws error', async () => {
    const mock = new MockLockManager();
    mock.shouldFail = true;
    setLockManager(mock);

    await assert.rejects(
      () => withLock('lock', async () => 'should not run'),
      { message: 'Could not acquire lock: lock' }
    );

    setLockManager(null);
  });

  await test('second caller fails when lock is held', async () => {
    const mock = new MockLockManager();
    setLockManager(mock);

    // First caller acquires
    mock.held.add('shared');

    // Second caller should fail (mock returns false if already held)
    await assert.rejects(
      () => withLock('shared', async () => 'nope'),
      { message: 'Could not acquire lock: shared' }
    );

    setLockManager(null);
  });

  await test('getLockManager returns null when cleared', () => {
    setLockManager(null);
    assert.equal(getLockManager(), null);
  });

  await test('getLockManager returns set manager', () => {
    const mock = new MockLockManager();
    setLockManager(mock);
    assert.equal(getLockManager(), mock);
    setLockManager(null);
  });
}

// ============================================================================
// Run
// ============================================================================

(async () => {
  console.log('Running Lock Tests...\n');

  await testWithoutManager();
  await testWithManager();
  await testEdgeCases();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
