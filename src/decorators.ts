/**
 * Photon Decorators
 *
 * High-level decorators for daemon features:
 * - @scheduled(cron) - Run methods on a cron schedule
 * - @webhook - Expose methods as HTTP webhook endpoints
 * - @locked(name) - Require distributed lock before execution
 */

// ============================================================================
// Metadata Storage
// ============================================================================

/** Metadata for scheduled methods */
export interface ScheduledMetadata {
  cron: string;
  jobId?: string;
}

/** Metadata for webhook methods */
export interface WebhookMetadata {
  path?: string;
  secret?: string;
}

/** Metadata for locked methods */
export interface LockedMetadata {
  lockName: string;
  timeout?: number;
}

// Store metadata using WeakMaps (keyed by class prototype)
const scheduledMethods = new WeakMap<object, Map<string | symbol, ScheduledMetadata>>();
const webhookMethods = new WeakMap<object, Map<string | symbol, WebhookMetadata>>();
const lockedMethods = new WeakMap<object, Map<string | symbol, LockedMetadata>>();

// ============================================================================
// @scheduled Decorator
// ============================================================================

/**
 * Mark a method to run on a cron schedule
 *
 * When the photon runs in daemon mode, methods with this decorator
 * are automatically registered as scheduled jobs.
 *
 * @param cron Cron expression (5 fields: minute hour day-of-month month day-of-week)
 * @param options Optional configuration
 */
export function scheduled(
  cron: string,
  options?: { jobId?: string }
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const metadata: ScheduledMetadata = {
      cron,
      jobId: options?.jobId,
    };

    // Get or create the map for this class
    let methods = scheduledMethods.get(target);
    if (!methods) {
      methods = new Map();
      scheduledMethods.set(target, methods);
    }
    methods.set(propertyKey, metadata);

    return descriptor;
  };
}

/**
 * Get scheduled metadata for a method
 */
export function getScheduledMetadata(
  target: object,
  propertyKey: string | symbol
): ScheduledMetadata | undefined {
  return scheduledMethods.get(target)?.get(propertyKey);
}

/**
 * Get all scheduled methods from a class instance or prototype
 */
export function getScheduledMethods(
  target: object
): Map<string | symbol, ScheduledMetadata> {
  // Check the prototype if target is an instance
  const proto = Object.getPrototypeOf(target);
  return scheduledMethods.get(proto) || scheduledMethods.get(target) || new Map();
}

// ============================================================================
// @webhook Decorator
// ============================================================================

/**
 * Mark a method as callable via HTTP webhook
 *
 * When the daemon's webhook server is running, methods with this decorator
 * can be called via POST /webhook/{methodName}
 *
 * @param options Optional configuration (path override, secret)
 */
export function webhook(options?: WebhookMetadata): MethodDecorator;
export function webhook(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
): PropertyDescriptor;
export function webhook(
  targetOrOptions?: object | WebhookMetadata,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor
): MethodDecorator | PropertyDescriptor {
  // Called with options: @webhook({ path: 'foo' })
  if (!propertyKey) {
    const options = (targetOrOptions || {}) as WebhookMetadata;
    return function (
      target: object,
      key: string | symbol,
      desc: PropertyDescriptor
    ) {
      applyWebhookMetadata(target, key, options);
      return desc;
    };
  }

  // Called without options: @webhook
  applyWebhookMetadata(targetOrOptions as object, propertyKey, {});
  return descriptor!;
}

function applyWebhookMetadata(
  target: object,
  propertyKey: string | symbol,
  metadata: WebhookMetadata
) {
  let methods = webhookMethods.get(target);
  if (!methods) {
    methods = new Map();
    webhookMethods.set(target, methods);
  }
  methods.set(propertyKey, metadata);
}

/**
 * Get webhook metadata for a method
 */
export function getWebhookMetadata(
  target: object,
  propertyKey: string | symbol
): WebhookMetadata | undefined {
  return webhookMethods.get(target)?.get(propertyKey);
}

/**
 * Get all webhook methods from a class instance or prototype
 */
export function getWebhookMethods(
  target: object
): Map<string | symbol, WebhookMetadata> {
  const proto = Object.getPrototypeOf(target);
  return webhookMethods.get(proto) || webhookMethods.get(target) || new Map();
}

// ============================================================================
// @locked Decorator
// ============================================================================

/**
 * Require a distributed lock before method execution
 *
 * The lock is acquired before the method runs and released after.
 * If the lock cannot be acquired, an error is thrown.
 *
 * @param lockName Name of the lock to acquire
 * @param options Optional configuration (timeout)
 */
export function locked(
  lockName: string,
  options?: { timeout?: number }
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const metadata: LockedMetadata = {
      lockName,
      timeout: options?.timeout,
    };

    // Store metadata
    let methods = lockedMethods.get(target);
    if (!methods) {
      methods = new Map();
      lockedMethods.set(target, methods);
    }
    methods.set(propertyKey, metadata);

    // Wrap the original method to acquire/release lock
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const lockManager = getLockManager();

      if (!lockManager) {
        // No lock manager available, run without lock
        return originalMethod.apply(this, args);
      }

      const acquired = await lockManager.acquire(lockName, metadata.timeout);
      if (!acquired) {
        throw new Error(`Could not acquire lock: ${lockName}`);
      }

      try {
        return await originalMethod.apply(this, args);
      } finally {
        await lockManager.release(lockName);
      }
    };

    return descriptor;
  };
}

/**
 * Get locked metadata for a method
 */
export function getLockedMetadata(
  target: object,
  propertyKey: string | symbol
): LockedMetadata | undefined {
  return lockedMethods.get(target)?.get(propertyKey);
}

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
// withLock Helper (for non-decorator usage)
// ============================================================================

/**
 * Execute a function with a distributed lock
 *
 * Use this for fine-grained locking within a method, or when you
 * don't want to lock the entire method.
 *
 * @param lockName Name of the lock to acquire
 * @param fn Function to execute while holding the lock
 * @param timeout Optional lock timeout in ms (default 30000)
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
