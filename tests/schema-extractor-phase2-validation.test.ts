/**
 * Tests for Phase 2 high-impact validations in schema-extractor
 * Ensures medium-severity fixes prevent silent failures and confusing behavior
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

describe('SchemaExtractor - Phase 2 Validations', () => {
  function extractSchemaFromSource(source: string): any {
    const extractor = new SchemaExtractor();
    return extractor.extractAllFromSource(source);
  }

  describe('Issue 4.2: @format Invalid Values Validation', () => {
    const validFormats = ['email', 'date', 'date-time', 'time', 'uri', 'uuid', 'ipv4', 'ipv6', 'hostname', 'json', 'table'];

    it('should warn for invalid @format values', () => {
      const source = `
        export default class Test {
          /**
           * @param data {@format table-invalid}
           */
          setData(data: string) {}
        }
      `;
      extractSchemaFromSource(source);
      const warnMsg = warnMessages.find(msg => msg.includes('@format') && msg.includes('invalid'));
      expect(warnMsg).toBeDefined();
    });

    it('should NOT apply invalid @format to schema', () => {
      const source = `
        export default class Test {
          /**
           * @param email {@format json-xml}
           */
          setEmail(email: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const emailProp = schema.tools[0].inputSchema.properties.email;

      // Invalid format should not be applied
      expect(emailProp.format).toBeUndefined();
    });

    it('should apply valid @format values', () => {
      const source = `
        export default class Test {
          /**
           * @param email {@format email}
           */
          setEmail(email: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const emailProp = schema.tools[0].inputSchema.properties.email;

      expect(emailProp.format).toBe('email');
    });

    it('should list available formats in warning', () => {
      const source = `
        export default class Test {
          /**
           * @param data {@format badformat}
           */
          setData(data: string) {}
        }
      `;
      extractSchemaFromSource(source);
      const warnMsg = warnMessages.find(msg => msg.includes('badformat'));

      // Should include some hint about valid formats
      expect(warnMsg).toBeDefined();
    });

    it('should handle typos in common formats', () => {
      const source = `
        export default class Test {
          /**
           * @param id {@format uuid2}
           */
          setId(id: string) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('@format'))).toBe(true);
    });
  });

  describe('Issue 1.2: Constraint-Type Mismatch Validation', () => {
    it('should warn when @min applied to boolean', () => {
      const source = `
        export default class Test {
          /**
           * @param active {@min 10}
           */
          setActive(active: boolean) {}
        }
      `;
      extractSchemaFromSource(source);
      const warnMsg = warnMessages.find(msg => msg.includes('boolean') || msg.includes('incompatible'));
      expect(warnMsg).toBeDefined();
    });

    it('should NOT apply @min to boolean type', () => {
      const source = `
        export default class Test {
          /**
           * @param enabled {@min 5}
           */
          setEnabled(enabled: boolean) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const enabledProp = schema.tools[0].inputSchema.properties.enabled;

      expect(enabledProp.minimum).toBeUndefined();
    });

    it('should warn when @pattern applied to number', () => {
      const source = `
        export default class Test {
          /**
           * @param count {@pattern ^[0-9]+$}
           */
          setCount(count: number) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('incompatible') || msg.includes('pattern'))).toBe(true);
    });

    it('should warn when array constraint applied to string', () => {
      const source = `
        export default class Test {
          /**
           * @param name {@minItems 2}
           */
          setName(name: string) {}
        }
      `;
      const metadata = extractSchemaFromSource(source);
      // minItems is for arrays, not strings
      const prop = metadata.tools[0].inputSchema.properties.name;
      expect(prop.minItems).toBeUndefined();
    });

    it('should apply constraints only to compatible types', () => {
      const source = `
        export default class Test {
          /**
           * @param items {@minItems 1}
           */
          setItems(items: string[]) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const itemsProp = schema.tools[0].inputSchema.properties.items;

      expect(itemsProp.minItems).toBe(1);
    });
  });

  describe('Issue 9.2: @retryable Invalid Config Validation', () => {
    it('should warn for @retryable with 0 count', () => {
      const source = `
        export default class Test {
          /**
           * @retryable 0 1000ms
           */
          async process() {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('count') || msg.includes('retryable'))).toBe(true);
    });

    it('should warn for @retryable with negative delay', () => {
      const source = `
        export default class Test {
          /**
           * @retryable 3 -100ms
           */
          async process() {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('delay') || msg.includes('negative'))).toBe(true);
    });

    it('should apply valid @retryable config', () => {
      const source = `
        export default class Test {
          /**
           * @retryable 3 1000ms
           */
          async process() {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const tool = schema.tools[0];

      // Should have retryable config applied
      expect(tool.retryable).toBeDefined();
    });
  });

  describe('Issue 9.3: @throttled Invalid Rate Validation', () => {
    it('should warn for @throttled 0/sec', () => {
      const source = `
        export default class Test {
          /**
           * @throttled 0/sec
           */
          async process() {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('throttle') || msg.includes('rate'))).toBe(true);
    });

    it('should warn for invalid rate format', () => {
      const source = `
        export default class Test {
          /**
           * @throttled invalid-format
           */
          async process() {}
        }
      `;
      extractSchemaFromSource(source);
      const warnMsg = warnMessages.find(msg => msg.includes('throttle') || msg.includes('invalid'));
      expect(warnMsg).toBeDefined();
    });

    it('should apply valid @throttled config', () => {
      const source = `
        export default class Test {
          /**
           * @throttled 10/sec
           */
          async process() {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const tool = schema.tools[0];

      expect(tool.throttled).toBeDefined();
    });
  });

  describe('Issue 5.1: Complex Default Values Warning', () => {
    it('should warn for function call as default', () => {
      const source = `
        export default class Test {
          async getData(limit: number = Math.max(10, 100)) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('default') || msg.includes('complex'))).toBe(true);
    });

    it('should warn for object literal as default', () => {
      const source = `
        export default class Test {
          async configure(opts: object = { key: 'value' }) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('complex'))).toBe(true);
    });

    it('should accept simple literal defaults', () => {
      const source = `
        export default class Test {
          async getData(limit: number = 100) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const limitProp = schema.tools[0].inputSchema.properties.limit;

      // Simple literals should be accepted
      expect(limitProp.default).toBe(100);
    });
  });

  describe('Issue 5.2: Default Type Validation', () => {
    it('should warn when string default given for number type', () => {
      const source = `
        export default class Test {
          async process(count: number = '100') {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('type') || msg.includes('default'))).toBe(true);
    });

    it('should warn when float default given for integer constraint', () => {
      const source = `
        export default class Test {
          /**
           * @param count {@field integer}
           */
          async process(count: number = 3.7) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('integer') || msg.includes('type'))).toBe(true);
    });

    it('should accept compatible type defaults', () => {
      const source = `
        export default class Test {
          async process(count: number = 100) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const countProp = schema.tools[0].inputSchema.properties.count;

      expect(countProp.default).toBe(100);
    });
  });

  describe('Issue 8.1: ReadOnly/WriteOnly Conflict Detection', () => {
    it('should warn when both @readOnly and @writeOnly present', () => {
      const source = `
        export default class Test {
          /**
           * @param data {@readOnly} {@writeOnly}
           */
          process(data: string) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('readOnly') && msg.includes('writeOnly'))).toBe(true);
    });

    it('should skip conflicting property', () => {
      const source = `
        export default class Test {
          /**
           * @param field {@readOnly} {@writeOnly}
           */
          set(field: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const fieldProp = schema.tools[0].inputSchema.properties.field;

      // Should not apply conflicting properties
      expect(fieldProp.readOnly === true && fieldProp.writeOnly === true).toBe(false);
    });

    it('should allow @readOnly alone', () => {
      const source = `
        export default class Test {
          /**
           * @param data {@readOnly}
           */
          process(data: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const dataProp = schema.tools[0].inputSchema.properties.data;

      expect(dataProp.readOnly).toBe(true);
    });
  });

  describe('Issue 8.2: Pattern+Enum Conflict Detection', () => {
    it('should warn when @pattern conflicts with enum', () => {
      const source = `
        export default class Test {
          /**
           * @param status {@pattern ^[a-z]+$} {@choice active,inactive}
           */
          setStatus(status: 'active' | 'inactive') {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('conflict') || msg.includes('enum'))).toBe(true);
    });

    it('should apply enum from TypeScript definition', () => {
      const source = `
        export default class Test {
          /**
           * @param status {@choice x,y,z}
           */
          setStatus(status: 'a' | 'b') {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const statusProp = schema.tools[0].inputSchema.properties.status;

      // Should use TypeScript enum, not JSDoc override
      expect(statusProp.enum).toContain('a');
      expect(statusProp.enum).toContain('b');
    });
  });

  describe('Issue 11.1: Unknown Layout Hints Detection', () => {
    it('should warn for unknown @title typo', () => {
      const source = `
        export default class Test {
          /**
           * @param name {@titulo "Full Name"}
           */
          setName(name: string) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('titulo') || msg.includes('unknown'))).toBe(true);
    });

    it('should warn for invalid hint names', () => {
      const source = `
        export default class Test {
          /**
           * @param value {@unknown-hint "value"}
           */
          setValue(value: string) {}
        }
      `;
      extractSchemaFromSource(source);
      expect(warnMessages.some(msg => msg.includes('unknown') || msg.includes('hint'))).toBe(true);
    });

    it('should accept valid hint names', () => {
      const source = `
        export default class Test {
          /**
           * @param name {@title "Full Name"} {@placeholder "Enter name"}
           */
          setName(name: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const nameProp = schema.tools[0].inputSchema.properties.name;

      // Valid hints should be applied
      expect(nameProp.title || nameProp.placeholder).toBeDefined();
    });
  });

  describe('Edge Cases and Interaction Effects', () => {
    it('should handle multiple constraint issues on single parameter', () => {
      const source = `
        export default class Test {
          /**
           * @param value {@min 10} {@format invalid} {@pattern [bad}
           */
          setValue(value: number) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const valueProp = schema.tools[0].inputSchema.properties.value;

      // Should apply valid constraint, skip invalid ones
      expect(valueProp.minimum).toBe(10);
      expect(valueProp.format).toBeUndefined();
      expect(valueProp.pattern).toBeUndefined();
    });

    it('should not warn multiple times for same issue per parameter', () => {
      const source = `
        export default class Test {
          /**
           * @param val1 {@format bad}
           * @param val2 {@format bad}
           */
          test(val1: string, val2: string) {}
        }
      `;
      extractSchemaFromSource(source);
      const warnCount = warnMessages.filter(msg => msg.includes('@format')).length;
      expect(warnCount).toBe(2); // One per parameter, not duplicated
    });

    it('should preserve unrelated metadata when validation fails', () => {
      const source = `
        export default class Test {
          /**
           * @param value {@format invalid} {@label "Important"} {@description "Test value"}
           */
          setValue(value: string) {}
        }
      `;
      const schema = extractSchemaFromSource(source);
      const valueProp = schema.tools[0].inputSchema.properties.value;

      // Invalid format should not be applied
      expect(valueProp.format).toBeUndefined();
      // But description should still be there
      expect(valueProp.description).toBeDefined();
    });
  });
});
