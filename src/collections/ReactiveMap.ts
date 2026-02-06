/**
 * ReactiveMap - A managed Map that auto-emits events on mutations
 *
 * When used as a class property, automatically emits events when entries are
 * set, deleted, or the map is cleared.
 *
 * @example
 * ```typescript
 * import { ReactiveMap } from '@portel/photon-core';
 *
 * export default class Cache {
 *   data = ReactiveMap.create<string, any>('data', (event, data) => this.emit(event, data));
 *
 *   set(key: string, value: any) {
 *     this.data.set(key, value);
 *     // Auto-emits 'data:set' with { key, value }
 *   }
 * }
 * ```
 *
 * Event naming convention:
 * - `{prop}:set` - Entry set (new or updated)
 * - `{prop}:deleted` - Entry deleted
 * - `{prop}:cleared` - All entries cleared
 */

import { Emitter } from './ReactiveArray.js';

export class ReactiveMap<K, V> extends Map<K, V> {
  private _propertyName: string = '';
  private _emitter: Emitter = () => {};

  /**
   * Create a new ReactiveMap bound to a property name and emitter function.
   */
  static create<K, V>(
    propertyName: string,
    emitter: Emitter,
    initialEntries?: Iterable<[K, V]>
  ): ReactiveMap<K, V> {
    const map = new ReactiveMap<K, V>(initialEntries);
    map._propertyName = propertyName;
    map._emitter = emitter;
    return map;
  }

  /**
   * Set a value for a key.
   * Emits `{prop}:set` with `{ key, value, isNew }`.
   */
  set(key: K, value: V): this {
    const isNew = !super.has(key);
    const previous = super.get(key);
    super.set(key, value);
    this._emitter(`${this._propertyName}:set`, { key, value, isNew, previous });
    return this;
  }

  /**
   * Delete an entry by key.
   * Emits `{prop}:deleted` with `{ key, value }` if the key existed.
   */
  delete(key: K): boolean {
    const value = super.get(key);
    const existed = super.delete(key);
    if (existed) {
      this._emitter(`${this._propertyName}:deleted`, { key, value });
    }
    return existed;
  }

  /**
   * Clear all entries from the map.
   * Emits `{prop}:cleared` with the count of removed entries.
   */
  clear(): void {
    const count = super.size;
    super.clear();
    this._emitter(`${this._propertyName}:cleared`, { count });
  }
}
