/**
 * Cloudflare capability surface — `this.cf.*`
 *
 * Photons reach into Cloudflare features (R2, KV, D1, Workers AI, Queues,
 * Vectorize, Images, Browser Rendering, Durable Objects) through one
 * namespace. The runtime adapter that wraps a photon decides what backs
 * each binding:
 *
 *   - Local: `miniflare` provides an in-process sandbox seeded from the
 *     photon's `protected cfBindings = { ... }` config.
 *   - Deployed Worker: the real `env` is proxied through.
 *
 * Both paths satisfy the same shape, so the photon source is unchanged.
 *
 * Typing: we publish minimal structural shapes here rather than re-exporting
 * `@cloudflare/workers-types`. The cost of importing the full workers-types
 * tree (~6k lines of declarations) into every photon's transform pipeline
 * showed up as flaky `EPIPE` errors under tsx. Photons that already use
 * workers-types get exact compatibility through structural typing — assign
 * a `R2Bucket` from workers-types into our `R2BucketLike` and TS accepts
 * it. Photons that don't use workers-types still see typed methods on
 * the namespace and full autocomplete on the runtime methods we expose
 * here.
 */

/**
 * Minimal R2 bucket surface — covers the methods photons actually call.
 * Structurally compatible with `@cloudflare/workers-types` `R2Bucket`.
 */
export interface R2BucketLike {
  head(key: string): Promise<unknown>;
  get(key: string, options?: unknown): Promise<unknown>;
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: unknown): Promise<unknown>;
}

/** Minimal KV namespace surface. */
export interface KVNamespaceLike {
  get(key: string, options?: unknown): Promise<unknown>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: unknown): Promise<unknown>;
}

/** Minimal D1 database surface. */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
  dump(): Promise<ArrayBuffer>;
}

/** Minimal D1 prepared statement surface. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<T>;
  all<T = unknown>(): Promise<T>;
  raw<T = unknown>(): Promise<T[]>;
}

/** Minimal queue surface. */
export interface QueueLike<Body = unknown> {
  send(message: Body, options?: unknown): Promise<void>;
  sendBatch(messages: { body: Body }[], options?: unknown): Promise<void>;
}

/** Minimal vectorize surface. */
export interface VectorizeIndexLike {
  insert(vectors: unknown[]): Promise<unknown>;
  upsert(vectors: unknown[]): Promise<unknown>;
  query(vector: number[], options?: unknown): Promise<unknown>;
  getByIds(ids: string[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Minimal Workers AI surface. */
export interface AiLike {
  run(model: string, inputs: unknown, options?: unknown): Promise<unknown>;
}

/** Minimal Cloudflare Images binding surface. */
export interface ImagesBindingLike {
  info(stream: ReadableStream): Promise<unknown>;
  input(stream: ReadableStream): unknown;
}

/** Minimal Fetcher surface (Service binding / Browser Rendering). */
export interface FetcherLike {
  fetch(input: string, init?: unknown): Promise<unknown>;
}

/** Minimal Durable Object namespace surface. */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  idFromString(id: string): unknown;
  newUniqueId(): unknown;
  get(id: unknown): { fetch(input: string, init?: unknown): Promise<unknown> };
}

/**
 * Cloudflare runtime surface as exposed via `this.cf`.
 *
 * Each subnamespace returns either an upstream Cloudflare type or a
 * runtime-supplied proxy with the same shape. Backends:
 *  - Local: miniflare instance configured from `protected cfBindings`.
 *  - Deployed Worker: real `env.<binding>` passed through.
 */
export interface CFRuntime {
  r2(name: string): R2BucketLike;
  kv(name: string): KVNamespaceLike;
  d1(name: string): D1DatabaseLike;
  queue<Body = unknown>(name: string): QueueLike<Body>;
  vectorize(name: string): VectorizeIndexLike;
  ai: AiLike;
  images: ImagesBindingLike;
  browser: FetcherLike;
  do(name: string): DurableObjectNamespaceLike;
  fetch(input: string, init?: unknown): Promise<unknown>;
}

const HINT =
  'No Cloudflare runtime is configured. Either run this photon under a ' +
  'CF-aware host (local Beam with miniflare, or deployed to Cloudflare ' +
  'Workers), declare `protected cfBindings = { ... }` on the class, or ' +
  'remove the `this.cf` usage.';

function throwingFn(category: string): (...args: unknown[]) => never {
  return (..._args: unknown[]) => {
    throw new Error(`this.cf.${category}() called but ${HINT}`);
  };
}

function throwingProperty(category: string): never {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') {
        return () => `[unconfigured this.cf.${category}]`;
      }
      throw new Error(`this.cf.${category}.${String(prop)} accessed but ${HINT}`);
    },
  }) as never;
}

/**
 * Returns a stub `CFRuntime` whose subnamespaces throw a helpful error
 * when used. Callers should hold one instance per photon (mirrors the
 * `_memory` and `_schedule` lazy-init pattern) so identity-sensitive
 * checks remain consistent across reads of `this.cf`.
 */
export function notConfiguredCF(): CFRuntime {
  return {
    r2: throwingFn('r2') as CFRuntime['r2'],
    kv: throwingFn('kv') as CFRuntime['kv'],
    d1: throwingFn('d1') as CFRuntime['d1'],
    queue: throwingFn('queue') as CFRuntime['queue'],
    vectorize: throwingFn('vectorize') as CFRuntime['vectorize'],
    ai: throwingProperty('ai') as unknown as AiLike,
    images: throwingProperty('images') as unknown as ImagesBindingLike,
    browser: throwingProperty('browser') as unknown as FetcherLike,
    do: throwingFn('do') as CFRuntime['do'],
    fetch: ((_input: string, _init?: unknown) => {
      throw new Error(`this.cf.fetch() called but ${HINT}`);
    }) as CFRuntime['fetch'],
  };
}
