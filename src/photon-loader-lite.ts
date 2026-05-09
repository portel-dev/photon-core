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
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
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
import { Photon as PhotonBase } from './base.js';
import {
  type Cloudflare,
  notConfiguredCloudflare,
  createCloudflareFromEnv,
} from './cloudflare.js';
import type { ExtractedSchema } from './types.js';
import type { MCPClientFactory } from '@portel/mcp';
import { getCacheDir } from './data-paths.js';

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
  /** Namespace for data path resolution (marketplace owner). Defaults to 'local'. */
  namespace?: string;
  /**
   * Build a `Cloudflare` runtime for a given photon. Hosts that bring CF
   * support (local miniflare, deployed Worker) supply a factory; the
   * loader calls it whenever a photon's constructor needs `Cloudflare`
   * (or whenever `this.cf.*` is detected on a plain class). When the
   * factory is absent the loader injects a throwing-Proxy fallback so
   * the diagnostic remains clear.
   */
  cloudflareFactory?: (photonName: string) => Cloudflare;
  /**
   * Raw Cloudflare Worker `env`. Wired through to constructor params
   * typed `CloudflareEnv` / `CloudflareEnv<T>`. Only present when the
   * loader is being driven by the deployed Worker template (or by a
   * test that wants to simulate it).
   */
  cloudflareEnv?: Record<string, unknown>;
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
 * Clear the photon instance cache. Fires onShutdown on each cached
 * instance first so resources held across loads get a chance to drain.
 */
export async function clearPhotonCache(): Promise<void> {
  await disposeAllPhotons('clear-cache');
}

/**
 * Dispose one cached photon instance (by absolute path + optional instance
 * name). Invokes onShutdown with the given reason before evicting the
 * cache entry. Errors from onShutdown are logged and swallowed.
 */
export async function disposePhoton(
  filePath: string,
  opts: { instanceName?: string; reason?: string } = {},
): Promise<boolean> {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  const cacheKey = opts.instanceName ? `${absolutePath}::${opts.instanceName}` : absolutePath;
  const proxy = instanceCache.get(cacheKey);
  if (!proxy) return false;
  await invokeShutdownQuietly(proxy, opts.reason || 'dispose');
  instanceCache.delete(cacheKey);
  return true;
}

/**
 * Dispose every cached photon instance and clear the cache. Fires
 * onShutdown on each with the given reason.
 */
export async function disposeAllPhotons(reason = 'dispose'): Promise<void> {
  const proxies = Array.from(instanceCache.values());
  instanceCache.clear();
  await Promise.all(proxies.map((p) => invokeShutdownQuietly(p, reason)));
}

/** Fire onShutdown with a bounded timeout; never propagates errors. */
async function invokeShutdownQuietly(proxy: any, reason: string): Promise<void> {
  try {
    const hook = proxy?.onShutdown;
    if (typeof hook !== 'function') return;
    const TIMEOUT_MS = 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(hook.call(proxy, { reason })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`onShutdown hook exceeded ${TIMEOUT_MS}ms`)),
            TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`[photon] onShutdown failed during ${reason}: ${err?.message ?? err}`);
  }
}

