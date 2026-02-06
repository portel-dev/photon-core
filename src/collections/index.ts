/**
 * Managed Collections - Auto-emit events on mutations
 *
 * These collections extend the native JavaScript collection types and automatically
 * emit events when their contents change. This enables seamless real-time sync
 * between server and client.
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
 *     // Auto-emits 'items:added' - UI updates automatically!
 *   }
 * }
 * ```
 *
 * On the client:
 * ```javascript
 * todoList.onItemsAdded((item) => {
 *   // Auto UI handles this - item appears with animation
 * });
 * ```
 *
 * Event naming convention (inspired by Firebase):
 * | Operation           | Event Name          | Data                    |
 * |---------------------|---------------------|-------------------------|
 * | Array.push(item)    | `{prop}:added`      | The item                |
 * | Array.splice(i, 1)  | `{prop}:removed`    | The removed item        |
 * | Array.set(i, x)     | `{prop}:updated`    | { index, value, prev }  |
 * | Array.replaceAll()  | `{prop}:changed`    | All items               |
 * | Map.set(k, v)       | `{prop}:set`        | { key, value, isNew }   |
 * | Map.delete(k)       | `{prop}:deleted`    | { key, value }          |
 * | Set.add(v)          | `{prop}:added`      | The value               |
 * | Set.delete(v)       | `{prop}:deleted`    | The value               |
 */

export { ReactiveArray, type Emitter } from './ReactiveArray.js';
export { ReactiveMap } from './ReactiveMap.js';
export { ReactiveSet } from './ReactiveSet.js';
