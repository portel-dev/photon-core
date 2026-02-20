/**
 * Tests for extensible middleware system
 * Run: npx tsx tests/middleware.test.ts
 */

import { strict as assert } from 'assert';
import { SchemaExtractor } from '../src/schema-extractor.js';
import {
  defineMiddleware,
  MiddlewareRegistry,
  builtinRegistry,
  createStateStore,
  buildMiddlewareChain,
  type MiddlewareDeclaration,
  type MiddlewareContext,
} from '../src/middleware.js';

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

async function asyncTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
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

// ─── parseInlineConfig ───

console.log('\n🧪 parseInlineConfig\n');

test('parses single inline config', () => {
  const ext = new SchemaExtractor();
  const config = ext.parseInlineConfig('{@ttl 5m}');
  assert.deepEqual(config, { ttl: '5m' });
});

test('parses multiple inline configs', () => {
  const ext = new SchemaExtractor();
  const config = ext.parseInlineConfig('{@ttl 5m} {@key params.userId}');
  assert.deepEqual(config, { ttl: '5m', key: 'params.userId' });
});

test('returns empty object for no config', () => {
  const ext = new SchemaExtractor();
  const config = ext.parseInlineConfig('plain text');
  assert.deepEqual(config, {});
});

// ─── extractUseDeclarations ───

console.log('\n🧪 extractUseDeclarations\n');

test('@use audit {@level info}', () => {
  const ext = new SchemaExtractor();
  const decls = ext.extractUseDeclarations('@use audit {@level info}');
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, 'audit');
  assert.deepEqual(decls[0].rawConfig, { level: 'info' });
});

test('@use with multiple props', () => {
  const ext = new SchemaExtractor();
  const decls = ext.extractUseDeclarations('@use circuitBreaker {@threshold 5} {@resetAfter 30s}');
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, 'circuitBreaker');
  assert.deepEqual(decls[0].rawConfig, { threshold: '5', resetAfter: '30s' });
});

test('multiple @use tags', () => {
  const ext = new SchemaExtractor();
  const decls = ext.extractUseDeclarations(
    '* @use audit {@level info}\n * @use rateLimit {@rate 10/min}'
  );
  assert.equal(decls.length, 2);
  assert.equal(decls[0].name, 'audit');
  assert.equal(decls[1].name, 'rateLimit');
});

test('@use without config', () => {
  const ext = new SchemaExtractor();
  const decls = ext.extractUseDeclarations('@use myMiddleware');
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, 'myMiddleware');
  assert.deepEqual(decls[0].rawConfig, {});
});

// ─── @use in full extraction ───

console.log('\n🧪 @use tag in schema extraction\n');

test('@use custom middleware appears in middleware[]', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Get data
       * @use audit {@level info} {@tags api,weather}
       */
      async getData() { return 42; }
    }
  `);
  assert.equal(tools.length, 1);
  assert.ok(tools[0].middleware);
  assert.equal(tools[0].middleware!.length, 1);
  assert.equal(tools[0].middleware![0].name, 'audit');
  assert.equal(tools[0].middleware![0].phase, 45); // default phase for custom
});

test('@cached sugar + @use custom both in middleware[]', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Get data
       * @cached 5m
       * @use audit {@level debug}
       */
      async getData() { return 42; }
    }
  `);
  const mw = tools[0].middleware!;
  assert.equal(mw.length, 2);
  // cached should be present
  const cached = mw.find(m => m.name === 'cached');
  assert.ok(cached);
  assert.equal(cached!.phase, 30);
  assert.deepEqual(cached!.config, { ttl: 300_000 });
  // audit should be present
  const audit = mw.find(m => m.name === 'audit');
  assert.ok(audit);
  assert.equal(audit!.phase, 45);
});

test('sugar equivalence: @cached 5m produces same as @use cached {@ttl 5m}', () => {
  const tools1 = extractTools(`
    export default class Test {
      /** @cached 5m */
      async a() {}
    }
  `);
  const tools2 = extractTools(`
    export default class Test {
      /** @use cached {@ttl 5m} */
      async a() {}
    }
  `);
  const mw1 = tools1[0].middleware!.find(m => m.name === 'cached')!;
  const mw2 = tools2[0].middleware!.find(m => m.name === 'cached')!;
  assert.equal(mw1.phase, mw2.phase);
  assert.deepEqual(mw1.config, mw2.config);
});

test('all sugar tags produce middleware declarations', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Full middleware
       * @cached 5m
       * @timeout 30s
       * @retryable 3 1s
       * @throttled 10/min
       * @debounced 500ms
       * @queued 3
       * @locked board:write
       * @validate params.email must be a valid email
       */
      async full(params: { email: string }) {}
    }
  `);
  const mw = tools[0].middleware!;
  assert.equal(mw.length, 8);

  const names = mw.map(m => m.name);
  assert.ok(names.includes('cached'));
  assert.ok(names.includes('timeout'));
  assert.ok(names.includes('retryable'));
  assert.ok(names.includes('throttled'));
  assert.ok(names.includes('debounced'));
  assert.ok(names.includes('queued'));
  assert.ok(names.includes('locked'));
  assert.ok(names.includes('validate'));
});

test('no tags means no middleware[]', () => {
  const tools = extractTools(`
    export default class Test {
      /** Simple method */
      async simple() {}
    }
  `);
  assert.equal(tools[0].middleware, undefined);
});

test('@use does not strip from description', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Get weather data
       * @use audit {@level info}
       */
      async getWeather() {}
    }
  `);
  assert.equal(tools[0].description, 'Get weather data');
});

