/**
 * PhotonError / ValidationError constructor tests.
 *
 * Verifies the native `{ cause }` option (ECMAScript Error cause) is
 * preserved on the error instance so OTel recordException and any
 * cause-chain walker can reach the original failure.
 */

import assert from 'node:assert/strict';
import { PhotonError, ValidationError } from '../src/validation.js';

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

async function run() {
  console.log('\nPhotonError:');

  await test('basic constructor without cause still works', () => {
    const err = new PhotonError('boom', 'CODE', { k: 1 }, 'try again');
    assert.equal(err.message, 'boom');
    assert.equal(err.code, 'CODE');
    assert.deepEqual(err.details, { k: 1 });
    assert.equal(err.suggestion, 'try again');
    assert.equal(err.cause, undefined);
    assert.equal(err.name, 'PhotonError');
  });

  await test('preserves cause when passed via options', () => {
    const root = new Error('network down');
    const err = new PhotonError('upstream failed', 'UPSTREAM', undefined, undefined, {
      cause: root,
    });
    assert.equal(err.cause, root);
  });

  await test('undefined cause option does not leak an enumerable property', () => {
    const err = new PhotonError('x', 'Y', undefined, undefined, { cause: undefined });
    assert.equal(err.cause, undefined);
  });

  await test('ValidationError forwards cause to PhotonError base', () => {
    const root = new TypeError('bad number');
    const err = new ValidationError('invalid input', { field: 'age' }, 'use >= 0', {
      cause: root,
    });
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.cause, root);
    assert.equal(err.name, 'ValidationError');
    assert.ok(err instanceof PhotonError);
  });

  console.log('\n==================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\nAll PhotonError tests passed!');
  }
}

run().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
