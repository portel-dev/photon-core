/**
 * Extensible Middleware System
 *
 * Every functional tag (@cached, @timeout, @retryable, etc.) is a MiddlewareDefinition.
 * Custom middleware uses the same API via @use tag + defineMiddleware().
 *
 * Pipeline assembly: declarations sorted by phase, composed inner→outer.
 * Lower phase = outer wrapper (executes first, returns last).
 */

import * as crypto from 'crypto';
import { parseDuration, parseRate } from './utils/duration.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MiddlewareContext {
  photon: string;
  tool: string;
  instance: string;
  params: any;
}

export type NextFn = () => Promise<any>;
export type MiddlewareHandler = (ctx: MiddlewareContext, next: NextFn) => Promise<any>;

export interface MiddlewareDefinition<C = Record<string, any>> {
  name: string;
  /** Ordering — lower = outer (executes first). Default: 45 */
  phase?: number;
  /** Parse shorthand sugar like @cached 5m */
  parseShorthand?(value: string): C;
  /** Parse inline {@prop value} config */
  parseConfig?(raw: Record<string, string>): C;
  /** Create a handler from parsed config */
  create(config: C, state: MiddlewareState): MiddlewareHandler;
}

export interface MiddlewareState {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): boolean;
}

/** Stored on ExtractedSchema per-tool */
export interface MiddlewareDeclaration {
  name: string;
  config: Record<string, any>;
  phase: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE STORE
// ═══════════════════════════════════════════════════════════════════════════════

export function createStateStore(): MiddlewareState {
  const store = new Map<string, any>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key);
    },
    set<T>(key: string, value: T): void {
      store.set(key, value);
    },
    delete(key: string): boolean {
      return store.delete(key);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

export class MiddlewareRegistry {
  private definitions = new Map<string, MiddlewareDefinition>();

  register(def: MiddlewareDefinition): void {
    this.definitions.set(def.name, def);
  }

  get(name: string): MiddlewareDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  names(): string[] {
    return [...this.definitions.keys()];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFINE MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

export function defineMiddleware<C = Record<string, any>>(
  def: MiddlewareDefinition<C>
): MiddlewareDefinition<C> {
  if (!def.name) {
    throw new Error('MiddlewareDefinition requires a name');
  }
  if (typeof def.create !== 'function') {
    throw new Error(`MiddlewareDefinition '${def.name}' requires a create function`);
  }
  // Apply default phase
  if (def.phase === undefined) {
    def.phase = 45;
  }
  return Object.freeze(def) as MiddlewareDefinition<C>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS (moved from loader.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/** Hash parameters for cache key */
export function hashParams(params: any): string {
  try {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(params || {}))
      .digest('hex')
      .slice(0, 12);
  } catch {
    return 'nohash';
  }
}

/** Get nested value from object by dot path */
function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  return path.split('.').reduce((o, key) => o?.[key], obj);
}

/** Built-in validators for @validate tag */
export const BUILT_IN_VALIDATORS: Record<string, (value: any) => boolean> = {
  'a valid email': (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  'a valid url': (v) => typeof v === 'string' && /^https?:\/\/.+/.test(v),
  positive: (v) => typeof v === 'number' && v > 0,
  'non-negative': (v) => typeof v === 'number' && v >= 0,
  'non-empty': (v) =>
    v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0),
  'a valid uuid': (v) =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  'an integer': (v) => typeof v === 'number' && Number.isInteger(v),
};

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN MIDDLEWARE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

interface CacheEntry {
  result: any;
  timestamp: number;
}

interface ThrottleStateEntry {
  timestamps: number[];
}

interface DebouncePending {
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

interface QueueState {
  running: number;
  queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>;
}

// --- throttled (phase 10) ---

const throttledMiddleware = defineMiddleware<{ count: number; windowMs: number }>({
  name: 'throttled',
  phase: 10,
  parseShorthand(value: string) {
    return parseRate(value);
  },
  parseConfig(raw) {
    if (raw.rate) {
      return parseRate(raw.rate);
    }
    return {
      count: parseInt(raw.count || '10', 10),
      windowMs: raw.window ? parseDuration(raw.window) : 60_000,
    };
  },
  create(config, state) {
    return async (ctx, next) => {
      const key = `${ctx.photon}:${ctx.instance}:${ctx.tool}`;
      const now = Date.now();
      let entry = state.get<ThrottleStateEntry>(key);
      if (!entry) {
        entry = { timestamps: [] };
        state.set(key, entry);
      }
      // Prune old timestamps
      entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);
      if (entry.timestamps.length >= config.count) {
        const error = new Error(
          `Rate limited: ${ctx.photon}.${ctx.tool} exceeds ${config.count} calls per ${config.windowMs}ms`
        );
        error.name = 'PhotonRateLimitError';
        throw error;
      }
      entry.timestamps.push(now);
      return next();
    };
  },
});

// --- debounced (phase 20) ---

const debouncedMiddleware = defineMiddleware<{ delay: number }>({
  name: 'debounced',
  phase: 20,
  parseShorthand(value: string) {
    return { delay: parseDuration(value) };
  },
  parseConfig(raw) {
    return { delay: raw.delay ? parseDuration(raw.delay) : 500 };
  },
  create(config, state) {
    return async (ctx, next) => {
      const key = `${ctx.photon}:${ctx.instance}:${ctx.tool}`;
      const existing = state.get<DebouncePending>(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error('Debounced: superseded by newer call'));
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
          state.delete(key);
          try {
            resolve(await next());
          } catch (error) {
            reject(error);
          }
        }, config.delay);

        state.set(key, { timer, resolve, reject });
      });
    };
  },
});

