/**
 * Counter service — tracks counts per key.
 * @stateful
 */
export default class CounterService {
  private counts: Record<string, number> = {};

  async increment(params: { key: string }): Promise<{ key: string; count: number }> {
    this.counts[params.key] = (this.counts[params.key] || 0) + 1;
    return { key: params.key, count: this.counts[params.key] };
  }

  async get(params: { key: string }): Promise<{ key: string; count: number }> {
    return { key: params.key, count: this.counts[params.key] || 0 };
  }
}