/** Register a single beforeExit handler that drains cached instances. */
let exitHookRegistered = false;
function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.on('beforeExit', () => {
    // Fire and forget — beforeExit allows async work, but we don't
    // block process exit if a photon's onShutdown misbehaves.
    void disposeAllPhotons('process-exit');
  });
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
    const compiledPath = await compilePhotonTS(absolutePath, { cacheDir: getCacheDir() });

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

    // 9a. Forgiving auto-inject: classes that reference `this.cf.*` or
    // `this.cfEnv.*` without declaring the matching constructor param
    // still get the field populated, so authoring stays loose. The
    // explicit-injection path (a typed constructor param) takes
    // precedence; this only fills gaps. Mirrors how the classic loader
    // injects `_callHandler` etc. for plain classes.
    const detected = detectCapabilities(source);
    const hasExplicitCloudflare = injections.some(i => i.injectionType === 'cloudflare');
    const hasExplicitCloudflareEnv = injections.some(i => i.injectionType === 'cloudflareEnv');
    if (detected.has('cloudflare') && !hasExplicitCloudflare && instance.cf === undefined) {
      instance.cf = options.cloudflareFactory
        ? options.cloudflareFactory(photonName)
        : notConfiguredCloudflare();
    }
    if (detected.has('cloudflareEnv') && !hasExplicitCloudflareEnv && instance.cfEnv === undefined) {
      instance.cfEnv = options.cloudflareEnv ?? makeThrowingCloudflareEnv();
    }

    // 10. Set photon identity. Namespace mirrors the file's position under
    // baseDir (same rule the classic loader applies). Falls back to 'local'
    // when no baseDir context is available. See
    // docs/internals/PHOTON-DIR-AND-NAMESPACE.md §3.
    instance._photonName = photonName;
    instance._photonNamespace = options.namespace ?? deriveNamespace(absolutePath, options.baseDir);
    instance._baseDir = options.baseDir;
    instance._photonFilePath = absolutePath;
    // Stat-gate baseline. When executeTool() sees the source file has
    // changed, it fires _photonReloader (registered just below) to swap
    // in the fresh compile before dispatching.
    try {
      const s = fsSync.statSync(absolutePath);
      instance._photonSourceStat = { mtimeMs: s.mtimeMs, size: s.size, ino: s.ino };
    } catch {
      // No stat — skip baselining so the gate is a no-op.
    }
    instance._photonReloader = async () => {
      // Invalidate the cache entry, then re-run the whole load pipeline
      // and copy public surface from the fresh instance onto the existing
      // one. Callers already holding a reference to the proxy see new
      // method behavior on the very next dispatch.
      instanceCache.delete(cacheKey);
      const fresh = (await photon(absolutePath, options)) as Record<string, any>;
      // Refresh stat baseline on success so we don't re-trigger.
      try {
        const s = fsSync.statSync(absolutePath);
        instance._photonSourceStat = { mtimeMs: s.mtimeMs, size: s.size, ino: s.ino };
      } catch {
        // ignore — next call will re-evaluate
      }
      // Rewire every own property from the fresh instance onto the
      // live one. Prototype-level methods are re-looked-up through the
      // instance's class on each dispatch via the proxy's method lookup,
      // so they pick up the new code automatically. Own-property state
      // (collections, explicit fields) gets refreshed here.
      for (const key of Object.keys(fresh)) {
        try {
          (instance as Record<string, any>)[key] = fresh[key];
        } catch {
          // Read-only own property — skip; the proxy path will handle it.
        }
      }
    };
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
      const targetPath = resolvePhotonPath(targetPhotonName, absolutePath, options.baseDir);
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

    // 16. Build middleware proxy (wraps dispatch with onError observability)
    const proxy = buildMiddlewareProxy(instance, photonName, toolSchemas, options);

    // 17. Register for shutdown on process exit so onShutdown fires for
    // lite-loaded photons the caller never explicitly disposed.
    registerExitHook();

    return proxy;
  } finally {
    loadingPaths.delete(absolutePath);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Namespace derivation (mirrors classic loader's resolveNamespace)
// ═══════════════════════════════════════════════════════════════════

function deriveNamespace(absolutePath: string, baseDir?: string): string {
  if (!baseDir) return 'local';
  const resolvedBase = path.resolve(baseDir);
  const rel = path.relative(resolvedBase, absolutePath);
  // File outside baseDir — fall back to 'local'.
  if (rel.startsWith('..')) return 'local';
  const parts = rel.split(path.sep);
  // Flat file at baseDir root — use 'local' (equivalent to '' in getPhotonDataDir).
  if (parts.length < 2) return 'local';
  return parts.slice(0, -1).join(path.sep);
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
        const depPath = resolvePhotonDepPath(
          dep.source,
          dep.sourceType,
          currentPath,
          options.baseDir,
        );
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

      case 'photonRuntime': {
        // `private photon: Photon` — inject a Photon instance configured
        // identically to the host so `this.photon.memory.set(...)`,
        // `this.photon.emit(...)`, etc. resolve to the same scope as
        // the equivalent `extends Photon` calls would. Identity-stable
        // per host load.
        const runtime = createPhotonRuntimeForHost(photonName, currentPath, options);
        values.push(runtime);
        break;
      }

      case 'cloudflare': {
        // `private cf: Cloudflare` — wrapped, auto-named CF surface.
        const cf = options.cloudflareFactory
          ? options.cloudflareFactory(photonName)
          : notConfiguredCloudflare();
        values.push(cf);
        break;
      }

      case 'cloudflareEnv': {
        // `private cfEnv: CloudflareEnv` — raw Worker env. On hosts
        // without a CF runtime, hand back a throwing Proxy so the
        // diagnostic names the imported symbol clearly.
        if (options.cloudflareEnv) {
          values.push(options.cloudflareEnv);
        } else {
          values.push(makeThrowingCloudflareEnv());
        }
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
// Photon-as-injection helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the `Photon` instance handed to `private photon: Photon` ctor
 * params. We instantiate the real base class and configure it with the
 * host photon's identity so every capability (`memory`, `schedule`,
 * `emit`, `call`, `mcp`, `caller`, `confirm`, `elicit`, `sample`,
 * `photon.use`, ...) resolves to the same scope an equivalent
 * `extends Photon` consumer would see. The result is shape-equivalent
 * to a normal Photon, so authors can swap between `extends Photon` and
 * constructor injection without touching any call site beyond the
 * access path (`this.memory` vs `this.photon.memory`).
 *
 * The `_callHandler` and `setMCPFactory` wiring is deferred to the
 * caller (see step 14 of `loadPhotonInternal`), which assigns the
 * resolver after constructor args are built. Constructor-time access
 * to `photon.memory` works because MemoryProvider is lazy-resolved on
 * first use and the photon name / baseDir are set up here directly.
 */
function createPhotonRuntimeForHost(
  photonName: string,
  currentPath: string,
  options: PhotonOptions,
): InstanceType<typeof PhotonBase> {
  const runtime = new PhotonBase() as PhotonBase & Record<string, unknown>;
  runtime._photonName = photonName;
  runtime._photonNamespace =
    options.namespace ?? deriveNamespace(currentPath, options.baseDir);
  runtime._baseDir = options.baseDir;
  runtime._photonFilePath = currentPath;
  if (options.sessionId) {
    runtime._sessionId = options.sessionId;
  }
  const setMCPFactory = (runtime as { setMCPFactory?: (f: MCPClientFactory) => void }).setMCPFactory;
  if (options.mcpFactory && typeof setMCPFactory === 'function') {
    setMCPFactory.call(runtime, options.mcpFactory);
  }
  // Cross-photon calls flow through the same in-process resolver the
  // host instance uses. `loadPhotonInternal` re-assigns `_callHandler`
  // on the host instance below; the runtime facade gets its own copy
  // pointed at the same target resolver so injected callers and
  // extends-Photon callers see identical behaviour.
  runtime._callHandler = async (
    targetPhotonName: string,
    method: string,
    params: Record<string, unknown>,
  ) => {
    const targetPath = resolvePhotonPath(targetPhotonName, currentPath, options.baseDir);
    const target = await photon(targetPath, {
      baseDir: options.baseDir,
      mcpFactory: options.mcpFactory,
      sessionId: options.sessionId,
    });
    return (target as Record<string, (p: Record<string, unknown>) => Promise<unknown>>)[method](params);
  };
  // `this.photon.photon.use()` parity: `extends Photon` instances get
  // `_photonResolver` set by the host loader; the injected runtime
  // needs the same resolver so dynamic photon access works identically
  // through both consumption modes.
  runtime._photonResolver = async (name: string, instanceName?: string) => {
    const targetPath = resolvePhotonPath(name, currentPath, options.baseDir);
    return photon(targetPath, {
      baseDir: options.baseDir,
      mcpFactory: options.mcpFactory,
      sessionId: options.sessionId,
      instanceName,
    });
  };
  return runtime;
}

const CFENV_HINT =
  'This photon imports `CloudflareEnv` from "@portel/photon" but no CF ' +
  'env was attached. Run via `photon host run` (miniflare-backed) or ' +
  'deploy with `photon host deploy cloudflare`. Outside CF, this ' +
  'photon\'s CF-dependent methods cannot execute.';

function makeThrowingCloudflareEnv(): Record<string, unknown> {
  // Engine-internal property accesses (constructor lookup, async-iterator
  // probing, `await` thenable check, JSON.stringify) must not throw —
  // otherwise, harmless reflection from runtime utilities like
  // `wireReactiveCollections` blows up the photon load before any user
  // code runs. We satisfy those safely and only throw when actual
  // user code reads a binding name.
  const safePassthrough = new Set<string | symbol>([
    'constructor',
    'then',
    'toJSON',
    'toString',
    'valueOf',
    Symbol.toPrimitive,
    Symbol.toStringTag,
    Symbol.iterator,
    Symbol.asyncIterator,
  ]);
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (safePassthrough.has(prop)) {
        if (prop === 'toString' || prop === Symbol.toPrimitive) {
          return () => '[unconfigured CloudflareEnv]';
        }
        return undefined;
      }
      throw new Error(`CloudflareEnv.${String(prop)} accessed but ${CFENV_HINT}`);
    },
    has(_target, prop) {
      return !safePassthrough.has(prop);
    },
  });
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
    'emit', 'render', 'call', 'mcp', 'setMCPFactory', 'onInitialize', 'onShutdown',
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
      const hasErrorHook = typeof instance.onError === 'function';

      // No middleware AND no onError — preserve the bound-method fast path
      // (keeps sync methods sync for callers that don't need the hook).
      if (declarations.length === 0 && !hasErrorHook) {
        return value.bind(target);
      }

      // Return a function that runs through the middleware chain (if any)
      // and routes any thrown error through the onError observability hook
      // before re-throwing. Hook cannot suppress or transform the error.
      return async (...args: any[]) => {
        const ctx: MiddlewareContext = {
          photon: photonName,
          tool: prop,
          instance: options.instanceName || 'default',
          params: args[0] ?? {},
        };

        const execute = () => value.apply(target, args);
        const dispatch =
          declarations.length === 0
            ? execute
            : buildMiddlewareChain(execute, declarations, registry, stateStores, ctx);

        try {
          return await dispatch();
        } catch (err) {
          await invokeErrorHookLite(instance, err, { tool: prop, params: args[0] ?? {} });
          throw err;
        }
      };
    },
  });
}

