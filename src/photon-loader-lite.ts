/**
 * Photon Loader Lite — Direct TypeScript API
 *
 * Load a .photon.ts file and get a fully-enhanced instance with all
 * runtime features: middleware, memory, scheduling, events, __meta.
 *
 * @example
 * ```typescript
 * import { photon } from '@portel/photon-core';
 *
 * const todo = await photon('./todo.photon.ts');
 * await todo.add({ title: 'Buy milk' });
 * // ✅ @cached, @throttled, @retry all work
 * // ✅ this.memory, this.schedule work
 * // ✅ @stateful events emitted, __meta attached
 * // ✅ @photon dependencies recursively loaded
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { compilePhotonTS } from './compiler.js';
import { findPhotonClass } from './class-detection.js';
import { SchemaExtractor, detectCapabilities } from './schema-extractor.js';
import {
  buildMiddlewareChain,
  builtinRegistry,
  MiddlewareRegistry,
  createStateStore,
  type MiddlewareContext,
  type MiddlewareState,
  type MiddlewareDeclaration,
} from './middleware.js';
import { withPhotonCapabilities } from './mixins.js';
import { MemoryProvider } from './memory.js';
import { ScheduleProvider } from './schedule.js';
import { toEnvVarName, parseEnvValue, type MissingParamInfo } from './env-utils.js';
import type { ExtractedSchema } from './types.js';
import type { MCPClientFactory } from '@portel/mcp';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface PhotonOptions {
  /** Override the base directory for memory/schedule storage (default: ~/.photon) */
  baseDir?: string;
  /** MCP client factory for this.mcp() support */
  mcpFactory?: MCPClientFactory;
  /** Named instance identifier */
  instanceName?: string;
  /** Receive emitted events from @stateful methods */
  onEvent?: (event: PhotonEvent) => void;
  /** Session ID for session-scoped memory */
  sessionId?: string;
}