// ─── Registry ───

console.log('\n🧪 MiddlewareRegistry\n');

test('builtinRegistry has all 8 built-ins', () => {
  assert.ok(builtinRegistry.has('cached'));
  assert.ok(builtinRegistry.has('timeout'));
  assert.ok(builtinRegistry.has('retryable'));
  assert.ok(builtinRegistry.has('throttled'));
  assert.ok(builtinRegistry.has('debounced'));
  assert.ok(builtinRegistry.has('queued'));
  assert.ok(builtinRegistry.has('locked'));
  assert.ok(builtinRegistry.has('validate'));
});

test('registry register/get/has', () => {
  const reg = new MiddlewareRegistry();
  const def = defineMiddleware({
    name: 'test-mw',
    phase: 25,
    create(_config, _state) {
      return async (_ctx, next) => next();
    },
  });
  reg.register(def);
  assert.ok(reg.has('test-mw'));
  assert.equal(reg.get('test-mw')?.name, 'test-mw');
  assert.equal(reg.get('test-mw')?.phase, 25);
  assert.ok(!reg.has('nonexistent'));
});

// ─── defineMiddleware ───

console.log('\n🧪 defineMiddleware\n');

test('validates name is required', () => {
  assert.throws(() => {
    defineMiddleware({ name: '', create: () => async (_, n) => n() });
  });
});

test('validates create is required', () => {
  assert.throws(() => {
    defineMiddleware({ name: 'test', create: undefined as any });
  });
});

test('applies default phase 45', () => {
  const def = defineMiddleware({ name: 'test', create: () => async (_, n) => n() });
  assert.equal(def.phase, 45);
});

test('freezes the definition', () => {
  const def = defineMiddleware({ name: 'test', create: () => async (_, n) => n() });
  assert.throws(() => {
    (def as any).name = 'changed';
  });
});

// ─── Phase Ordering ───

console.log('\n🧪 Phase ordering\n');

test('phases sort correctly: throttled(10) < cached(30) < custom(45) < timeout(70)', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Ordered
       * @cached 5m
       * @timeout 10s
       * @throttled 5/min
       * @use audit
       */
      async ordered() {}
    }
  `);
  const mw = tools[0].middleware!;
  const sorted = [...mw].sort((a, b) => a.phase - b.phase);
  assert.equal(sorted[0].name, 'throttled'); // 10
  assert.equal(sorted[1].name, 'cached');    // 30
  assert.equal(sorted[2].name, 'audit');     // 45
  assert.equal(sorted[3].name, 'timeout');   // 70
});

// ─── buildMiddlewareChain ───

console.log('\n🧪 buildMiddlewareChain\n');

await asyncTest('chain executes in phase order (outer → inner)', async () => {
  const order: string[] = [];
  const reg = new MiddlewareRegistry();

  reg.register(defineMiddleware({
    name: 'first',
    phase: 10,
    create() {
      return async (ctx, next) => {
        order.push('first-before');
        const result = await next();
        order.push('first-after');
        return result;
      };
    },
  }));

  reg.register(defineMiddleware({
    name: 'second',
    phase: 50,
    create() {
      return async (ctx, next) => {
        order.push('second-before');
        const result = await next();
        order.push('second-after');
        return result;
      };
    },
  }));

  const declarations: MiddlewareDeclaration[] = [
    { name: 'second', config: {}, phase: 50 },
    { name: 'first', config: {}, phase: 10 },
  ];
  const ctx: MiddlewareContext = { photon: 'test', tool: 'method', instance: 'default', params: {} };
  const states = new Map();

  const chain = buildMiddlewareChain(
    async () => { order.push('execute'); return 42; },
    declarations,
    reg,
    states,
    ctx,
  );

  const result = await chain();
  assert.equal(result, 42);
  assert.deepEqual(order, ['first-before', 'second-before', 'execute', 'second-after', 'first-after']);
});

await asyncTest('empty declarations returns original execute', async () => {
  const reg = new MiddlewareRegistry();
  const states = new Map();
  const ctx: MiddlewareContext = { photon: 'test', tool: 'method', instance: 'default', params: {} };

  const execute = async () => 'original';
  const chain = buildMiddlewareChain(execute, [], reg, states, ctx);
  assert.equal(chain, execute);
});

await asyncTest('state persists across calls', async () => {
  const reg = new MiddlewareRegistry();
  reg.register(defineMiddleware({
    name: 'counter',
    phase: 10,
    create(_config, state) {
      return async (_ctx, next) => {
        const count = (state.get<number>('count') || 0) + 1;
        state.set('count', count);
        const result = await next();
        return { ...result, callCount: count };
      };
    },
  }));

  const declarations: MiddlewareDeclaration[] = [{ name: 'counter', config: {}, phase: 10 }];
  const ctx: MiddlewareContext = { photon: 'test', tool: 'method', instance: 'default', params: {} };
  const states = new Map();

  const chain1 = buildMiddlewareChain(async () => ({ value: 'a' }), declarations, reg, states, ctx);
  const r1 = await chain1();
  assert.equal(r1.callCount, 1);

  const chain2 = buildMiddlewareChain(async () => ({ value: 'b' }), declarations, reg, states, ctx);
  const r2 = await chain2();
  assert.equal(r2.callCount, 2);
});

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
