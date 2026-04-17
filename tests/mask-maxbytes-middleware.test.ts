/**
 * @mask and @maxResponseBytes Middleware Tests
 *
 * Verifies the two security-oriented response-post-processing middleware:
 *   - @mask redacts named fields recursively in result objects
 *   - @maxResponseBytes caps serialized size with a truncation envelope
 */

import assert from 'node:assert/strict';
import { builtinRegistry, createStateStore, type MiddlewareContext } from '../src/middleware.js';

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

function makeCtx(): MiddlewareContext {
  return { photon: 'demo', tool: 'fetch', instance: 'default', params: {} };
}

async function runTests(): Promise<void> {
  console.log('\n@mask middleware:');

  await test('redacts named top-level fields', async () => {
    const def = builtinRegistry.get('mask')!;
    const handler = def.create({ fields: ['email', 'token'], placeholder: '[REDACTED]' }, createStateStore());
    const result = await handler(makeCtx(), async () => ({ id: 1, email: 'x@y.z', token: 'abc' }));
    assert.deepEqual(result, { id: 1, email: '[REDACTED]', token: '[REDACTED]' });
  });

  await test('walks into nested arrays and objects', async () => {
    const def = builtinRegistry.get('mask')!;
    const handler = def.create({ fields: ['password'], placeholder: '***' }, createStateStore());
    const result = await handler(makeCtx(), async () => ({
      users: [{ name: 'a', password: 'p1' }, { name: 'b', password: 'p2' }],
      nested: { inner: { password: 'p3' } },
    }));
    assert.deepEqual(result, {
      users: [{ name: 'a', password: '***' }, { name: 'b', password: '***' }],
      nested: { inner: { password: '***' } },
    });
  });

  await test('leaves primitives and missing fields untouched', async () => {
    const def = builtinRegistry.get('mask')!;
    const handler = def.create({ fields: ['secret'], placeholder: '[REDACTED]' }, createStateStore());
    assert.equal(await handler(makeCtx(), async () => 'plain'), 'plain');
    assert.equal(await handler(makeCtx(), async () => 42), 42);
    assert.deepEqual(await handler(makeCtx(), async () => ({ ok: true })), { ok: true });
  });

  await test('shorthand parses comma-and-space-separated field lists', () => {
    const def = builtinRegistry.get('mask')!;
    assert.deepEqual(
      def.parseShorthand!('email, token , password'),
      { fields: ['email', 'token', 'password'], placeholder: '[REDACTED]' }
    );
    assert.deepEqual(
      def.parseShorthand!('a b c'),
      { fields: ['a', 'b', 'c'], placeholder: '[REDACTED]' }
    );
  });

  console.log('\n@maxResponseBytes middleware:');

  await test('leaves small responses unchanged', async () => {
    const def = builtinRegistry.get('maxResponseBytes')!;
    const handler = def.create({ limit: 10_000 }, createStateStore());
    const result = await handler(makeCtx(), async () => ({ ok: true }));
    assert.deepEqual(result, { ok: true });
  });

  await test('truncates oversized responses with a structured envelope', async () => {
    const def = builtinRegistry.get('maxResponseBytes')!;
    const handler = def.create({ limit: 100 }, createStateStore());
    const big = 'x'.repeat(500);
    const result = (await handler(makeCtx(), async () => big)) as {
      truncated: boolean;
      reason: string;
      originalBytes: number;
      limit: number;
      preview: string;
    };
    assert.equal(result.truncated, true);
    assert.equal(result.reason, 'maxResponseBytes');
    assert.equal(result.limit, 100);
    assert.equal(result.originalBytes >= 500, true);
    assert.equal(result.preview.length <= 100, true);
  });

  await test('limit of 0 disables truncation', async () => {
    const def = builtinRegistry.get('maxResponseBytes')!;
    const handler = def.create({ limit: 0 }, createStateStore());
    const big = 'x'.repeat(5000);
    const result = await handler(makeCtx(), async () => big);
    assert.equal(result, big);
  });

  await test('shorthand parses byte count', () => {
    const def = builtinRegistry.get('maxResponseBytes')!;
    assert.deepEqual(def.parseShorthand!('4096'), { limit: 4096 });
  });

  await test('parseConfig accepts limit/bytes/max aliases', () => {
    const def = builtinRegistry.get('maxResponseBytes')!;
    assert.deepEqual(def.parseConfig!({ limit: '100' }), { limit: 100 });
    assert.deepEqual(def.parseConfig!({ bytes: '200' }), { limit: 200 });
    assert.deepEqual(def.parseConfig!({ max: '300' }), { limit: 300 });
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void runTests();
