/**
 * Class Detection Utilities
 *
 * Shared logic for detecting Photon classes in ES modules.
 * Extracted from photon, ncp, and lumina loaders.
 */

/**
 * Check if a value is a class constructor
 */
export function isClass(fn: unknown): fn is new (...args: unknown[]) => unknown {
  return typeof fn === 'function' && /^\s*class\s+/.test(fn.toString());
}

/**
 * Check if a class has async methods (instance or static)
 *
 * Checks for AsyncFunction, AsyncGeneratorFunction, and GeneratorFunction
 * on both prototype (instance methods) and the class itself (static methods).
 */
export function hasAsyncMethods(ClassConstructor: new (...args: unknown[]) => unknown): boolean {
  const asyncCtorNames = new Set([
    'AsyncFunction',
    'AsyncGeneratorFunction',
    'GeneratorFunction',
  ]);

  // Check instance methods on prototype
  const prototype = ClassConstructor.prototype;
  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor && typeof descriptor.value === 'function') {
      if (asyncCtorNames.has(descriptor.value.constructor.name)) {
        return true;
      }
    }
  }

  // Check static methods on the class itself
  for (const key of Object.getOwnPropertyNames(ClassConstructor)) {
    if (['length', 'name', 'prototype'].includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(ClassConstructor, key);
    if (descriptor && typeof descriptor.value === 'function') {
      if (asyncCtorNames.has(descriptor.value.constructor.name)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find a single Photon class in a module
 *
 * Priority: default export first, then named exports.
 * Returns the first class with async methods, or null.
 */
export function findPhotonClass(module: Record<string, unknown>): (new (...args: unknown[]) => unknown) | null {
  // Try default export first
  if (module.default && isClass(module.default)) {
    if (hasAsyncMethods(module.default)) {
      return module.default;
    }
  }

  // Try named exports
  for (const exportedItem of Object.values(module)) {
    if (isClass(exportedItem) && hasAsyncMethods(exportedItem)) {
      return exportedItem;
    }
  }

  return null;
}

/**
 * Find all Photon classes in a module
 *
 * Returns every exported class that has async methods.
 * Used by NCP which may load multiple classes from one file.
 */
export function findPhotonClasses(module: Record<string, unknown>): Array<new (...args: unknown[]) => unknown> {
  const classes: Array<new (...args: unknown[]) => unknown> = [];

  for (const exportedItem of Object.values(module)) {
    if (isClass(exportedItem) && hasAsyncMethods(exportedItem)) {
      classes.push(exportedItem);
    }
  }

  return classes;
}
