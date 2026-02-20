/**
 * Tests for duration and rate parsing utilities
 * Run: npx tsx tests/duration.test.ts
 */

import { strict as assert } from 'assert';
import { parseDuration, parseRate } from '../src/utils/duration.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${e}`);
    failed++;
  }
}

// ─── parseDuration ───

console.log('\n🧪 parseDuration\n');

test('parses milliseconds', () => {
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('100ms'), 100);
  assert.equal(parseDuration('0ms'), 0);
});

test('parses seconds', () => {
  assert.equal(parseDuration('30s'), 30_000);
  assert.equal(parseDuration('1s'), 1_000);
  assert.equal(parseDuration('5sec'), 5_000);
});

test('parses minutes', () => {
  assert.equal(parseDuration('5m'), 300_000);
  assert.equal(parseDuration('1min'), 60_000);
  assert.equal(parseDuration('10m'), 600_000);
});

test('parses hours', () => {
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('2hr'), 7_200_000);
});

test('parses days', () => {
  assert.equal(parseDuration('1d'), 86_400_000);
  assert.equal(parseDuration('1day'), 86_400_000);
});

test('handles decimal values', () => {
  assert.equal(parseDuration('1.5s'), 1_500);
  assert.equal(parseDuration('0.5m'), 30_000);
});

test('fallback: raw number as ms', () => {
  assert.equal(parseDuration('1234'), 1234);
  assert.equal(parseDuration('0'), 0);
});

test('fallback: invalid string returns 0', () => {
  assert.equal(parseDuration('abc'), 0);
  assert.equal(parseDuration(''), 0);
});

test('case insensitive', () => {
  assert.equal(parseDuration('5S'), 5_000);
  assert.equal(parseDuration('2M'), 120_000);
  assert.equal(parseDuration('1H'), 3_600_000);
});

test('trims whitespace', () => {
  assert.equal(parseDuration('  5s  '), 5_000);
});

// ─── parseRate ───

console.log('\n🧪 parseRate\n');

test('parses per-second', () => {
  const r = parseRate('5/s');
  assert.equal(r.count, 5);
  assert.equal(r.windowMs, 1_000);
});

test('parses per-minute', () => {
  const r = parseRate('10/min');
  assert.equal(r.count, 10);
  assert.equal(r.windowMs, 60_000);
});

test('parses per-hour', () => {
  const r = parseRate('100/h');
  assert.equal(r.count, 100);
  assert.equal(r.windowMs, 3_600_000);
});

test('parses per-day', () => {
  const r = parseRate('1000/d');
  assert.equal(r.count, 1000);
  assert.equal(r.windowMs, 86_400_000);
});

test('fallback: raw number as count per minute', () => {
  const r = parseRate('50');
  assert.equal(r.count, 50);
  assert.equal(r.windowMs, 60_000);
});

test('fallback: invalid string defaults to 10/min', () => {
  const r = parseRate('abc');
  assert.equal(r.count, 10);
  assert.equal(r.windowMs, 60_000);
});

test('case insensitive', () => {
  const r = parseRate('10/MIN');
  assert.equal(r.count, 10);
  assert.equal(r.windowMs, 60_000);
});

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
