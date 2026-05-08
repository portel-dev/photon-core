/**
 * Cloudflare capability surface — `this.cf.*`
 *
 * Photons reach into Cloudflare features (R2, KV, D1, Workers AI, Queues,
 * Vectorize, Images, Browser Rendering, Durable Objects) through one
 * namespace. The runtime adapter that wraps a photon decides what backs
 * each binding:
 *
 *   - Local: `miniflare` provides an in-process sandbox seeded from the
 *     photon's `protected cf = { ... }` config.
 *   - Deployed Worker: the real `env` is proxied through.
 *
 * Both paths satisfy the same shape, so the photon source is unchanged.
 *
 * Each subnamespace returns either an upstream Cloudflare type or a thin
 * proxy with the same shape. We use `unknown` here to avoid a hard runtime
 * dep on `@cloudflare/workers-types`; users who import those types get
 * structural compatibility automatically.
 */
export interface CFRuntime {
  r2(name: string): unknown;
  kv(name: string): unknown;
  d1(name: string): unknown;
  queue(name: string): unknown;
  vectorize(name: string): unknown;
  ai: unknown;
  images: unknown;
  browser: unknown;
  do(name: string): unknown;
  fetch(input: unknown, init?: unknown): Promise<unknown>;
}

const HINT =
  'No Cloudflare runtime is configured. Either run this photon under a ' +
  'CF-aware host (local Beam with miniflare, or deployed to Cloudflare ' +
  'Workers), declare `protected cf = { ... }` on the class, or remove ' +
  'the `this.cf` usage.';

function throwingFn(category: string): (...args: unknown[]) => never {
  return (..._args: unknown[]) => {
    throw new Error(`this.cf.${category}() called but ${HINT}`);
  };
}

function throwingProperty(category: string): unknown {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') {
        return () => `[unconfigured this.cf.${category}]`;
      }
      throw new Error(`this.cf.${category}.${String(prop)} accessed but ${HINT}`);
    },
  });
}

/**
 * Returns a stub `CFRuntime` whose subnamespaces throw a helpful error
 * when used. Provided so `this.cf` always returns a defined object even
 * when no runtime adapter has been injected — the error fires at the
 * point of use rather than at property access.
 */
export function notConfiguredCF(): CFRuntime {
  return {
    r2: throwingFn('r2'),
    kv: throwingFn('kv'),
    d1: throwingFn('d1'),
    queue: throwingFn('queue'),
    vectorize: throwingFn('vectorize'),
    ai: throwingProperty('ai'),
    images: throwingProperty('images'),
    browser: throwingProperty('browser'),
    do: throwingFn('do'),
    fetch: throwingFn('fetch') as CFRuntime['fetch'],
  };
}
