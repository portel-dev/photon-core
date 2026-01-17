/**
 * Channel Broker Tests
 *
 * Tests for the channel-based pub/sub system
 */

import assert from 'node:assert/strict';
import {
  registerBroker,
  createBroker,
  getRegisteredBrokers,
  getBroker,
  setBroker,
  clearBroker,
} from '../src/channels/registry.js';
import { NoOpBroker } from '../src/channels/noop-broker.js';
import type { ChannelBroker, ChannelMessage, ChannelHandler, Subscription } from '../src/channels/types.js';

// Track test results
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
// NoOpBroker Tests
// ============================================================================

async function testNoOpBroker() {
  console.log('\nNoOpBroker:');

  await test('has correct type', () => {
    const broker = new NoOpBroker();
    assert.equal(broker.type, 'noop');
  });

  await test('isConnected returns true', () => {
    const broker = new NoOpBroker();
    assert.equal(broker.isConnected(), true);
  });

  await test('publish does not throw', async () => {
    const broker = new NoOpBroker();
    const message: ChannelMessage = {
      channel: 'test',
      event: 'test-event',
      data: { foo: 'bar' },
    };
    await broker.publish(message); // Should not throw
  });

  await test('subscribe returns inactive subscription', async () => {
    const broker = new NoOpBroker();
    let called = false;
    const handler: ChannelHandler = () => {
      called = true;
    };

    const sub = await broker.subscribe('test-channel', handler);

    assert.equal(sub.channel, 'test-channel');
    assert.equal(sub.active, false);
    assert.equal(typeof sub.unsubscribe, 'function');
    assert.equal(called, false); // Handler should never be called
  });

  await test('connect and disconnect do not throw', async () => {
    const broker = new NoOpBroker();
    await broker.connect();
    await broker.disconnect();
  });
}

// ============================================================================
// Registry Tests
// ============================================================================

async function testRegistry() {
  console.log('\nRegistry:');

  // Clear state before testing
  clearBroker();

  await test('noop broker is registered by default', () => {
    const types = getRegisteredBrokers();
    assert(types.includes('noop'), 'noop should be registered');
  });

  await test('createBroker creates noop broker', () => {
    const broker = createBroker('noop');
    assert.equal(broker.type, 'noop');
  });

  await test('createBroker throws for unknown type', () => {
    assert.throws(
      () => createBroker('unknown-broker-type'),
      /Unknown broker type: unknown-broker-type/
    );
  });

  await test('registerBroker adds custom broker', () => {
    // Create a mock broker
    class MockBroker implements ChannelBroker {
      readonly type = 'mock';
      async publish(): Promise<void> {}
      async subscribe(channel: string): Promise<Subscription> {
        return { channel, active: true, unsubscribe: () => {} };
      }
      isConnected(): boolean {
        return true;
      }
    }

    registerBroker('mock', () => new MockBroker());

    const types = getRegisteredBrokers();
    assert(types.includes('mock'), 'mock should be registered');

    const broker = createBroker('mock');
    assert.equal(broker.type, 'mock');
  });

  await test('getBroker returns cached instance', () => {
    clearBroker();
    const broker1 = getBroker();
    const broker2 = getBroker();
    assert.equal(broker1, broker2, 'Should return same instance');
  });

  await test('setBroker overrides active broker', () => {
    clearBroker();
    const customBroker = new NoOpBroker();
    setBroker(customBroker);
    const active = getBroker();
    assert.equal(active, customBroker);
  });

  await test('clearBroker resets active broker', () => {
    setBroker(new NoOpBroker());
    clearBroker();
    // After clear, getBroker should create a new instance
    const broker = getBroker();
    assert(broker !== null);
  });
}

// ============================================================================
// Mock Broker for Integration Testing
// ============================================================================

class InMemoryBroker implements ChannelBroker {
  readonly type = 'in-memory';
  private subscriptions = new Map<string, Set<ChannelHandler>>();
  private connected = false;

