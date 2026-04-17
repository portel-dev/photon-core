/**
 * Scoped Memory System
 *
 * Framework-level key-value storage for photons that eliminates
 * boilerplate file I/O. Available as `this.memory` on Photon.
 *
 * Architecture: MemoryProvider delegates to a pluggable MemoryBackend.
 * The default backend is FileMemoryBackend (JSON files on disk).
 * Enterprise deployments can swap in Redis, Postgres, or SQLite.
 *
 * Three scopes:
 * | Scope    | Meaning                          |
 * |----------|----------------------------------|
 * | photon   | Private to this photon (default)  |
 * | session  | Per-user session (Beam sessions)  |
 * | global   | Shared across all photons         |
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import {
  getPhotonMemoryDir,
  getGlobalMemoryDir,
  getSessionMemoryDir,
  getLegacyMemoryDir,
  getLegacyGlobalMemoryDir,
  getLegacySessionMemoryDir,
  getDataRoot,
} from './data-paths.js';

export type MemoryScope = 'photon' | 'session' | 'global';

// ════════════════════════════════════════════════════════════════════════════════
// BACKEND INTERFACE
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Pluggable storage backend for MemoryProvider.
 *
 * Implementations handle the actual persistence. All methods receive
 * a resolved namespace (scope + photonId + sessionId already baked in)
 * so the backend doesn't need to know about scoping rules.
 */
export interface MemoryBackend {
  get(namespace: string, key: string): Promise<any | null>;
  set(namespace: string, key: string, value: any): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  has(namespace: string, key: string): Promise<boolean>;
  keys(namespace: string): Promise<string[]>;
  clear(namespace: string): Promise<void>;
  /**
   * Atomic read-modify-write. Backends with native transactions (Redis WATCH,
   * Postgres FOR UPDATE) should use them here. The default file backend
   * uses a per-key promise chain.
   */
  update(namespace: string, key: string, updater: (current: any | null) => any): Promise<any>;
  /**
   * List all key-value pairs in the namespace, optionally filtered by key prefix.
   * Aligns with Deno KV's list() surface for minimal, predictable enumeration.
   */
  list(namespace: string, prefix?: string): Promise<Array<{ key: string; value: any }>>;
}

// ════════════════════════════════════════════════════════════════════════════════
// FILE BACKEND (default)
// ════════════════════════════════════════════════════════════════════════════════

