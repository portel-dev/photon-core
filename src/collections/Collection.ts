/**
 * Collection<T> — Rich queryable collection with Laravel-style chaining
 *
 * Extends ReactiveArray<T> so mutations auto-emit events. Query methods return
 * new immutable Collection instances (no emitter wired) that can be further
 * chained or serialized.
 *
 * @example
 * ```typescript
 * import { PhotonMCP, Collection } from '@portel/photon-core';
 *
 * export default class ProductCatalog extends PhotonMCP {
 *   products = new Collection<Product>();
 *
 *   async catalog() {
 *     return this.products.where('stock', '>', 0).sortBy('price');
 *   }
 *
 *   async dashboard() {
 *     return this.products.where('category', 'Electronics').as('cards');
 *   }
 * }
 * ```
 */

import { ReactiveArray, type Emitter } from './ReactiveArray.js';

/** Comparison operators for where() clauses */
export type CompareOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | '===';

/** Rendering format hints for auto-UI */
export type RenderFormat = 'table' | 'cards' | 'list' | 'chart' | 'grid' | 'chips';

/** Rendering hint attached via .as() */
export interface RenderHint {
  format: RenderFormat;
  options?: Record<string, unknown>;
}

// No-op emitter for query result collections (immutable — no events)
const NOOP_EMITTER: Emitter = () => {};

export class Collection<T> extends ReactiveArray<T> {
  /** Rendering hint set by .as() */
  _renderHint: RenderHint | null = null;

  /**
   * Create a new Collection with optional initial items.
   * Items are loaded without triggering events.
   */
  constructor(items?: T[]) {
    super();
    if (items && items.length > 0) {
      globalThis.Array.prototype.push.apply(this, items);
    }
  }

  /**
   * Create a Collection bound to a property name and emitter (for runtime wiring).
   */
  static override create<T>(
    propertyName: string,
    emitter: Emitter,
    initialItems?: T[]
  ): Collection<T> {
    const col = new Collection<T>(initialItems);
    (col as any)._propertyName = propertyName;
    (col as any)._emitter = emitter;
    return col;
  }

  /**
   * Create a Collection from an existing array.
   */
  static from<T>(items: T[]): Collection<T> {
    return new Collection<T>(items);
  }

  // ─── Helper: create an immutable query-result Collection ───

  private _result<U>(items: U[]): Collection<U> {
    const col = new Collection<U>(items);
    (col as any)._emitter = NOOP_EMITTER;
    return col;
  }

  // ─── Query Methods (immutable — return new Collection) ───

  /**
   * Filter items by field comparison.
   *
   * Shorthand: `where('status', 'active')` → equality check
   * Full:      `where('price', '>', 100)` → comparison
   */
  where(key: keyof T & string, opOrVal: CompareOp | T[keyof T], val?: T[keyof T]): Collection<T> {
    let op: CompareOp;
    let compareVal: unknown;

    if (val === undefined) {
      // Shorthand: where('status', 'active') → equality
      op = '=';
      compareVal = opOrVal;
    } else {
      op = opOrVal as CompareOp;
      compareVal = val;
    }

    return this._result(
      globalThis.Array.prototype.filter.call(this, (item: T) => {
        const fieldVal = (item as Record<string, unknown>)[key];
        switch (op) {
          case '=': return fieldVal == compareVal;
          case '===': return fieldVal === compareVal;
          case '!=': return fieldVal != compareVal;
          case '>': return (fieldVal as number) > (compareVal as number);
          case '<': return (fieldVal as number) < (compareVal as number);
          case '>=': return (fieldVal as number) >= (compareVal as number);
          case '<=': return (fieldVal as number) <= (compareVal as number);
          default: return false;
        }
      }) as T[]
    );
  }

  /**
   * Filter items with a predicate function.
   */
  query(fn: (item: T) => boolean): Collection<T> {
    return this._result(
      globalThis.Array.prototype.filter.call(this, fn) as T[]
    );
  }

  /**
   * Transform each item.
   */
  collect<U>(fn: (item: T) => U): Collection<U> {
    return this._result(
      globalThis.Array.prototype.map.call(this, fn) as U[]
    );
  }

  /**
   * Extract a single field from each item.
   */
  pluck<K extends keyof T>(key: K): Collection<T[K]> {
    return this._result(
      globalThis.Array.prototype.map.call(this, (item: T) => item[key]) as T[K][]
    );
  }

