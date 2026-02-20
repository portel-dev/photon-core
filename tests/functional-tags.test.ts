/**
 * Tests for functional tag extraction from JSDoc
 * Run: npx tsx tests/functional-tags.test.ts
 */

import { strict as assert } from 'assert';
import { SchemaExtractor } from '../src/schema-extractor.js';

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

function extractTools(source: string) {
  const extractor = new SchemaExtractor();
  return extractor.extractFromSource(source);
}

// ─── @cached ───

console.log('\n🧪 @cached extraction\n');

test('@cached with duration', () => {
  const tools = extractTools(`
    export default class Test {
      /** Get data @cached 5m */
      async getData() { return 42; }
    }
  `);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0].cached, { ttl: 300_000 });
});

test('@cached without duration defaults to 5m', () => {
  const tools = extractTools(`
    export default class Test {
      /** Get data @cached */
      async getData() { return 42; }
    }
  `);
  assert.deepEqual(tools[0].cached, { ttl: 300_000 });
});

test('@cached with various units', () => {
  const tools = extractTools(`
    export default class Test {
      /** @cached 30s */ async a() {}
      /** @cached 1h */ async b() {}
      /** @cached 500ms */ async c() {}
    }
  `);
  assert.deepEqual(tools[0].cached, { ttl: 30_000 });
  assert.deepEqual(tools[1].cached, { ttl: 3_600_000 });
  assert.deepEqual(tools[2].cached, { ttl: 500 });
});

test('no @cached means undefined', () => {
  const tools = extractTools(`
    export default class Test {
      /** Get data */ async getData() { return 42; }
    }
  `);
  assert.equal(tools[0].cached, undefined);
});

// ─── @timeout ───

console.log('\n🧪 @timeout extraction\n');

test('@timeout with duration', () => {
  const tools = extractTools(`
    export default class Test {
      /** Fetch data @timeout 30s */
      async fetch() { return 42; }
    }
  `);
  assert.deepEqual(tools[0].timeout, { ms: 30_000 });
});

test('@timeout requires a value', () => {
  const tools = extractTools(`
    export default class Test {
      /** Fetch data @timeout */
      async fetch() { return 42; }
    }
  `);
  // @timeout without value should not match
  assert.equal(tools[0].timeout, undefined);
});

// ─── @retryable ───

console.log('\n🧪 @retryable extraction\n');

test('@retryable defaults (3 retries, 1s)', () => {
  const tools = extractTools(`
    export default class Test {
      /** Call API @retryable */
      async call() { return 42; }
    }
  `);
  assert.deepEqual(tools[0].retryable, { count: 3, delay: 1_000 });
});

test('@retryable with count only', () => {
  const tools = extractTools(`
    export default class Test {
      /** Call API @retryable 5 */
      async call() { return 42; }
    }
  `);
  assert.deepEqual(tools[0].retryable, { count: 5, delay: 1_000 });
});

test('@retryable with count and delay', () => {
  const tools = extractTools(`
    export default class Test {
      /** Call API @retryable 3 2s */
      async call() { return 42; }
    }
  `);
  assert.deepEqual(tools[0].retryable, { count: 3, delay: 2_000 });
});

// ─── @throttled ───

console.log('\n🧪 @throttled extraction\n');

test('@throttled with rate', () => {
  const tools = extractTools(`
    export default class Test {
      /** Send msg @throttled 10/min */
      async send() {}
    }
  `);
  assert.deepEqual(tools[0].throttled, { count: 10, windowMs: 60_000 });
});

test('@throttled per hour', () => {
  const tools = extractTools(`
    export default class Test {
      /** API call @throttled 100/h */
      async call() {}
    }
  `);
  assert.deepEqual(tools[0].throttled, { count: 100, windowMs: 3_600_000 });
});

// ─── @debounced ───

console.log('\n🧪 @debounced extraction\n');

