/**
 * Execution Audit Trail
 *
 * Automatic observability for photon tool executions.
 * Records every tool call with input, output, timing, and errors
 * in append-only JSONL files at ~/.photon/logs/{photonId}/executions.jsonl
 *
 * Zero effort for developers — the runtime records everything.
 *
 * @example
 * ```typescript
 * // Query via API
 * const audit = new AuditTrail();
 * const recent = await audit.query('todo-list');           // last 20
 * const adds = await audit.query('todo-list', { method: 'add' }); // filter by method
 * const entry = await audit.get('exec_abc123');             // single execution
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * A single execution record
 */
export interface ExecutionRecord {
  /** Unique execution ID */
  id: string;
  /** Photon name (kebab-case) */
  photon: string;
  /** Method/tool name that was called */
  method: string;
  /** Input parameters */
  input: Record<string, any>;
  /** Output result (null if error) */
  output: any;
  /** Execution duration in milliseconds */
  duration_ms: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Parent execution ID (for cross-photon calls) */
  parent_id: string | null;
  /** Error message (null if success) */
  error: string | null;
}

/**
 * Query options for filtering execution history
 */
export interface AuditQueryOptions {
  /** Filter by method name */
  method?: string;
  /** Maximum number of results (default: 20) */
  limit?: number;
  /** Only return executions after this ISO timestamp */
  after?: string;
  /** Only return executions before this ISO timestamp */
  before?: string;
  /** Only return failed executions */
  errorsOnly?: boolean;
}

/** Default retention period: 30 days in milliseconds */
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generate a unique execution ID
 */
