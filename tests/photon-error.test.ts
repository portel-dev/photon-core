/**
 * PhotonError / ValidationError constructor tests.
 *
 * Verifies the native `{ cause }` option (ECMAScript Error cause) is
 * preserved on the error instance so OTel recordException and any cause-chain
 * walker can reach the original failure.
 */

import { describe, test, expect } from 'bun:test';
import { PhotonError, ValidationError } from '../src/validation';

describe('PhotonError', () => {
  test('basic constructor without cause still works', () => {
    const err = new PhotonError('boom', 'CODE', { k: 1 }, 'try again');
    expect(err.message).toBe('boom');
    expect(err.code).toBe('CODE');
    expect(err.details).toEqual({ k: 1 });
    expect(err.suggestion).toBe('try again');
    expect(err.cause).toBeUndefined();
    expect(err.name).toBe('PhotonError');
  });

  test('preserves cause when passed via options', () => {
    const root = new Error('network down');
    const err = new PhotonError('upstream failed', 'UPSTREAM', undefined, undefined, {
      cause: root,
    });
    expect(err.cause).toBe(root);
  });

  test('undefined cause option does not leak an enumerable property', () => {
    const err = new PhotonError('x', 'Y', undefined, undefined, { cause: undefined });
    expect(err.cause).toBeUndefined();
  });

  test('ValidationError forwards cause to PhotonError base', () => {
    const root = new TypeError('bad number');
    const err = new ValidationError('invalid input', { field: 'age' }, 'use >= 0', {
      cause: root,
    });
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.cause).toBe(root);
    expect(err.name).toBe('ValidationError');
    expect(err).toBeInstanceOf(PhotonError);
  });
});