test('@debounced defaults to 500ms', () => {
  const tools = extractTools(`
    export default class Test {
      /** Save @debounced */
      async save() {}
    }
  `);
  assert.deepEqual(tools[0].debounced, { delay: 500 });
});

test('@debounced with custom delay', () => {
  const tools = extractTools(`
    export default class Test {
      /** Save @debounced 200ms */
      async save() {}
    }
  `);
  assert.deepEqual(tools[0].debounced, { delay: 200 });
});

// ─── @queued ───

console.log('\n🧪 @queued extraction\n');

test('@queued defaults to concurrency 1', () => {
  const tools = extractTools(`
    export default class Test {
      /** Process @queued */
      async process() {}
    }
  `);
  assert.deepEqual(tools[0].queued, { concurrency: 1 });
});

test('@queued with concurrency', () => {
  const tools = extractTools(`
    export default class Test {
      /** Process @queued 3 */
      async process() {}
    }
  `);
  assert.deepEqual(tools[0].queued, { concurrency: 3 });
});

// ─── @validate ───

console.log('\n🧪 @validate extraction\n');

test('@validate single rule', () => {
  const tools = extractTools(`
    export default class Test {
      /** Charge
       * @validate params.email must be a valid email
       */
      async charge(params: { email: string }) {}
    }
  `);
  assert.deepEqual(tools[0].validations, [
    { field: 'email', rule: 'must be a valid email' },
  ]);
});

test('@validate multiple rules', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Charge
       * @validate params.email must be a valid email
       * @validate params.amount must be positive
       */
      async charge(params: { email: string; amount: number }) {}
    }
  `);
  assert.equal(tools[0].validations!.length, 2);
  assert.equal(tools[0].validations![0].field, 'email');
  assert.equal(tools[0].validations![1].field, 'amount');
  assert.equal(tools[0].validations![1].rule, 'must be positive');
});

test('@validate strips params. prefix', () => {
  const tools = extractTools(`
    export default class Test {
      /** Check @validate params.name must be non-empty */
      async check(params: { name: string }) {}
    }
  `);
  assert.equal(tools[0].validations![0].field, 'name');
});

// ─── @deprecated ───

console.log('\n🧪 @deprecated extraction\n');

test('@deprecated with message', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Old method
       * @deprecated Use newMethod instead
       */
      async oldMethod() {}
    }
  `);
  assert.equal(tools[0].deprecated, 'Use newMethod instead');
});

test('@deprecated without message returns true', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Old method
       * @deprecated
       */
      async oldMethod() {}
    }
  `);
  assert.equal(tools[0].deprecated, true);
});

test('@deprecated does not leak into description', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Old method
       * @deprecated Use v2
       */
      async oldMethod() {}
    }
  `);
  // Description should not contain the @deprecated tag text
  assert.ok(!tools[0].description?.includes('@deprecated'));
  assert.ok(!tools[0].description?.includes('Use v2'));
});

// ─── Combined tags ───

console.log('\n🧪 Combined tag extraction\n');

test('multiple tags on one method', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Fetch weather data
       * @cached 15m
       * @timeout 10s
       * @retryable 2 500ms
       * @throttled 30/min
       */
      async getWeather(params: { city: string }) {}
    }
  `);
  const tool = tools[0];
  assert.deepEqual(tool.cached, { ttl: 900_000 });
  assert.deepEqual(tool.timeout, { ms: 10_000 });
  assert.deepEqual(tool.retryable, { count: 2, delay: 500 });
  assert.deepEqual(tool.throttled, { count: 30, windowMs: 60_000 });
});

test('functional tags do not interfere with existing tags', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Process item
       * @cached 5m
       * @locked board:write
       * @format table
       */
      async process(params: { id: string }) {}
    }
  `);
  const tool = tools[0];
  assert.deepEqual(tool.cached, { ttl: 300_000 });
  assert.equal(tool.locked, 'board:write');
  assert.equal(tool.outputFormat, 'table');
});

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
