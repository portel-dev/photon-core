/**
 * CloudflareEnv — raw Cloudflare Worker `env`, surfaced as an explicit
 * constructor injection so the import line itself signals that the
 * importing photon depends on a Cloudflare deploy target.
 *
 * @example
 * ```ts
 * import type { CloudflareEnv } from "@portel/photon";
 *
 * interface MyBindings {
 *   WEATHER_KV: KVNamespace;
 *   PHOTOS: R2Bucket;
 * }
 *
 * export class Weather {
 *   constructor(private env: CloudflareEnv<MyBindings>) {}
 *   async forecast() {
 *     await this.env.WEATHER_KV.put("k", "v");
 *   }
 * }
 * ```
 *
 * The default loose type (`Record<string, unknown>`) keeps the no-types
 * path working. Authors who want strict binding shapes pass their own
 * type parameter; future codegen from `protected cfBindings` can fill
 * this in automatically.
 */
export type CloudflareEnv<T = Record<string, unknown>> = T;
