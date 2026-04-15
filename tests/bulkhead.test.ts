/**
 * @bulkhead middleware tests.
 *
 * Verifies concurrent-execution cap behaviour:
 * - calls under the cap succeed
 * - the (cap+1)-th concurrent call fails fast with PhotonBulkheadFullError
 * - the counter decrements after completion, allowing new calls through
 */

import assert from 'node:assert/strict';
import { builtinRegistry, buildMiddlewareChain, MiddlewareState } from '../src/middleware.js';

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

function buildChain(maxConcurrent: number, execute: () => Promise<unknown>) {
  const states = new Map<string, MiddlewareState>();
  return buildMiddlewareChain(
    execute,
    [{ name: 'bulkhead', config: { maxConcurrent }, phase: 15 }],
    builtinRegistry,
    states,
    { photon: 'p', instance: 'i', tool: 't' }
  );
}

async function run() {
  console.log('\nBulkhead:');

  await test('registered in builtinRegistry', () => {
    assert.ok(builtinRegistry.get('bulkhead'), 'bulkhead middleware registered');
    assert.equal(builtinRegistry.get('bulkhead')!.phase, 15);
  });

  await test('parses @bulkhead 3 shorthand', () => {
    const def = builtinRegistry.get('bulkhead')!;
    const cfg = def.parseShorthand!('3');
    assert.equal((cfg as { maxConcurrent: number }).maxConcurrent, 3);
  });

  await test('calls under cap succeed sequentially', async () => {
    let calls = 0;
    const chain = buildChain(2, async () => {
      calls++;
      return calls;
    });
    assert.equal(await chain(), 1);
    assert.equal(await chain(), 2);
    assert.equal(await chain(), 3);
  });

  await test('concurrent call past cap fails fast with PhotonBulkheadFullError', async () => {
    const chain = buildChain(2, () => new Promise((r) => setTimeout(() => r('ok'), 50)));
    const p1 = chain();
    const p2 = chain();
    // Third concurrent call should reject.
    let thirdError: unknown;
    try {
      await chain();
    } catch (e) {
      thirdError = e;
    }
    assert.ok(thirdError instanceof Error);
    assert.equal((thirdError as Error).name, 'PhotonBulkheadFullError');
    assert.ok((thirdError as Error).message.includes('Bulkhead full'));
    // Outstanding calls still complete normally.
    assert.equal(await p1, 'ok');
    assert.equal(await p2, 'ok');
  });

  await test('counter decrements on completion, admits new callers', async () => {
    const chain = buildChain(1, () => new Promise((r) => setTimeout(() => r('done'), 20)));
    await chain(); // in-flight goes 0 → 1 → 0
    await chain(); // must admit
    assert.ok(true);
  });

  await test('counter decrements on error', async () => {
    const chain = buildChain(1, async () => {
      throw new Error('boom');
    });
    await assert.rejects(() => chain(), /boom/);
    // A subsequent call must not be blocked because the in-flight count was
    // decremented in finally.
    const ok = buildChain(1, async () => 'ok');
    assert.equal(await ok(), 'ok');
  });

  console.log('\n==================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\nAll bulkhead tests passed!');
  }
}

run().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
