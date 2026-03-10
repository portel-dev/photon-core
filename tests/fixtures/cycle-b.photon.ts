/**
 * Circular dependency test: B depends on A
 * @photon a ./cycle-a.photon.ts
 */
export default class CycleB {
  constructor(private a: any) {}

  async pong() {
    return 'b';
  }
}
