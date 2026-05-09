/**
 * Tests for the new Cloudflare injection surface.
 *
 * The wrapped `Cloudflare` is a constructor-injected dependency (not a
 * member of `Photon`), and the loader supplies it via the
 * `cloudflareFactory` option. Outside of CF the loader falls back to a
 * throwing Proxy with a clear message.
 */

import assert from 'node:assert/strict';
import {
  bindingNameFor,
  createCloudflareFromEnv,
  notConfiguredCloudflare,
  SHARED_AI_BINDING,
  type Cloudflare,
} from '../src/cloudflare.js';
import {
  isPhotonRuntimeType,
  isCloudflareType,
  isCloudflareEnvType,
} from '../src/schema-extractor.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

console.log('bindingNameFor:');

test('default binding is `<photon>_<category>`', () => {
  assert.equal(bindingNameFor('gallery', 'kv'), 'gallery_kv');
  assert.equal(bindingNameFor('gallery', 'r2'), 'gallery_r2');
  assert.equal(bindingNameFor('gallery', 'd1'), 'gallery_d1');
});

test('qualifier inserts between photon and category', () => {
  assert.equal(bindingNameFor('gallery', 'kv', 'cache'), 'gallery_cache_kv');
  assert.equal(bindingNameFor('weather', 'r2', 'archive'), 'weather_archive_r2');
});

test('hyphenated photon names normalize to underscores', () => {
  // Wrangler binding names cannot contain hyphens; both photon and
  // qualifier are normalized so authors never have to think about it.
  assert.equal(bindingNameFor('my-photon', 'kv'), 'my_photon_kv');
  assert.equal(bindingNameFor('a-b', 'r2', 'c-d'), 'a_b_c_d_r2');
});

test('mixed-case lowercased so wrangler accepts the name', () => {
  assert.equal(bindingNameFor('Gallery', 'kv'), 'gallery_kv');
  assert.equal(bindingNameFor('photos', 'r2', 'Archive'), 'photos_archive_r2');
});

console.log('\nnotConfiguredCloudflare:');

test('every scoped category throws naming the import', () => {
  const cf = notConfiguredCloudflare();
  for (const cat of ['kv', 'r2', 'd1', 'queue', 'vectorize'] as const) {
    assert.throws(() => (cf[cat] as (q?: string) => unknown)(), /imports `Cloudflare`/);
  }
});

test('shared bindings (ai, images, browser) throw on member access', () => {
  const cf = notConfiguredCloudflare();
  assert.throws(() => (cf.ai as { run: (m: string) => unknown }).run('@cf/foo'), /imports `Cloudflare`/);
  assert.throws(() => (cf.images as { info: (s: unknown) => unknown }).info(null), /imports `Cloudflare`/);
  assert.throws(() => (cf.browser as { fetch: (u: string) => unknown }).fetch('x'), /imports `Cloudflare`/);
});

test('fetch on the unconfigured stub throws', () => {
  const cf = notConfiguredCloudflare();
  assert.throws(() => cf.fetch('https://example.com/'), /imports `Cloudflare`/);
});

console.log('\ncreateCloudflareFromEnv:');

test('resolves auto-named bindings from env', () => {
  const fakeKV = { get: () => Promise.resolve(null), put: () => Promise.resolve(), delete: () => Promise.resolve(), list: () => Promise.resolve({}) };
  const env = { gallery_kv: fakeKV };
  const cf = createCloudflareFromEnv(env, 'gallery');
  assert.equal(cf.kv(), fakeKV);
});

test('throws naming the missing binding when not present', () => {
  const cf = createCloudflareFromEnv({}, 'gallery');
  assert.throws(() => cf.kv(), /binding "gallery_kv"/);
});

test('shared ai binding lifted from env.AI', () => {
  const fakeAI = { run: () => Promise.resolve('ok') };
  const cf = createCloudflareFromEnv({ [SHARED_AI_BINDING]: fakeAI }, 'gallery');
  assert.equal(cf.ai, fakeAI);
});

console.log('\nschema-extractor type matchers:');

test('isPhotonRuntimeType matches Photon and Photon | undefined', () => {
  assert.equal(isPhotonRuntimeType('Photon'), true);
  assert.equal(isPhotonRuntimeType('Photon | undefined'), true);
  assert.equal(isPhotonRuntimeType('PhotonRuntime'), false);
  assert.equal(isPhotonRuntimeType('photon'), false);
});

test('isCloudflareType matches Cloudflare strictly', () => {
  assert.equal(isCloudflareType('Cloudflare'), true);
  assert.equal(isCloudflareType('Cloudflare | undefined'), true);
  assert.equal(isCloudflareType('CloudflareEnv'), false);
});

test('isCloudflareEnvType matches CloudflareEnv with optional generic', () => {
  assert.equal(isCloudflareEnvType('CloudflareEnv'), true);
  assert.equal(isCloudflareEnvType('CloudflareEnv<MyBindings>'), true);
  assert.equal(isCloudflareEnvType('CloudflareEnv<{ KV: KVNamespace }>'), true);
  assert.equal(isCloudflareEnvType('Cloudflare'), false);
});

test('Cloudflare type alias is structurally usable', () => {
  // Compile-only check: ensures the exported `Cloudflare` interface
  // accepts a structurally compatible factory output.
  const cf: Cloudflare = notConfiguredCloudflare();
  assert.ok(cf);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
