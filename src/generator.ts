/**
 * Generator-based Tool Execution
 *
 * Enables photon tools to use generator functions with `yield` for:
 * - User prompts (text, password, confirm, select)
 * - Progress updates
 * - Streaming responses
 * - Multi-step wizards
 *
 * The runtime handles yields appropriately based on the protocol:
 * - REST: Extract yields as optional parameters
 * - WebSocket/MCP: Interactive prompts
 * - CLI: readline prompts
 * - Fallback: Native OS dialogs
 *
 * @example
 * ```typescript
 * async *connect(params: { ip: string }) {
 *   await this.startConnection(params.ip);
 *
 *   const code: string = yield {
 *     prompt: 'Enter the 6-digit code:',
 *     type: 'text'
 *   };
 *
 *   await this.sendCode(code);
 *   return { success: true };
 * }
 * ```
 */

// ============================================================================
// Yield Types - What can be yielded from generator tools
// ============================================================================

/**
 * Text input prompt
 */
export interface PromptYield {
  prompt: string;
  type?: 'text' | 'password';
  default?: string;
  /** Unique identifier for this prompt (auto-generated if not provided) */
  id?: string;
  /** Validation pattern */
  pattern?: string;
  /** Whether this prompt is required */
  required?: boolean;
}

/**
 * Confirmation dialog
 */
export interface ConfirmYield {
  confirm: string;
  /** Mark as dangerous action (UI can show warning styling) */
  dangerous?: boolean;
  id?: string;
}

/**
 * Selection from options
 */
export interface SelectYield {
  select: string;
  options: Array<string | { value: string; label: string }>;
  /** Allow multiple selections */
  multi?: boolean;
  id?: string;
}

/**
 * Progress update (for long-running operations)
 */
export interface ProgressYield {
  progress: number;  // 0-100
  status?: string;
  /** Additional data to stream to client */
  data?: any;
}

/**
 * Stream data to client
 */
export interface StreamYield {
  stream: any;
  /** Whether this is the final chunk */
  final?: boolean;
}

/**
 * Log/debug message
 */
