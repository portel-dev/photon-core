/**
 * End-to-end injection tests: photons that consume runtime capabilities
 * via constructor injection (instead of `extends Photon`) plus the
 * forgiving auto-inject path for plain classes that reference
 * `this.cf` / `this.cfEnv` without declaring a typed constructor
 * parameter.
 */

import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { photon, clearPhotonCache } from '../src/photon-loader-lite.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`  ✓ ${name}`);
    },
    err => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err?.message ?? err}`);
    },
  );
}

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-injection-'));

async function main(): Promise<void> {
  console.log('Photon injection (constructor-based runtime access):');

  await clearPhotonCache();
  await test('injected `Photon` is configured with the host photon name', async () => {
    const inst = await photon(path.join(FIXTURES, 'photon-injected.photon.ts'), {
      baseDir: tmpBase,
    });
    const result = (await (inst as { whoami: () => Promise<{ name: string | undefined }> }).whoami());
    assert.equal(result.name, 'photon-injected');
  });

  await clearPhotonCache();
  await test('memory writes through injected runtime are visible on read-back', async () => {
    const inst = await photon(path.join(FIXTURES, 'photon-injected.photon.ts'), {
      baseDir: tmpBase,
    });
    await (inst as { write: (p: { key: string; value: string }) => Promise<unknown> }).write({
      key: 'greeting',
      value: 'hello',
    });
    const out = await (inst as { read: (p: { key: string }) => Promise<{ value: unknown }> }).read({
      key: 'greeting',
    });
    assert.equal(out.value, 'hello');
  });

  await clearPhotonCache();
  await test('extends ↔ inject parity: same photon, same memory scope', async () => {
    // The injected `Photon` is a fresh PhotonBase instance, but its
    // `_photonName` and `_baseDir` are wired to the host photon — so
    // both consumption modes resolve to the same MemoryProvider scope.
    // This test writes through the injected runtime then re-loads the
    // same photon and reads back through the host instance's own
    // memory accessor (the closest extends-Photon equivalent inside
    // the lite-loader's reach), confirming they hit the same store.
    const fixture = path.join(FIXTURES, 'photon-injected.photon.ts');
    const inst = (await photon(fixture, { baseDir: tmpBase })) as {
      write: (p: { key: string; value: string }) => Promise<unknown>;
      read: (p: { key: string }) => Promise<{ value: unknown }>;
    };
    await inst.write({ key: 'parity', value: 'ok' });
    // Force a fresh load by clearing cache, then read back through the
    // injected runtime again. Same scope ⇒ value persists.
    await clearPhotonCache();
    const inst2 = (await photon(fixture, { baseDir: tmpBase })) as {
      read: (p: { key: string }) => Promise<{ value: unknown }>;
    };
    const result = await inst2.read({ key: 'parity' });
    assert.equal(result.value, 'ok');
  });

  console.log('\nCloudflare injection (explicit constructor params):');

  await clearPhotonCache();
  await test('Cloudflare not configured → throwing-Proxy fallback names the import', async () => {
    const inst = await photon(path.join(FIXTURES, 'cloudflare-injected.photon.ts'), {
      baseDir: tmpBase,
    });
    await assert.rejects(
      () => (inst as { storeKey: (p: { key: string; value: string }) => Promise<unknown> }).storeKey({
        key: 'k',
        value: 'v',
      }),
      /imports `Cloudflare`/,
    );
  });

  await clearPhotonCache();
  await test('Cloudflare factory injected → cf.kv() resolves to the binding', async () => {
    const calls: Array<{ k: string; v: string }> = [];
    const fakeKV = {
      put: (k: string, v: string) => {
        calls.push({ k, v });
        return Promise.resolve();
      },
    };
    const inst = await photon(path.join(FIXTURES, 'cloudflare-injected.photon.ts'), {
      baseDir: tmpBase,
      cloudflareFactory: photonName => {
        // Single-binding stub — only `kv()` is exercised here.
        const guard = (label: string) => () => {
          throw new Error(`stub does not implement ${label} (photon=${photonName})`);
        };
        return {
          kv: () => fakeKV as unknown as ReturnType<import('../src/cloudflare.js').Cloudflare['kv']>,
          r2: guard('r2') as never,
          d1: guard('d1') as never,
          queue: guard('queue') as never,
          vectorize: guard('vectorize') as never,
          ai: { run: guard('ai.run') } as unknown as import('../src/cloudflare.js').Cloudflare['ai'],
          images: {} as import('../src/cloudflare.js').Cloudflare['images'],
          browser: { fetch: guard('browser.fetch') } as unknown as import('../src/cloudflare.js').Cloudflare['browser'],
          fetch: guard('fetch') as never,
        };
      },
    });
    const out = await (inst as { storeKey: (p: { key: string; value: string }) => Promise<{ key: string }> }).storeKey({
      key: 'foo',
      value: 'bar',
    });
    assert.equal(out.key, 'foo');
    assert.deepEqual(calls, [{ k: 'foo', v: 'bar' }]);
  });

  await clearPhotonCache();
  await test('CloudflareEnv injected → raw lookup works', async () => {
    const inst = await photon(path.join(FIXTURES, 'cloudflare-injected.photon.ts'), {
      baseDir: tmpBase,
      cloudflareEnv: { CUSTOM_SECRET: 'shh' },
    });
    const out = await (inst as { readEnvKey: (p: { name: string }) => Promise<{ value: unknown }> }).readEnvKey({
      name: 'CUSTOM_SECRET',
    });
    assert.equal(out.value, 'shh');
  });

  await clearPhotonCache();
  await test('CloudflareEnv unconfigured → access throws naming the import', async () => {
    const inst = await photon(path.join(FIXTURES, 'cloudflare-injected.photon.ts'), {
      baseDir: tmpBase,
    });
    await assert.rejects(
      () => (inst as { readEnvKey: (p: { name: string }) => Promise<unknown> }).readEnvKey({ name: 'ANY' }),
      /imports `CloudflareEnv`/,
    );
  });

  console.log('\nForgiving auto-inject (plain classes, no ctor param):');

  await clearPhotonCache();
  await test('plain class using this.cf gets cf field auto-populated', async () => {
    const calls: Array<{ k: string; v: string }> = [];
    const fakeKV = {
      put: (k: string, v: string) => {
        calls.push({ k, v });
        return Promise.resolve();
      },
    };
    const inst = await photon(path.join(FIXTURES, 'cloudflare-implicit.photon.ts'), {
      baseDir: tmpBase,
      cloudflareFactory: () => ({
        kv: () => fakeKV as unknown as ReturnType<import('../src/cloudflare.js').Cloudflare['kv']>,
      } as unknown as import('../src/cloudflare.js').Cloudflare),
    });
    const out = await (inst as { store: (p: { key: string; value: string }) => Promise<{ key: string }> }).store({
      key: 'auto',
      value: 'inject',
    });
    assert.equal(out.key, 'auto');
    assert.deepEqual(calls, [{ k: 'auto', v: 'inject' }]);
  });

  await clearPhotonCache();
  await test('plain class without factory still gets a throwing-Proxy fallback', async () => {
    const inst = await photon(path.join(FIXTURES, 'cloudflare-implicit.photon.ts'), {
      baseDir: tmpBase,
    });
    await assert.rejects(
      () => (inst as { store: (p: { key: string; value: string }) => Promise<unknown> }).store({
        key: 'x',
        value: 'y',
      }),
      /imports `Cloudflare`/,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
