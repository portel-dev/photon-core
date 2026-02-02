/**
 * Tests for shared utility modules:
 * - class-detection
 * - env-utils
 * - version-check
 * - mime-types
 * - validation
 * - compiler (mock)
 */

import assert from 'node:assert/strict';

// Class detection
import {
  isClass,
  hasAsyncMethods,
  findPhotonClass,
  findPhotonClasses,
} from '../src/class-detection.js';

// Env utils
import {
  toEnvVarName,
  parseEnvValue,
  generateExampleValue,
  summarizeConstructorParams,
  generateConfigErrorMessage,
  resolveEnvArgs,
} from '../src/env-utils.js';

// Version check
import {
  parseRuntimeRequirement,
  checkRuntimeCompatibility,
} from '../src/version-check.js';

// MIME types
import { getMimeType } from '../src/mime-types.js';

// Validation
import {
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
  notEmpty,
  hasLength,
  isEmail,
  isUrl,
  inRange,
  isPositive,
  isInteger,
  hasExtension,
  assertString,
  assertDefined,
  validate,
  validateOrThrow,
  PhotonError,
  ValidationError,
} from '../src/validation.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          passed++;
          console.log(`  ✅ ${name}`);
        })
        .catch((err: any) => {
          failed++;
          console.log(`  ❌ ${name}: ${err.message}`);
        });
    }
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('\n📦 Class Detection Tests\n');

  test('isClass detects class', () => {
    class Foo {}
    assert.ok(isClass(Foo));
  });

  test('isClass rejects function', () => {
    function foo() {}
    assert.ok(!isClass(foo));
  });

  test('isClass rejects arrow', () => {
    const foo = () => {};
    assert.ok(!isClass(foo));
  });

  test('hasAsyncMethods detects async method', () => {
    class Foo {
      async bar() {}
    }
    assert.ok(hasAsyncMethods(Foo));
  });

  test('hasAsyncMethods detects async generator', () => {
    class Foo {
      async *bar() {}
    }
    assert.ok(hasAsyncMethods(Foo));
  });

  test('hasAsyncMethods detects generator', () => {
    class Foo {
      *bar() {}
    }
    assert.ok(hasAsyncMethods(Foo));
  });

  test('hasAsyncMethods detects static async', () => {
    class Foo {
      static async bar() {}
    }
    assert.ok(hasAsyncMethods(Foo));
  });

  test('hasAsyncMethods returns false for sync-only', () => {
    class Foo {
      bar() {}
    }
    assert.ok(!hasAsyncMethods(Foo));
  });

  test('findPhotonClass prefers default export', () => {
    class A { async foo() {} }
    class B { async bar() {} }
    const mod = { default: A, B } as any;
    assert.strictEqual(findPhotonClass(mod), A);
  });

  test('findPhotonClass falls back to named export', () => {
    class MyPhoton { async run() {} }
    const mod = { MyPhoton } as any;
    assert.strictEqual(findPhotonClass(mod), MyPhoton);
  });

  test('findPhotonClass returns null for empty module', () => {
    assert.strictEqual(findPhotonClass({}), null);
  });

  test('findPhotonClasses finds multiple', () => {
    class A { async a() {} }
    class B { async b() {} }
    const mod = { A, B } as any;
    const result = findPhotonClasses(mod);
    assert.strictEqual(result.length, 2);
  });

  console.log('\n📦 Env Utils Tests\n');

  test('toEnvVarName basic', () => {
    assert.strictEqual(toEnvVarName('my-mcp', 'apiKey'), 'MY_MCP_API_KEY');
  });

  test('toEnvVarName all lowercase', () => {
    assert.strictEqual(toEnvVarName('simple', 'host'), 'SIMPLE_HOST');
  });

  test('parseEnvValue string', () => {
    assert.strictEqual(parseEnvValue('hello', 'string'), 'hello');
  });

  test('parseEnvValue number', () => {
    assert.strictEqual(parseEnvValue('42', 'number'), 42);
  });

  test('parseEnvValue boolean true', () => {
    assert.strictEqual(parseEnvValue('true', 'boolean'), true);
  });

  test('parseEnvValue boolean false', () => {
    assert.strictEqual(parseEnvValue('false', 'boolean'), false);
  });

  test('generateExampleValue for apiKey', () => {
    assert.strictEqual(generateExampleValue('apiKey', 'string'), 'sk_your_api_key_here');
  });

  test('generateExampleValue for port', () => {
    assert.strictEqual(generateExampleValue('port', 'number'), '5432');
  });

  test('generateExampleValue for unknown', () => {
    assert.strictEqual(generateExampleValue('foo', 'string'), null);
  });

  test('summarizeConstructorParams generates docs', () => {
    const params = [
      { name: 'apiKey', type: 'string', isOptional: false, hasDefault: false },
      { name: 'port', type: 'number', isOptional: true, hasDefault: true, defaultValue: 3000 },
    ];
    const { docs, exampleEnv } = summarizeConstructorParams(params, 'my-service');
    assert.ok(docs.includes('MY_SERVICE_API_KEY'));
    assert.ok(docs.includes('[REQUIRED]'));
    assert.ok(docs.includes('[OPTIONAL]'));
    assert.ok('MY_SERVICE_API_KEY' in exampleEnv);
    assert.ok(!('MY_SERVICE_PORT' in exampleEnv)); // optional, not in example
  });

  test('generateConfigErrorMessage includes env vars', () => {
    const msg = generateConfigErrorMessage('test', [
      { paramName: 'apiKey', envVarName: 'TEST_API_KEY', type: 'string' },
    ]);
    assert.ok(msg.includes('TEST_API_KEY'));
    assert.ok(msg.includes('Configuration Warning'));
  });

  test('resolveEnvArgs resolves from env', () => {
    process.env.MYTEST_HOST = 'localhost';
    const params = [
      { name: 'host', type: 'string', isOptional: false, hasDefault: false },
    ];
    const { values, missing } = resolveEnvArgs(params, 'mytest');
    assert.strictEqual(values[0], 'localhost');
    assert.strictEqual(missing.length, 0);
    delete process.env.MYTEST_HOST;
  });

  test('resolveEnvArgs reports missing', () => {
    const params = [
      { name: 'secret', type: 'string', isOptional: false, hasDefault: false },
    ];
    const { values, missing } = resolveEnvArgs(params, 'mytest');
    assert.strictEqual(values[0], undefined);
    assert.strictEqual(missing.length, 1);
    assert.strictEqual(missing[0].envVarName, 'MYTEST_SECRET');
  });

  console.log('\n📦 Version Check Tests\n');

  test('parseRuntimeRequirement extracts tag', () => {
    assert.strictEqual(parseRuntimeRequirement('/** @runtime ^1.5.0 */'), '^1.5.0');
  });

  test('parseRuntimeRequirement returns undefined if missing', () => {
    assert.strictEqual(parseRuntimeRequirement('no tag here'), undefined);
  });

  test('checkRuntimeCompatibility caret compatible', () => {
    const r = checkRuntimeCompatibility('^1.5.0', '1.6.0');
    assert.ok(r.compatible);
  });

  test('checkRuntimeCompatibility caret incompatible major', () => {
    const r = checkRuntimeCompatibility('^1.5.0', '2.0.0');
    assert.ok(!r.compatible);
  });

  test('checkRuntimeCompatibility caret incompatible minor', () => {
    const r = checkRuntimeCompatibility('^1.5.0', '1.4.0');
    assert.ok(!r.compatible);
  });

  test('checkRuntimeCompatibility exact match', () => {
    const r = checkRuntimeCompatibility('1.5.0', '1.5.0');
    assert.ok(r.compatible);
  });

  test('checkRuntimeCompatibility exact mismatch', () => {
    const r = checkRuntimeCompatibility('1.5.0', '1.5.1');
    assert.ok(!r.compatible);
  });

  test('checkRuntimeCompatibility tilde', () => {
    const r = checkRuntimeCompatibility('~1.5.0', '1.5.3');
    assert.ok(r.compatible);
  });

  test('checkRuntimeCompatibility tilde minor bump fails', () => {
    const r = checkRuntimeCompatibility('~1.5.0', '1.6.0');
    assert.ok(!r.compatible);
  });

  test('checkRuntimeCompatibility >=', () => {
    const r = checkRuntimeCompatibility('>=1.5.0', '2.0.0');
    assert.ok(r.compatible);
  });

  test('checkRuntimeCompatibility >', () => {
    const r = checkRuntimeCompatibility('>1.5.0', '1.5.1');
    assert.ok(r.compatible);
  });

  test('checkRuntimeCompatibility > equal fails', () => {
    const r = checkRuntimeCompatibility('>1.5.0', '1.5.0');
    assert.ok(!r.compatible);
  });

  console.log('\n📦 MIME Type Tests\n');

  test('getMimeType html', () => {
    assert.strictEqual(getMimeType('page.html'), 'text/html');
  });

  test('getMimeType json', () => {
    assert.strictEqual(getMimeType('data.json'), 'application/json');
  });

  test('getMimeType png', () => {
    assert.strictEqual(getMimeType('image.png'), 'image/png');
  });

  test('getMimeType unknown', () => {
    assert.strictEqual(getMimeType('file.xyz'), 'application/octet-stream');
  });

  test('getMimeType svg', () => {
    assert.strictEqual(getMimeType('icon.svg'), 'image/svg+xml');
  });

  console.log('\n📦 Validation Tests\n');

  test('type guards', () => {
    assert.ok(isString('hello'));
    assert.ok(!isString(42));
    assert.ok(isNumber(42));
    assert.ok(!isNumber('42'));
    assert.ok(isBoolean(true));
    assert.ok(isObject({}));
    assert.ok(!isObject([]));
    assert.ok(isArray([]));
    assert.ok(!isArray({}));
  });

  test('notEmpty validator', () => {
    const v = notEmpty('field');
    assert.ok(v('hello').valid);
    assert.ok(!v('').valid);
    assert.ok(!v('  ').valid);
  });

  test('hasLength validator', () => {
    const v = hasLength('name', 2, 10);
    assert.ok(v('abc').valid);
    assert.ok(!v('a').valid);
    assert.ok(!v('a'.repeat(11)).valid);
  });

  test('isEmail validator', () => {
    const v = isEmail('email');
    assert.ok(v('a@b.com').valid);
    assert.ok(!v('not-email').valid);
  });

  test('isUrl validator', () => {
    const v = isUrl('url');
    assert.ok(v('https://example.com').valid);
    assert.ok(!v('not-a-url').valid);
  });

  test('inRange validator', () => {
    const v = inRange('age', 0, 120);
    assert.ok(v(25).valid);
    assert.ok(!v(-1).valid);
    assert.ok(!v(121).valid);
  });

  test('isPositive validator', () => {
    const v = isPositive('count');
    assert.ok(v(1).valid);
    assert.ok(!v(0).valid);
    assert.ok(!v(-1).valid);
  });

  test('isInteger validator', () => {
    const v = isInteger('count');
    assert.ok(v(5).valid);
    assert.ok(!v(5.5).valid);
  });

  test('hasExtension validator', () => {
    const v = hasExtension('file', ['ts', 'js']);
    assert.ok(v('file.ts').valid);
    assert.ok(!v('file.py').valid);
  });

  test('validate combines validators', () => {
    const result = validate('hello', [notEmpty('field'), hasLength('field', 1, 10)]);
    assert.ok(result.valid);
  });

  test('validateOrThrow throws on invalid', () => {
    assert.throws(
      () => validateOrThrow('', [notEmpty('field')]),
      (err: any) => err instanceof ValidationError,
    );
  });

  test('assertString works', () => {
    assertString('hello', 'test');
    assert.throws(
      () => assertString(42, 'test'),
      (err: any) => err instanceof ValidationError,
    );
  });

  test('assertDefined works', () => {
    assertDefined('hello', 'test');
    assert.throws(
      () => assertDefined(null, 'test'),
      (err: any) => err instanceof ValidationError,
    );
  });

  test('PhotonError has properties', () => {
    const err = new PhotonError('msg', 'CODE', { key: 'val' }, 'try this');
    assert.strictEqual(err.message, 'msg');
    assert.strictEqual(err.code, 'CODE');
    assert.deepStrictEqual(err.details, { key: 'val' });
    assert.strictEqual(err.suggestion, 'try this');
  });

  test('ValidationError extends PhotonError', () => {
    const err = new ValidationError('bad input');
    assert.ok(err instanceof PhotonError);
    assert.strictEqual(err.code, 'VALIDATION_ERROR');
  });

  // Print summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'═'.repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
