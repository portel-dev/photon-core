/**
 * A photon with @cached middleware for testing.
 */
export default class CachedTool {
  private callCount = 0;

  /**
   * Returns incrementing call count, but should be cached.
   * @cached 10s
   */
  async expensive(params: { key: string }) {
    this.callCount++;
    return { key: params.key, callCount: this.callCount };
  }
}
