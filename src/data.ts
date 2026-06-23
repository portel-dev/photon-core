/**
 * Structured Photon data.
 *
 * `this.data` is for durable records and event logs. It complements:
 * - `this.memory`: small scoped key/value facts
 * - `this.storage()`: legacy raw file/path storage
 * - Cloudflare bindings: deploy-target-specific services
 *
 * The default backend is dependency-free and file-backed. Hosts can replace it
 * with SQLite, Durable Object storage, D1, Postgres, or another structured
 * backend without changing Photon code.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  getDataRoot,
  getPhotonDataDir,
} from './data-paths.js';
import type { MemoryScope } from './memory.js';

export type DataScope = MemoryScope;

export interface DataListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string | number | null;
}

export interface DataListResult<T = any> {
  items: Array<{ id: string; value: T; updated_at?: string }>;
  next_cursor: string | null;
  total: number;
}

export interface DataLogEntry<T = any> {
  index: number;
  value: T;
  timestamp: string;
}

export interface DataLogReadOptions {
  after?: string | number;
  before?: string | number;
  limit?: number;
}

export interface DataLogReadResult<T = any> {
  entries: Array<DataLogEntry<T>>;
  next_cursor: string | null;
  total: number;
}

export interface DataSqlResult<T = any> {
  rows: T[];
}

export interface DataSql {
  exec<T = any>(query: string, params?: unknown[]): Promise<DataSqlResult<T>>;
}

/**
 * Pluggable backend for structured data.
 *
 * All methods receive a resolved namespace. File backends treat it as a
 * directory; database backends can treat it as a tenant/schema/table prefix.
 */
export interface DataBackend {
  tableGet(namespace: string, table: string, id: string): Promise<any | null>;
  tablePut(namespace: string, table: string, id: string, value: any): Promise<void>;
  tableDelete(namespace: string, table: string, id: string): Promise<boolean>;
  tableHas(namespace: string, table: string, id: string): Promise<boolean>;
  tableList(namespace: string, table: string, options?: DataListOptions): Promise<DataListResult>;
  tableClear(namespace: string, table: string): Promise<void>;

  logAppend(namespace: string, log: string, value: any): Promise<DataLogEntry>;
  logRead(namespace: string, log: string, options?: DataLogReadOptions): Promise<DataLogReadResult>;
  logClear(namespace: string, log: string): Promise<void>;

  sql?(namespace: string): DataSql;
}

export interface DurableObjectSqlStorageLike {
  exec(query: string, ...params: unknown[]): any;
}

export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string | string[]): Promise<boolean | number | void>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  sql?: DurableObjectSqlStorageLike;
}

interface TableEnvelope<T = any> {
  id: string;
  value: T;
  updated_at: string;
}

interface LogEnvelope<T = any> {
  value: T;
  timestamp: string;
}

function segment(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '~') || '_';
}

function unsegment(value: string): string {
  return decodeURIComponent(value.replace(/~/g, '%'));
}

function safeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.floor(limit);
}

function cursorOffset(cursor: string | number | null | undefined): number {
  if (cursor === null || cursor === undefined || cursor === '') return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf-8');
  await fs.rename(temp, filePath);
}

function tableDir(namespace: string, table: string): string {
  return path.join(namespace, 'tables', segment(table));
}

function tableFile(namespace: string, table: string, id: string): string {
  return path.join(tableDir(namespace, table), `${segment(id)}.json`);
}

function logFile(namespace: string, log: string): string {
  return path.join(namespace, 'logs', `${segment(log)}.jsonl`);
}

function doPrefix(namespace: string, kind: 'table' | 'log', name: string): string {
  return `data:${segment(namespace)}:${kind}:${segment(name)}:`;
}

function doTableKey(namespace: string, table: string, id: string): string {
  return `${doPrefix(namespace, 'table', table)}${segment(id)}`;
}

function doLogPrefix(namespace: string, log: string): string {
  return doPrefix(namespace, 'log', log);
}

function doLogMetaKey(namespace: string, log: string): string {
  return `${doLogPrefix(namespace, log)}__meta`;
}

function doLogEntryKey(namespace: string, log: string, index: number): string {
  return `${doLogPrefix(namespace, log)}${String(index).padStart(20, '0')}`;
}

function fromSqlCursor<T = any>(cursor: any): T[] {
  if (!cursor) return [];
  if (Array.isArray(cursor)) return cursor as T[];
  if (Array.isArray(cursor.rows)) return cursor.rows as T[];
  if (typeof cursor.toArray === 'function') return cursor.toArray() as T[];
  if (typeof cursor.toArray === 'object' && Array.isArray(cursor.toArray)) {
    return cursor.toArray as T[];
  }
  return [];
}

