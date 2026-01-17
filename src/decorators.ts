/**
 * Photon Lock Helpers
 *
 * Runtime support for distributed locking via daemon.
 * The @locked docblock tag and this.withLock() helper both use this.
 */

// ============================================================================
// Lock Manager Interface
// ============================================================================

/**
 * Interface for lock management
 * Implemented by daemon client or other providers
 */
export interface LockManager {
  acquire(lockName: string, timeout?: number): Promise<boolean>;
  release(lockName: string): Promise<boolean>;
}

let _lockManager: LockManager | null = null;

/**
 * Set the global lock manager (called by runtime)
 * @internal
 */
export function setLockManager(manager: LockManager | null): void {
  _lockManager = manager;
}

/**
 * Get the current lock manager
 * @internal
 */
export function getLockManager(): LockManager | null {
  return _lockManager;
}

// ============================================================================
// withLock Helper
// ============================================================================

/**
 * Execute a function with a distributed lock
 *
 * Use this for fine-grained locking within a method, or when you
 * need dynamic lock names.
 *
 * @param lockName Name of the lock to acquire
 * @param fn Function to execute while holding the lock
 * @param timeout Optional lock timeout in ms (default 30000)
 *
 * @example
 * ```typescript
 * async moveTask(params: { taskId: string; column: string }) {
 *   return this.withLock(`task:${params.taskId}`, async () => {
 *     const task = await this.loadTask(params.taskId);
 *     task.column = params.column;
 *     await this.saveTask(task);
 *     return task;
 *   });
 * }
 * ```
 */
export async function withLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  timeout?: number
): Promise<T> {
  const lockManager = getLockManager();

  if (!lockManager) {
    // No lock manager, run without lock
    return fn();
  }

  const acquired = await lockManager.acquire(lockName, timeout);
  if (!acquired) {
    throw new Error(`Could not acquire lock: ${lockName}`);
  }

  try {
    return await fn();
  } finally {
    await lockManager.release(lockName);
  }
}
