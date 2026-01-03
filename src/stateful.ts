/**
 * Stateful Workflow Execution with JSONL Persistence
 *
 * Enables photon workflows to be paused, resumed, and recovered across daemon restarts.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DESIGN PHILOSOPHY
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Stateful workflows use an append-only JSONL log for persistence:
 * - Each line is a self-contained JSON entry (start, emit, checkpoint, ask, answer, return, error)
 * - Checkpoints mark safe resume points with accumulated state
 * - Developer places checkpoint AFTER side effects to ensure idempotency
 * - Resume loads log, reconstructs state from last checkpoint, continues
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CHECKPOINT PATTERN (Idempotent Resume)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ```typescript
 * async *workflow() {
 *   // Step 1: Side effect (e.g., posting to Slack)
 *   const posted = await this.slack.post_message({ channel: '#eng', text: 'Hello' });
 *   yield { checkpoint: true, state: { step: 1, messageTs: posted.ts } };
 *
 *   // Step 2: Another side effect (e.g., creating GitHub issue)
 *   const issue = await this.github.create_issue({ ... });
 *   yield { checkpoint: true, state: { step: 2, messageTs: posted.ts, issueNumber: issue.number } };
 *
 *   return { posted, issue };
 * }
 * ```
 *
 * On resume: Load state from last checkpoint, skip to that step, continue execution.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * JSONL LOG FORMAT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ~/.photon/runs/{runId}.jsonl
 *
 * ```jsonl
 * {"t":"start","tool":"generate","params":{"week":"52"},"ts":1704067200}
 * {"t":"emit","emit":"status","message":"Collecting data...","ts":1704067201}
 * {"t":"checkpoint","id":"cp_1","state":{"commits":["a1b2c3"],"step":1},"ts":1704067205}
 * {"t":"ask","id":"approve","ask":"confirm","message":"Continue?","ts":1704067211}
 * {"t":"answer","id":"approve","value":true,"ts":1704067215}
 * {"t":"return","value":{"status":"done"},"ts":1704067220}
 * ```
 *
 * @module stateful
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type {
  StateLogEntry,
  StateLogStart,
  StateLogEmit,
  StateLogCheckpoint,
  StateLogAsk,
  StateLogAnswer,
  StateLogReturn,
  StateLogError,
  WorkflowRun,
  WorkflowStatus,
} from './types.js';
import {
  type PhotonYield,
  type AskYield,
  type EmitYield,
  type InputProvider,
  type OutputHandler,
  isAskYield,
  isEmitYield,
  isAsyncGenerator,
} from './generator.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Default runs directory (~/.photon/runs)
 */
export const RUNS_DIR = path.join(os.homedir(), '.photon', 'runs');

// ══════════════════════════════════════════════════════════════════════════════
// CHECKPOINT YIELD TYPE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Checkpoint yield - marks a safe resume point
 *
 * @example
 * // After a side effect, checkpoint to preserve state
 * const posted = await this.slack.post_message({ ... });
 * yield { checkpoint: true, state: { step: 1, messageTs: posted.ts } };
 */
export interface CheckpointYield {
  /** Marker for checkpoint yield */
  checkpoint: true;
  /** State snapshot to preserve */
  state: Record<string, any>;
  /** Optional checkpoint ID (auto-generated if not provided) */
  id?: string;
}

/**
 * Extended yield type including checkpoint
 */
export type StatefulYield = PhotonYield | CheckpointYield;

/**
 * Type guard for checkpoint yields
 */
export function isCheckpointYield(y: StatefulYield): y is CheckpointYield {
  return 'checkpoint' in y && (y as any).checkpoint === true;
}

// ══════════════════════════════════════════════════════════════════════════════
// STATE LOG - JSONL Persistence
// ══════════════════════════════════════════════════════════════════════════════

/**
 * State log writer for a single workflow run
 */
export class StateLog {
  private runId: string;
  private logPath: string;

  constructor(runId: string, runsDir?: string) {
    this.runId = runId;
    this.logPath = path.join(runsDir || RUNS_DIR, `${runId}.jsonl`);
  }