export function generateExecutionId(): string {
  return `exec_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Get the logs directory for a photon
 */
function getLogDir(photonId: string): string {
  const safeName = photonId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseDir = process.env.PHOTON_LOG_DIR || path.join(os.homedir(), '.photon', 'logs');
  return path.join(baseDir, safeName);
}

/**
 * Get the executions log file path
 */
function getLogPath(photonId: string): string {
  return path.join(getLogDir(photonId), 'executions.jsonl');
}

/**
 * Execution Audit Trail
 *
 * Records and queries photon tool executions.
 * Append-only JSONL storage for reliability.
 */
export class AuditTrail {
  /** Write counter for auto-prune scheduling */
  private _writeCount = 0;

  /** How often to auto-prune (every N writes) */
  private _pruneInterval = 100;

  /**
   * Record a tool execution
   *
   * Called by the runtime before/after every tool call.
   * Uses append to avoid read-modify-write races.
   * Auto-prunes records older than 30 days every 100 writes.
   */
  record(entry: ExecutionRecord): void {
    const logPath = getLogPath(entry.photon);
    const logDir = path.dirname(logPath);

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line);

    // Auto-prune on schedule (non-blocking, best-effort)
    this._writeCount++;
    if (this._writeCount >= this._pruneInterval) {
      this._writeCount = 0;
      try {
        this.prune(DEFAULT_RETENTION_MS, entry.photon);
      } catch {
        // Prune is best-effort — never fail a record() because of it
      }
    }
  }

  /**
   * Start an execution — returns a finish function
   *
   * Convenience method for the runtime to wrap around tool calls:
   * ```typescript
   * const finish = audit.start('todo-list', 'add', { text: 'Buy milk' });
   * try {
   *   const result = await executeTool(...);
   *   finish(result);
   * } catch (err) {
   *   finish(null, err);
   * }
   * ```
   */
  start(
    photon: string,
    method: string,
    input: Record<string, any>,
    parentId?: string
  ): {
    id: string;
    finish: (output: any, error?: Error | string | null) => ExecutionRecord;
  } {
    const id = generateExecutionId();
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    return {
      id,
      finish: (output: any, error?: Error | string | null) => {
        const entry: ExecutionRecord = {
          id,
          photon,
          method,
          input: this.sanitizeInput(input),
          output: error ? null : this.truncateOutput(output),
          duration_ms: Date.now() - startTime,
          timestamp,
          parent_id: parentId || null,
          error: error
            ? typeof error === 'string'
              ? error
              : error.message
            : null,
        };
        this.record(entry);
        return entry;
      },
    };
  }

  /**
   * Query execution history for a photon
   */
  async query(
    photonId: string,
    options: AuditQueryOptions = {}
  ): Promise<ExecutionRecord[]> {
    const logPath = getLogPath(photonId);
    const limit = options.limit ?? 20;

    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse all records (bottom-up for most recent first)
    let records: ExecutionRecord[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const record = JSON.parse(lines[i]) as ExecutionRecord;

        // Apply filters
        if (options.method && record.method !== options.method) continue;
        if (options.errorsOnly && !record.error) continue;
        if (options.after && record.timestamp < options.after) continue;
        if (options.before && record.timestamp > options.before) continue;

        records.push(record);

        if (records.length >= limit) break;
      } catch {
        // Skip malformed lines
      }
    }

    return records;
  }

  /**
   * Get a single execution by ID
   */
  async get(
    executionId: string,
    photonId?: string
  ): Promise<ExecutionRecord | null> {
    // If photonId provided, search only that photon's log
    if (photonId) {
      return this.findInLog(getLogPath(photonId), executionId);
    }

    // Otherwise, search all photon logs
    const baseDir = process.env.PHOTON_LOG_DIR || path.join(os.homedir(), '.photon', 'logs');
    if (!fs.existsSync(baseDir)) return null;

    const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      const found = this.findInLog(path.join(baseDir, dir, 'executions.jsonl'), executionId);
      if (found) return found;
    }

    return null;
  }

  /**
   * Get execution trace — an execution and all its children
   */
  async trace(executionId: string): Promise<ExecutionRecord[]> {
    const root = await this.get(executionId);
    if (!root) return [];

    const result = [root];

    // Find all children across all photon logs
    const baseDir = process.env.PHOTON_LOG_DIR || path.join(os.homedir(), '.photon', 'logs');
    if (!fs.existsSync(baseDir)) return result;

    const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      const logPath = path.join(baseDir, dir, 'executions.jsonl');
      if (!fs.existsSync(logPath)) continue;

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as ExecutionRecord;
          if (record.parent_id === executionId) {
            result.push(record);
          }
        } catch {
          // Skip
        }
      }
    }

    // Sort by timestamp
    return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * List all photons that have execution logs
   */
  listPhotons(): string[] {
    const baseDir = process.env.PHOTON_LOG_DIR || path.join(os.homedir(), '.photon', 'logs');
    if (!fs.existsSync(baseDir)) return [];

    return fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .filter(d => fs.existsSync(path.join(baseDir, d.name, 'executions.jsonl')))
      .map(d => d.name);
  }

  /**
   * Prune records older than retention period
   *
   * Rewrites log files keeping only records within the retention window.
   * Called automatically on every 100th record() call, or manually.
   *
   * @param retentionMs Max age in ms (default: 30 days)
   * @param photonId Prune a specific photon, or all if omitted
   * @returns Number of records removed
   */
  prune(retentionMs: number = DEFAULT_RETENTION_MS, photonId?: string): number {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    let totalRemoved = 0;

    const photons = photonId ? [photonId] : this.listPhotons();

    for (const id of photons) {
      const logPath = getLogPath(id);
      if (!fs.existsSync(logPath)) continue;

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const kept: string[] = [];

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as ExecutionRecord;
          if (record.timestamp >= cutoff) {
            kept.push(line);
          } else {
            totalRemoved++;
          }
        } catch {
          // Drop malformed lines during prune
          totalRemoved++;
        }
      }

      if (kept.length === 0) {
        // Remove empty log file and directory
        fs.unlinkSync(logPath);
        const dir = path.dirname(logPath);
        try { fs.rmdirSync(dir); } catch { /* not empty, fine */ }
      } else if (kept.length < lines.length) {
        fs.writeFileSync(logPath, kept.join('\n') + '\n');
      }
    }

    return totalRemoved;
  }

  /**
   * Clear execution logs for a photon (or all)
   */
  clear(photonId?: string): void {
    if (photonId) {
      const logPath = getLogPath(photonId);
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
      return;
    }

    // Clear all
    const baseDir = process.env.PHOTON_LOG_DIR || path.join(os.homedir(), '.photon', 'logs');
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  }

  /**
   * Sanitize input to avoid logging sensitive data
   */
  private sanitizeInput(input: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      // Redact common sensitive field names
      if (/password|secret|token|apikey|api_key|credential/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Truncate large outputs to keep log files manageable
   */
  private truncateOutput(output: any): any {
    if (output === undefined || output === null) return output;

    const str = typeof output === 'string' ? output : JSON.stringify(output);
    if (str.length > 10_000) {
      return { _truncated: true, preview: str.slice(0, 1000), length: str.length };
    }
    return output;
  }

  /**
   * Find a record by ID in a specific log file
   */
  private findInLog(logPath: string, executionId: string): ExecutionRecord | null {
    if (!fs.existsSync(logPath)) return null;

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Search from end (most recent) for efficiency
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const record = JSON.parse(lines[i]) as ExecutionRecord;
        if (record.id === executionId) return record;
      } catch {
        // Skip
      }
    }

    return null;
  }
}

// Default singleton instance
let _defaultAuditTrail: AuditTrail | null = null;

/**
 * Get the default audit trail instance
 */
export function getAuditTrail(): AuditTrail {
  if (!_defaultAuditTrail) {
    _defaultAuditTrail = new AuditTrail();
  }
  return _defaultAuditTrail;
}

/**
 * Set a custom audit trail (for testing or custom storage)
 */
export function setAuditTrail(trail: AuditTrail): void {
  _defaultAuditTrail = trail;
}