function keyPath(dir: string, key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(dir, `${safeKey}.json`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * File-based memory backend. Each key is a JSON file on disk.
 * Uses per-key promise chains and temp+rename for safe concurrent access.
 */
export class FileMemoryBackend implements MemoryBackend {
  private _locks = new Map<string, Promise<void>>();

  private async withLock<T>(namespace: string, key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${namespace}:${key}`;
    const prev = this._locks.get(lockKey) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    this._locks.set(lockKey, next);
    try {
      await prev;
      return await fn();
    } finally {
      resolve();
      if (this._locks.get(lockKey) === next) {
        this._locks.delete(lockKey);
      }
    }
  }

  async get(namespace: string, key: string): Promise<any | null> {
    return this.withLock(namespace, key, async () => {
      const filePath = keyPath(namespace, key);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
      } catch (error: any) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    });
  }

  async set(namespace: string, key: string, value: any): Promise<void> {
    return this.withLock(namespace, key, async () => {
      if (!await pathExists(namespace)) {
        await fs.mkdir(namespace, { recursive: true });
      }
      const filePath = keyPath(namespace, key);
      const tmpPath = filePath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(value, null, 2));
      await fs.rename(tmpPath, filePath);
    });
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    return this.withLock(namespace, key, async () => {
      const filePath = keyPath(namespace, key);
      try {
        await fs.unlink(filePath);
        return true;
      } catch (error: any) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async has(namespace: string, key: string): Promise<boolean> {
    return pathExists(keyPath(namespace, key));
  }

  async keys(namespace: string): Promise<string[]> {
    try {
      const files = await fs.readdir(namespace);
      return files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp')).map(f => f.slice(0, -5));
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async clear(namespace: string): Promise<void> {
    try {
      const files = await fs.readdir(namespace);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      await Promise.all(jsonFiles.map(file => fs.unlink(path.join(namespace, file))));
    } catch (error: any) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  async update(namespace: string, key: string, updater: (current: any | null) => any): Promise<any> {
    return this.withLock(namespace, key, async () => {
      const filePath = keyPath(namespace, key);

      let current: any = null;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        current = JSON.parse(content);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }

      const updated = updater(current);

      if (!await pathExists(namespace)) {
        await fs.mkdir(namespace, { recursive: true });
      }
      const tmpPath = filePath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2));
      await fs.rename(tmpPath, filePath);
      return updated;
    });
  }

  async list(namespace: string, prefix?: string): Promise<Array<{ key: string; value: any }>> {
    let allKeys: string[];
    try {
      const files = await fs.readdir(namespace);
      allKeys = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp')).map(f => f.slice(0, -5));
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const filtered = prefix ? allKeys.filter(k => k.startsWith(prefix)) : allKeys;
    const entries = await Promise.all(
      filtered.map(async key => {
        const value = await this.get(namespace, key);
        return { key, value };
      })
    );
    return entries.filter(e => e.value !== null);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// SCOPE RESOLUTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Compatibility shim — one-release migration only.
 *
 * Under docs/internals/PHOTON-DIR-AND-NAMESPACE.md the namespace comes
 * purely from directory position and never changes silently. But installs
 * that ran with the old git-remote-based namespace detection may have data
 * sitting under a stale namespace bucket. On first read, if the canonical
 * dir is empty but exactly one sibling namespace contains this photon's
 * memory, migrate it atomically to the canonical location.
 *
 * Multiple matches → ambiguous; warn to stderr so the user can consolidate
 * manually rather than proceeding with empty memory.
 *
 * @deprecated Remove this helper and its caller one release after the
 *   PHOTON_DIR-and-namespace change ships.
 */
function findAndMigrateStrandedMemory(
  photonId: string,
  canonicalDir: string,
  baseDir?: string
): string | null {
  const dataRoot = getDataRoot(baseDir);
  let entries: string[];
  try {
    entries = fsSync.readdirSync(dataRoot);
  } catch {
    return null;
  }

  const matches: string[] = [];
  for (const entry of entries) {
    // Skip non-namespace buckets. `_global`, `_sessions`, `.cache`, `tasks`
    // live at the same level but are reserved names.
    if (entry.startsWith('_') || entry.startsWith('.') || entry === 'tasks') continue;
    const candidate = path.join(dataRoot, entry, photonId, 'memory');
    try {
      const stat = fsSync.statSync(candidate);
      if (stat.isDirectory()) {
        // Only count non-empty dirs as real data.
        if (fsSync.readdirSync(candidate).length > 0) matches.push(candidate);
      }
    } catch {
      // Not a match, continue.
    }
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    process.stderr.write(
      `[photon] warning: photon '${photonId}' has memory data stranded under multiple namespaces:\n` +
        matches.map((m) => `  - ${m}`).join('\n') +
        `\n  Canonical path is ${canonicalDir}.\n` +
        `  Move the correct one into the canonical path and delete the others to consolidate.\n`
    );
    return null;
  }

  const stranded = matches[0];
  try {
    fsSync.mkdirSync(path.dirname(canonicalDir), { recursive: true });
    fsSync.renameSync(stranded, canonicalDir);
    // Clean up now-empty parent if it has no siblings.
    try {
      const strandedParent = path.dirname(stranded);
      if (fsSync.readdirSync(strandedParent).length === 0) fsSync.rmdirSync(strandedParent);
      const strandedNs = path.dirname(strandedParent);
      if (fsSync.readdirSync(strandedNs).length === 0) fsSync.rmdirSync(strandedNs);
    } catch {
      // Non-fatal: leave parent dirs if cleanup fails.
    }
    return canonicalDir;
  } catch {
    // Cross-device rename or permission issue — fall back to reading in place.
    return stranded;
  }
}

function resolveDir(
  photonId: string,
  namespace: string,
  scope: MemoryScope,
  sessionId?: string,
  baseDir?: string
): string {
  switch (scope) {
    case 'photon': {
      const newDir = getPhotonMemoryDir(namespace, photonId, baseDir);
      if (!fsSync.existsSync(newDir)) {
        const legacyDir = getLegacyMemoryDir(photonId, baseDir);
        if (fsSync.existsSync(legacyDir)) return legacyDir;
        // Last resort: data stranded under a different namespace bucket.
        const recovered = findAndMigrateStrandedMemory(photonId, newDir, baseDir);
        if (recovered) return recovered;
      }
      return newDir;
    }
    case 'session': {
      if (!sessionId) {
        throw new Error('Session ID required for session-scoped memory. Set via memory.sessionId.');
      }
      const newDir = getSessionMemoryDir(sessionId, namespace, photonId, baseDir);
      if (!fsSync.existsSync(newDir)) {
        const legacyDir = getLegacySessionMemoryDir(sessionId, photonId, baseDir);
        if (fsSync.existsSync(legacyDir)) return legacyDir;
      }
      return newDir;
    }
    case 'global': {
      const newDir = getGlobalMemoryDir(baseDir);
      if (!fsSync.existsSync(newDir)) {
        const legacyDir = getLegacyGlobalMemoryDir(baseDir);
        if (fsSync.existsSync(legacyDir)) return legacyDir;
      }
      return newDir;
    }
    default:
      throw new Error(`Unknown memory scope: ${scope}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MEMORY PROVIDER (public API — delegates to backend)
// ════════════════════════════════════════════════════════════════════════════════

/** Default shared backend instance (file-based) */
let defaultBackend: MemoryBackend = new FileMemoryBackend();

/**
 * Set the global default memory backend.
 * Call before any photons are loaded to switch storage layer.
 *
 * @example
 * ```typescript
 * import { setDefaultMemoryBackend } from '@portel/photon-core';
 * import { RedisMemoryBackend } from '@portel/photon-redis';
 * setDefaultMemoryBackend(new RedisMemoryBackend({ url: 'redis://...' }));
 * ```
 */
export function setDefaultMemoryBackend(backend: MemoryBackend): void {
  defaultBackend = backend;
}

export function getDefaultMemoryBackend(): MemoryBackend {
  return defaultBackend;
}

/**
 * Scoped Memory Provider
 *
 * The public API surface for `this.memory` on photon instances.
 * Delegates all operations to the configured MemoryBackend.
 */
export class MemoryProvider {
  private _photonId: string;
  private _namespace: string;
  private _sessionId?: string;
  private _baseDir?: string;
  private _backend: MemoryBackend;

  constructor(
    photonId: string,
    sessionId?: string,
    namespace?: string,
    baseDir?: string,
    backend?: MemoryBackend
  ) {
    this._photonId = photonId;
    this._namespace = namespace || 'local';
    this._sessionId = sessionId;
    this._baseDir = baseDir;
    this._backend = backend ?? defaultBackend;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  set sessionId(id: string | undefined) {
    this._sessionId = id;
  }

  /** Resolve the storage namespace (directory for file backend, prefix for Redis, etc.) */
  private ns(scope: MemoryScope): string {
    return resolveDir(this._photonId, this._namespace, scope, this._sessionId, this._baseDir);
  }

  async get<T = any>(key: string, scope: MemoryScope = 'photon'): Promise<T | null> {
    return this._backend.get(this.ns(scope), key);
  }

  async set<T = any>(key: string, value: T, scope: MemoryScope = 'photon'): Promise<void> {
    return this._backend.set(this.ns(scope), key, value);
  }

  async delete(key: string, scope: MemoryScope = 'photon'): Promise<boolean> {
    return this._backend.delete(this.ns(scope), key);
  }

  async has(key: string, scope: MemoryScope = 'photon'): Promise<boolean> {
    return this._backend.has(this.ns(scope), key);
  }

  async keys(scope: MemoryScope = 'photon'): Promise<string[]> {
    return this._backend.keys(this.ns(scope));
  }

  async clear(scope: MemoryScope = 'photon'): Promise<void> {
    return this._backend.clear(this.ns(scope));
  }

  async getAll<T = any>(scope: MemoryScope = 'photon'): Promise<Record<string, T>> {
    const allKeys = await this.keys(scope);
    const result: Record<string, T> = {};
    for (const key of allKeys) {
      const value = await this.get<T>(key, scope);
      if (value !== null) result[key] = value;
    }
    return result;
  }

  async list<T = any>(prefix?: string, scope: MemoryScope = 'photon'): Promise<Array<{ key: string; value: T }>> {
    return this._backend.list(this.ns(scope), prefix) as Promise<Array<{ key: string; value: T }>>;
  }

  async update<T = any>(
    key: string,
    updater: (current: T | null) => T,
    scope: MemoryScope = 'photon'
  ): Promise<T> {
    return this._backend.update(this.ns(scope), key, updater);
  }
}
