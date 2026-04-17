/**
 * Photon with onError + onShutdown for lifecycle parity tests.
 *
 * Events are stored on globalThis so the test file and the compiled
 * photon module both see the same array (the lite loader compiles and
 * imports its own copy, which is not identity-equal to `import` from
 * the test).
 */
type Event = { type: string; payload: any };

function events(): Event[] {
  const g = globalThis as any;
  if (!g.__PHOTON_LIFECYCLE_EVENTS__) g.__PHOTON_LIFECYCLE_EVENTS__ = [] as Event[];
  return g.__PHOTON_LIFECYCLE_EVENTS__;
}

export default class LifecyclePhoton {
  async doWork(params: { ok?: boolean }) {
    if (params.ok === false) throw new Error('intentional');
    return { result: 'ok' };
  }

  async onError(err: unknown, ctx: { tool: string; params: any }) {
    events().push({
      type: 'error',
      payload: { tool: ctx.tool, msg: (err as Error).message },
    });
  }

  async onShutdown(ctx?: { reason?: string }) {
    events().push({ type: 'shutdown', payload: { reason: ctx?.reason } });
  }
}
