/**
 * ReactiveArray - A managed array that auto-emits events on mutations
 *
 * When used as a class property, automatically emits events when items are
 * added, removed, or updated.
 *
 * @example
 * ```typescript
 * import { ReactiveArray } from '@portel/photon-core';
 *
 * export default class TodoList {
 *   items = ReactiveArray.create<Task>('items', (event, data) => this.emit(event, data));
 *
 *   add(text: string) {
 *     this.items.push({ id: crypto.randomUUID(), text });
 *     // Auto-emits 'items:added' with the new item
 *   }
 * }
 * ```
 *
 * Event naming convention (inspired by Firebase):
 * - `{prop}:added` - Item pushed/inserted
 * - `{prop}:removed` - Item popped/spliced out
 * - `{prop}:updated` - Item at index changed
 * - `{prop}:changed` - Full array replaced
 */

export type Emitter = (event: string, data: unknown) => void;

export class ReactiveArray<T> extends Array<T> {
  private _propertyName: string = '';
  private _emitter: Emitter = () => {};

  /**
   * Create a new ReactiveArray bound to a property name and emitter function.
   * The emitter is called with event names like 'items:added', 'items:removed', etc.
   */
  static create<T>(
    propertyName: string,
    emitter: Emitter,
    initialItems?: T[]
  ): ReactiveArray<T> {
    const arr = new ReactiveArray<T>();
    arr._propertyName = propertyName;
    arr._emitter = emitter;
    if (initialItems) {
      // Use super.push to avoid triggering events during init
      globalThis.Array.prototype.push.apply(arr, initialItems);
    }
    return arr;
  }

  /**
   * Add one or more elements to the end of the array.
   * Emits `{prop}:added` for each item.
   */
  push(...items: T[]): number {
    const result = super.push(...items);
    items.forEach((item) => this._emitter(`${this._propertyName}:added`, item));
    return result;
  }

  /**
   * Remove the last element from the array.
   * Emits `{prop}:removed` with the removed item.
   */
  pop(): T | undefined {
    const item = super.pop();
    if (item !== undefined) {
      this._emitter(`${this._propertyName}:removed`, item);
    }
    return item;
  }

  /**
   * Remove the first element from the array.
   * Emits `{prop}:removed` with the removed item.
   */
  shift(): T | undefined {
    const item = super.shift();
    if (item !== undefined) {
      this._emitter(`${this._propertyName}:removed`, item);
    }
    return item;
  }

  /**
   * Add one or more elements to the beginning of the array.
   * Emits `{prop}:added` for each item.
   */
  unshift(...items: T[]): number {
    const result = super.unshift(...items);
    items.forEach((item) => this._emitter(`${this._propertyName}:added`, item));
    return result;
  }

  /**
   * Remove/replace elements from the array.
   * Emits `{prop}:removed` for deleted items and `{prop}:added` for inserted items.
   */
  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    const removed = super.splice(start, deleteCount ?? 0, ...items);
    removed.forEach((item) =>
      this._emitter(`${this._propertyName}:removed`, item)
    );
    items.forEach((item) => this._emitter(`${this._propertyName}:added`, item));
    return removed;
  }

  /**
   * Set an element at a specific index.
   * Emits `{prop}:updated` with `{ index, value, previous }`.
   */
  set(index: number, value: T): void {
    const previous = this[index];
    this[index] = value;
    this._emitter(`${this._propertyName}:updated`, { index, value, previous });
  }

  /**
   * Replace all items in the array.
   * Emits `{prop}:changed` with the full new array.
   */
  replaceAll(items: T[]): void {
    // Clear and replace
    this.length = 0;
    globalThis.Array.prototype.push.apply(this, items);
    this._emitter(`${this._propertyName}:changed`, [...items]);
  }

  /**
   * Clear all items from the array.
   * Emits `{prop}:changed` with an empty array.
   */
  clear(): void {
    this.length = 0;
    this._emitter(`${this._propertyName}:changed`, []);
  }

  /**
   * Sort the array in place.
   * Emits `{prop}:changed` with the sorted array.
   */
  sort(compareFn?: (a: T, b: T) => number): this {
    super.sort(compareFn);
    this._emitter(`${this._propertyName}:changed`, [...this]);
    return this;
  }

  /**
   * Reverse the array in place.
   * Emits `{prop}:changed` with the reversed array.
   */
  reverse(): this {
    super.reverse();
    this._emitter(`${this._propertyName}:changed`, [...this]);
    return this;
  }

  /**
   * Fill the array with a value.
   * Emits `{prop}:changed` with the filled array.
   */
  fill(value: T, start?: number, end?: number): this {
    super.fill(value, start, end);
    this._emitter(`${this._propertyName}:changed`, [...this]);
    return this;
  }

  /**
   * Copy items within the array.
   * Emits `{prop}:changed` with the modified array.
   */
  copyWithin(target: number, start: number, end?: number): this {
    super.copyWithin(target, start, end);
    this._emitter(`${this._propertyName}:changed`, [...this]);
    return this;
  }
}
