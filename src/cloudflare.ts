/**
 * Cloudflare — wrapped, auto-named CF surface injected via constructor.
 *
 * Where `CloudflareEnv<T>` exposes the raw Worker `env` (escape hatch for
 * service bindings, exotic features, anything we don't wrap), `Cloudflare`
 * is the ergonomic 95% path: photons call `cf.kv()` / `cf.r2()` / etc.
 * with optional qualifier strings, and the runtime resolves bindings by
 * the **photon name + suffix** convention — so authors never pick names
 * that could collide across photons.
 *
 * Importing `Cloudflare` (or `CloudflareEnv`) into a photon's source is
 * the explicit signal that the photon depends on a Cloudflare deploy
 * target. Outside of CF (or its local miniflare mirror), the loader
 * injects a throwing Proxy and the message names the imported symbol so
 * the diagnostic is unambiguous.
 *
 * @example
 * ```ts
 * import type { Photon, Cloudflare } from "@portel/photon";
 *
 * export class Gallery {
 *   constructor(
 *     private photon: Photon,
 *     private cf: Cloudflare,
 *   ) {}
 *   async upload(name: string, blob: Blob) {
 *     await this.cf.r2().put(name, blob);             // gallery_r2
 *     await this.cf.d1().prepare("...").bind(name).run(); // gallery_d1
 *     await this.photon.memory.set(name, Date.now());
 *   }
 * }
 * ```
 *
 * Multi-resource case — qualifier namespaces under the photon:
 * ```ts
 * this.cf.kv()           // gallery_kv      (default for this photon)
 * this.cf.kv("cache")    // gallery_cache_kv
 * this.cf.kv("sessions") // gallery_sessions_kv
 * ```
 *
 * Override path stays in `protected cfBindings = { ... }` — present only
 * when an author needs to point a named binding at a pre-existing CF
 * resource owned outside the photon.
 */

import {
  type R2BucketLike,
  type KVNamespaceLike,
  type D1DatabaseLike,
  type QueueLike,
  type VectorizeIndexLike,
  type AiLike,
  type ImagesBindingLike,
  type FetcherLike,
} from './cf.js';

/**
 * The wrapped Cloudflare surface. Methods that take a resource type
 * (kv, r2, d1, queue, vectorize) accept an **optional** qualifier — when
 * omitted, the runtime resolves the photon's default binding for that
 * category. AI / images / browser are single shared bindings per Worker
 * and have no qualifier.
 */
export interface Cloudflare {
  /** Resolves to `<photonName>_kv` (default) or `<photonName>_<qualifier>_kv`. */
  kv(qualifier?: string): KVNamespaceLike;
  /** Resolves to `<photonName>_r2` (default) or `<photonName>_<qualifier>_r2`. */
  r2(qualifier?: string): R2BucketLike;
  /** Resolves to `<photonName>_d1` (default) or `<photonName>_<qualifier>_d1`. */
  d1(qualifier?: string): D1DatabaseLike;
  /** Resolves to `<photonName>_queue` (default) or `<photonName>_<qualifier>_queue`. */
  queue<Body = unknown>(qualifier?: string): QueueLike<Body>;
  /** Resolves to `<photonName>_vectorize` (default) or `<photonName>_<qualifier>_vectorize`. */
  vectorize(qualifier?: string): VectorizeIndexLike;
  /** Workers AI — shared `AI` binding. */
  readonly ai: AiLike;
  /** Cloudflare Images — shared `IMAGES` binding. */
  readonly images: ImagesBindingLike;
  /** Browser Rendering — shared `BROWSER` binding. */
  readonly browser: FetcherLike;
  /** Top-level fetch (with optional service-binding routing). */
  fetch(input: string, init?: unknown): Promise<unknown>;
}

/**
 * Categories that are scoped per-photon and use the auto-naming
 * convention. Shared categories (ai, images, browser) live outside this
 * list and resolve to fixed binding names.
 */
export type ScopedBindingCategory = 'kv' | 'r2' | 'd1' | 'queue' | 'vectorize';

/**
 * Build the env binding name for a scoped category on a given photon.
 * Default (no qualifier): `<photon>_<category>` (e.g. `gallery_kv`).
 * With qualifier: `<photon>_<qualifier>_<category>` (e.g. `gallery_cache_kv`).
 *
 * The helper is exported so deploy-side codegen (wrangler.toml emission)
 * uses the same naming rule the runtime resolves with.
 */