  /**
   * Sort by a key or comparator function.
   * Returns a new sorted Collection (does NOT mutate).
   */
  sortBy(keyOrFn: keyof T & string | ((a: T, b: T) => number), direction: 'asc' | 'desc' = 'asc'): Collection<T> {
    const items = globalThis.Array.from(this) as T[];
    if (typeof keyOrFn === 'function') {
      items.sort(keyOrFn);
    } else {
      const key = keyOrFn;
      items.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[key] as number;
        const bVal = (b as Record<string, unknown>)[key] as number;
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return this._result(items);
  }

  /**
   * Group items by a key or function.
   * Returns a record of group-name → Collection.
   */
  groupBy(keyOrFn: keyof T & string | ((item: T) => string)): Record<string, Collection<T>> {
    const groups: Record<string, T[]> = {};
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      const groupKey = typeof keyOrFn === 'function'
        ? keyOrFn(item)
        : String((item as Record<string, unknown>)[keyOrFn]);
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(item);
    }
    const result: Record<string, Collection<T>> = {};
    for (const [k, v] of Object.entries(groups)) {
      result[k] = this._result(v);
    }
    return result;
  }

  /**
   * Remove duplicates, optionally by a key.
   */
  unique(key?: keyof T & string): Collection<T> {
    const seen = new globalThis.Set<unknown>();
    const items: T[] = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      const val = key ? (item as Record<string, unknown>)[key] : item;
      if (!seen.has(val)) {
        seen.add(val);
        items.push(item);
      }
    }
    return this._result(items);
  }

  /**
   * Take the first n items.
   */
  take(n: number): Collection<T> {
    return this._result(globalThis.Array.prototype.slice.call(this, 0, n) as T[]);
  }

  /**
   * Skip the first n items.
   */
  skip(n: number): Collection<T> {
    return this._result(globalThis.Array.prototype.slice.call(this, n) as T[]);
  }

  // ─── Terminal Methods ───

  /**
   * Get the first item, optionally matching a predicate.
   */
  first(fn?: (item: T) => boolean): T | undefined {
    if (!fn) return this[0];
    for (let i = 0; i < this.length; i++) {
      if (fn(this[i])) return this[i];
    }
    return undefined;
  }

  /**
   * Get the last item, optionally matching a predicate.
   */
  last(fn?: (item: T) => boolean): T | undefined {
    if (!fn) return this[this.length - 1];
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn(this[i])) return this[i];
    }
    return undefined;
  }

  /**
   * Count items.
   */
  count(): number {
    return this.length;
  }

  /**
   * Check if collection is empty.
   */
  isEmpty(): boolean {
    return this.length === 0;
  }

  /**
   * Sum numeric values, optionally by key.
   */
  sum(key?: keyof T & string): number {
    let total = 0;
    for (let i = 0; i < this.length; i++) {
      const val = key ? (this[i] as Record<string, unknown>)[key] : this[i];
      total += Number(val) || 0;
    }
    return total;
  }

  /**
   * Average of numeric values, optionally by key.
   */
  avg(key?: keyof T & string): number {
    if (this.length === 0) return 0;
    return this.sum(key) / this.length;
  }

  /**
   * Item with minimum value (by key or raw comparison).
   */
  min(key?: keyof T & string): T | undefined {
    if (this.length === 0) return undefined;
    let minItem = this[0];
    let minVal = key ? (minItem as Record<string, unknown>)[key] : minItem;
    for (let i = 1; i < this.length; i++) {
      const val = key ? (this[i] as Record<string, unknown>)[key] : this[i];
      if ((val as number) < (minVal as number)) {
        minItem = this[i];
        minVal = val;
      }
    }
    return minItem;
  }

  /**
   * Item with maximum value (by key or raw comparison).
   */
  max(key?: keyof T & string): T | undefined {
    if (this.length === 0) return undefined;
    let maxItem = this[0];
    let maxVal = key ? (maxItem as Record<string, unknown>)[key] : maxItem;
    for (let i = 1; i < this.length; i++) {
      const val = key ? (this[i] as Record<string, unknown>)[key] : this[i];
      if ((val as number) > (maxVal as number)) {
        maxItem = this[i];
        maxVal = val;
      }
    }
    return maxItem;
  }

  /**
   * Reduce the collection to a single value.
   */
  aggregate<U>(fn: (acc: U, item: T) => U, initial: U): U {
    let acc = initial;
    for (let i = 0; i < this.length; i++) {
      acc = fn(acc, this[i]);
    }
    return acc;
  }

  // ─── Rendering Hints ───

  /**
   * Attach a rendering hint for auto-UI.
   * Returns `this` for chaining at the end of a query.
   */
  as(format: RenderFormat, options?: Record<string, unknown>): this {
    this._renderHint = { format, options };
    return this;
  }

  /**
   * Custom serialization.
   * - Without `.as()`: plain array (backward compatible)
   * - With `.as()`: metadata object with `_photonType`, items, and count
   */
  toJSON(): T[] | { _photonType: string; items: T[]; count: number; renderOptions?: Record<string, unknown> } {
    const items = globalThis.Array.from(this) as T[];
    if (!this._renderHint) {
      return items;
    }
    return {
      _photonType: `collection:${this._renderHint.format}`,
      items,
      count: items.length,
      ...(this._renderHint.options ? { renderOptions: this._renderHint.options } : {}),
    };
  }
}
