/**
 * Surface tests for the `this.cf.*` Cloudflare capability namespace.
 * The runtime adapter (miniflare locally, real Worker env when deployed)
 * is responsible for binding the actual implementations; this scaffold
 * verifies the shape, the "not configured" error path, and that the
 * capability is reachable through both the Photon base class and the
 * withPhotonCapabilities mixin.
 */

import assert from 'node:assert/strict';
import { Photon } from '../src/base.js';
import { withPhotonCapabilities } from '../src/mixins.js';
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

const FUNCTION_CATEGORIES = ['r2', 'kv', 'd1', 'queue', 'vectorize'] as const;
const PROPERTY_CATEGORIES = ['ai', 'images', 'browser'] as const;

console.log('this.cf — Photon base class:');

test('Photon.cf returns a defined object even with no runtime', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.ok(inst.cf, 'this.cf should be defined');
});

test('Photon.env is undefined on local (no CF runtime attached)', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  // The CF Worker template attaches `env` via Object.defineProperty at
  // dispatch time; locally it stays undefined so user code can branch.
  assert.equal(inst.env, undefined);
});

test('Photon.mcpAuthed is undefined on local (no /mcp dispatch)', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.equal(inst.mcpAuthed, undefined);
});

test('subclass can read this.env / this.mcpAuthed without casting', () => {
  // Type-only smoke. If the base properties weren't declared the
  // expressions inside this method would fail tsc. The runtime check
  // just confirms the property accesses don't throw.
  class Sample extends Photon {
    check(): { hasEnv: boolean; authed: boolean } {
      return { hasEnv: this.env !== undefined, authed: this.mcpAuthed === true };
    }
  }
  const inst = new Sample();
  assert.deepEqual(inst.check(), { hasEnv: false, authed: false });
});

test('Photon.cf is identity-stable across reads (cached stub)', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.equal(inst.cf, inst.cf, 'this.cf should return the same object on repeat access');
});

for (const cat of FUNCTION_CATEGORIES) {
  test(`Photon.cf.${cat}() throws helpful error when no runtime configured`, () => {
    class Sample extends Photon {}
    const inst = new Sample();
    assert.throws(
      () => (inst.cf as any)[cat]('name'),
      new RegExp(`this\\.cf\\.${cat}\\(\\) called`)
    );
  });
}

for (const cat of PROPERTY_CATEGORIES) {
  test(`Photon.cf.${cat}.<member> throws helpful error when accessed`, () => {
    class Sample extends Photon {}
    const inst = new Sample();
    assert.throws(
      () => ((inst.cf as any)[cat]).run('@cf/foo'),
      new RegExp(`this\\.cf\\.${cat}\\.run accessed`)
    );
  });
}

test('Photon.cf.fetch throws helpful error when called', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  assert.throws(
    () => (inst.cf as CFRuntime).fetch('https://example.com/'),
    /this\.cf\.fetch\(\) called/
  );
});

test('Photon: injected _cfRuntime is returned verbatim and bypasses stub', () => {
  class Sample extends Photon {}
  const inst = new Sample();
  const fake: CFRuntime = makeFakeCF();
  inst._cfRuntime = fake;
  assert.equal(inst.cf, fake);
  const bucket = (inst.cf as CFRuntime).r2('photos') as { name: string; kind: string };
  assert.equal(bucket.kind, 'r2-stub');
  assert.equal(bucket.name, 'photos');
});

console.log('\nthis.cf — withPhotonCapabilities mixin:');

test('Mixin exposes this.cf on plain classes', () => {
  class Plain {
    async noop() {}
  }
  const Enhanced = withPhotonCapabilities(Plain);
  const inst = new Enhanced() as any;
  assert.ok(inst.cf);
});

test('Mixin: this.cf is identity-stable across reads', () => {
  class Plain {}
  const Enhanced = withPhotonCapabilities(Plain);
  const inst = new Enhanced() as any;
  assert.equal(inst.cf, inst.cf);
});

test('Mixin: this.cf.r2() throws when no runtime configured', () => {
  class Plain {}
  const Enhanced = withPhotonCapabilities(Plain);
  const inst = new Enhanced() as any;
  assert.throws(() => (inst.cf as CFRuntime).r2('photos'), /No Cloudflare runtime is configured/);
});

test('Mixin: injected _cfRuntime takes precedence over stub', () => {
  class Plain {}
  const Enhanced = withPhotonCapabilities(Plain);
  const inst = new Enhanced() as any;
  const fake = makeFakeCF();
  inst._cfRuntime = fake;
  assert.equal(inst.cf, fake);
});

console.log('\nthis.cf — notConfiguredCF stub:');

test('notConfiguredCF() returns a fresh object each call (factory)', () => {
  const a = notConfiguredCF();
  const b = notConfiguredCF();
  assert.notEqual(a, b);
});

for (const cat of FUNCTION_CATEGORIES) {
  test(`notConfiguredCF().${cat}() throws`, () => {
    const stub = notConfiguredCF();
    assert.throws(() => (stub as any)[cat]('x'));
  });
}

for (const cat of PROPERTY_CATEGORIES) {
  test(`notConfiguredCF().${cat} accessed throws`, () => {
    const stub = notConfiguredCF();
    assert.throws(() => ((stub as any)[cat]).put('x', 'y'));
  });
}

test('notConfiguredCF().fetch() throws', () => {
  const stub = notConfiguredCF();
  assert.throws(() => stub.fetch('https://example.com/'));
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

function makeFakeCF(): CFRuntime {
  return {
    r2: (name: string) => ({ name, kind: 'r2-stub' }) as any,
    kv: () => ({}) as any,
    d1: () => ({}) as any,
    queue: () => ({}) as any,
    vectorize: () => ({}) as any,
    ai: { run: () => Promise.resolve('ok') } as any,
    images: {} as any,
    browser: {} as any,
    fetch: async () => new Response('ok') as any,
  };
}