  /**
   * Ensure runs directory exists
   */
  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
  }

  /**
   * Append an entry to the log
   */
  async append(entry: Omit<StateLogEntry, 'ts'>): Promise<void> {
    const line = JSON.stringify({ ...entry, ts: Date.now() }) + '\n';
    await fs.appendFile(this.logPath, line, 'utf-8');
  }

  /**
   * Write start entry
   */
  async writeStart(tool: string, params: Record<string, any>): Promise<void> {
    await this.append({ t: 'start', tool, params } as StateLogStart);
  }

  /**
   * Write emit entry
   */
  async writeEmit(emit: string, message?: string, data?: any): Promise<void> {
    await this.append({ t: 'emit', emit, message, data } as StateLogEmit);
  }

  /**
   * Write checkpoint entry
   */
  async writeCheckpoint(id: string, state: Record<string, any>): Promise<void> {
    await this.append({ t: 'checkpoint', id, state } as StateLogCheckpoint);
  }

  /**
   * Write ask entry
   */
  async writeAsk(id: string, ask: string, message: string): Promise<void> {
    await this.append({ t: 'ask', id, ask, message } as StateLogAsk);
  }

  /**
   * Write answer entry
   */
  async writeAnswer(id: string, value: any): Promise<void> {
    await this.append({ t: 'answer', id, value } as StateLogAnswer);
  }

  /**
   * Write return entry
   */
  async writeReturn(value: any): Promise<void> {
    await this.append({ t: 'return', value } as StateLogReturn);
  }

  /**
   * Write error entry
   */
  async writeError(message: string, stack?: string): Promise<void> {
    await this.append({ t: 'error', message, stack } as StateLogError);
  }

  /**
   * Read all entries from the log
   */
  async readAll(): Promise<StateLogEntry[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line) as StateLogEntry);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Stream entries from the log (memory efficient for large logs)
   */
  async *stream(): AsyncGenerator<StateLogEntry> {
    const fileStream = createReadStream(this.logPath);
    const rl = createInterface({ input: fileStream });

    for await (const line of rl) {
      if (line.trim()) {
        yield JSON.parse(line) as StateLogEntry;
      }
    }
  }

  /**
   * Get the log file path
   */
  getPath(): string {
    return this.logPath;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RESUME STATE - Reconstructed from log
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Reconstructed state from a workflow log
 */
export interface ResumeState {
  /** Tool/method being executed */
  tool: string;
  /** Input parameters */
  params: Record<string, any>;
  /** Is workflow complete? */
  isComplete: boolean;
  /** Final result (if complete) */
  result?: any;
  /** Error (if failed) */
  error?: string;
  /** Last checkpoint state */
  lastCheckpoint?: {
    id: string;
    state: Record<string, any>;
    ts: number;
  };
  /** Answered asks (id -> value) */
  answers: Record<string, any>;
  /** All entries in order */
  entries: StateLogEntry[];
}

/**
 * Parse a workflow log and reconstruct resume state
 */
export async function parseResumeState(runId: string, runsDir?: string): Promise<ResumeState | null> {
  const log = new StateLog(runId, runsDir);
  const entries = await log.readAll();

  if (entries.length === 0) {
    return null;
  }

  const state: ResumeState = {
    tool: '',
    params: {},
    isComplete: false,
    answers: {},
    entries,
  };

  for (const entry of entries) {
    switch (entry.t) {
      case 'start':
        state.tool = entry.tool;
        state.params = entry.params;
        break;
      case 'checkpoint':
        state.lastCheckpoint = {
          id: entry.id,
          state: entry.state,
          ts: entry.ts,
        };
        break;
      case 'answer':
        state.answers[entry.id] = entry.value;
        break;
      case 'return':
        state.isComplete = true;
        state.result = entry.value;
        break;
      case 'error':
        state.isComplete = true;
        state.error = entry.message;
        break;
    }
  }

  return state;
}

// ══════════════════════════════════════════════════════════════════════════════
// STATEFUL EXECUTOR - Run generator with checkpointing
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for stateful generator execution
 */
export interface StatefulExecutorConfig {
  /** Run ID (generated if not provided) */
  runId?: string;
  /** Runs directory (defaults to ~/.photon/runs) */
  runsDir?: string;
  /** Photon name (for metadata) */
  photon: string;
  /** Tool name being executed */
  tool: string;
  /** Input parameters */
  params: Record<string, any>;
  /** Input provider for ask yields */
  inputProvider: InputProvider;
  /** Output handler for emit yields */
  outputHandler?: OutputHandler;
  /** Resume from existing run (skips to last checkpoint) */
  resume?: boolean;
}

/**
 * Result of stateful execution
 */
export interface StatefulExecutionResult<T> {
  /** Run ID */
  runId: string;
  /** Final result (if completed) */
  result?: T;
  /** Error message (if failed) */
  error?: string;
  /** Was this resumed from a previous run? */
  resumed: boolean;
  /** Final status */
  status: WorkflowStatus;
}

/**
 * Generate a unique run ID
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `run_${timestamp}_${random}`;
}

/**
 * Execute a stateful generator with checkpoint support
 *
 * @example
 * const result = await executeStatefulGenerator(workflow(), {
 *   photon: 'weekly-report',
 *   tool: 'generate',
 *   params: { week: 52 },
 *   inputProvider: cliInputProvider,
 *   outputHandler: (emit) => console.log(emit.message)
 * });
 */
export async function executeStatefulGenerator<T>(
  generatorFn: () => AsyncGenerator<StatefulYield, T, any>,
  config: StatefulExecutorConfig
): Promise<StatefulExecutionResult<T>> {
  const runId = config.runId || generateRunId();
  const log = new StateLog(runId, config.runsDir);
  await log.init();

  let resumed = false;
  let resumeState: ResumeState | null = null;
  let checkpointIndex = 0;
  let askIndex = 0;

  // Check if we should resume
  if (config.resume) {
    resumeState = await parseResumeState(runId, config.runsDir);
    if (resumeState) {
      resumed = true;
      if (resumeState.isComplete) {
        // Already complete, return cached result
        return {
          runId,
          result: resumeState.result,
          error: resumeState.error,
          resumed: true,
          status: resumeState.error ? 'failed' : 'completed',
        };
      }
    }
  }

  // Write start entry (only if not resuming)
  if (!resumed) {
    await log.writeStart(config.tool, config.params);
  }

  try {
    // Call the function and check if it returns a generator or a promise
    const maybeGenerator = generatorFn();

    // Handle non-generator functions (regular async methods)
    if (!isAsyncGenerator(maybeGenerator)) {
      // It's a promise, await it directly
      const finalValue = await maybeGenerator;
      await log.writeReturn(finalValue);

      return {
        runId,
        result: finalValue,
        resumed,
        status: 'completed',
      };
    }

    // It's a generator, proceed with generator execution
    const generator = maybeGenerator;
    let result = await generator.next();

    // If resuming, fast-forward to last checkpoint
    if (resumed && resumeState?.lastCheckpoint) {
      const targetCheckpointId = resumeState.lastCheckpoint.id;
      let foundCheckpoint = false;

      // Fast-forward: run generator, skip until we hit the checkpoint
      while (!result.done) {
        const yielded = result.value;

        if (isCheckpointYield(yielded)) {
          const cpId = yielded.id || `cp_${checkpointIndex++}`;
          if (cpId === targetCheckpointId) {
            foundCheckpoint = true;
            // Inject the saved state
            result = await generator.next(resumeState.lastCheckpoint.state);
            break;
          }
          // Not our checkpoint, continue
          result = await generator.next(yielded.state);
        } else if (isAskYield(yielded)) {
          // Use saved answer
          const askId = yielded.id || `ask_${askIndex++}`;
          if (askId in resumeState.answers) {
            result = await generator.next(resumeState.answers[askId]);
          } else {
            // No saved answer, this shouldn't happen if log is consistent
            throw new Error(`Resume error: missing answer for ask '${askId}'`);
          }
        } else if (isEmitYield(yielded)) {
          // Skip emits during fast-forward
          result = await generator.next();
        } else {
          result = await generator.next();
        }
      }

      if (!foundCheckpoint && !result.done) {
        console.warn(`[stateful] Checkpoint '${targetCheckpointId}' not found during resume`);
      }
    }

    // Normal execution loop
    while (!result.done) {
      const yielded = result.value;

      if (isCheckpointYield(yielded)) {
        const cpId = yielded.id || `cp_${checkpointIndex++}`;
        await log.writeCheckpoint(cpId, yielded.state);

        // Continue with the state (generator may use it)
        result = await generator.next(yielded.state);
      } else if (isAskYield(yielded as PhotonYield)) {
        const askYield = yielded as AskYield;
        const askId = askYield.id || `ask_${askIndex++}`;

        // Check for pre-answered (from resume state)
        if (resumeState && askId in resumeState.answers) {
          result = await generator.next(resumeState.answers[askId]);
          continue;
        }

        // Log ask and get input
        await log.writeAsk(askId, askYield.ask, askYield.message);
        const input = await config.inputProvider(askYield);
        await log.writeAnswer(askId, input);

        result = await generator.next(input);
      } else if (isEmitYield(yielded as PhotonYield)) {
        const emitYield = yielded as EmitYield;
        await log.writeEmit(emitYield.emit, (emitYield as any).message, emitYield);

        if (config.outputHandler) {
          await config.outputHandler(emitYield);
        }

        result = await generator.next();
      } else {
        // Unknown yield, skip
        result = await generator.next();
      }
    }

    // Write return entry
    await log.writeReturn(result.value);

    return {
      runId,
      result: result.value,
      resumed,
      status: 'completed',
    };
  } catch (error: any) {
    await log.writeError(error.message, error.stack);

    return {
      runId,
      error: error.message,
      resumed,
      status: 'failed',
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// WORKFLOW RUN MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * List all workflow runs
 */
export async function listRuns(runsDir?: string): Promise<WorkflowRun[]> {
  const dir = runsDir || RUNS_DIR;
  const runs: WorkflowRun[] = [];

  try {
    const files = await fs.readdir(dir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const runId = file.replace('.jsonl', '');
      const run = await getRunInfo(runId, dir);
      if (run) {
        runs.push(run);
      }
    }

    // Sort by start time, most recent first
    runs.sort((a, b) => b.startedAt - a.startedAt);

    return runs;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get info about a specific run
 */
export async function getRunInfo(runId: string, runsDir?: string): Promise<WorkflowRun | null> {
  const state = await parseResumeState(runId, runsDir);
  if (!state) {
    return null;
  }

  const firstEntry = state.entries[0];
  const lastEntry = state.entries[state.entries.length - 1];

  // Determine status
  let status: WorkflowStatus = 'running';
  if (state.isComplete) {
    status = state.error ? 'failed' : 'completed';
  } else if (state.entries.some(e => e.t === 'ask' && !state.answers[(e as StateLogAsk).id])) {
    status = 'waiting';
  }

  return {
    runId,
    photon: '', // Would need to be stored in start entry
    tool: state.tool,
    params: state.params,
    status,
    startedAt: firstEntry.ts,
    updatedAt: lastEntry.ts,
    completedAt: state.isComplete ? lastEntry.ts : undefined,
    result: state.result,
    error: state.error,
    lastCheckpoint: state.lastCheckpoint,
  };
}

/**
 * Delete a workflow run
 */
export async function deleteRun(runId: string, runsDir?: string): Promise<void> {
  const logPath = path.join(runsDir || RUNS_DIR, `${runId}.jsonl`);
  await fs.unlink(logPath);
}

/**
 * Clean up completed/failed runs older than specified age
 */
export async function cleanupRuns(maxAgeMs: number, runsDir?: string): Promise<number> {
  const runs = await listRuns(runsDir);
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;

  for (const run of runs) {
    if ((run.status === 'completed' || run.status === 'failed') && run.updatedAt < cutoff) {
      await deleteRun(run.runId, runsDir);
      deleted++;
    }
  }

  return deleted;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

export {
  type StateLogEntry,
  type StateLogStart,
  type StateLogEmit,
  type StateLogCheckpoint,
  type StateLogAsk,
  type StateLogAnswer,
  type StateLogReturn,
  type StateLogError,
  type WorkflowRun,
  type WorkflowStatus,
} from './types.js';