export interface PhotonEvent {
  method: string;
  params: Record<string, any>;
  result: any;
  timestamp: string;
  instance?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Loading state (cycle detection, caching)
// ═══════════════════════════════════════════════════════════════════

/** Currently-loading photon paths for cycle detection */
const loadingPaths = new Set<string>();

/** Cache of loaded photon instances (keyed by absolutePath::instanceName) */
const instanceCache = new Map<string, any>();

/** Dedup concurrent loads */
const loadPromises = new Map<string, Promise<any>>();

// ═══════════════════════════════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════════════════════════════

/**
 * Load a .photon.ts file and return a fully-enhanced instance.
 *
 * The returned object has all methods working with middleware (@cached, @retry, etc.),
 * memory, scheduling, @stateful event emission, and cross-photon calls.
 *
 * @param filePath Path to the .photon.ts file (absolute or relative to cwd)
 * @param options Optional configuration
 * @returns Enhanced photon instance with all runtime features
 */
export async function photon<T = any>(
  filePath: string,
  options: PhotonOptions = {},
): Promise<T> {
  // Resolve to absolute path
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const instanceName = options.instanceName || '';
  const cacheKey = instanceName ? `${absolutePath}::${instanceName}` : absolutePath;

  // Cycle detection (must come before dedup check to avoid deadlock)
  if (loadingPaths.has(absolutePath)) {
    const chain = Array.from(loadingPaths).concat(absolutePath).join(' → ');
    throw new Error(`Circular @photon dependency: ${chain}`);
  }

  // Return cached instance
  if (instanceCache.has(cacheKey)) {
    return instanceCache.get(cacheKey) as T;
  }

  // Dedup concurrent loads
  if (loadPromises.has(cacheKey)) {
    return loadPromises.get(cacheKey) as Promise<T>;
  }

  const promise = loadPhotonInternal(absolutePath, cacheKey, options);
  loadPromises.set(cacheKey, promise);

  try {
    const result = await promise;
    instanceCache.set(cacheKey, result);
    return result as T;
  } finally {
    loadPromises.delete(cacheKey);
  }
}

/**
 * Clear the photon instance cache. Useful for testing.
 */
export function clearPhotonCache(): void {
  instanceCache.clear();
}

// ═══════════════════════════════════════════════════════════════════
// Internal pipeline
// ═══════════════════════════════════════════════════════════════════

async function loadPhotonInternal(
  absolutePath: string,
  cacheKey: string,
  options: PhotonOptions,
): Promise<any> {
  loadingPaths.add(absolutePath);

  try {
    // 1. Read source
    const source = await fs.readFile(absolutePath, 'utf-8');

    // 2. Compile TypeScript → JavaScript
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cacheDir = path.join(homeDir, '.photon', 'cache');
    const compiledPath = await compilePhotonTS(absolutePath, { cacheDir });

    // 3. Import compiled module
    const moduleUrl = pathToFileURL(compiledPath).href;
    const module = await import(moduleUrl);

    // 4. Find the Photon class
    const PhotonClass = findPhotonClass(module as Record<string, unknown>);
    if (!PhotonClass) {
      throw new Error(`No Photon class found in ${absolutePath}`);
    }

    // 5. Derive photon name from file path
    const photonName = derivePhotonName(absolutePath);

    // 6. Extract schema for middleware and metadata
    const extractor = new SchemaExtractor();
    const metadata = extractor.extractAllFromSource(source);
    const toolSchemas = metadata.tools;

    // 7. Resolve constructor injections
    const injections = extractor.resolveInjections(source, photonName);
    const constructorArgs = await resolveConstructorArgs(
      injections,
      photonName,
      absolutePath,
      options,
    );

    // 8. Enhance class with capabilities (for plain classes)
    const EnhancedClass = withPhotonCapabilities(PhotonClass);

    // 9. Instantiate
    const instance = new EnhancedClass(...constructorArgs) as Record<string, any>;

    // 10. Set photon identity
    instance._photonName = photonName;
    if (options.instanceName) {
      instance.instanceName = options.instanceName;
    }
    if (options.sessionId) {
      instance._sessionId = options.sessionId;
    }

    // 11. Wire reactive collections
    wireReactiveCollections(instance);

    // 12. Wrap @stateful methods (event emission + __meta)
    wrapStatefulMethods(instance, source, options.onEvent);

    // 13. Inject MCP factory if provided
    if (options.mcpFactory && typeof instance.setMCPFactory === 'function') {
      instance.setMCPFactory(options.mcpFactory);
    }

    // 14. Inject cross-photon call handler (in-process resolution)
    instance._callHandler = async (
      targetPhotonName: string,
      method: string,
      params: Record<string, any>,
    ) => {
      const targetPath = resolvePhotonPath(targetPhotonName, absolutePath);
      const target = await photon(targetPath, {
        baseDir: options.baseDir,
        mcpFactory: options.mcpFactory,
        sessionId: options.sessionId,
      });
      return (target as any)[method](params);
    };

    // 15. Call onInitialize lifecycle hook
    if (typeof instance.onInitialize === 'function') {
      await instance.onInitialize();
    }

    // 16. Build middleware proxy
    const proxy = buildMiddlewareProxy(instance, photonName, toolSchemas, options);

    return proxy;
  } finally {
    loadingPaths.delete(absolutePath);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Constructor injection
// ═══════════════════════════════════════════════════════════════════

async function resolveConstructorArgs(
  injections: Array<{
    param: { name: string; type: string; isOptional: boolean; hasDefault: boolean; defaultValue?: any };
    injectionType: string;
    envVarName?: string;
    photonDependency?: { name: string; source: string; sourceType: string; instanceName?: string };
    mcpDependency?: { name: string; source: string; sourceType: string };
  }>,
  photonName: string,
  currentPath: string,
  options: PhotonOptions,
): Promise<any[]> {
  const values: any[] = [];
  const missing: MissingParamInfo[] = [];

  for (const injection of injections) {
    const { param, injectionType } = injection;

    switch (injectionType) {
      case 'photon': {
        // Recursive photon loading
        const dep = injection.photonDependency!;
        const depPath = resolvePhotonDepPath(dep.source, dep.sourceType, currentPath);
        const depInstance = await photon(depPath, {
          baseDir: options.baseDir,
          mcpFactory: options.mcpFactory,
          instanceName: dep.instanceName,
          sessionId: options.sessionId,
        });
        values.push(depInstance);
        break;
      }

      case 'mcp': {
        // MCP dependencies require a factory
        if (!options.mcpFactory) {
          throw new Error(
            `Photon "${photonName}" requires MCP dependency "${param.name}" but no mcpFactory was provided. ` +
            `Pass { mcpFactory } in the options to photon().`,
          );
        }
        // Will be resolved by the instance's mcp() method at call time
        values.push(undefined);
        break;
      }

      case 'env': {
        const envVarName = injection.envVarName || toEnvVarName(photonName, param.name);
        const envValue = process.env[envVarName];

        if (envValue !== undefined) {
          values.push(parseEnvValue(envValue, param.type));
        } else if (param.hasDefault || param.isOptional) {
          values.push(undefined);
        } else {
          missing.push({ paramName: param.name, envVarName, type: param.type });
          values.push(undefined);
        }
        break;
      }

      case 'state': {
        // State injection — use default value (state is loaded by the class itself)
        values.push(undefined);
        break;
      }

      default:
        values.push(undefined);
    }
  }

  if (missing.length > 0) {
    const envList = missing.map(m => `  ${m.envVarName} (${m.paramName}: ${m.type})`).join('\n');
    console.warn(
      `⚠️  ${photonName}: Missing environment variables:\n${envList}\n` +
      `Some methods may fail until these are set.`,
    );
  }

  return values;
}

// ═══════════════════════════════════════════════════════════════════
// Reactive collection wiring
// ═══════════════════════════════════════════════════════════════════

function wireReactiveCollections(instance: Record<string, any>): void {
  const emit = typeof instance.emit === 'function'
    ? instance.emit.bind(instance)
    : null;

  if (!emit) return;

  for (const key of Object.keys(instance)) {
    const value = instance[key];
    if (!value || typeof value !== 'object') continue;

    const ctorName = value.constructor?.name;
    if (
      ctorName === 'ReactiveArray' ||
      ctorName === 'ReactiveMap' ||
      ctorName === 'ReactiveSet' ||
      ctorName === 'Collection'
    ) {
      value._propertyName = key;
      value._emitter = emit;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// @stateful method wrapping
// ═══════════════════════════════════════════════════════════════════

function wrapStatefulMethods(
  instance: Record<string, any>,
  source: string,
  onEvent?: (event: PhotonEvent) => void,
): void {
  if (!/@stateful\b/i.test(source)) return;

  // Skip framework-injected methods from withPhotonCapabilities
  const frameworkMethods = new Set([
    'emit', 'call', 'mcp', 'setMCPFactory', 'onInitialize', 'onShutdown',
  ]);

  // Walk the prototype chain to find all public methods
  // (withPhotonCapabilities creates a subclass, so methods may be on grandparent prototype)
  const methodNames: string[] = [];
  const seen = new Set<string>();
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (seen.has(name) || name === 'constructor' || name.startsWith('_')) continue;
      if (frameworkMethods.has(name)) continue;
      seen.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor && typeof descriptor.value === 'function') {
        methodNames.push(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  if (methodNames.length === 0) return;

  for (const methodName of methodNames) {
    const original = instance[methodName];
    if (typeof original !== 'function') continue;

    instance[methodName] = function (this: any, ...args: any[]) {
      const paramNames = extractParamNames(original);
      const params = Object.fromEntries(paramNames.map((name, i) => [name, args[i]]));

      const result = original.apply(this, args);

      // Handle both sync and async results
      const attachMeta = (res: any) => {
        if (res && typeof res === 'object' && !Array.isArray(res) && !res.__meta) {
          const timestamp = new Date().toISOString();
          Object.defineProperty(res, '__meta', {
            value: {
              createdAt: timestamp,
              createdBy: methodName,
              modifiedAt: null,
              modifiedBy: null,
              modifications: [],
            },
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }

        // Emit event
        if (onEvent) {
          const event: PhotonEvent = {
            method: methodName,
            params,
            result: res,
            timestamp: new Date().toISOString(),
          };
          if (this.instanceName) {
            event.instance = this.instanceName;
          }
          onEvent(event);
        }

        return res;
      };

      // Support async methods (most common case)
      if (result && typeof result.then === 'function') {
        return result.then(attachMeta);
      }

      return attachMeta(result);
    };
  }
}

/**
 * Extract parameter names from a function signature string
 */
function extractParamNames(fn: (...args: any[]) => any): string[] {
  const fnStr = fn.toString();
  const match = fnStr.match(/\(([^)]*)\)/);
  if (!match?.[1]) return [];

  return match[1]
    .split(',')
    .map(param => {
      const cleaned = param
        .trim()
        .split('=')[0]  // Remove default value
        .split(':')[0]  // Remove type annotations
        .trim();
      return cleaned;
    })
    .filter(name => name && name !== 'this');
}

// ═══════════════════════════════════════════════════════════════════
// Middleware proxy
// ═══════════════════════════════════════════════════════════════════

function buildMiddlewareProxy(
  instance: Record<string, any>,
  photonName: string,
  toolSchemas: ExtractedSchema[],
  options: PhotonOptions,
): any {
  // Build tool lookup: method name → schema
  const toolMap = new Map<string, ExtractedSchema>();
  for (const schema of toolSchemas) {
    toolMap.set(schema.name, schema);
  }

  // Middleware state stores (shared across calls)
  const stateStores = new Map<string, MiddlewareState>();

  // Build combined registry (builtins only for now; custom middleware can be added later)
  const registry = new MiddlewareRegistry();
  for (const name of builtinRegistry.names()) {
    registry.register(builtinRegistry.get(name)!);
  }

  return new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string') return value;

      // Skip internal/private methods
      if (prop.startsWith('_') || prop === 'constructor') {
        return value.bind(target);
      }

      const schema = toolMap.get(prop);
      const declarations: MiddlewareDeclaration[] = schema?.middleware || [];

      // No middleware — return bound method directly
      if (declarations.length === 0) {
        return value.bind(target);
      }

      // Return a function that applies middleware on each call
      return (...args: any[]) => {
        const ctx: MiddlewareContext = {
          photon: photonName,
          tool: prop,
          instance: options.instanceName || 'default',
          params: args[0] ?? {},
        };

        const execute = () => value.apply(target, args);
        const chain = buildMiddlewareChain(
          execute,
          declarations,
          registry,
          stateStores,
          ctx,
        );

        return chain();
      };
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Path utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive a photon name from a file path.
 * e.g., '/path/to/todo.photon.ts' → 'todo'
 */
function derivePhotonName(filePath: string): string {
  const basename = path.basename(filePath);
  return basename
    .replace(/\.photon\.(ts|js|mjs)$/, '')
    .replace(/\.(ts|js|mjs)$/, '');
}

/**
 * Resolve a photon dependency source to an absolute path.
 */
function resolvePhotonDepPath(
  source: string,
  sourceType: string,
  currentPhotonPath: string,
): string {
  if (sourceType === 'local') {
    if (source.startsWith('./') || source.startsWith('../')) {
      return path.resolve(path.dirname(currentPhotonPath), source);
    }
    return source;
  }

  // For marketplace photons, look in ~/.photon/photons/<name>/
  if (sourceType === 'marketplace') {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDir, '.photon', 'photons', source, `${source}.photon.ts`);
  }

  // npm and github sources — for now, throw a helpful error
  throw new Error(
    `Cannot resolve ${sourceType} photon dependency "${source}" in lite loader. ` +
    `Only local paths and marketplace photons are supported. ` +
    `Use the full runtime for npm/github dependencies.`,
  );
}

/**
 * Resolve a photon name to a path for cross-photon calls.
 * Searches: sibling files, then ~/.photon/photons/
 */
function resolvePhotonPath(photonName: string, callerPath: string): string {
  // Try sibling file first
  const dir = path.dirname(callerPath);
  const siblingPath = path.join(dir, `${photonName}.photon.ts`);

  // We can't do sync fs.existsSync in an async context cleanly,
  // so just return the sibling path — the load will fail with a clear error if not found
  return siblingPath;
}