  async publish(message: ChannelMessage): Promise<void> {
    const handlers = this.subscriptions.get(message.channel);
    if (handlers) {
      for (const handler of handlers) {
        handler(message);
      }
    }
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    let handlers = this.subscriptions.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.subscriptions.set(channel, handlers);
    }
    handlers.add(handler);

    return {
      channel,
      active: true,
      unsubscribe: () => {
        handlers!.delete(handler);
      },
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.subscriptions.clear();
  }
}

async function testInMemoryBroker() {
  console.log('\nInMemoryBroker (integration pattern):');

  await test('publish delivers to subscribers', async () => {
    const broker = new InMemoryBroker();
    const received: ChannelMessage[] = [];

    await broker.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    await broker.publish({
      channel: 'test-channel',
      event: 'test',
      data: { value: 42 },
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].channel, 'test-channel');
    assert.equal(received[0].event, 'test');
    assert.deepEqual(received[0].data, { value: 42 });
  });

  await test('publish does not deliver to other channels', async () => {
    const broker = new InMemoryBroker();
    const received: ChannelMessage[] = [];

    await broker.subscribe('channel-a', (msg) => {
      received.push(msg);
    });

    await broker.publish({
      channel: 'channel-b',
      event: 'test',
    });

    assert.equal(received.length, 0);
  });

  await test('multiple subscribers receive messages', async () => {
    const broker = new InMemoryBroker();
    let count = 0;

    await broker.subscribe('multi', () => count++);
    await broker.subscribe('multi', () => count++);
    await broker.subscribe('multi', () => count++);

    await broker.publish({ channel: 'multi', event: 'test' });

    assert.equal(count, 3);
  });

  await test('unsubscribe stops message delivery', async () => {
    const broker = new InMemoryBroker();
    let count = 0;

    const sub = await broker.subscribe('unsub-test', () => count++);

    await broker.publish({ channel: 'unsub-test', event: 'test' });
    assert.equal(count, 1);

    sub.unsubscribe();

    await broker.publish({ channel: 'unsub-test', event: 'test' });
    assert.equal(count, 1); // Should not increase
  });

  await test('connect/disconnect lifecycle', async () => {
    const broker = new InMemoryBroker();

    assert.equal(broker.isConnected(), false);

    await broker.connect();
    assert.equal(broker.isConnected(), true);

    await broker.disconnect();
    assert.equal(broker.isConnected(), false);
  });
}

// ============================================================================
// ChannelMessage Structure Tests
// ============================================================================

async function testChannelMessage() {
  console.log('\nChannelMessage structure:');

  await test('minimal message has required fields', async () => {
    const broker = new InMemoryBroker();
    let received: ChannelMessage | null = null;

    await broker.subscribe('struct-test', (msg) => {
      received = msg;
    });

    await broker.publish({
      channel: 'struct-test',
      event: 'minimal',
    });

    assert(received !== null);
    assert.equal(received!.channel, 'struct-test');
    assert.equal(received!.event, 'minimal');
  });

  await test('message preserves all optional fields', async () => {
    const broker = new InMemoryBroker();
    let received: ChannelMessage | null = null;

    await broker.subscribe('struct-test', (msg) => {
      received = msg;
    });

    const timestamp = Date.now();
    await broker.publish({
      channel: 'struct-test',
      event: 'full',
      data: { nested: { value: 123 } },
      timestamp,
      source: 'test-source',
    });

    assert(received !== null);
    assert.equal(received!.channel, 'struct-test');
    assert.equal(received!.event, 'full');
    assert.deepEqual(received!.data, { nested: { value: 123 } });
    assert.equal(received!.timestamp, timestamp);
    assert.equal(received!.source, 'test-source');
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

(async () => {
  console.log('Channel Broker Tests\n' + '='.repeat(50));

  await testNoOpBroker();
  await testRegistry();
  await testInMemoryBroker();
  await testChannelMessage();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nAll channel broker tests passed!');
})();
