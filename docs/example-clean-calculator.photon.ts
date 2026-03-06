/**
 * Clean Calculator Example
 *
 * Demonstrates the clean classes pattern - no inheritance needed!
 *
 * This photon gets all Photon framework capabilities automatically:
 * - this.emit() for events
 * - this.memory for storage
 * - this.call() for cross-photon communication
 * - this.mcp() for external MCP server access
 *
 * @description A simple calculator that demonstrates clean classes
 * @tags math,example,clean-classes
 */

export default class Calculator {
  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   * @returns Sum of a and b
   */
  async add(a: number, b: number) {
    const result = a + b;
    this.emit({ operation: 'add', a, b, result });
    return result;
  }

  /**
   * Multiply two numbers
   * @param a First number
   * @param b Second number
   * @returns Product of a and b
   */
  async multiply(a: number, b: number) {
    const result = a * b;
    this.emit({ operation: 'multiply', a, b, result });
    return result;
  }

  /**
   * Calculate with history using memory
   * @param a First number
   * @param b Second number
   * @returns Result with calculation count
   */
  async addWithHistory(a: number, b: number) {
    const result = a + b;

    // Use memory to track calculation count
    let count = this.memory.get('calculation_count') || 0;
    count++;
    this.memory.set('calculation_count', count);

    this.emit({
      operation: 'add_with_history',
      a,
      b,
      result,
      total_calculations: count,
    });

    return { result, total_calculations: count };
  }

  /**
   * Get statistics from memory
   * @returns Calculation statistics
   */
  async getStats() {
    const count = this.memory.get('calculation_count') || 0;
    const lastResult = this.memory.get('last_result');

    return {
      total_calculations: count,
      last_result: lastResult,
    };
  }
}
