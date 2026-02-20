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

test('builtinRegistry has all 11 built-ins', () => {
  assert.ok(builtinRegistry.has('fallback'));
  assert.ok(builtinRegistry.has('logged'));
  assert.ok(builtinRegistry.has('circuitBreaker'));
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

// ─── @fallback ───

console.log('\n🧪 @fallback tag\n');

test('@fallback [] extracts as middleware declaration', () => {
  const tools = extractTools(`
    export default class Test {
      /** @fallback [] */
      async loadData() { return []; }
    }
  `);
  assert.ok(tools[0].middleware);
  const fb = tools[0].middleware!.find((m: any) => m.name === 'fallback');
  assert.ok(fb);
  assert.equal(fb!.phase, 3);
  assert.equal(fb!.config.value, '[]');
});

test('@fallback {} parses object default', () => {
  const tools = extractTools(`
    export default class Test {
      /** @fallback {} */
      async loadConfig() { return {}; }
    }
  `);
  const fb = tools[0].middleware!.find((m: any) => m.name === 'fallback');
  assert.equal(fb!.config.value, '{}');
});

test('@fallback null parses null default', () => {
  const tools = extractTools(`
    export default class Test {
      /** @fallback null */
      async findUser() { return null; }
    }
  `);
  const fb = tools[0].middleware!.find((m: any) => m.name === 'fallback');
  assert.equal(fb!.config.value, 'null');
});

test('@fallback has individual field on schema', () => {
  const tools = extractTools(`
    export default class Test {
      /** @fallback [] */
      async loadData() { return []; }
    }
  `);
  assert.ok(tools[0].fallback);
  assert.equal(tools[0].fallback.value, '[]');
});

test('@fallback does not appear in description', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Load user data
       * @fallback null
       */
      async loadUser() {}
    }
  `);
  assert.equal(tools[0].description, 'Load user data');
});

test('@fallback is outermost (phase 3) in pipeline ordering', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * With everything
       * @fallback []
       * @throttled 5/min
       * @cached 5m
       * @timeout 10s
       */
      async everything() {}
    }
  `);
  const mw = tools[0].middleware!;
  const sorted = [...mw].sort((a, b) => a.phase - b.phase);
  assert.equal(sorted[0].name, 'fallback');   // 3 — outermost
  assert.equal(sorted[1].name, 'throttled');  // 10
  assert.equal(sorted[2].name, 'cached');     // 30
  assert.equal(sorted[3].name, 'timeout');    // 70
});

await asyncTest('@fallback catches errors and returns default value', async () => {
  const reg = new MiddlewareRegistry();
  reg.register(defineMiddleware({
    name: 'fallback',
    phase: 3,
    create(config: any) {
      return async (_ctx, next) => {
        try {
          return await next();
        } catch {
          // Parse value same as middleware.ts does
          const v = config.value;
          if (v === 'null') return null;
          try { return JSON.parse(v); } catch { return v; }
        }
      };
    },
  }));

  const declarations: MiddlewareDeclaration[] = [
    { name: 'fallback', config: { value: '[]' }, phase: 3 },
  ];
  const ctx: MiddlewareContext = { photon: 'test', tool: 'failing', instance: 'default', params: {} };
  const states = new Map();

  const chain = buildMiddlewareChain(
    async () => { throw new Error('boom'); },
    declarations, reg, states, ctx,
  );
  const result = await chain();
  assert.deepEqual(result, []);
});

await asyncTest('@fallback lets successful calls through', async () => {
  const reg = new MiddlewareRegistry();
  reg.register(defineMiddleware({
    name: 'fallback',
    phase: 3,
    create(config: any) {
      return async (_ctx, next) => {
        try { return await next(); } catch {
          try { return JSON.parse(config.value); } catch { return config.value; }
        }
      };
    },
  }));

  const declarations: MiddlewareDeclaration[] = [
    { name: 'fallback', config: { value: '[]' }, phase: 3 },
  ];
  const ctx: MiddlewareContext = { photon: 'test', tool: 'ok', instance: 'default', params: {} };
  const states = new Map();

  const chain = buildMiddlewareChain(
    async () => ({ data: 'real' }),
    declarations, reg, states, ctx,
  );
  const result = await chain();
  assert.deepEqual(result, { data: 'real' });
});

// ─── @logged ───

console.log('\n🧪 @logged tag\n');

test('@logged extracts as middleware declaration', () => {
  const tools = extractTools(`
    export default class Test {
      /** @logged */
      async fetchData() { return 42; }
    }
  `);
  assert.ok(tools[0].middleware);
  const lg = tools[0].middleware!.find((m: any) => m.name === 'logged');
  assert.ok(lg);
  assert.equal(lg!.phase, 5);
  assert.equal(lg!.config.level, 'info');
});