// --- cached (phase 30) ---

const cachedMiddleware = defineMiddleware<{ ttl: number; key?: string }>({
  name: 'cached',
  phase: 30,
  parseShorthand(value: string) {
    const ttl = parseDuration(value);
    return { ttl: ttl || 300_000 };
  },
  parseConfig(raw) {
    const config: { ttl: number; key?: string } = {
      ttl: raw.ttl ? parseDuration(raw.ttl) : 300_000,
    };
    if (raw.key) config.key = raw.key;
    return config;
  },
  create(config, state) {
    return async (ctx, next) => {
      const paramHash = config.key
        ? getNestedValue(ctx.params, config.key)
        : hashParams(ctx.params);
      const cacheKey = `${ctx.photon}:${ctx.instance}:${ctx.tool}:${paramHash}`;
      const cached = state.get<CacheEntry>(cacheKey);
      if (cached && Date.now() - cached.timestamp < config.ttl) {
        return cached.result;
      }
      const result = await next();
      state.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    };
  },
});

// --- validate (phase 40) ---

const validateMiddleware = defineMiddleware<{ validations: Array<{ field: string; rule: string }> }>({
  name: 'validate',
  phase: 40,
  parseConfig(raw) {
    // Config comes pre-parsed from extractValidations
    return { validations: [] };
  },
  create(config, _state) {
    return async (ctx, next) => {
      for (const { field, rule } of config.validations) {
        const value = getNestedValue(ctx.params, field);
        const ruleLower = rule.toLowerCase();

        let valid = false;
        let builtInMatched = false;
        for (const [pattern, validator] of Object.entries(BUILT_IN_VALIDATORS)) {
          if (ruleLower.includes(pattern)) {
            valid = validator(value);
            builtInMatched = true;
            break;
          }
        }

        if (!builtInMatched && ruleLower.startsWith('must be ')) {
          valid = value !== null && value !== undefined && value !== '';
        }

        if (!valid) {
          const error = new Error(
            `Validation failed: ${field} ${rule} (got ${JSON.stringify(value)}) in ${ctx.photon}.${ctx.tool}`
          );
          error.name = 'PhotonValidationError';
          throw error;
        }
      }
      return next();
    };
  },
});

// --- queued (phase 50) ---

const queuedMiddleware = defineMiddleware<{ concurrency: number }>({
  name: 'queued',
  phase: 50,
  parseShorthand(value: string) {
    return { concurrency: parseInt(value, 10) || 1 };
  },
  parseConfig(raw) {
    return { concurrency: parseInt(raw.concurrency || '1', 10) };
  },
  create(config, state) {
    return async (ctx, next) => {
      const key = `${ctx.photon}:${ctx.instance}:${ctx.tool}`;
      let queueState = state.get<QueueState>(key);
      if (!queueState) {
        queueState = { running: 0, queue: [] };
        state.set(key, queueState);
      }

      const tryDequeue = () => {
        const s = state.get<QueueState>(key);
        if (!s) return;
        while (s.running < config.concurrency && s.queue.length > 0) {
          const entry = s.queue.shift()!;
          s.running++;
          entry.fn().then(
            (result) => {
              s.running--;
              entry.resolve(result);
              tryDequeue();
            },
            (error) => {
              s.running--;
              entry.reject(error);
              tryDequeue();
            }
          );
        }
      };

      if (queueState.running < config.concurrency) {
        queueState.running++;
        return next().finally(() => {
          const s = state.get<QueueState>(key);
          if (s) {
            s.running--;
            tryDequeue();
          }
        });
      }

      return new Promise((resolve, reject) => {
        queueState!.queue.push({ fn: next, resolve, reject });
      });
    };
  },
});

// --- locked (phase 60) ---
// Note: The actual lock implementation is injected from the loader since it depends
// on the daemon's lock manager. This definition provides the structure.

