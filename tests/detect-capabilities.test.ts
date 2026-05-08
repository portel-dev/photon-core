/**
 * Regression tests for detectCapabilities — the source-scan that tells
 * the loader which runtime capabilities to inject on plain classes.
 *
 * The original regex (`/this\.call\s*\(/` and siblings) only matched the
 * literal `this.X` token. Typed-access workarounds like
 * `(this as any).call(...)` — common when TypeScript can't see the
 * loader-injected method — silently missed the regex and the capability
 * never got injected, so runtime failed with "X is not a function."
 */

import assert from 'node:assert/strict';
import { detectCapabilities, type PhotonCapability } from '../src/schema-extractor.js';

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

function expectCap(source: string, cap: PhotonCapability): void {
  const caps = detectCapabilities(source);
  assert.ok(caps.has(cap), `expected cap '${cap}' to be detected in: ${source.trim()}`);
}

function expectNoCap(source: string, cap: PhotonCapability): void {
  const caps = detectCapabilities(source);
  assert.ok(!caps.has(cap), `cap '${cap}' should NOT be detected in: ${source.trim()}`);
}

console.log('detectCapabilities — literal this.X (baseline):');

test('literal this.call()', () => expectCap('this.call("foo.bar", {})', 'call'));
test('literal this.emit()', () => expectCap('this.emit({ type: "x" })', 'emit'));
test('literal this.memory', () => expectCap('await this.memory.get("k")', 'memory'));
test('literal this.mcp()', () => expectCap('this.mcp("github").call("x")', 'mcp'));
test('literal this.withLock()', () => expectCap('await this.withLock("k", async () => {})', 'lock'));
test('literal this.caller', () => expectCap('const id = this.caller.id', 'caller'));
test('literal this.instanceMeta', () =>
  expectCap('const m = this.instanceMeta.name', 'instanceMeta'));
test('literal this.allInstances()', () =>
  expectCap('for await (const x of this.allInstances()) {}', 'allInstances'));
test('literal this.render()', () => expectCap('this.render("table", rows)', 'emit'));

console.log('\ndetectCapabilities — typed-access workarounds (the footgun):');

test('(this as any).call()', () => expectCap('(this as any).call("foo.bar", {})', 'call'));
test('(this as any).emit()', () => expectCap('(this as any).emit({ x: 1 })', 'emit'));
test('(this as any).memory', () => expectCap('await (this as any).memory.get("k")', 'memory'));
test('(this as any).mcp()', () => expectCap('(this as any).mcp("github")', 'mcp'));
test('(this as any).withLock()', () =>
  expectCap('await (this as any).withLock("k", async () => {})', 'lock'));
test('(this as any).caller', () => expectCap('const id = (this as any).caller.id', 'caller'));
test('(this as any).instanceMeta', () =>
  expectCap('const m = (this as any).instanceMeta.name', 'instanceMeta'));
test('(this as any).allInstances()', () =>
  expectCap('for await (const x of (this as any).allInstances()) {}', 'allInstances'));
test('(this as any).render()', () => expectCap('(this as any).render("table", rows)', 'emit'));

console.log('\ndetectCapabilities — other type-cast forms:');

test('typed cast to class: (this as Photon).call()', () =>
  expectCap('(this as Photon).call("x.y", {})', 'call'));
test('typed cast with generic: (this as SomeClass<T>).memory', () =>
  expectCap('(this as SomeClass<T>).memory', 'memory'));
test('double cast: (this as unknown as T).call()', () =>
  expectCap('(this as unknown as MyType).call("x.y")', 'call'));
test('angle-bracket cast: (<any>this).call()', () =>
  expectCap('(<any>this).call("x.y", {})', 'call'));
test('angle-bracket with generic: (<MyClass>this).emit()', () =>
  expectCap('(<MyClass>this).emit({ foo: 1 })', 'emit'));

console.log('\ndetectCapabilities — whitespace & formatter variants:');

test('formatter-inserted spaces: this . call(', () => expectCap('this . call("x.y")', 'call'));
test('extra spaces in cast: ( this   as   any ).call(', () =>
  expectCap('( this   as   any ).call("x.y")', 'call'));
test('newline between this and .call', () =>
  expectCap('this\n  .call("x.y", {})', 'call'));

console.log('\ndetectCapabilities — casts with function-type parens (regression):');

// These patterns were silently missed before the nested-paren fix. The inner
// `(k: string)` ended `[^)]+` prematurely, so `.memory` / `.call` were never
// seen and the capability was never injected — causing runtime
// "Cannot read properties of undefined" on every memory access.
test('cast with function-type in annotation: .memory', () =>
  expectCap(
    '(this as unknown as { memory: { set: (k: string, v: unknown) => Promise<void> } }).memory.set(K,q)',
    'memory'
  ));
test('cast with function-type in annotation: .call()', () =>
  expectCap(
    '(this as unknown as { call: (t: string, p: unknown) => Promise<void> }).call("x.y", {})',
    'call'
  ));
test('cast with function-type spanning newlines (growth-console style)', () =>
  expectCap(
    'await (this as unknown as {\n  memory: { get: (k: string) => Promise<unknown> };\n}).memory.get("items");',
    'memory'
  ));

console.log('\ndetectCapabilities — negatives (must NOT falsely match):');

test('unrelated .call on another receiver', () =>
  expectNoCap('array.call(thisArg)', 'call'));
test('comment with this.call WITHOUT parens does not trigger', () => {
  // The `call` rule requires a trailing `(`, so a bare reference in a
  // comment ("this.call" with no parens) correctly doesn't match.
  expectNoCap('// uses this.call for peer invocation', 'call');
});
test('comment with this.call( DOES trigger (regex cannot distinguish code from comments)', () => {
  // Accepted false positive: stripping comments before scanning would be
  // more complexity than it's worth. A stale comment costs one unused
  // closure per plain-class photon, which is immeasurable.
  expectCap('// this.call("example.x", {})', 'call');
});
test('a photon named "calllog" should NOT trigger call', () =>
  expectNoCap('this.callLog = []', 'call'));
test('property name ending in caller should NOT trigger caller', () =>
  expectNoCap('this.callerManager.init()', 'caller'));
test('method similar to memory prefix', () =>
  expectNoCap('this.memoryBank.add(1)', 'memory'));

console.log('\ndetectCapabilities — this.cf (Cloudflare surface):');

test('literal this.cf.r2()', () => expectCap('await this.cf.r2("photos").put(k, v)', 'cf'));
test('literal this.cf.d1()', () => expectCap('this.cf.d1("app").prepare("..")', 'cf'));
test('literal this.cf.ai property', () => expectCap('await this.cf.ai.run("@cf/x")', 'cf'));
test('cast (this as any).cf.kv()', () =>
  expectCap('(this as any).cf.kv("cache").get("k")', 'cf'));
test('property cfManager should NOT trigger cf', () =>
  expectNoCap('this.cfManager.init()', 'cf'));

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
