/**
 * Tests for withPhotonCapabilities mixin
 * Validates capability injection across all inheritance patterns
 */

import { withPhotonCapabilities, Photon, MemoryProvider } from '../dist/index.js';
import { strict as assert } from 'assert';

async function runTests() {
  console.log('🧪 Testing withPhotonCapabilities Mixin...\n');
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          () => {
            console.log(`✅ ${name}`);
            passed++;
          },
          (err) => {
            console.error(`❌ ${name}: ${err.message}`);
            failed++;
          }
        );
      } else {
        console.log(`✅ ${name}`);
        passed++;
      }
    } catch (err) {
      console.error(`❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  // Test 1: Plain class (no parent)
  await test('Plain class gets all capabilities', () => {
    class Calculator {
      async add(a: number, b: number) {
        return a + b;
      }
    }

    const Enhanced = withPhotonCapabilities(Calculator);
    const instance = new Enhanced() as any;

    assert.strictEqual(typeof instance.emit, 'function', 'Should have emit method');
    assert.ok(instance.memory, 'Should have memory property');
    assert.strictEqual(typeof instance.call, 'function', 'Should have call method');
    assert.strictEqual(typeof instance.mcp, 'function', 'Should have mcp method');
  });

  // Test 2: Class with custom parent
  await test('Class with custom parent preserves parent methods', () => {
    class CustomBase {
      protected getData() {
        return 'data';
      }
    }

    class Todo extends CustomBase {
      async add(text: string) {
        return text;
      }
    }

    const Enhanced = withPhotonCapabilities(Todo);
    const instance = new Enhanced() as any;

    assert.strictEqual(typeof instance.add, 'function', 'Should have original method');
    assert.strictEqual(typeof (instance as any).getData, 'function', 'Should have parent method');
    assert.strictEqual(typeof instance.emit, 'function', 'Should have emit');
  });

  // Test 3: Class extending imported library-like base
  await test('Class extending library base works correctly', () => {
    // Simulate an imported library base
    class LibraryBase {
      public config: { timeout: number } = { timeout: 5000 };

      protected log(msg: string) {
        return `[LOG] ${msg}`;
      }
    }

    class Service extends LibraryBase {
      async work() {
        return this.log('Working');
      }
    }

    const Enhanced = withPhotonCapabilities(Service);
    const instance = new Enhanced() as any;

    assert.strictEqual(instance.config.timeout, 5000, 'Should preserve parent properties');
    assert.strictEqual(typeof instance.work, 'function', 'Should have original method');
    assert.strictEqual(typeof instance.emit, 'function', 'Should have emit');
  });

  // Test 4: Class already extending Photon (no double-wrapping)
  await test('Class already extending Photon returns same class', () => {
    class AlreadyPhoton extends Photon {
      async work() {
        return 'done';
      }
    }

    const Enhanced = withPhotonCapabilities(AlreadyPhoton);
    assert.strictEqual(Enhanced, AlreadyPhoton, 'Should return original class unchanged');
  });

  // Test 5: Avoid double-wrapping
  await test('Double-wrapping is idempotent', () => {
    class Plain {
      async compute() {
        return 42;
      }
    }

    const Enhanced1 = withPhotonCapabilities(Plain);
    const Enhanced2 = withPhotonCapabilities(Enhanced1);

    // Both should return the same wrapped class
    assert.strictEqual(Enhanced1, Enhanced2, 'Second wrap should return first wrap');
  });

  // Test 6: Verify memory provider works
  await test('Memory provider works correctly', async () => {
    class DataStore {
      async get(key: string) {
        return null;
      }
    }

    const Enhanced = withPhotonCapabilities(DataStore);
    const instance = new Enhanced() as any;

    // Memory should be lazy-initialized
    assert.ok(instance.memory, 'Memory should be defined');
    assert.ok(instance.memory instanceof MemoryProvider, 'Should be MemoryProvider instance');

    // Verify memory methods exist
    assert.strictEqual(typeof instance.memory.set, 'function', 'Should have set method');
    assert.strictEqual(typeof instance.memory.get, 'function', 'Should have get method');
    assert.strictEqual(typeof instance.memory.has, 'function', 'Should have has method');

    // Verify same memory instance on repeated access (lazy-init works)
    const mem1 = instance.memory;
    const mem2 = instance.memory;
    assert.strictEqual(mem1, mem2, 'Memory should be cached (same instance)');
  });

  // Test 7: Verify emit method signature
  await test('Emit method accepts data and channel objects', async () => {
    class EventEmitter {
      emitted: any[] = [];

      async process() {
        return 'done';
      }
    }

    const Enhanced = withPhotonCapabilities(EventEmitter);
    const instance = new Enhanced() as any;

    // Temporarily capture emits (won't have real output handler in test)
    let emitCount = 0;
    const originalEmit = instance.emit;
    instance.emit = (data: any) => {
      emitCount++;
      originalEmit.call(instance, data);
    };

    instance.emit({ status: 'working' });
    instance.emit({ channel: 'notifications', event: 'update', data: { id: 1 } });

    assert.strictEqual(emitCount, 2, 'Should emit multiple times');
  });

  // Test 8: Verify call method throws without handler
  await test('Call method throws appropriate error when no handler', async () => {
    class Worker {
      async execute() {
        return 'result';
      }
    }

    const Enhanced = withPhotonCapabilities(Worker);
    const instance = new Enhanced() as any;

    // call() is async, so it returns a Promise that rejects
    let errorThrown = false;
    try {
      await instance.call('other.method');
    } catch (err) {
      errorThrown = true;
      assert.ok(/not available/i.test(String(err)), 'Should mention unavailable calls');
    }
    assert.ok(errorThrown, 'Should throw error when _callHandler not set');
  });

  // Test 9: Verify mcp method throws without factory
  await test('MCP method throws appropriate error when no factory', () => {
    class DataFetcher {
      async fetch() {
        return null;
      }
    }

    const Enhanced = withPhotonCapabilities(DataFetcher);
    const instance = new Enhanced() as any;

    // mcp() should throw because _mcpFactory is not set
    assert.throws(
      () => instance.mcp('github'),
      /not available/i,
      'Should throw error about unavailable MCP access'
    );
  });

  // Test 10: Original methods still work
  await test('Original methods execute correctly after wrapping', async () => {
    class Math {
      async add(a: number, b: number) {
        return a + b;
      }

      async multiply(a: number, b: number) {
        return a * b;
      }
    }

    const Enhanced = withPhotonCapabilities(Math);
    const instance = new Enhanced() as any;

    const sum = await instance.add(5, 3);
    const product = await instance.multiply(5, 3);

    assert.strictEqual(sum, 8, 'Add should work');
    assert.strictEqual(product, 15, 'Multiply should work');
  });

  // Test 11: This binding in methods
  await test('Methods preserve correct this binding', async () => {
    class State {
      private value = 42;

      getValue() {
        return this.value;
      }

      async increment() {
        this.value++;
        return this.getValue();
      }
    }

    const Enhanced = withPhotonCapabilities(State);
    const instance = new Enhanced() as any;

    const initial = instance.getValue();
    const afterIncrement = await instance.increment();

    assert.strictEqual(initial, 42, 'Initial value should be 42');
    assert.strictEqual(afterIncrement, 43, 'Incremented value should be 43');
  });

  // Test 12: Multiple instances are independent
  await test('Multiple instances have independent state', () => {
    class Counter {
      count = 0;

      increment() {
        this.count++;
      }
    }

    const Enhanced = withPhotonCapabilities(Counter);
    const inst1 = new Enhanced() as any;
    const inst2 = new Enhanced() as any;

    inst1.increment();
    inst1.increment();
    inst2.increment();

    assert.strictEqual(inst1.count, 2, 'Instance 1 count should be 2');
    assert.strictEqual(inst2.count, 1, 'Instance 2 count should be 1');
    assert.notStrictEqual(inst1.memory, inst2.memory, 'Memory should be independent');
  });

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
