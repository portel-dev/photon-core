/**
 * Tests for photon() — Direct TypeScript API
 * Run: npx tsx tests/photon-loader-lite.test.ts
 */

import { strict as assert } from 'assert';
import * as path from 'path';
import { photon, clearPhotonCache, type PhotonEvent } from '../src/photon-loader-lite.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch((e) => {
    console.log(`  ❌ ${name}`);
    console.error(`     ${e}`);
    failed++;
  });
}

async function run() {
  console.log('\n🧪 photon() — Direct TypeScript API\n');

  // ─── Basic Loading ───────────────────────────────────────────

  console.log('  Basic Loading');

  await test('loads a simple photon and calls methods', async () => {
    clearPhotonCache();
    const calc = await photon(path.join(FIXTURES, 'simple-calc.photon.ts'));
    const result = await calc.add({ a: 2, b: 3 });
    assert.equal(result, 5);
  });

  await test('multiple methods work on same instance', async () => {
    clearPhotonCache();
    const calc = await photon(path.join(FIXTURES, 'simple-calc.photon.ts'));
    assert.equal(await calc.add({ a: 1, b: 2 }), 3);
    assert.equal(await calc.multiply({ a: 3, b: 4 }), 12);
  });

  await test('returns cached instance on second call', async () => {
    clearPhotonCache();
    const filePath = path.join(FIXTURES, 'simple-calc.photon.ts');
    const a = await photon(filePath);
    const b = await photon(filePath);
    // Same proxy wrapping the same instance
    assert.equal(await a.add({ a: 1, b: 1 }), await b.add({ a: 1, b: 1 }));
  });

  await test('different instance names get separate instances', async () => {
    clearPhotonCache();
    const filePath = path.join(FIXTURES, 'simple-calc.photon.ts');
    const a = await photon(filePath, { instanceName: 'alpha' });
    const b = await photon(filePath, { instanceName: 'beta' });
    // Both work independently
    assert.equal(await a.add({ a: 1, b: 2 }), 3);
    assert.equal(await b.add({ a: 10, b: 20 }), 30);
  });

  // ─── Type Inference ──────────────────────────────────────────

  console.log('\n  Type Inference');

  await test('generic type parameter works', async () => {
    clearPhotonCache();
    interface Calc {
      add(params: { a: number; b: number }): Promise<number>;
    }
    const calc = await photon<Calc>(path.join(FIXTURES, 'simple-calc.photon.ts'));
    const result: number = await calc.add({ a: 5, b: 10 });
    assert.equal(result, 15);
  });

  // ─── Middleware ──────────────────────────────────────────────

  console.log('\n  Middleware');

  await test('@cached middleware works', async () => {
    clearPhotonCache();
    const tool = await photon(path.join(FIXTURES, 'cached-tool.photon.ts'));

    const r1 = await tool.expensive({ key: 'test' });
    const r2 = await tool.expensive({ key: 'test' });

    // Should return cached result (same callCount)
    assert.equal(r1.callCount, r2.callCount, 'Second call should return cached result');
    assert.equal(r1.key, 'test');
  });

  await test('@cached returns fresh result for different params', async () => {
    clearPhotonCache();
    const tool = await photon(path.join(FIXTURES, 'cached-tool.photon.ts'));

    const r1 = await tool.expensive({ key: 'alpha' });
    const r2 = await tool.expensive({ key: 'beta' });

    // Different keys = different cache entries = different callCounts
    assert.notEqual(r1.callCount, r2.callCount);
  });

  // ─── @stateful ──────────────────────────────────────────────

  console.log('\n  @stateful');

  await test('@stateful attaches __meta to returned objects', async () => {
    clearPhotonCache();
    const todo = await photon(path.join(FIXTURES, 'stateful-todo.photon.ts'));
    const item = await todo.add({ title: 'Test item' });

    assert.equal(item.title, 'Test item');
    assert.equal(item.done, false);

    // __meta should be attached
    assert.ok(item.__meta, '__meta should be attached');
    assert.equal(item.__meta.createdBy, 'add');
    assert.ok(item.__meta.createdAt, 'should have createdAt timestamp');
  });

  await test('__meta is non-enumerable', async () => {
    clearPhotonCache();
    const todo = await photon(path.join(FIXTURES, 'stateful-todo.photon.ts'));
    const item = await todo.add({ title: 'Hidden meta' });

    // __meta should not appear in JSON or Object.keys
    assert.ok(!Object.keys(item).includes('__meta'));
    const json = JSON.stringify(item);
    assert.ok(!json.includes('__meta'));
  });

  await test('onEvent callback receives events', async () => {
    clearPhotonCache();
    const events: PhotonEvent[] = [];
    const todo = await photon(path.join(FIXTURES, 'stateful-todo.photon.ts'), {
      onEvent: (e) => events.push(e),
    });

    await todo.add({ title: 'Event test' });
    await todo.list();

    assert.equal(events.length, 2);
    assert.equal(events[0].method, 'add');
    // The param name is 'params' since the signature is add(params: {...})
    assert.deepEqual(events[0].params, { params: { title: 'Event test' } });
    assert.equal(events[1].method, 'list');
  });

  // ─── @photon Dependency Injection ───────────────────────────

  console.log('\n  @photon Dependency Injection');

  await test('resolves @photon dependencies recursively', async () => {
    clearPhotonCache();
    const parent = await photon(path.join(FIXTURES, 'parent.photon.ts'));
    const result = await parent.addViaChild({ a: 7, b: 8 });
    assert.equal(result, 15);
  });

  // ─── Cycle Detection ────────────────────────────────────────

  console.log('\n  Cycle Detection');

  await test('detects circular @photon dependencies', async () => {
    clearPhotonCache();
    try {
      await photon(path.join(FIXTURES, 'cycle-a.photon.ts'));
      assert.fail('Should have thrown circular dependency error');
    } catch (e: any) {
      assert.ok(
        e.message.includes('Circular @photon dependency'),
        `Expected circular dependency error, got: ${e.message}`,
      );
    }
  });

  // ─── Plain Class (no extends Photon) ────────────────────────

  console.log('\n  Plain Class Capabilities');

  await test('plain class gets memory injected', async () => {
    clearPhotonCache();
    const calc = await photon(path.join(FIXTURES, 'simple-calc.photon.ts'));
    // memory getter should be available through withPhotonCapabilities
    assert.ok(calc.memory !== undefined, 'memory should be available');
  });

  // ─── Integration: Cross-photon composition ─────────────────

  console.log('\n  Cross-Photon Composition (Integration)');

  await test('orchestrator calls counter and logger via this.call()', async () => {
    clearPhotonCache();
    const orch = await photon(path.join(FIXTURES, 'orchestrator.photon.ts'));

    const r1 = await orch.track({ key: 'clicks' });
    assert.equal(r1.key, 'clicks');
    assert.equal(r1.count, 1);
    assert.equal(r1.logged, true);

    const r2 = await orch.track({ key: 'clicks' });
    assert.equal(r2.count, 2);
  });

  await test('orchestrator status aggregates from multiple photons', async () => {
    clearPhotonCache();
    const orch = await photon(path.join(FIXTURES, 'orchestrator.photon.ts'));

    // Track something first
    await orch.track({ key: 'default' });
    await orch.track({ key: 'default' });

    const status = await orch.status();
    assert.equal(status.counterValue, 2);
    assert.equal(status.logCount, 2);
  });

  await test('sub-photons maintain state across orchestrator calls', async () => {
    clearPhotonCache();
    const orch = await photon(path.join(FIXTURES, 'orchestrator.photon.ts'));

    // Multiple calls accumulate state in sub-photons
    await orch.track({ key: 'a' });
    await orch.track({ key: 'b' });
    await orch.track({ key: 'a' });

    // Counter-service should have a=2, b=1
    // Logger should have 3 entries
    // We can verify by loading the sub-photons directly (cached instances)
    const counter = await photon(path.join(FIXTURES, 'counter-service.photon.ts'));
    const loggerSvc = await photon(path.join(FIXTURES, 'logger-service.photon.ts'));

    const aCount = await counter.get({ key: 'a' });
    const bCount = await counter.get({ key: 'b' });
    const logs = await loggerSvc.entries();

    assert.equal(aCount.count, 2);
    assert.equal(bCount.count, 1);
    assert.equal(logs.length, 3);
  });

  // ─── Error Handling ─────────────────────────────────────────

  console.log('\n  Error Handling');

  await test('throws clear error for missing file', async () => {
    clearPhotonCache();
    try {
      await photon('/nonexistent/path.photon.ts');
      assert.fail('Should have thrown');
    } catch (e: any) {
      assert.ok(e.message || e.code, 'Should have error info');
    }
  });

  // ─── Summary ────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