export interface LogYield {
  log: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * All possible yield types
 */
export type PhotonYield =
  | PromptYield
  | ConfirmYield
  | SelectYield
  | ProgressYield
  | StreamYield
  | LogYield;

/**
 * Check if a yield requires user input
 */
export function isInputYield(y: PhotonYield): y is PromptYield | ConfirmYield | SelectYield {
  return 'prompt' in y || 'confirm' in y || 'select' in y;
}

/**
 * Check if a yield is a progress update
 */
export function isProgressYield(y: PhotonYield): y is ProgressYield {
  return 'progress' in y;
}

/**
 * Check if a yield is streaming data
 */
export function isStreamYield(y: PhotonYield): y is StreamYield {
  return 'stream' in y;
}

/**
 * Check if a yield is a log message
 */
export function isLogYield(y: PhotonYield): y is LogYield {
  return 'log' in y;
}

// ============================================================================
// Input Provider - How runtimes provide values for yields
// ============================================================================

/**
 * Function that provides input for a yield
 * Runtimes implement this based on their protocol
 */
export type InputProvider = (yielded: PhotonYield) => Promise<any>;

/**
 * Handler for non-input yields (progress, stream, log)
 */
export type OutputHandler = (yielded: PhotonYield) => void | Promise<void>;

/**
 * Configuration for generator execution
 */
export interface GeneratorExecutorConfig {
  /** Provides input for prompt/confirm/select yields */
  inputProvider: InputProvider;
  /** Handles progress/stream/log yields */
  outputHandler?: OutputHandler;
  /** Pre-provided inputs (for REST APIs) */
  preProvidedInputs?: Record<string, any>;
  /** Timeout for waiting for input (ms) */
  inputTimeout?: number;
}

// ============================================================================
// Generator Executor - Runs generator tools
// ============================================================================

/**
 * Execute a generator-based tool
 *
 * @param generator - The async generator to execute
 * @param config - Configuration for handling yields
 * @returns The final return value of the generator
 *
 * @example
 * ```typescript
 * const result = await executeGenerator(tool.connect({ ip: '192.168.1.1' }), {
 *   inputProvider: async (y) => {
 *     if ('prompt' in y) return await readline(y.prompt);
 *     if ('confirm' in y) return await confirm(y.confirm);
 *   },
 *   outputHandler: (y) => {
 *     if ('progress' in y) console.log(`Progress: ${y.progress}%`);
 *   }
 * });
 * ```
 */
export async function executeGenerator<T>(
  generator: AsyncGenerator<PhotonYield, T, any>,
  config: GeneratorExecutorConfig
): Promise<T> {
  const { inputProvider, outputHandler, preProvidedInputs } = config;

  let promptIndex = 0;
  let result = await generator.next();

  while (!result.done) {
    const yielded = result.value;

    // Handle input yields (prompt, confirm, select)
    if (isInputYield(yielded)) {
      // Generate ID if not provided
      const yieldId = yielded.id || `prompt_${promptIndex++}`;

      // Check for pre-provided input (REST API style)
      if (preProvidedInputs && yieldId in preProvidedInputs) {
        result = await generator.next(preProvidedInputs[yieldId]);
        continue;
      }

      // Get input from provider
      const input = await inputProvider(yielded);
      result = await generator.next(input);
    }
    // Handle output yields (progress, stream, log)
    else {
      if (outputHandler) {
        await outputHandler(yielded);
      }
      // Continue without providing a value
      result = await generator.next();
    }
  }

  return result.value;
}

// ============================================================================
// Generator Detection - Check if a function is a generator
// ============================================================================

/**
 * Check if a function is an async generator function
 */
export function isAsyncGeneratorFunction(fn: any): fn is (...args: any[]) => AsyncGenerator {
  if (!fn) return false;
  const constructor = fn.constructor;
  if (!constructor) return false;
  if (constructor.name === 'AsyncGeneratorFunction') return true;
  // Check prototype chain
  const prototype = Object.getPrototypeOf(fn);
  return prototype && prototype.constructor &&
         prototype.constructor.name === 'AsyncGeneratorFunction';
}

/**
 * Check if a value is an async generator (already invoked)
 */
export function isAsyncGenerator(obj: any): obj is AsyncGenerator {
  return obj &&
         typeof obj.next === 'function' &&
         typeof obj.return === 'function' &&
         typeof obj.throw === 'function' &&
         typeof obj[Symbol.asyncIterator] === 'function';
}

// ============================================================================
// Yield Extraction - Extract yields from generator for schema generation
// ============================================================================

/**
 * Information about a yield point extracted from a generator
 */
export interface ExtractedYield {
  id: string;
  type: 'prompt' | 'confirm' | 'select';
  prompt?: string;
  options?: Array<string | { value: string; label: string }>;
  default?: string;
  required?: boolean;
  pattern?: string;
  dangerous?: boolean;
  multi?: boolean;
}

/**
 * Extract yield information by running generator with mock provider
 * This is used for REST API schema generation
 *
 * Note: This only extracts yields that are reachable with default/empty inputs
 * Complex conditional yields may not be extracted
 */
export async function extractYields(
  generatorFn: (...args: any[]) => AsyncGenerator<PhotonYield, any, any>,
  mockParams: any = {}
): Promise<ExtractedYield[]> {
  const yields: ExtractedYield[] = [];
  let promptIndex = 0;

  try {
    const generator = generatorFn(mockParams);
    let result = await generator.next();

    while (!result.done) {
      const yielded = result.value;

      if (isInputYield(yielded)) {
        const id = yielded.id || `prompt_${promptIndex++}`;

        if ('prompt' in yielded) {
          yields.push({
            id,
            type: yielded.type === 'password' ? 'prompt' : 'prompt',
            prompt: yielded.prompt,
            default: yielded.default,
            required: yielded.required,
            pattern: yielded.pattern,
          });
          // Provide mock value to continue
          result = await generator.next(yielded.default || '');
        } else if ('confirm' in yielded) {
          yields.push({
            id,
            type: 'confirm',
            prompt: yielded.confirm,
            dangerous: yielded.dangerous,
          });
          result = await generator.next(true);
        } else if ('select' in yielded) {
          yields.push({
            id,
            type: 'select',
            prompt: yielded.select,
            options: yielded.options,
            multi: yielded.multi,
          });
          const firstOption = yielded.options[0];
          const mockValue = typeof firstOption === 'string' ? firstOption : firstOption.value;
          result = await generator.next(yielded.multi ? [mockValue] : mockValue);
        }
      } else {
        // Skip non-input yields
        result = await generator.next();
      }
    }
  } catch (error) {
    // Generator may throw if it needs real resources
    // Return what we've extracted so far
    console.warn('[generator] Yield extraction incomplete:', error);
  }

  return yields;
}

// ============================================================================
// Default Input Providers - Built-in implementations for common scenarios
// ============================================================================

/**
 * Create an input provider from pre-provided values
 * Throws if a required value is missing
 */
export function createPrefilledProvider(inputs: Record<string, any>): InputProvider {
  return async (yielded: PhotonYield) => {
    if (!isInputYield(yielded)) return undefined;

    const id = yielded.id || 'default';

    if (id in inputs) {
      return inputs[id];
    }

    // Check for default value
    if ('prompt' in yielded && yielded.default !== undefined) {
      return yielded.default;
    }

    throw new NeedsInputError(yielded);
  };
}

/**
 * Error thrown when input is needed but not available
 * Runtimes can catch this to return appropriate responses
 */
export class NeedsInputError extends Error {
  public readonly yielded: PhotonYield;

  constructor(yielded: PhotonYield) {
    const message = 'prompt' in yielded ? yielded.prompt :
                    'confirm' in yielded ? yielded.confirm :
                    'select' in yielded ? yielded.select : 'Input required';
    super(`Input required: ${message}`);
    this.name = 'NeedsInputError';
    this.yielded = yielded;
  }
}

// ============================================================================
// Utility: Wrap regular async function to match generator interface
// ============================================================================

/**
 * Wrap a regular async function to behave like a generator
 * Useful for uniform handling in runtimes
 */
export async function* wrapAsGenerator<T>(
  asyncFn: () => Promise<T>
): AsyncGenerator<never, T, unknown> {
  return await asyncFn();
}
