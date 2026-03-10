/**
 * Runtime Scheduling System
 *
 * Programmatic scheduling for photons — create, pause, resume, and cancel
 * scheduled tasks at runtime. Available as `this.schedule` on Photon.
 *
 * Complements static `@scheduled`/`@cron` JSDoc tags with dynamic scheduling.
 * Schedules persist to disk; the daemon reads and executes them.
 *
 * Storage: ~/.photon/schedules/{photonId}/{taskId}.json
 *
 * @example
 * ```typescript
 * export default class Cleanup extends Photon {
 *   async setup() {
 *     await this.schedule.create({
 *       name: 'nightly-cleanup',
 *       schedule: '0 0 * * *',
 *       method: 'purge',
 *       params: { olderThan: 30 },
 *     });
 *   }
 *
 *   async purge({ olderThan }: { olderThan: number }) {
 *     // ... cleanup logic
 *   }
 * }
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────

export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'error';

export interface ScheduledTask {
  /** Unique task ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** Cron expression (5-field: minute hour day month weekday) */
  cron: string;
  /** Method name on this photon to call */
  method: string;
  /** Parameters to pass to the method */
  params: Record<string, any>;
  /** Execute once then mark completed */
  fireOnce: boolean;
  /** Maximum number of executions (0 = unlimited) */
  maxExecutions: number;
  /** Current status */
  status: ScheduleStatus;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last execution */
  lastExecutionAt?: string;
  /** Total execution count */
  executionCount: number;
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** Photon that owns this task */
  photonId: string;
}

export interface CreateScheduleOptions {
  /** Human-readable name (must be unique per photon) */
  name: string;
  /** Cron expression (5-field) or shorthand: '@hourly', '@daily', '@weekly', '@monthly' */
  schedule: string;
  /** Method name on this photon to invoke */
  method: string;
  /** Parameters to pass to the method */
  params?: Record<string, any>;
  /** Optional description */
  description?: string;
  /** Execute once then auto-complete (default: false) */
  fireOnce?: boolean;
  /** Maximum executions before auto-complete (0 = unlimited, default: 0) */
  maxExecutions?: number;
}

export interface UpdateScheduleOptions {
  /** New cron schedule */
  schedule?: string;
  /** New method name */
  method?: string;
  /** New parameters */
  params?: Record<string, any>;
  /** New description */
  description?: string;
  /** Update fire-once flag */
  fireOnce?: boolean;
  /** Update max executions */
  maxExecutions?: number;
}

// ── Cron Shorthands ────────────────────────────────────────────────────

const CRON_SHORTHANDS: Record<string, string> = {
  '@yearly':   '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly':  '0 0 1 * *',
  '@weekly':   '0 0 * * 0',
  '@daily':    '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly':   '0 * * * *',
};

/**
 * Resolve cron shorthands and validate basic format.
 * Returns the resolved 5-field cron expression.
 */
