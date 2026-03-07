/**
 * Tests for constraint validation and fail-safe mechanisms in schema-extractor
 * Ensures fixes don't have side effects and work correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemaExtractor } from '../src/schema-extractor';

// Capture console.warn calls for testing
let warnMessages: string[] = [];
const originalWarn = console.warn;

beforeEach(() => {
  warnMessages = [];
  console.warn = (...args: any[]) => {
    warnMessages.push(args.map(a => String(a)).join(' '));
  };
});

afterEach(() => {
  console.warn = originalWarn;
});

describe('SchemaExtractor - Constraint Validation', () => {
  // Helper to extract schema for testing
  function extractSchemaFromSource(source: string): any {
    const extractor = new SchemaExtractor();
    const metadata = extractor.extractAllFromSource(source);
    return metadata;
  }

  describe('Phase 1: Critical Constraints', () => {
    // ========================================================================
    // Issue 2.1: @min > @max Validation
    // ========================================================================
    describe('@min > @max validation', () => {
      it('should warn when @min > @max', () => {
        const source = `
          export default class Test {
            /**
             * @param age {@min 100} {@max 10}
             */
            setAge(age: number) {}
          }
        `;
        extractSchemaFromSource(source);
        expect(warnMessages.some(msg => msg.includes('@min') && msg.includes('@max'))).toBe(true);
      });

      it('should apply @min and skip @max when min > max', () => {
        const source = `
          export default class Test {
            /**
             * @param count {@min 50} {@max 10}
             */
            setCount(count: number) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const countProp = method.inputSchema.properties.count;

        // Should have minimum from @min
        expect(countProp.minimum).toBe(50);
        // Should NOT have maximum from @max (skipped due to validation)
        expect(countProp.maximum).toBeUndefined();
      });

      it('should not warn when @min <= @max', () => {
        const source = `
          export default class Test {
            /**
             * @param count {@min 10} {@max 50}
             */
            setCount(count: number) {}
          }
        `;
        warnMessages = []; // Reset
        extractSchemaFromSource(source);
        expect(warnMessages.some(msg => msg.includes('@min') && msg.includes('@max'))).toBe(false);
      });

      it('should apply both @min and @max when valid', () => {
        const source = `
          export default class Test {
            /**
             * @param count {@min 10} {@max 100}
             */
            setCount(count: number) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const countProp = method.inputSchema.properties.count;

        expect(countProp.minimum).toBe(10);
        expect(countProp.maximum).toBe(100);
      });

      it('should handle string minLength/maxLength correctly', () => {
        const source = `
          export default class Test {
            /**
             * @param email {@min 100} {@max 10}
             */
            setEmail(email: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const emailProp = method.inputSchema.properties.email;

        // Should warn about min > max
        expect(warnMessages.some(msg => msg.includes('@min') && msg.includes('@max'))).toBe(true);
        // Should have minLength but not maxLength
        expect(emailProp.minLength).toBe(100);
        expect(emailProp.maxLength).toBeUndefined();
      });

      it('should handle array minItems/maxItems correctly', () => {
        const source = `
          export default class Test {
            /**
             * @param items {@min 50} {@max 5}
             */
            setItems(items: string[]) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const itemsProp = method.inputSchema.properties.items;

        expect(itemsProp.minItems).toBe(50);
        expect(itemsProp.maxItems).toBeUndefined();
      });
    });

    // ========================================================================
    // Issue 4.1: @pattern Regex Validation
    // ========================================================================
    describe('@pattern regex validation', () => {
      it('should warn for invalid regex in @pattern', () => {
        const source = `
          export default class Test {
            /**
             * @param code {@pattern [invalid-regex}
             */
            setCode(code: string) {}
          }
        `;
        extractSchemaFromSource(source);
        expect(warnMessages.some(msg => msg.includes('@pattern') && msg.includes('Invalid regex'))).toBe(true);
      });

      it('should NOT apply invalid @pattern to schema', () => {
        const source = `
          export default class Test {
            /**
             * @param code {@pattern [invalid}
             */
            setCode(code: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const codeProp = method.inputSchema.properties.code;

        // Should not have pattern property when regex is invalid
        expect(codeProp.pattern).toBeUndefined();
      });

      it('should apply valid @pattern to schema', () => {
        const source = `
          export default class Test {
            /**
             * @param email {@pattern ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$}
             */
            setEmail(email: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const emailProp = method.inputSchema.properties.email;

        expect(emailProp.pattern).toBe('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$');
      });

      it('should handle complex regex patterns', () => {
        const source = `
          export default class Test {
            /**
             * @param uuid {@pattern ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$}
             */
            setUuid(uuid: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const uuidProp = method.inputSchema.properties.uuid;

        expect(uuidProp.pattern).toBeDefined();
        // Verify the pattern can be compiled
        expect(() => new RegExp(uuidProp.pattern)).not.toThrow();
      });

      it('should not affect other constraints when @pattern is invalid', () => {
        const source = `
          export default class Test {
            /**
             * @param code {@pattern [invalid} {@min 3} {@max 10}
             */
            setCode(code: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const codeProp = method.inputSchema.properties.code;

        // Pattern should not be applied
        expect(codeProp.pattern).toBeUndefined();
        // But min/max should still work
        expect(codeProp.minLength).toBe(3);
        expect(codeProp.maxLength).toBe(10);
      });
    });

    // ========================================================================
    // Issue 9.1: @multipleOf Validation
    // ========================================================================
    describe('@multipleOf validation', () => {
      it('should warn for @multipleOf <= 0', () => {
        const source = `
          export default class Test {
            /**
             * @param quantity {@multipleOf 0}
             */
            setQuantity(quantity: number) {}
          }
        `;
        extractSchemaFromSource(source);
        expect(warnMessages.some(msg => msg.includes('@multipleOf') && msg.includes('Must be positive'))).toBe(true);
      });

      it('should NOT apply invalid @multipleOf to schema', () => {
        const source = `
          export default class Test {
            /**
             * @param quantity {@multipleOf 0}
             */
            setQuantity(quantity: number) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const qtyProp = method.inputSchema.properties.quantity;

        expect(qtyProp.multipleOf).toBeUndefined();
      });

      it('should warn for negative @multipleOf', () => {
        const source = `
          export default class Test {
            /**
             * @param quantity {@multipleOf -5}
             */
            setQuantity(quantity: number) {}
          }
        `;
        extractSchemaFromSource(source);
        expect(warnMessages.some(msg => msg.includes('@multipleOf'))).toBe(true);
      });

      it('should apply valid positive @multipleOf', () => {
        const source = `
          export default class Test {
            /**
             * @param quantity {@multipleOf 5}
             */
            setQuantity(quantity: number) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const qtyProp = method.inputSchema.properties.quantity;

        expect(qtyProp.multipleOf).toBe(5);
      });

      it('should handle decimal @multipleOf values', () => {
        const source = `
          export default class Test {
            /**
             * @param price {@multipleOf 0.01}
             */
            setPrice(price: number) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const priceProp = method.inputSchema.properties.price;

        expect(priceProp.multipleOf).toBe(0.01);
      });

      it('should not affect other constraints when @multipleOf is invalid', () => {
        const source = `
          export default class Test {
            /**
             * @param quantity {@multipleOf 0} {@min 1} {@max 100}
             */
            setQuantity(quantity: number) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];
        const qtyProp = method.inputSchema.properties.quantity;

        // multipleOf should not be applied
        expect(qtyProp.multipleOf).toBeUndefined();
        // But other constraints should work
        expect(qtyProp.minimum).toBe(1);
        expect(qtyProp.maximum).toBe(100);
      });
    });

    // ========================================================================
    // Issue 12.1: @validate Field Validation
    // ========================================================================
    describe('@validate parameter validation', () => {
      it('should warn when @validate references non-existent field', () => {
        const source = `
          export default class Test {
            /**
             * @param email Email address
             * @validate pasword must be at least 8 characters
             */
            register(email: string) {}
          }
        `;
        extractSchemaFromSource(source);
        expect(warnMessages.some(msg => msg.includes('pasword') && msg.includes('non-existent'))).toBe(true);
      });

      it('should NOT include validation for non-existent field', () => {
        const source = `
          export default class Test {
            /**
             * @param email Email address
             * @validate pasword must be at least 8 characters
             */
            register(email: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];

        // Should have no validations since the field doesn't exist
        expect(method.validations).toBeUndefined();
      });

      it('should include validation for existing field', () => {
        const source = `
          export default class Test {
            /**
             * @param email Email address
             * @validate email must be valid
             */
            register(email: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];

        // Should have validations for the existing field
        expect(method.validations).toBeDefined();
        expect(method.validations[0].field).toBe('email');
      });

      it('should warn with list of available parameters', () => {
        const source = `
          export default class Test {
            /**
             * @param email Email
             * @param password Password
             * @validate userName must exist
             */
            register(email: string, password: string) {}
          }
        `;
        extractSchemaFromSource(source);
        const warnMsg = warnMessages.find(msg => msg.includes('userName'));
        expect(warnMsg).toContain('email');
        expect(warnMsg).toContain('password');
      });

      it('should handle multiple validations with mixed valid/invalid fields', () => {
        const source = `
          export default class Test {
            /**
             * @param email Email
             * @param password Password
             * @validate email must be valid
             * @validate userName must exist
             * @validate password must be secure
             */
            register(email: string, password: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];

        // Should have 2 validations (email and password, not userName)
        expect(method.validations?.length).toBe(2);
        const fields = method.validations.map((v: any) => v.field);
        expect(fields).toContain('email');
        expect(fields).toContain('password');
        expect(fields).not.toContain('userName');
      });

      it('should not affect other metadata when validation is skipped', () => {
        const source = `
          export default class Test {
            /**
             * @param email Email {@format email}
             * @validate userName must exist
             */
            register(email: string) {}
          }
        `;
        const schema = extractSchemaFromSource(source);
        const method = schema.tools[0];

        // Email constraint should still be applied
        expect(method.inputSchema.properties.email.format).toBe('email');
        // But validation should be skipped
        expect(method.validations).toBeUndefined();
      });
    });
  });

  describe('Edge Cases and Side Effects', () => {
    it('should handle multiple constraints on same parameter', () => {
      const source = `
        export default class Test {
          /**
           * @param age {@min 18} {@max 120} {@multipleOf 1}
           */
          setAge(age: number) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const method = schema.tools[0];
      const ageProp = method.inputSchema.properties.age;

      expect(ageProp.minimum).toBe(18);
      expect(ageProp.maximum).toBe(120);
      expect(ageProp.multipleOf).toBe(1);
    });

    it('should not warn multiple times for same issue', () => {
      const source = `
        export default class Test {
          /**
           * @param val1 {@min 100} {@max 10}
           * @param val2 {@min 50} {@max 5}
           */
          test(val1: number, val2: number) {}
        }
      `;
      extractSchemaFromSource(source);
      const warnCount = warnMessages.filter(msg => msg.includes('@min') && msg.includes('@max')).length;
      expect(warnCount).toBe(2); // One for each parameter
    });

    it('should apply constraints correctly even with malformed JSDoc', () => {
      const source = `
        export default class Test {
          /**
           * @param email {@pattern ^[a-z]+$}   extra spaces
           * @param count {@min 10}  {@max 20}
           */
          test(email: string, count: number) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const method = schema.tools[0];

      expect(method.inputSchema.properties.email.pattern).toBeDefined();
      expect(method.inputSchema.properties.count.minimum).toBe(10);
      expect(method.inputSchema.properties.count.maximum).toBe(20);
    });

    it('should preserve other properties when constraint validation fails', () => {
      const source = `
        export default class Test {
          /**
           * @param code Code {@pattern [invalid} {@label "Product Code"} {@placeholder "SKU-123"}
             */
          test(code: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const method = schema.tools[0];
      const codeProp = method.inputSchema.properties.code;

      // Invalid pattern should not be applied
      expect(codeProp.pattern).toBeUndefined();
      // But other properties should still be there (if schema-extractor supports them)
      expect(codeProp.description).toBeDefined();
    });
  });
});
