/**
 * Input Validation Utilities
 *
 * Type-safe validation with user-friendly error messages.
 * Adapted from photon's shared/validation.ts.
 *
 * Also includes PhotonError and ValidationError base classes
 * (originally from photon's shared/error-handler.ts).
 */

// ══════════════════════════════════════════════════════════════════════════════
// ERROR BASE CLASSES
// ══════════════════════════════════════════════════════════════════════════════

export class PhotonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PhotonError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends PhotonError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    suggestion?: string,
  ) {
    super(message, 'VALIDATION_ERROR', details, suggestion);
    this.name = 'ValidationError';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION RESULT / TYPES
// ══════════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type Validator<T> = (value: T) => ValidationResult;

function createResult(valid: boolean, errors: string[] = []): ValidationResult {
  return { valid, errors };
}

export function combineResults(...results: ValidationResult[]): ValidationResult {
  const allErrors = results.flatMap((r) => r.errors);
  return createResult(allErrors.length === 0, allErrors);
}

// ══════════════════════════════════════════════════════════════════════════════
// TYPE VALIDATORS
// ══════════════════════════════════════════════════════════════════════════════

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// ══════════════════════════════════════════════════════════════════════════════
// STRING VALIDATORS
// ══════════════════════════════════════════════════════════════════════════════

export function notEmpty(fieldName: string): Validator<string> {
  return (value: string) => {
    if (!value || value.trim().length === 0) {
      return createResult(false, [`${fieldName} cannot be empty`]);
    }
    return createResult(true);
  };
}

export function hasLength(
  fieldName: string,
  min?: number,
  max?: number,
): Validator<string> {
  return (value: string) => {
    const errors: string[] = [];
    if (min !== undefined && value.length < min) {
      errors.push(`${fieldName} must be at least ${min} characters`);
    }
    if (max !== undefined && value.length > max) {
      errors.push(`${fieldName} must be at most ${max} characters`);
    }
    return createResult(errors.length === 0, errors);
  };
}

export function matchesPattern(
  fieldName: string,
  pattern: RegExp,
  message?: string,
): Validator<string> {
  return (value: string) => {
    if (!pattern.test(value)) {
      return createResult(false, [message || `${fieldName} has invalid format`]);
    }
    return createResult(true);
  };
}

export function isEmail(fieldName: string): Validator<string> {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return matchesPattern(fieldName, emailPattern, `${fieldName} must be a valid email`);
}

export function isUrl(fieldName: string): Validator<string> {
  return (value: string) => {
    try {
      new URL(value);
      return createResult(true);
    } catch {
      return createResult(false, [`${fieldName} must be a valid URL`]);
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NUMBER VALIDATORS
// ══════════════════════════════════════════════════════════════════════════════

export function inRange(
  fieldName: string,
  min?: number,
  max?: number,
): Validator<number> {
  return (value: number) => {
    const errors: string[] = [];
    if (min !== undefined && value < min) {
      errors.push(`${fieldName} must be at least ${min}`);
    }
    if (max !== undefined && value > max) {
      errors.push(`${fieldName} must be at most ${max}`);
    }
    return createResult(errors.length === 0, errors);
  };
}

export function isPositive(fieldName: string): Validator<number> {
  return (value: number) => {
    if (value <= 0) {
      return createResult(false, [`${fieldName} must be positive`]);
    }
    return createResult(true);
  };
}

export function isInteger(fieldName: string): Validator<number> {
  return (value: number) => {
    if (!Number.isInteger(value)) {
      return createResult(false, [`${fieldName} must be an integer`]);
    }
    return createResult(true);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ARRAY VALIDATORS
// ══════════════════════════════════════════════════════════════════════════════

export function hasArrayLength(
  fieldName: string,
  min?: number,
  max?: number,
): Validator<unknown[]> {
  return (value: unknown[]) => {
    const errors: string[] = [];
    if (min !== undefined && value.length < min) {
      errors.push(`${fieldName} must have at least ${min} items`);
    }
    if (max !== undefined && value.length > max) {
      errors.push(`${fieldName} must have at most ${max} items`);
    }
    return createResult(errors.length === 0, errors);
  };
}

export function arrayOf<T>(
  fieldName: string,
  itemValidator: Validator<T>,
): Validator<T[]> {
  return (value: T[]) => {
    const errors: string[] = [];
    value.forEach((item, index) => {
      const result = itemValidator(item);
      if (!result.valid) {
        errors.push(`${fieldName}[${index}]: ${result.errors.join(', ')}`);
      }
    });
    return createResult(errors.length === 0, errors);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// OBJECT VALIDATORS
// ══════════════════════════════════════════════════════════════════════════════

export function hasFields(
  fieldName: string,
  requiredFields: string[],
): Validator<Record<string, unknown>> {
  return (value: Record<string, unknown>) => {
    const errors: string[] = [];
    requiredFields.forEach((field) => {
      if (!(field in value)) {
        errors.push(`${fieldName} missing required field: ${field}`);
      }
    });
    return createResult(errors.length === 0, errors);
  };
}

export function oneOf<T>(fieldName: string, allowed: T[]): Validator<T> {
  return (value: T) => {
    if (!allowed.includes(value)) {
      return createResult(false, [
        `${fieldName} must be one of: ${allowed.join(', ')}`,
      ]);
    }
    return createResult(true);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ══════════════════════════════════════════════════════════════════════════════

export function validate<T>(
  value: T,
  validators: Validator<T>[],
): ValidationResult {
  const results = validators.map((validator) => validator(value));
  return combineResults(...results);
}

export function validateOrThrow<T>(
  value: T,
  validators: Validator<T>[],
  context?: string,
): void {
  const result = validate(value, validators);
  if (!result.valid) {
    const message = result.errors.join('; ');
    throw new ValidationError(message, { value, context }, 'Check input values and try again');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FILE SYSTEM VALIDATORS
// ══════════════════════════════════════════════════════════════════════════════

export function pathExists(fieldName: string): Validator<string> {
  return (value: string) => {
    if (!value || value.trim().length === 0) {
      return createResult(false, [`${fieldName} path cannot be empty`]);
    }
    return createResult(true);
  };
}

export function hasExtension(
  fieldName: string,
  extensions: string[],
): Validator<string> {
  return (value: string) => {
    const ext = value.split('.').pop()?.toLowerCase();
    if (!ext || !extensions.includes(ext)) {
      return createResult(false, [
        `${fieldName} must have one of these extensions: ${extensions.join(', ')}`,
      ]);
    }
    return createResult(true);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TYPE GUARD UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

export function assertDefined<T>(
  value: T | null | undefined,
  fieldName: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(`${fieldName} is required`, { value }, 'Provide a valid value');
  }
}

export function assertString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (!isString(value)) {
    throw new ValidationError(
      `${fieldName} must be a string, got ${typeof value}`,
      { value },
      'Provide a string value',
    );
  }
}

export function assertNumber(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (!isNumber(value)) {
    throw new ValidationError(
      `${fieldName} must be a number, got ${typeof value}`,
      { value },
      'Provide a numeric value',
    );
  }
}

export function assertObject(
  value: unknown,
  fieldName: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) {
    throw new ValidationError(
      `${fieldName} must be an object, got ${typeof value}`,
      { value },
      'Provide an object value',
    );
  }
}

export function assertArray(
  value: unknown,
  fieldName: string,
): asserts value is unknown[] {
  if (!isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an array, got ${typeof value}`,
      { value },
      'Provide an array value',
    );
  }
}
