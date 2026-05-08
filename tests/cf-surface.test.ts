/**
 * Surface tests for the `this.cf.*` Cloudflare capability namespace.
 * The runtime adapter (miniflare locally, real Worker env when deployed)
 * is responsible for binding the actual implementations; this scaffold
 * just verifies the shape and the "not configured" error path.
 */

import assert from 'node:assert/strict';
import { Photon } from '../src/base.js';
import { notConfiguredCF, type CFRuntime } from '../src/cf.js';

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

console.log('this.cf — surface scaffold:');

test('Photon.cf returns a defined object even with no runtime', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.ok(inst.cf, 'this.cf should be defined');
});

test('this.cf.r2() throws helpful error when no runtime configured', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.throws(() => (inst.cf as CFRuntime).r2('photos'), /No Cloudflare runtime is configured/);
});

test('this.cf.d1() error mentions the category', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.throws(
    () => (inst.cf as CFRuntime).d1('app'),
    /this\.cf\.d1\(\) called/
  );
});

test('this.cf.ai property access throws on use', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.throws(
    () => ((inst.cf as CFRuntime).ai as any).run('@cf/foo'),
    /this\.cf\.ai\.run accessed/
  );
});

test('injected _cfRuntime is returned verbatim', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  const fake: CFRuntime = {
    r2: (name: string) => ({ name, kind: 'r2-stub' }),
    kv: () => ({}),
    d1: () => ({}),
    queue: () => ({}),
    vectorize: () => ({}),
    ai: { run: () => Promise.resolve('ok') },
    images: {},
    browser: {},
    do: () => ({}),
    fetch: async () => new Response('ok'),
  };
  inst._cfRuntime = fake;
  const bucket = (inst.cf as CFRuntime).r2('photos') as { name: string; kind: string };
  assert.equal(bucket.name, 'photos');
  assert.equal(bucket.kind, 'r2-stub');
});

test('notConfiguredCF() returns a fresh stub each call', () => {
  const a = notConfiguredCF();
  const b = notConfiguredCF();
  assert.notEqual(a, b);
  assert.throws(() => a.r2('x'));
  assert.throws(() => b.kv('y'));
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
