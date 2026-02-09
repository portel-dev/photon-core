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
 * Check if a class has any public methods (instance or static)
 */
export function hasMethods(ClassConstructor: new (...args: unknown[]) => unknown): boolean {
  const prototype = ClassConstructor.prototype;
  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor && typeof descriptor.value === 'function') {
      return true;
    }
  }

  for (const key of Object.getOwnPropertyNames(ClassConstructor)) {
    if (['length', 'name', 'prototype'].includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(ClassConstructor, key);
    if (descriptor && typeof descriptor.value === 'function') {
      return true;
    }
  }

  return false;
}

/**
 * Find a single Photon class in a module
 *
 * Priority: default export first, then named exports.
 * Default exports are trusted unconditionally — the file is named .photon.ts,
 * so the user's intent is clear. For named exports, async methods are used
 * as a heuristic to distinguish photon classes from helper classes.
 */
export function findPhotonClass(module: Record<string, unknown>): (new (...args: unknown[]) => unknown) | null {
  // Default export = the user's photon class. Trust it.
  if (module.default && isClass(module.default)) {
    return module.default;
  }

  // Named exports: prefer classes with async methods (likely the photon),
  // but fall back to any class with public methods if none are async
  let fallback: (new (...args: unknown[]) => unknown) | null = null;

  for (const exportedItem of Object.values(module)) {
    if (isClass(exportedItem)) {
      if (hasAsyncMethods(exportedItem)) {
        return exportedItem;
      }
      if (!fallback && hasMethods(exportedItem)) {
        fallback = exportedItem;
      }
    }
  }

  return fallback;
}

/**
 * Find all Photon classes in a module
 *
 * Returns every exported class that has methods.
 * Used by NCP which may load multiple classes from one file.
 */
export function findPhotonClasses(module: Record<string, unknown>): Array<new (...args: unknown[]) => unknown> {
  const classes: Array<new (...args: unknown[]) => unknown> = [];

  for (const exportedItem of Object.values(module)) {
    if (isClass(exportedItem) && hasMethods(exportedItem)) {
      classes.push(exportedItem);
    }
  }

  return classes;
}
