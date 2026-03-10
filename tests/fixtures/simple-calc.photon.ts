/**
 * A simple calculator photon for testing basic load.
 */
export default class Calculator {
  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }

  /**
   * Multiply two numbers
   * @param a First number
   * @param b Second number
   */
  async multiply(params: { a: number; b: number }) {
    return params.a * params.b;
  }
}