export function bindingNameFor(
  photonName: string,
  category: ScopedBindingCategory,
  qualifier?: string,
): string {
  const safePhoton = photonName.toLowerCase().replace(/-/g, '_');
  if (qualifier && qualifier.length > 0) {
    const safeQualifier = qualifier.toLowerCase().replace(/-/g, '_');
    return `${safePhoton}_${safeQualifier}_${category}`;
  }
  return `${safePhoton}_${category}`;
}

/** Fixed binding name for a shared category. */
export const SHARED_AI_BINDING = 'AI';
export const SHARED_IMAGES_BINDING = 'IMAGES';
export const SHARED_BROWSER_BINDING = 'BROWSER';

const CF_HINT =
  'This photon imports `Cloudflare` from "@portel/photon" but no CF ' +
  'runtime is attached. Run via `photon host run` (miniflare-backed) ' +
  'or deploy with `photon host deploy cloudflare`. Outside CF, this ' +
  'photon\'s CF-dependent methods cannot execute.';

/**
 * Throwing-Proxy fallback. Used by the loader when a photon's
 * constructor types a `Cloudflare` parameter but no CF runtime was
 * provided (e.g. unit tests that didn't pass a stub, or local hosts
 * without miniflare configured).
 */
export function notConfiguredCloudflare(): Cloudflare {
  const throwing = (label: string) => (..._args: unknown[]) => {
    throw new Error(`Cloudflare.${label} called but ${CF_HINT}`);
  };
  const throwingProp = (label: string) =>
    new Proxy(Object.create(null), {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive || prop === 'toString') {
          return () => `[unconfigured Cloudflare.${label}]`;
        }
        throw new Error(`Cloudflare.${label}.${String(prop)} accessed but ${CF_HINT}`);
      },
    });
  return {
    kv: throwing('kv') as Cloudflare['kv'],
    r2: throwing('r2') as Cloudflare['r2'],
    d1: throwing('d1') as Cloudflare['d1'],
    queue: throwing('queue') as Cloudflare['queue'],
    vectorize: throwing('vectorize') as Cloudflare['vectorize'],
    ai: throwingProp('ai') as unknown as AiLike,
    images: throwingProp('images') as unknown as ImagesBindingLike,
    browser: throwingProp('browser') as unknown as FetcherLike,
    fetch: throwing('fetch') as Cloudflare['fetch'],
  };
}

/**
 * Build a `Cloudflare` surface backed directly by a Worker `env` (the
 * deployed-CF case). Resolves auto-named bindings via the convention in
 * `bindingNameFor`. Local hosts use the miniflare-backed factory in the
 * photon repo's `runtime/cf-local.ts` instead.
 *
 * `env` is typed loosely so this module stays free of
 * `@cloudflare/workers-types`. The deployed Worker template passes the
 * real `env` straight through.
 */
export function createCloudflareFromEnv(
  env: Record<string, unknown>,
  photonName: string,
): Cloudflare {
  const scoped = (category: ScopedBindingCategory) => (qualifier?: string) => {
    const name = bindingNameFor(photonName, category, qualifier);
    const binding = env[name];
    if (binding === undefined) {
      throw new Error(
        `Cloudflare.${category}(${qualifier ? JSON.stringify(qualifier) : ''}) ` +
          `requires binding "${name}" on the Worker env, but it is not defined. ` +
          `Add it to wrangler.toml (or run \`photon host deploy cloudflare\` to ` +
          `regenerate bindings from the photon's declarations).`,
      );
    }
    return binding;
  };
  return {
    kv: scoped('kv') as Cloudflare['kv'],
    r2: scoped('r2') as Cloudflare['r2'],
    d1: scoped('d1') as Cloudflare['d1'],
    queue: scoped('queue') as Cloudflare['queue'],
    vectorize: scoped('vectorize') as Cloudflare['vectorize'],
    ai: (env[SHARED_AI_BINDING] ?? notConfiguredCloudflare().ai) as AiLike,
    images: (env[SHARED_IMAGES_BINDING] ?? notConfiguredCloudflare().images) as ImagesBindingLike,
    browser: (env[SHARED_BROWSER_BINDING] ?? notConfiguredCloudflare().browser) as FetcherLike,
    fetch: (input: string, init?: unknown) => {
      const fetcher = env['fetch'] as ((i: string, n?: unknown) => Promise<unknown>) | undefined;
      if (typeof fetcher === 'function') return fetcher(input, init);
      return fetch(input, init as RequestInit | undefined) as Promise<unknown>;
    },
  };
}
