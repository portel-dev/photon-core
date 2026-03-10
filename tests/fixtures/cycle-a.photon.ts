/**
 * Circular dependency test: A depends on B
 * @photon b ./cycle-b.photon.ts
 */
export default class CycleA {
  constructor(private b: any) {}

  async ping() {
    return 'a';
  }
}
