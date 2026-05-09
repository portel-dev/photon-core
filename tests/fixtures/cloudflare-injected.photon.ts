/**
 * Photon that depends on a Cloudflare runtime via constructor
 * injection. The import line is the deploy-target signal: this photon
 * cannot run outside a CF-aware host (or one that supplies a stub).
 */
import type { Cloudflare, CloudflareEnv } from '../../src/index.js';

export default class CFGallery {
  constructor(
    private cf: Cloudflare,
    private cfEnv: CloudflareEnv,
  ) {}

  /** Calls `cf.kv()` which auto-resolves to `cfgallery_kv`. */
  async storeKey(params: { key: string; value: string }): Promise<{ key: string }> {
    await this.cf.kv().put(params.key, params.value);
    return { key: params.key };
  }

  /** Reaches into the raw env (escape hatch). */
  async readEnvKey(params: { name: string }): Promise<{ value: unknown }> {
    return { value: (this.cfEnv as Record<string, unknown>)[params.name] };
  }
}