function resolveDataDir(
  photonId: string,
  namespace: string,
  scope: DataScope,
  sessionId: string | undefined,
  baseDir?: string
): string {
  if (scope === 'global') {
    return path.join(getDataRoot(baseDir), '_global', 'data');
  }

  if (scope === 'session') {
    if (!sessionId) {
      throw new Error('Session ID required for session-scoped data');
    }
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const root = path.join(getDataRoot(baseDir), '_sessions', safeSession);
    if (!namespace || namespace === 'local') {
      return path.join(root, photonId, 'data');
    }
    return path.join(root, namespace, photonId, 'data');
  }

  return path.join(getPhotonDataDir(namespace, photonId, baseDir), 'data');
}

/**
 * File backend for structured data. Tables are JSON files per record; logs are
 * append-only JSONL files.
 */
export class FileDataBackend implements DataBackend {
  private _locks = new Map<string, Promise<void>>();

  private async withLock<T>(namespace: string, resource: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${namespace}:${resource}`;
    const prev = this._locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this._locks.set(lockKey, next);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this._locks.get(lockKey) === next) {
        this._locks.delete(lockKey);
      }
    }
  }

  async tableGet(namespace: string, table: string, id: string): Promise<any | null> {
    return this.withLock(namespace, `table:${table}:${id}`, async () => {
      try {
        const envelope = await readJson<TableEnvelope>(tableFile(namespace, table, id));
        return envelope.value;
      } catch (error: any) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    });
  }

  async tablePut(namespace: string, table: string, id: string, value: any): Promise<void> {
    return this.withLock(namespace, `table:${table}:${id}`, async () => {
      const envelope: TableEnvelope = {
        id,
        value,
        updated_at: new Date().toISOString(),
      };
      await writeJsonAtomic(tableFile(namespace, table, id), envelope);
    });
  }

  async tableDelete(namespace: string, table: string, id: string): Promise<boolean> {
    return this.withLock(namespace, `table:${table}:${id}`, async () => {
      try {
        await fs.unlink(tableFile(namespace, table, id));
        return true;
      } catch (error: any) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async tableHas(namespace: string, table: string, id: string): Promise<boolean> {
    return pathExists(tableFile(namespace, table, id));
  }

  async tableList(namespace: string, table: string, options: DataListOptions = {}): Promise<DataListResult> {
    const dir = tableDir(namespace, table);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { items: [], next_cursor: null, total: 0 };
      }
      throw error;
    }

    const ids = files
      .filter(file => file.endsWith('.json') && !file.endsWith('.tmp'))
      .map(file => unsegment(file.slice(0, -'.json'.length)))
      .filter(id => !options.prefix || id.startsWith(options.prefix))
      .sort((a, b) => a.localeCompare(b));

    const total = ids.length;
    const offset = cursorOffset(options.cursor);
    const limit = safeLimit(options.limit, 100);
    const pageIds = ids.slice(offset, offset + limit);
    const items = [];

    for (const id of pageIds) {
      const envelope = await readJson<TableEnvelope>(tableFile(namespace, table, id));
      items.push({
        id: envelope.id,
        value: envelope.value,
        updated_at: envelope.updated_at,
      });
    }

    const nextOffset = offset + pageIds.length;
    return {
      items,
      next_cursor: nextOffset < total ? String(nextOffset) : null,
      total,
    };
  }

  async tableClear(namespace: string, table: string): Promise<void> {
    await fs.rm(tableDir(namespace, table), { recursive: true, force: true });
  }

  async logAppend(namespace: string, log: string, value: any): Promise<DataLogEntry> {
    return this.withLock(namespace, `log:${log}`, async () => {
      const filePath = logFile(namespace, log);
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      let index = 0;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        index = content.trim() ? content.trimEnd().split('\n').length : 0;
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }

      const entry: DataLogEntry = {
        index,
        value,
        timestamp: new Date().toISOString(),
      };
      const envelope: LogEnvelope = {
        value,
        timestamp: entry.timestamp,
      };
      await fs.appendFile(filePath, `${JSON.stringify(envelope)}\n`, 'utf-8');
      return entry;
    });
  }

  async logRead(namespace: string, log: string, options: DataLogReadOptions = {}): Promise<DataLogReadResult> {
    const filePath = logFile(namespace, log);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { entries: [], next_cursor: null, total: 0 };
      }
      throw error;
    }

    const after = options.after === undefined ? -1 : Number(options.after);
    const before = options.before === undefined ? Number.POSITIVE_INFINITY : Number(options.before);
    const entries = content
      .split('\n')
      .filter(Boolean)
      .map((line, index) => {
        const envelope = JSON.parse(line) as LogEnvelope;
        return {
          index,
          value: envelope.value,
          timestamp: envelope.timestamp,
        };
      })
      .filter(entry => entry.index > after && entry.index < before);

    const total = entries.length;
    const limit = safeLimit(options.limit, 100);
    const page = entries.slice(0, limit);
    return {
      entries: page,
      next_cursor: page.length < total && page.length > 0 ? String(page[page.length - 1].index) : null,
      total,
    };
  }

  async logClear(namespace: string, log: string): Promise<void> {
    await fs.rm(logFile(namespace, log), { force: true });
  }
}

/**
 * Cloudflare Durable Object storage backend.
 *
 * Uses `ctx.storage` KV-style methods for portable table/log APIs and exposes
 * `ctx.storage.sql.exec` through `data.sql` when the deployed runtime supports
 * SQLite-backed Durable Objects.
 */
export class DurableObjectDataBackend implements DataBackend {
  constructor(private _storage: DurableObjectStorageLike) {}

  async tableGet(namespace: string, table: string, id: string): Promise<any | null> {
    const envelope = await this._storage.get<TableEnvelope>(doTableKey(namespace, table, id));
    return envelope === undefined ? null : envelope.value;
  }

  async tablePut(namespace: string, table: string, id: string, value: any): Promise<void> {
    const envelope: TableEnvelope = {
      id,
      value,
      updated_at: new Date().toISOString(),
    };
    await this._storage.put(doTableKey(namespace, table, id), envelope);
  }

  async tableDelete(namespace: string, table: string, id: string): Promise<boolean> {
    const deleted = await this._storage.delete(doTableKey(namespace, table, id));
    return deleted === undefined ? true : Boolean(deleted);
  }

  async tableHas(namespace: string, table: string, id: string): Promise<boolean> {
    return (await this._storage.get(doTableKey(namespace, table, id))) !== undefined;
  }

  async tableList(namespace: string, table: string, options: DataListOptions = {}): Promise<DataListResult> {
    const prefix = doPrefix(namespace, 'table', table);
    const map = await this._storage.list<TableEnvelope>({ prefix });
    const rows = Array.from(map.values())
      .filter(envelope => !options.prefix || envelope.id.startsWith(options.prefix))
      .sort((a, b) => a.id.localeCompare(b.id));

    const total = rows.length;
    const offset = cursorOffset(options.cursor);
    const limit = safeLimit(options.limit, 100);
    const page = rows.slice(offset, offset + limit);
    return {
      items: page.map(envelope => ({
        id: envelope.id,
        value: envelope.value,
        updated_at: envelope.updated_at,
      })),
      next_cursor: offset + page.length < total ? String(offset + page.length) : null,
      total,
    };
  }

  async tableClear(namespace: string, table: string): Promise<void> {
    const keys = Array.from((await this._storage.list({ prefix: doPrefix(namespace, 'table', table) })).keys());
    if (keys.length > 0) await this._storage.delete(keys);
  }

  async logAppend(namespace: string, log: string, value: any): Promise<DataLogEntry> {
    const metaKey = doLogMetaKey(namespace, log);
    const meta = (await this._storage.get<{ nextIndex: number }>(metaKey)) ?? { nextIndex: 0 };
    const entry: DataLogEntry = {
      index: meta.nextIndex,
      value,
      timestamp: new Date().toISOString(),
    };
    const envelope: LogEnvelope = {
      value,
      timestamp: entry.timestamp,
    };
    await this._storage.put(doLogEntryKey(namespace, log, entry.index), envelope);
    await this._storage.put(metaKey, { nextIndex: entry.index + 1 });
    return entry;
  }

  async logRead(namespace: string, log: string, options: DataLogReadOptions = {}): Promise<DataLogReadResult> {
    const prefix = doLogPrefix(namespace, log);
    const map = await this._storage.list<LogEnvelope | { nextIndex: number }>({ prefix });
    const after = options.after === undefined ? -1 : Number(options.after);
    const before = options.before === undefined ? Number.POSITIVE_INFINITY : Number(options.before);
    const entries = Array.from(map.entries())
      .filter(([key]) => key !== doLogMetaKey(namespace, log))
      .map(([key, envelope]) => {
        const encodedIndex = key.slice(prefix.length);
        const index = Number(encodedIndex);
        const logEnvelope = envelope as LogEnvelope;
        return {
          index,
          value: logEnvelope.value,
          timestamp: logEnvelope.timestamp,
        };
      })
      .filter(entry => Number.isFinite(entry.index) && entry.index > after && entry.index < before)
      .sort((a, b) => a.index - b.index);

    const total = entries.length;
    const limit = safeLimit(options.limit, 100);
    const page = entries.slice(0, limit);
    return {
      entries: page,
      next_cursor: page.length < total && page.length > 0 ? String(page[page.length - 1].index) : null,
      total,
    };
  }

  async logClear(namespace: string, log: string): Promise<void> {
    const keys = Array.from((await this._storage.list({ prefix: doLogPrefix(namespace, log) })).keys());
    if (keys.length > 0) await this._storage.delete(keys);
  }

  sql(_namespace: string): DataSql {
    if (!this._storage.sql) {
      throw new Error(
        'Data SQL is not available on this Durable Object storage; enable SQLite-backed Durable Objects'
      );
    }
    return {
      exec: async <T = any>(query: string, params: unknown[] = []) => {
        const cursor = this._storage.sql!.exec(query, ...params);
        return { rows: fromSqlCursor<T>(cursor) };
      },
    };
  }
}

const defaultBackend = new FileDataBackend();

export function setDefaultDataBackend(backend: DataBackend): void {
  (globalThis as any).__photonDataBackend = backend;
}

export function getDefaultDataBackend(): DataBackend {
  return (globalThis as any).__photonDataBackend ?? defaultBackend;
}

export class DataTable<T = any> {
  constructor(
    private _backend: DataBackend,
    private _namespace: string,
    private _name: string
  ) {}

  async get(id: string): Promise<T | null> {
    return this._backend.tableGet(this._namespace, this._name, id);
  }

  async put(id: string, value: T): Promise<void> {
    await this._backend.tablePut(this._namespace, this._name, id, value);
  }

  async delete(id: string): Promise<boolean> {
    return this._backend.tableDelete(this._namespace, this._name, id);
  }

  async has(id: string): Promise<boolean> {
    return this._backend.tableHas(this._namespace, this._name, id);
  }

  async list(options: DataListOptions = {}): Promise<DataListResult<T>> {
    return this._backend.tableList(this._namespace, this._name, options) as Promise<DataListResult<T>>;
  }

  async clear(): Promise<void> {
    await this._backend.tableClear(this._namespace, this._name);
  }
}

export class DataLog<T = any> {
  constructor(
    private _backend: DataBackend,
    private _namespace: string,
    private _name: string
  ) {}

  async append(value: T): Promise<DataLogEntry<T>> {
    return this._backend.logAppend(this._namespace, this._name, value) as Promise<DataLogEntry<T>>;
  }

  async read(options: DataLogReadOptions = {}): Promise<DataLogReadResult<T>> {
    return this._backend.logRead(this._namespace, this._name, options) as Promise<DataLogReadResult<T>>;
  }

  async clear(): Promise<void> {
    await this._backend.logClear(this._namespace, this._name);
  }

  async delete(): Promise<void> {
    await this.clear();
  }
}

export class DataProvider {
  private _photonId: string;
  private _namespace: string;
  private _sessionId?: string;
  private _baseDir?: string;
  private _backend: DataBackend;

  constructor(
    photonId: string,
    sessionId?: string,
    namespace?: string,
    baseDir?: string,
    backend?: DataBackend
  ) {
    this._photonId = photonId;
    this._namespace = namespace || 'local';
    this._sessionId = sessionId;
    this._baseDir = baseDir;
    this._backend = backend ?? getDefaultDataBackend();
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  set sessionId(id: string | undefined) {
    this._sessionId = id;
  }

  table<T = any>(name: string, scope: DataScope = 'photon'): DataTable<T> {
    return new DataTable<T>(this._backend, this.ns(scope), name);
  }

  log<T = any>(name: string, scope: DataScope = 'photon'): DataLog<T> {
    return new DataLog<T>(this._backend, this.ns(scope), name);
  }

  get sql(): DataSql {
    const sql = this._backend.sql?.(this.ns('photon'));
    if (!sql) {
      throw new Error(
        'Data SQL is not available on this runtime; use a runtime data backend with SQL support'
      );
    }
    return sql;
  }

  private ns(scope: DataScope): string {
    return resolveDataDir(
      this._photonId,
      this._namespace,
      scope,
      this._sessionId,
      this._baseDir
    );
  }
}
