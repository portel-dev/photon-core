/**
 * A photon that depends on child via @photon injection.
 *
 * @photon child ./child.photon.ts
 */
export default class Parent {
  constructor(private child: any) {}

  /**
   * Delegate to child
   * @param a First number
   * @param b Second number
   */
  async addViaChild(params: { a: number; b: number }) {
    return this.child.add(params);
  }
}
