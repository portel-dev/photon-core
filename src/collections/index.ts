/**
 * Managed Collections - Auto-emit events on mutations
 *
 * These collections extend the native JavaScript collection types and automatically
 * emit events when their contents change. This enables seamless real-time sync
 * between server and client.
 *
 * ## Level 1: Zero Effort (just add import)
 *
 * ```typescript
 * import { Array } from '@portel/photon-core';
 *
 * export default class TodoList {
 *   items: Array<Task> = [];  // Shadows global Array, auto-wired by runtime
 *
 *   add(text: string) {
 *     this.items.push({ id: crypto.randomUUID(), text });
 *     // Auto-emits 'items:added' - no manual wiring needed!
 *   }
 * }
 * ```
 *
 * ## Level 2: Explicit Control
 *
 * ```typescript
 * import { ReactiveArray } from '@portel/photon-core';
 *
 * // Use .create() for explicit control over property name and emitter
 * items = ReactiveArray.create<Task>('items', customEmitter, initialItems);
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

// Level 1 exports: Shadow global types for zero-effort reactivity
// Just `import { Array } from '@portel/photon-core'` and use normally
export { ReactiveArray as Array } from './ReactiveArray.js';
export { ReactiveMap as Map } from './ReactiveMap.js';
export { ReactiveSet as Set } from './ReactiveSet.js';
