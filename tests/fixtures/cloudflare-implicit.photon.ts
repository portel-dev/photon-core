/**
 * Plain class that uses `this.cf.*` without declaring a constructor
 * param of type `Cloudflare`. The loader's forgiving auto-inject path
 * is expected to populate `instance.cf` after construction so the call
 * works without the user having to wire the import + ctor param.
 */
export default class ImplicitCF {
  /**
   * Stores a value — the loader auto-injects `this.cf` because it
   * detects the member access in source.
   */
  async store(params: { key: string; value: string }): Promise<{ key: string }> {
    await (this as unknown as { cf: { kv: () => { put: (k: string, v: string) => Promise<void> } } }).cf.kv().put(params.key, params.value);
    return { key: params.key };
  }
}
