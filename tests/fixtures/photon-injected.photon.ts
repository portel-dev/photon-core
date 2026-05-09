/**
 * Photon that consumes runtime capabilities through constructor
 * injection rather than `extends Photon`. Used by
 * tests/photon-injection.test.ts to exercise the loader's
 * `'photonRuntime'` injection case.
 */
import type { Photon } from '../../src/index.js';

export default class InjectedNotes {
  constructor(private photon: Photon) {}

  /**
   * Round-trips a value through `this.photon.memory` so the test can
   * confirm the injected runtime is wired to the same scope an
   * `extends Photon` consumer would see.
   * @param key Memory key
   * @param value Value to store
   */
  async write(params: { key: string; value: string }): Promise<{ stored: string }> {
    await this.photon.memory.set(params.key, params.value);
    return { stored: params.value };
  }

  /** Read back a value previously written via `write`. */
  async read(params: { key: string }): Promise<{ value: unknown }> {
    return { value: await this.photon.memory.get(params.key) };
  }

  /** Names the photon — proves `_photonName` was wired through. */
  async whoami(): Promise<{ name: string | undefined }> {
    return { name: (this.photon as { _photonName?: string })._photonName };
  }
}
