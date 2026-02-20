/**
 * Scoped Memory System
 *
 * Framework-level key-value storage for photons that eliminates
 * boilerplate file I/O. Available as `this.memory` on Photon.
 *
 * Three scopes:
 * | Scope    | Meaning                          | Storage                           |
 * |----------|----------------------------------|-----------------------------------|
 * | photon   | Private to this photon (default)  | ~/.photon/data/{photonId}/        |
 * | session  | Per-user session (Beam sessions)  | ~/.photon/sessions/{sessionId}/   |
 * | global   | Shared across all photons         | ~/.photon/data/_global/           |
 *
 * @example
 * ```typescript
 * export default class TodoList extends Photon {
 *   async add({ text }: { text: string }) {
 *     const items = await this.memory.get<Task[]>('items') ?? [];
 *     items.push({ id: crypto.randomUUID(), text });
 *     await this.memory.set('items', items);
 *     return items;
 *   }
 * }
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export type MemoryScope = 'photon' | 'session' | 'global';

/**
 * Get the base data directory
 */
function getDataDir(): string {
  return process.env.PHOTON_DATA_DIR || path.join(os.homedir(), '.photon', 'data');
}

/**
 * Get the sessions directory
 */
function getSessionsDir(): string {
  return process.env.PHOTON_SESSIONS_DIR || path.join(os.homedir(), '.photon', 'sessions');
}

/**
 * Resolve storage directory for a given scope
 */
function resolveDir(photonId: string, scope: MemoryScope, sessionId?: string): string {
  const safeName = photonId.replace(/[^a-zA-Z0-9_-]/g, '_');

  switch (scope) {
    case 'photon':
      return path.join(getDataDir(), safeName);
    case 'session':
      if (!sessionId) {
        throw new Error('Session ID required for session-scoped memory. Set via memory.sessionId.');
      }
      const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      return path.join(getSessionsDir(), safeSession, safeName);
    case 'global':
      return path.join(getDataDir(), '_global');
    default:
      throw new Error(`Unknown memory scope: ${scope}`);
  }
}

/**
 * Get the file path for a key within a directory
 */
function keyPath(dir: string, key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(dir, `${safeKey}.json`);
}

/**
 * Check if a path exists (async)
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scoped Memory Provider
 *
 * Provides key-value storage with automatic JSON serialization.
 * Each key is stored as a separate file for atomic operations.
 */
export class MemoryProvider {
  private _photonId: string;
  private _sessionId?: string;

  constructor(photonId: string, sessionId?: string) {
    this._photonId = photonId;
    this._sessionId = sessionId;
  }

  /**
   * Current session ID (can be updated by the runtime)
   */
  get sessionId(): string | undefined {
    return this._sessionId;
  }

  set sessionId(id: string | undefined) {
    this._sessionId = id;
  }

  /**
   * Get a value from memory
   *
   * @param key The key to retrieve
   * @param scope Storage scope (default: 'photon')
   * @returns The stored value, or null if not found
   */
  async get<T = any>(key: string, scope: MemoryScope = 'photon'): Promise<T | null> {
    const dir = resolveDir(this._photonId, scope, this._sessionId);
    const filePath = keyPath(dir, key);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Set a value in memory
   *
   * @param key The key to store
   * @param value The value (must be JSON-serializable)
   * @param scope Storage scope (default: 'photon')
   */
  async set<T = any>(key: string, value: T, scope: MemoryScope = 'photon'): Promise<void> {
    const dir = resolveDir(this._photonId, scope, this._sessionId);

    if (!await pathExists(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    const filePath = keyPath(dir, key);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2));
  }

  /**
   * Delete a key from memory
   *
   * @param key The key to delete
   * @param scope Storage scope (default: 'photon')
   * @returns true if the key existed and was deleted
   */
  async delete(key: string, scope: MemoryScope = 'photon'): Promise<boolean> {
    const dir = resolveDir(this._photonId, scope, this._sessionId);
    const filePath = keyPath(dir, key);

    try {
      await fs.unlink(filePath);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  /**
   * Check if a key exists in memory
   *
   * @param key The key to check
   * @param scope Storage scope (default: 'photon')
   */
  async has(key: string, scope: MemoryScope = 'photon'): Promise<boolean> {
    const dir = resolveDir(this._photonId, scope, this._sessionId);
    return pathExists(keyPath(dir, key));
  }

  /**
   * List all keys in memory for a scope
   *
   * @param scope Storage scope (default: 'photon')
   */
  async keys(scope: MemoryScope = 'photon'): Promise<string[]> {
    const dir = resolveDir(this._photonId, scope, this._sessionId);

    try {
      const files = await fs.readdir(dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -5));
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Clear all keys in a scope
   *
   * @param scope Storage scope (default: 'photon')
   */
  async clear(scope: MemoryScope = 'photon'): Promise<void> {
    const dir = resolveDir(this._photonId, scope, this._sessionId);

    try {
      const files = await fs.readdir(dir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      await Promise.all(jsonFiles.map(file => fs.unlink(path.join(dir, file))));
    } catch (error: any) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  /**
   * Get all key-value pairs in a scope
   *
   * @param scope Storage scope (default: 'photon')
   */
  async getAll<T = any>(scope: MemoryScope = 'photon'): Promise<Record<string, T>> {
    const allKeys = await this.keys(scope);
    const result: Record<string, T> = {};

    for (const key of allKeys) {
      const value = await this.get<T>(key, scope);
      if (value !== null) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Update a value with read-modify-write
   *
   * Note: Not truly atomic under concurrent access. For concurrent
   * writes, use distributed locking via `withLock()`.
   *
   * @param key The key to update
   * @param updater Function that receives current value and returns new value
   * @param scope Storage scope (default: 'photon')
   */
  async update<T = any>(
    key: string,
    updater: (current: T | null) => T,
    scope: MemoryScope = 'photon'
  ): Promise<T> {
    const current = await this.get<T>(key, scope);
    const updated = updater(current);
    await this.set(key, updated, scope);
    return updated;
  }
}