const lockedMiddleware = defineMiddleware<{ name: string }>({
  name: 'locked',
  phase: 60,
  parseShorthand(value: string) {
    return { name: value };
  },
  parseConfig(raw) {
    return { name: raw.name || '' };
  },
  create(config, _state) {
    // The actual withLock implementation is injected by the loader.
    // At the photon-core level, we provide a passthrough that the loader overrides.
    return async (ctx, next) => {
      // Loader replaces this handler with one that calls withLockHelper
      // If running without the loader, locks are a no-op
      return next();
    };
  },
});

// --- timeout (phase 70) ---

const timeoutMiddleware = defineMiddleware<{ ms: number }>({
  name: 'timeout',
  phase: 70,
  parseShorthand(value: string) {
    return { ms: parseDuration(value) };
  },
  parseConfig(raw) {
    return { ms: raw.ms ? parseDuration(raw.ms) : 30_000 };
  },
  create(config, _state) {
    return async (ctx, next) => {
      return Promise.race([
        next(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            const error = new Error(
              `Timeout: ${ctx.photon}.${ctx.tool} did not complete within ${config.ms}ms`
            );
            error.name = 'PhotonTimeoutError';
            reject(error);
          }, config.ms);
        }),
      ]);
    };
  },
});

// --- retryable (phase 80) ---

const retryableMiddleware = defineMiddleware<{ count: number; delay: number }>({
  name: 'retryable',
  phase: 80,
  parseShorthand(value: string) {
    const parts = value.trim().split(/\s+/);
    const count = parseInt(parts[0], 10) || 3;
    const delay = parts[1] ? parseDuration(parts[1]) : 1_000;
    return { count, delay };
  },
  parseConfig(raw) {
    return {
      count: parseInt(raw.count || '3', 10),
      delay: raw.delay ? parseDuration(raw.delay) : 1_000,
    };
  },
  create(config, _state) {
    return async (ctx, next) => {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= config.count; attempt++) {
        try {
          return await next();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < config.count) {
            const backoffMs = config.delay * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }
      throw lastError;
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL BUILT-IN REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

export const builtinRegistry = new MiddlewareRegistry();
builtinRegistry.register(throttledMiddleware);
builtinRegistry.register(debouncedMiddleware);
builtinRegistry.register(cachedMiddleware);
builtinRegistry.register(validateMiddleware);
builtinRegistry.register(queuedMiddleware);
builtinRegistry.register(lockedMiddleware);
builtinRegistry.register(timeoutMiddleware);
builtinRegistry.register(retryableMiddleware);

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a middleware chain from declarations.
 *
 * Sort by phase (ascending), then reverse for wrapping:
 *   chain = actualExecution
 *   for each declaration (highest phase first → wraps innermost):
 *     handler = definition.create(config, stateStore)
 *     prev = chain
 *     chain = () => handler(ctx, prev)
 *
 * Result: lowest phase runs outermost (executes first).
 */
export function buildMiddlewareChain(
  execute: () => Promise<any>,
  declarations: MiddlewareDeclaration[],
  registry: MiddlewareRegistry,
  stateStores: Map<string, MiddlewareState>,
  ctx: MiddlewareContext,
  /** Optional overrides for specific middleware (e.g., locked with real lock impl) */
  handlerOverrides?: Map<string, (config: any, state: MiddlewareState) => MiddlewareHandler>,
): () => Promise<any> {
  if (!declarations || declarations.length === 0) {
    return execute;
  }

  // Resolve actual phases: use definition's phase if available (custom middleware
  // defines its own phase, but schema extractor defaults to 45 for unknowns)
  const resolved = declarations.map(decl => {
    const def = registry.get(decl.name);
    const phase = def?.phase !== undefined ? def.phase : decl.phase;
    return { ...decl, phase };
  });

  // Stable sort by phase (preserves declaration order within same phase)
  const sorted = resolved.sort((a, b) => a.phase - b.phase);

  // Build chain: iterate reversed sorted list (highest phase = innermost wrapper)
  let chain = execute;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const decl = sorted[i];
    const def = registry.get(decl.name);
    if (!def) {
      // Unknown middleware — skip with warning
      continue;
    }

    // Get or create state store for this middleware
    let state = stateStores.get(decl.name);
    if (!state) {
      state = createStateStore();
      stateStores.set(decl.name, state);
    }

    // Check for handler override (e.g., locked middleware needs real lock manager)
    const override = handlerOverrides?.get(decl.name);
    const handler = override
      ? override(decl.config, state)
      : def.create(decl.config, state);

    const prev = chain;
    chain = () => handler(ctx, prev);
  }

  return chain;
}