/** Fire onError with a bounded 5s timeout. Never throws, never suppresses. */
async function invokeErrorHookLite(
  instance: Record<string, any>,
  error: unknown,
  ctx: { tool: string; params: any },
): Promise<void> {
  const hook = instance.onError;
  if (typeof hook !== 'function') return;
  const TIMEOUT_MS = 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(hook.call(instance, error, ctx)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`onError hook exceeded ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        );
      }),
    ]);
  } catch (hookErr: any) {
    // eslint-disable-next-line no-console
    console.error(
      `onError hook failed for ${ctx.tool}: ${hookErr?.message ?? String(hookErr)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 * Resolve a photon dependency source to an absolute path. Marketplace
 * lookups respect the resolved PHOTON_DIR so lite-loaded photons find
 * their dependencies under the same base the caller configured.
 */
function resolvePhotonDepPath(
  source: string,
  sourceType: string,
  currentPhotonPath: string,
  baseDir?: string,
): string {
  if (sourceType === 'local') {
    if (source.startsWith('./') || source.startsWith('../')) {
      return path.resolve(path.dirname(currentPhotonPath), source);
    }
    return source;
  }

  // Marketplace photons live under the resolved PHOTON_DIR (not hardcoded
  // to ~/.photon as before). Canonical layout is `{base}/{source}.photon.ts`
  // for flat installs, `{base}/<ns>/{source}.photon.ts` for namespaced ones.
  // Here we return the flat path; callers that need namespaced resolution
  // should use the classic loader.
  if (sourceType === 'marketplace') {
    const base = baseDir || process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
    return path.join(base, `${source}.photon.ts`);
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
 * Prefers a sibling file next to the caller; falls back to the resolved
 * PHOTON_DIR. Returns the most likely path; the caller reports an
 * actionable error if it doesn't exist.
 */
function resolvePhotonPath(photonName: string, callerPath: string, baseDir?: string): string {
  const siblingPath = path.join(path.dirname(callerPath), `${photonName}.photon.ts`);
  if (fsSync.existsSync(siblingPath)) return siblingPath;
  const base = baseDir || process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
  const baseFlat = path.join(base, `${photonName}.photon.ts`);
  if (fsSync.existsSync(baseFlat)) return baseFlat;
  return siblingPath; // load will fail with a clear error if missing
}
