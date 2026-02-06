/**
 * ReactiveSet - A managed Set that auto-emits events on mutations
 *
 * When used as a class property, automatically emits events when values are
 * added, deleted, or the set is cleared.
 *
 * @example
 * ```typescript
 * import { ReactiveSet } from '@portel/photon-core';
 *
 * export default class Tags {
 *   tags = ReactiveSet.create<string>('tags', (event, data) => this.emit(event, data));
 *
 *   addTag(tag: string) {
 *     this.tags.add(tag);
 *     // Auto-emits 'tags:added' with the tag
 *   }
 * }
 * ```
 *
 * Event naming convention:
 * - `{prop}:added` - Value added (if not already present)
 * - `{prop}:deleted` - Value deleted
 * - `{prop}:cleared` - All values cleared
 */

import { Emitter } from './ReactiveArray.js';

export class ReactiveSet<T> extends Set<T> {
  private _propertyName: string = '';
  private _emitter: Emitter = () => {};

  /**
   * Create a new ReactiveSet bound to a property name and emitter function.
   */
  static create<T>(
    propertyName: string,
    emitter: Emitter,
    initialValues?: Iterable<T>
  ): ReactiveSet<T> {
    const set = new ReactiveSet<T>(initialValues);
    set._propertyName = propertyName;
    set._emitter = emitter;
    return set;
  }

  /**
   * Add a value to the set.
   * Emits `{prop}:added` with the value if it wasn't already present.
   */
  add(value: T): this {
    const isNew = !super.has(value);
    super.add(value);
    if (isNew) {
      this._emitter(`${this._propertyName}:added`, value);
    }
    return this;
  }

  /**
   * Delete a value from the set.
   * Emits `{prop}:deleted` with the value if it existed.
   */
  delete(value: T): boolean {
    const existed = super.delete(value);
    if (existed) {
      this._emitter(`${this._propertyName}:deleted`, value);
    }
    return existed;
  }

  /**
   * Clear all values from the set.
   * Emits `{prop}:cleared` with the count of removed values.
   */
  clear(): void {
    const count = super.size;
    super.clear();
    this._emitter(`${this._propertyName}:cleared`, { count });
  }
}