function resolveCron(schedule: string): string {
  const trimmed = schedule.trim();

  // Check shorthands
  const shorthand = CRON_SHORTHANDS[trimmed.toLowerCase()];
  if (shorthand) return shorthand;

  // Validate 5-field cron format
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression: '${schedule}'. Expected 5 fields (minute hour day month weekday) or a shorthand (@hourly, @daily, @weekly, @monthly, @yearly).`
    );
  }

  return trimmed;
}

// ── Storage Helpers ────────────────────────────────────────────────────

function getSchedulesDir(): string {
  return process.env.PHOTON_SCHEDULES_DIR || path.join(os.homedir(), '.photon', 'schedules');
}

function photonScheduleDir(photonId: string): string {
  const safeName = photonId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSchedulesDir(), safeName);
}

function taskPath(photonId: string, taskId: string): string {
  return path.join(photonScheduleDir(photonId), `${taskId}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// ── Schedule Provider ──────────────────────────────────────────────────

/**
 * Runtime Schedule Provider
 *
 * Provides CRUD operations for scheduled tasks.
 * Tasks are persisted as JSON files that the daemon watches and executes.
 */
export class ScheduleProvider {
  private _photonId: string;

  constructor(photonId: string) {
    this._photonId = photonId;
  }

  /**
   * Create a new scheduled task
   *
   * @example
   * ```typescript
   * await this.schedule.create({
   *   name: 'daily-report',
   *   schedule: '0 9 * * *',
   *   method: 'generate',
   *   params: { format: 'pdf' },
   * });
   * ```
   */
  async create(options: CreateScheduleOptions): Promise<ScheduledTask> {
    const cron = resolveCron(options.schedule);

    // Check for duplicate name
    const existing = await this.getByName(options.name);
    if (existing) {
      throw new Error(`Schedule '${options.name}' already exists (id: ${existing.id}). Use update() to modify it.`);
    }

    const task: ScheduledTask = {
      id: randomUUID(),
      name: options.name,
      description: options.description,
      cron,
      method: options.method,
      params: options.params || {},
      fireOnce: options.fireOnce ?? false,
      maxExecutions: options.maxExecutions ?? 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      executionCount: 0,
      photonId: this._photonId,
    };

    await this._save(task);
    return task;
  }

  /**
   * Get a scheduled task by ID
   */
  async get(taskId: string): Promise<ScheduledTask | null> {
    try {
      const content = await fs.readFile(taskPath(this._photonId, taskId), 'utf-8');
      return JSON.parse(content) as ScheduledTask;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Get a scheduled task by name
   */
  async getByName(name: string): Promise<ScheduledTask | null> {
    const tasks = await this.list();
    return tasks.find(t => t.name === name) || null;
  }

  /**
   * List all scheduled tasks, optionally filtered by status
   */
  async list(status?: ScheduleStatus): Promise<ScheduledTask[]> {
    const dir = photonScheduleDir(this._photonId);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    const tasks: ScheduledTask[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        const task = JSON.parse(content) as ScheduledTask;
        if (!status || task.status === status) {
          tasks.push(task);
        }
      } catch {
        // Skip corrupt files
      }
    }

    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Update an existing scheduled task
   */
  async update(taskId: string, updates: UpdateScheduleOptions): Promise<ScheduledTask> {
    const task = await this.get(taskId);
    if (!task) {
      throw new Error(`Schedule not found: ${taskId}`);
    }

    if (updates.schedule !== undefined) {
      task.cron = resolveCron(updates.schedule);
    }
    if (updates.method !== undefined) task.method = updates.method;
    if (updates.params !== undefined) task.params = updates.params;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.fireOnce !== undefined) task.fireOnce = updates.fireOnce;
    if (updates.maxExecutions !== undefined) task.maxExecutions = updates.maxExecutions;

    await this._save(task);
    return task;
  }

  /**
   * Pause a scheduled task (stops execution until resumed)
   */
  async pause(taskId: string): Promise<ScheduledTask> {
    const task = await this.get(taskId);
    if (!task) throw new Error(`Schedule not found: ${taskId}`);
    if (task.status !== 'active') {
      throw new Error(`Cannot pause task with status '${task.status}'. Only active tasks can be paused.`);
    }
    task.status = 'paused';
    await this._save(task);
    return task;
  }

  /**
   * Resume a paused scheduled task
   */
  async resume(taskId: string): Promise<ScheduledTask> {
    const task = await this.get(taskId);
    if (!task) throw new Error(`Schedule not found: ${taskId}`);
    if (task.status !== 'paused') {
      throw new Error(`Cannot resume task with status '${task.status}'. Only paused tasks can be resumed.`);
    }
    task.status = 'active';
    await this._save(task);
    return task;
  }

  /**
   * Cancel (delete) a scheduled task
   */
  async cancel(taskId: string): Promise<boolean> {
    try {
      await fs.unlink(taskPath(this._photonId, taskId));
      return true;
    } catch (err: any) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * Cancel a scheduled task by name
   */
  async cancelByName(name: string): Promise<boolean> {
    const task = await this.getByName(name);
    if (!task) return false;
    return this.cancel(task.id);
  }

  /**
   * Check if a schedule with the given name exists
   */
  async has(name: string): Promise<boolean> {
    const task = await this.getByName(name);
    return task !== null;
  }

  /**
   * Cancel all scheduled tasks for this photon
   */
  async cancelAll(): Promise<number> {
    const tasks = await this.list();
    let count = 0;
    for (const task of tasks) {
      if (await this.cancel(task.id)) count++;
    }
    return count;
  }

  /** @internal */
  private async _save(task: ScheduledTask): Promise<void> {
    const dir = photonScheduleDir(this._photonId);
    await ensureDir(dir);
    await fs.writeFile(taskPath(this._photonId, task.id), JSON.stringify(task, null, 2));
  }
}
