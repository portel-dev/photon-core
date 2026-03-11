/**
 * Orchestrator — composes counter and logger services via this.call().
 *
 * Plain class — gets this.call() injected by withPhotonCapabilities.
 */
export default class Orchestrator {
  async track(params: { key: string }): Promise<{ key: string; count: number; logged: boolean }> {
    // Increment counter via cross-photon call
    const result = await (this as any).call('counter-service.increment', { key: params.key });

    // Log the action
    await (this as any).call('logger-service.log', {
      message: `Incremented ${params.key} to ${result.count}`,
    });

    return { key: params.key, count: result.count, logged: true };
  }

  async status(): Promise<{ counterValue: number; logCount: number }> {
    const counter = await (this as any).call('counter-service.get', { key: 'default' });
    const logs = await (this as any).call('logger-service.entries', {});
    return { counterValue: counter.count, logCount: logs.length };
  }
}