test('@logged debug parses custom level', () => {
  const tools = extractTools(`
    export default class Test {
      /** @logged debug */
      async debugMethod() {}
    }
  `);
  const lg = tools[0].middleware!.find((m: any) => m.name === 'logged');
  assert.equal(lg!.config.level, 'debug');
});

test('@logged has individual field on schema', () => {
  const tools = extractTools(`
    export default class Test {
      /** @logged warn */
      async warnMethod() {}
    }
  `);
  assert.ok(tools[0].logged);
  assert.equal(tools[0].logged.level, 'warn');
});

test('@logged does not appear in description', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Fetch user data
       * @logged
       */
      async fetchUser() {}
    }
  `);
  assert.equal(tools[0].description, 'Fetch user data');
});

test('@logged at phase 5 sits between fallback(3) and throttled(10)', () => {
  const tools = extractTools(`
    export default class Test {
      /**
       * Full stack
       * @fallback null
       * @logged
       * @throttled 5/min
       */
      async fullStack() {}
    }
  `);
  const mw = tools[0].middleware!;
  const sorted = [...mw].sort((a, b) => a.phase - b.phase);
  assert.equal(sorted[0].name, 'fallback');  // 3
  assert.equal(sorted[1].name, 'logged');    // 5
  assert.equal(sorted[2].name, 'throttled'); // 10
});

await asyncTest('@logged logs success via console.error', async () => {
  const logs: string[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => logs.push(args.join(' '));

  const reg = new MiddlewareRegistry();
  reg.register(defineMiddleware({
    name: 'logged',
    phase: 5,
    create(config: any) {
      return async (ctx, next) => {
        const start = Date.now();
        try {
          const result = await next();
          console.error(`[${config.level}] ${ctx.photon}.${ctx.tool} ${Date.now() - start}ms`);
          return result;
        } catch (error: any) {
          console.error(`[${config.level}] ${ctx.photon}.${ctx.tool} FAILED — ${error.message}`);
          throw error;
        }
      };
    },
  }));

  const declarations: MiddlewareDeclaration[] = [
    { name: 'logged', config: { level: 'info' }, phase: 5 },
  ];
  const ctx: MiddlewareContext = { photon: 'billing', tool: 'charge', instance: 'default', params: {} };
  const states = new Map();

  const chain = buildMiddlewareChain(async () => 'ok', declarations, reg, states, ctx);
  await chain();

  console.error = origError;
  assert.ok(logs.some(l => l.includes('[info] billing.charge') && l.includes('ms')));
});

await asyncTest('@logged logs failure via console.error', async () => {
  const logs: string[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => logs.push(args.join(' '));

  const reg = new MiddlewareRegistry();
  reg.register(defineMiddleware({
    name: 'logged',
    phase: 5,
    create(config: any) {
      return async (ctx, next) => {
        try {
          return await next();
        } catch (error: any) {
          console.error(`[${config.level}] ${ctx.photon}.${ctx.tool} FAILED — ${error.message}`);
          throw error;
        }
      };
    },
  }));

  const declarations: MiddlewareDeclaration[] = [
    { name: 'logged', config: { level: 'error' }, phase: 5 },
  ];
  const ctx: MiddlewareContext = { photon: 'billing', tool: 'charge', instance: 'default', params: {} };
  const states = new Map();

  const chain = buildMiddlewareChain(async () => { throw new Error('card declined'); }, declarations, reg, states, ctx);
  try { await chain(); } catch {}

  console.error = origError;
  assert.ok(logs.some(l => l.includes('[error] billing.charge FAILED') && l.includes('card declined')));
});

// ─── @circuitBreaker extraction ───

console.log('\n🧪 @circuitBreaker extraction\n');

test('@circuitBreaker 5 30s extracts correctly', () => {
  const source = `
    export default class Svc {
      /** @circuitBreaker 5 30s */
      async call(params: { url: string }) { return null; }
    }
  `;
  const tools = extractTools(source);
  assert.ok(tools[0].circuitBreaker);
  assert.equal(tools[0].circuitBreaker!.threshold, 5);
  assert.equal(tools[0].circuitBreaker!.resetAfter, '30s');
});

test('@circuitBreaker 3 1m extracts correctly', () => {
  const source = `
    export default class Svc {
      /** @circuitBreaker 3 1m */
      async call(params: { url: string }) { return null; }
    }
  `;
  const tools = extractTools(source);
  assert.ok(tools[0].circuitBreaker);
  assert.equal(tools[0].circuitBreaker!.threshold, 3);
  assert.equal(tools[0].circuitBreaker!.resetAfter, '1m');
});

test('@circuitBreaker appears as middleware declaration at phase 8', () => {
  const source = `
    export default class Svc {
      /** @circuitBreaker 5 30s */
      async call(params: { url: string }) { return null; }
    }
  `;
  const tools = extractTools(source);
  const mw = tools[0].middleware!;
  const cb = mw.find(m => m.name === 'circuitBreaker');
  assert.ok(cb, 'circuitBreaker declaration exists');
  assert.equal(cb!.phase, 8);
  assert.equal(cb!.config.threshold, 5);
  assert.equal(cb!.config.resetAfter, '30s');
});

test('@circuitBreaker stripped from description', () => {
  const source = `
    export default class Svc {
      /**
       * Call external API
       * @circuitBreaker 5 30s
       */
      async call(params: { url: string }) { return null; }
    }
  `;
  const tools = extractTools(source);
  assert.equal(tools[0].description, 'Call external API');
});

// ─── @circuitBreaker runtime ───

console.log('\n🧪 @circuitBreaker runtime\n');

test('@circuitBreaker opens after threshold failures', async () => {
  let callCount = 0;
  const execute = async () => {
    callCount++;
    throw new Error('service down');
  };

  const declarations: MiddlewareDeclaration[] = [
    { name: 'circuitBreaker', config: { threshold: 3, resetAfterMs: 60_000 }, phase: 8 },
  ];
  const stateStores = new Map();
  const ctx: MiddlewareContext = { photon: 'test', tool: 'call', instance: 'default', params: {} };

  const chain = buildMiddlewareChain(execute, declarations, builtinRegistry, stateStores, ctx);

  // Fail 3 times
  for (let i = 0; i < 3; i++) {
    try { await chain(); } catch {}
  }
  assert.equal(callCount, 3);

  // 4th call should be fast-rejected (circuit open)
  try {
    await chain();
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonCircuitOpenError');
    assert.ok(e.message.includes('Circuit open'));
  }
  assert.equal(callCount, 3, 'execute not called when circuit is open');
});

test('@circuitBreaker resets on success', async () => {
  let shouldFail = true;
  const execute = async () => {
    if (shouldFail) throw new Error('fail');
    return 'ok';
  };

  const declarations: MiddlewareDeclaration[] = [
    { name: 'circuitBreaker', config: { threshold: 2, resetAfterMs: 50 }, phase: 8 },
  ];
  const stateStores = new Map();
  const ctx: MiddlewareContext = { photon: 'test', tool: 'call', instance: 'default', params: {} };

  const chain = buildMiddlewareChain(execute, declarations, builtinRegistry, stateStores, ctx);

  // Fail 2 times → circuit opens
  for (let i = 0; i < 2; i++) {
    try { await chain(); } catch {}
  }

  // Wait for reset period
  await new Promise(r => setTimeout(r, 60));

  // Circuit should be half-open now, allow probe
  shouldFail = false;
  const result = await chain();
  assert.equal(result, 'ok');

  // Circuit should be closed again — another call works
  const result2 = await chain();
  assert.equal(result2, 'ok');
});

test('@circuitBreaker half-open probe failure re-opens', async () => {
  let callCount = 0;
  const execute = async () => {
    callCount++;
    throw new Error('still down');
  };

  const declarations: MiddlewareDeclaration[] = [
    { name: 'circuitBreaker', config: { threshold: 2, resetAfterMs: 50 }, phase: 8 },
  ];
  const stateStores = new Map();
  const ctx: MiddlewareContext = { photon: 'test', tool: 'call', instance: 'default', params: {} };

  const chain = buildMiddlewareChain(execute, declarations, builtinRegistry, stateStores, ctx);

  // Fail 2 times → circuit opens
  for (let i = 0; i < 2; i++) {
    try { await chain(); } catch {}
  }
  assert.equal(callCount, 2);

  // Wait for reset period
  await new Promise(r => setTimeout(r, 60));

  // Probe also fails → circuit re-opens
  try { await chain(); } catch {}
  assert.equal(callCount, 3);

  // Next call should be fast-rejected again (circuit re-opened)
  try {
    await chain();
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonCircuitOpenError');
  }
  assert.equal(callCount, 3);
});

// ─── Registry update ───

console.log('\n🧪 Registry (updated)\n');

test('builtinRegistry has all 11 built-ins', () => {
  assert.ok(builtinRegistry.has('fallback'));
  assert.ok(builtinRegistry.has('logged'));
  assert.ok(builtinRegistry.has('circuitBreaker'));
  assert.ok(builtinRegistry.has('cached'));
  assert.ok(builtinRegistry.has('timeout'));
  assert.ok(builtinRegistry.has('retryable'));
  assert.ok(builtinRegistry.has('throttled'));
  assert.ok(builtinRegistry.has('debounced'));
  assert.ok(builtinRegistry.has('queued'));
  assert.ok(builtinRegistry.has('locked'));
  assert.ok(builtinRegistry.has('validate'));
});

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
