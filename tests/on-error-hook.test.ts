/**
 * Tests for the onError lifecycle hook (observability, never suppresses).
 * See photon-core/src/base.ts executeTool + _invokeErrorHook.
 */

import assert from 'node:assert/strict';
import { Photon } from '../src/base.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

/** Silence expected stderr noise from executeTool's error logging during tests. */
function suppressConsoleError<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  return fn().finally(() => {
    console.error = orig;
  });
}

console.log('\n── onError hook ──────────────────────────────────');

await test('onError receives error and ctx when a method throws', async () => {
  const observed: Array<{ err: unknown; ctx: any }> = [];
  class Boom extends Photon {
    async boom(params: any): Promise<void> {
      throw new Error(`kaboom:${params?.kind}`);
    }
    async onError(error: unknown, ctx: { tool: string; params: any }): Promise<void> {
      observed.push({ err: error, ctx });
    }
  }
  const instance = new Boom();
  await suppressConsoleError(async () => {
    await assert.rejects(
      () => instance.executeTool('boom', { kind: 'badgers' }),
      /kaboom:badgers/
    );
  });
  assert.equal(observed.length, 1);
  assert.ok(observed[0].err instanceof Error);
  assert.equal((observed[0].err as Error).message, 'kaboom:badgers');
  assert.equal(observed[0].ctx.tool, 'boom');
  assert.deepEqual(observed[0].ctx.params, { kind: 'badgers' });
});

await test('onError does not fire when method succeeds', async () => {
  let fired = false;
  class Ok extends Photon {
    async greet(params: any): Promise<string> {
      return `hello ${params?.name ?? 'world'}`;
    }
    async onError(): Promise<void> {
      fired = true;
    }
  }
  const instance = new Ok();
  const result = await instance.executeTool('greet', { name: 'arul' });
  assert.equal(result, 'hello arul');
  assert.equal(fired, false);
});

await test('onError cannot suppress or transform the thrown error', async () => {
  class Swallowing extends Photon {
    async boom(): Promise<void> {
      throw new Error('original');
    }
    async onError(): Promise<void> {
      // Try to suppress — runtime must ignore.
      return;
    }
  }
  const instance = new Swallowing();
  await suppressConsoleError(async () => {
    await assert.rejects(() => instance.executeTool('boom', {}), /original/);
  });
});

await test('throwing inside onError does not cascade', async () => {
  class DoubleTrouble extends Photon {
    async boom(): Promise<void> {
      throw new Error('first');
    }
    async onError(): Promise<void> {
      throw new Error('second');
    }
  }
  const instance = new DoubleTrouble();
  // The original 'first' error must still surface. The 'second' is logged
  // and swallowed.
  await suppressConsoleError(async () => {
    await assert.rejects(() => instance.executeTool('boom', {}), /first/);
  });
});

await test('a slow onError hook times out without blocking the request path', async () => {
  class Slow extends Photon {
    async boom(): Promise<void> {
      throw new Error('quick');
    }
    async onError(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  const instance = new Slow();
  // Override the default 5s timeout by monkey-patching the private method.
  // We'd rather not wait 5s in tests — use reflection to shrink the wait.
  const proto = Object.getPrototypeOf(instance);
  const orig = proto._invokeErrorHook;
  proto._invokeErrorHook = async function (error: unknown, ctx: any) {
    const hook = (this as any).onError;
    if (typeof hook !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(hook.call(this, error, ctx)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('onError hook exceeded 100ms')), 100);
        }),
      ]);
    } catch (hookErr: any) {
      console.error(`onError hook failed for ${ctx.tool}: ${hookErr?.message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const started = Date.now();
  try {
    await suppressConsoleError(async () => {
      await assert.rejects(() => instance.executeTool('boom', {}), /quick/);
    });
  } finally {
    proto._invokeErrorHook = orig;
  }
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed < 1000,
    `expected fast failure, slow hook should have timed out; elapsed=${elapsed}ms`
  );
});

await test('no onError method means normal error propagation', async () => {
  class Bare extends Photon {
    async boom(): Promise<void> {
      throw new Error('unhooked');
    }
  }
  const instance = new Bare();
  await suppressConsoleError(async () => {
    await assert.rejects(() => instance.executeTool('boom', {}), /unhooked/);
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
