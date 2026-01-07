/**
 * Generator-based Tool Execution with Ask/Emit Pattern
 *
 * Enables photon tools to use async generator functions with `yield` for:
 * - Interactive user input (ask) - blocks until user responds
 * - Real-time output (emit) - fire and forget, no response needed
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DESIGN PHILOSOPHY
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The `ask` vs `emit` pattern provides instant clarity:
 * - `ask` = "I need something FROM the user" (blocks, returns value)
 * - `emit` = "I'm sending something TO the user" (non-blocking, void)
 *
 * This maps naturally to all runtime contexts:
 *
 * | Runtime    | ask (input)              | emit (output)              |
 * |------------|--------------------------|----------------------------|
 * | REST API   | Returns 202 + continue   | Included in response or SSE|
 * | WebSocket  | Server request → client  | Server push to client      |
 * | CLI        | Readline prompt          | Console output             |
 * | MCP        | Elicitation dialog       | Notification/logging       |
 * | Chatbot    | Bot question → user reply| Status message, typing...  |
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * REST API CONTINUATION PATTERN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * When a generator yields `ask`, REST APIs can implement a continuation flow:
 *
 * ```
 * POST /api/google-tv/connect
 * Body: { ip: "192.168.1.100" }
 *
 * Response (202 Accepted):
 * {
 *   "status": "awaiting_input",
 *   "continuation_id": "ctx_abc123",
 *   "ask": { "type": "text", "id": "pairing_code", "message": "Enter code:" },
 *   "continue": "/api/google-tv/connect/ctx_abc123"
 * }
 *
 * POST /api/google-tv/connect/ctx_abc123
 * Body: { "pairing_code": "123456" }
 *
 * Response (200 OK):
 * { "status": "complete", "result": { "success": true } }
 * ```
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * USAGE EXAMPLE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ```typescript
 * async *connect(params: { ip: string }) {
 *   yield { emit: 'status', message: 'Connecting to TV...' };
 *
 *   await this.startPairing(params.ip);
 *
 *   yield { emit: 'progress', value: 0.3, message: 'Waiting for code...' };
 *
 *   // Blocks until user provides input
 *   const code: string = yield {
 *     ask: 'text',
 *     id: 'pairing_code',
 *     message: 'Enter the 6-digit code shown on TV:',
 *     pattern: '^[0-9]{6}$',
 *     required: true
 *   };
 *
 *   yield { emit: 'status', message: 'Verifying code...' };
 *
 *   await this.sendCode(code);
 *
 *   yield { emit: 'toast', message: 'Connected!', type: 'success' };
 *
 *   return { success: true, paired: true };
 * }
 * ```
 *
 * @module generator
 */

// ══════════════════════════════════════════════════════════════════════════════
// ASK YIELDS - Input from user (blocks until response)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Base properties shared by all ask yields
 */
interface AskBase {
  /**
   * Unique identifier for this input.
   * Used for:
   * - REST API parameter mapping (pre-provided inputs)
   * - Continuation token correlation
   * - Form field identification
   *
   * Auto-generated if not provided (ask_0, ask_1, etc.)
   */
  id?: string;

  /**
   * The prompt message shown to the user.
   * Should be clear and actionable.
   */
  message: string;

  /**
   * Whether this input is required.
   * If false, user can skip/cancel.
   * @default true
   */
  required?: boolean;
}

/**
 * Text input - single line string
 *
 * @example
 * const name: string = yield {
 *   ask: 'text',
 *   message: 'Enter your name:',
 *   default: 'Guest',
 *   placeholder: 'John Doe'
 * };
 */
export interface AskText extends AskBase {
  ask: 'text';
  /** Default value if user submits empty */
  default?: string;
  /** Placeholder hint shown in input field */
  placeholder?: string;
  /** Regex pattern for validation */
  pattern?: string;
  /** Minimum length */
  minLength?: number;
  /** Maximum length */
  maxLength?: number;
}

/**
 * Password input - hidden/masked string
 *
 * @example
 * const apiKey: string = yield {
 *   ask: 'password',
 *   message: 'Enter your API key:'
 * };
 */
export interface AskPassword extends AskBase {
  ask: 'password';
}

/**
 * Confirmation - yes/no boolean
 *
 * @example
 * const confirmed: boolean = yield {
 *   ask: 'confirm',
 *   message: 'Delete this file permanently?',
 *   dangerous: true
 * };
 */
export interface AskConfirm extends AskBase {
  ask: 'confirm';
  /**
   * Mark as dangerous/destructive action.
   * UI may show warning styling (red button, confirmation dialog).
   */
  dangerous?: boolean;
  /** Default value if user just presses enter */
  default?: boolean;
}

/**
 * Selection from predefined options
 *
 * @example
 * // Simple string options
 * const env: string = yield {
 *   ask: 'select',
 *   message: 'Choose environment:',
 *   options: ['development', 'staging', 'production']
 * };
 *
 * // Rich options with labels
 * const region: string = yield {
 *   ask: 'select',
 *   message: 'Select region:',
 *   options: [
 *     { value: 'us-east-1', label: 'US East (N. Virginia)' },
 *     { value: 'eu-west-1', label: 'EU West (Ireland)' }
 *   ]
 * };
 *
 * // Multi-select
 * const features: string[] = yield {
 *   ask: 'select',
 *   message: 'Enable features:',
 *   options: ['auth', 'logging', 'metrics'],
 *   multi: true
 * };
 */
export interface AskSelect extends AskBase {
  ask: 'select';
  /** Available options */
  options: Array<string | { value: string; label: string; description?: string }>;
  /** Allow selecting multiple options */
  multi?: boolean;
  /** Default selected value(s) */
  default?: string | string[];
}

/**
 * Number input with optional constraints
 *
 * @example
 * const quantity: number = yield {
 *   ask: 'number',
 *   message: 'Enter quantity:',
 *   min: 1,
 *   max: 100,
 *   step: 1
 * };
 */
export interface AskNumber extends AskBase {
  ask: 'number';
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Default value */
  default?: number;
}

/**
 * File selection (for supported runtimes)
 *
 * @example
 * const file: FileInfo = yield {
 *   ask: 'file',
 *   message: 'Select a document:',
 *   accept: '.pdf,.doc,.docx',
 *   multiple: false
 * };
 */
export interface AskFile extends AskBase {
  ask: 'file';
  /** Accepted file types (MIME types or extensions) */
  accept?: string;
  /** Allow multiple file selection */
  multiple?: boolean;
}

/**
 * Date/time selection
 *
 * @example
 * const date: string = yield {
 *   ask: 'date',
 *   message: 'Select delivery date:',
 *   min: '2024-01-01',
 *   max: '2024-12-31'
 * };
 */
export interface AskDate extends AskBase {
  ask: 'date';
  /** Include time selection */
  includeTime?: boolean;
  /** Minimum date (ISO string) */
  min?: string;
  /** Maximum date (ISO string) */
  max?: string;
  /** Default value (ISO string) */
  default?: string;
}

/**
 * JSON Schema property definition for form fields
 */
export interface FormSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title?: string;
  description?: string;
  default?: any;
  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  // Number constraints
  minimum?: number;
  maximum?: number;
  // Enum (single select)
  enum?: string[];
  // Enum with titles (single select)
  oneOf?: Array<{ const: string; title: string }>;
}

/**
 * JSON Schema for array (multi-select)
 */
export interface FormSchemaArrayProperty {
  type: 'array';
  title?: string;
  description?: string;
  minItems?: number;
  maxItems?: number;
  items: {
    type?: 'string';
    enum?: string[];
    anyOf?: Array<{ const: string; title: string }>;
  };
  default?: string[];
}

/**
 * Full form schema (flat object only per MCP spec)
 */
export interface FormSchema {
  type: 'object';
  properties: Record<string, FormSchemaProperty | FormSchemaArrayProperty>;
  required?: string[];
}

/**
 * Form-based input - multi-field structured data with JSON Schema
 *
 * Aligned with MCP elicitation spec (form mode).
 * Schema is limited to flat objects with primitive properties.
 *
 * @example
 * // Simple form
 * const contact = yield {
 *   ask: 'form',
 *   id: 'contact',
 *   message: 'Enter your contact details',
 *   schema: {
 *     type: 'object',
 *     properties: {
 *       name: { type: 'string', title: 'Full Name' },
 *       email: { type: 'string', format: 'email', title: 'Email' },
 *       subscribe: { type: 'boolean', title: 'Subscribe to newsletter', default: true }
 *     },
 *     required: ['name', 'email']
 *   }
 * };
 *
 * @example
 * // With enum selection
 * const preferences = yield {
 *   ask: 'form',
 *   id: 'prefs',
 *   message: 'Configure your preferences',
 *   schema: {
 *     type: 'object',
 *     properties: {
 *       theme: {
 *         type: 'string',
 *         title: 'Theme',
 *         oneOf: [
 *           { const: 'light', title: 'Light Mode' },
 *           { const: 'dark', title: 'Dark Mode' },
 *           { const: 'auto', title: 'System Default' }
 *         ],
 *         default: 'auto'
 *       },
 *       notifications: {
 *         type: 'array',
 *         title: 'Notification Types',
 *         items: {
 *           anyOf: [
 *             { const: 'email', title: 'Email' },
 *             { const: 'push', title: 'Push' },
 *             { const: 'sms', title: 'SMS' }
 *           ]
 *         },
 *         default: ['email']
 *       }
 *     }
 *   }
 * };
 */
export interface AskForm extends AskBase {
  ask: 'form';
  /** JSON Schema defining the form fields */
  schema: FormSchema;
}

/**
 * URL-based input - opens browser for OAuth or credential collection
 *
 * Aligned with MCP elicitation spec (url mode).
 * User is redirected to a URL for authentication, then returns.
 *
 * Security: URL opens in secure browser context (not embedded webview).
 * The URL should NOT contain sensitive data.
 *
 * @example
 * // OAuth flow
 * const auth = yield {
 *   ask: 'url',
 *   id: 'github_auth',
 *   message: 'Authenticate with GitHub to continue',
 *   url: 'https://github.com/login/oauth/authorize?client_id=...'
 * };
 *
 * @example
 * // API key collection via secure form
 * const result = yield {
 *   ask: 'url',
 *   id: 'api_key',
 *   message: 'Enter your API key securely',
 *   url: 'https://myservice.com/collect-api-key?callback=...'
 * };
 */
export interface AskUrl extends AskBase {
  ask: 'url';
  /** URL to open in browser */
  url: string;
  /**
   * Unique ID for this elicitation (for async completion).
   * If not provided, one will be generated.
   */
  elicitationId?: string;
}

/**
 * Elicitation response action (MCP-aligned)
 */
export type ElicitAction = 'accept' | 'decline' | 'cancel';

/**
 * Result from a form or url elicitation (MCP-aligned)
 *
 * Different from the simpler ElicitResult in elicit.ts which is for
 * native OS dialogs. This follows the MCP elicitation protocol.
 */
export interface FormElicitResult<T = any> {
  /** User's action */
  action: ElicitAction;
  /** Form content (only present when action is 'accept' and mode is 'form') */
  content?: T;
}

/**
 * Union of all ask (input) yield types
 */
export type AskYield =
  | AskText
  | AskPassword
  | AskConfirm
  | AskSelect
  | AskNumber
  | AskFile
  | AskDate
  | AskForm
  | AskUrl;

// ══════════════════════════════════════════════════════════════════════════════
// EMIT YIELDS - Output to user (fire and forget)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Status message - general purpose user notification
 *
 * Use for: progress updates, step completions, informational messages
 *
 * @example
 * yield { emit: 'status', message: 'Connecting to server...' };
 * yield { emit: 'status', message: 'Upload complete!', type: 'success' };
 */
export interface EmitStatus {
  emit: 'status';
  /** Message to display */
  message: string;
  /** Message type for styling */
  type?: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Progress update - for long-running operations
 *
 * Runtimes may display as: progress bar, percentage, spinner
 *
 * @example
 * yield { emit: 'progress', value: 0.0, message: 'Starting...' };
 * yield { emit: 'progress', value: 0.5, message: 'Halfway there...' };
 * yield { emit: 'progress', value: 1.0, message: 'Complete!' };
 */
export interface EmitProgress {
  emit: 'progress';
  /** Progress value from 0 to 1 (0% to 100%) */
  value: number;
  /** Optional status message */
  message?: string;
  /** Additional metadata */
  meta?: Record<string, any>;
}

/**
 * Streaming data - for chunked responses
 *
 * Use for: streaming text, large file transfers, real-time data
 *
 * @example
 * for await (const chunk of aiStream) {
 *   yield { emit: 'stream', data: chunk.text };
 * }
 * yield { emit: 'stream', data: '', final: true };
 */
export interface EmitStream {
  emit: 'stream';
  /** Data chunk to send */
  data: any;
  /** Whether this is the final chunk */
  final?: boolean;
  /** Content type hint */
  contentType?: string;
}

/**
 * Log message - for debugging/development
 *
 * May be hidden in production or routed to logging system
 *
 * @example
 * yield { emit: 'log', message: 'Processing item', level: 'debug', data: { id: 123 } };
 */
export interface EmitLog {
  emit: 'log';
  /** Log message */
  message: string;
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Additional structured data */
  data?: Record<string, any>;
}

/**
 * Toast notification - ephemeral popup message
 *
 * Use for: success confirmations, quick alerts, non-blocking notices
 *
 * @example
 * yield { emit: 'toast', message: 'Settings saved!', type: 'success' };
 * yield { emit: 'toast', message: 'Connection lost', type: 'error', duration: 5000 };
 */
export interface EmitToast {
  emit: 'toast';
  /** Toast message */
  message: string;
  /** Toast type for styling */
  type?: 'info' | 'success' | 'warning' | 'error';
  /** Display duration in ms (0 = sticky) */
  duration?: number;
}

/**
 * Thinking indicator - for chatbot/AI contexts
 *
 * Shows user that processing is happening (typing dots, spinner)
 *
 * @example
 * yield { emit: 'thinking', active: true };
 * const result = await this.heavyComputation();
 * yield { emit: 'thinking', active: false };
 */
export interface EmitThinking {
  emit: 'thinking';
  /** Whether thinking indicator should be shown */
  active: boolean;
}

/**
 * Rich artifact - embedded content preview
 *
 * Use for: images, code blocks, documents, embeds
 *
 * @example
 * yield {
 *   emit: 'artifact',
 *   type: 'image',
 *   url: 'https://example.com/chart.png',
 *   title: 'Sales Chart Q4'
 * };
 *
 * yield {
 *   emit: 'artifact',
 *   type: 'code',
 *   language: 'typescript',
 *   content: 'const x = 1;',
 *   title: 'Example'
 * };
 */
export interface EmitArtifact {
  emit: 'artifact';
  /** Artifact type */
  type: 'image' | 'code' | 'document' | 'embed' | 'json';
  /** Title/label */
  title?: string;
  /** URL for external content */
  url?: string;
  /** Inline content */
  content?: string;
  /** Language hint for code */
  language?: string;
  /** MIME type hint */
  mimeType?: string;
}

/**
 * UI render - display a UI asset from the Photon's asset folder
 *
 * For MCP Apps (SEP-1865) - renders interactive UI templates
 * The runtime will resolve the asset path and serve the UI appropriately.
 *
 * @example
 * // Show a form UI after a tool runs
 * yield {
 *   emit: 'ui',
 *   id: 'preferences',
 *   title: 'Configure Preferences',
 *   data: { currentTheme: 'dark', volume: 80 }
 * };
 *
 * @example
 * // Show inline HTML content
 * yield {
 *   emit: 'ui',
 *   inline: '<div class="result"><h2>Success!</h2></div>',
 *   mimeType: 'text/html'
 * };
 */
export interface EmitUI {
  emit: 'ui';
  /**
   * UI asset ID (references @ui annotation in Photon)
   * Must match an @ui declared asset: @ui preferences ./ui/preferences.html
   */
  id?: string;
  /** Title for the UI panel/dialog */
  title?: string;
  /** Data to pass to the UI template (available as window.__photon_data__) */
  data?: Record<string, any>;
  /** Inline HTML/JSX content (alternative to id) */
  inline?: string;
  /** MIME type for inline content */
  mimeType?: 'text/html' | 'text/jsx' | 'application/json';
  /** Display mode */
  mode?: 'panel' | 'dialog' | 'fullscreen' | 'inline';
  /** Width hint (CSS value or number in px) */
  width?: string | number;
  /** Height hint (CSS value or number in px) */
  height?: string | number;
}

/**
 * Union of all emit (output) yield types
 */
export type EmitYield =
  | EmitStatus
  | EmitProgress
  | EmitStream
  | EmitLog
  | EmitToast
  | EmitThinking
  | EmitArtifact
  | EmitUI;

// ══════════════════════════════════════════════════════════════════════════════
// COMBINED TYPES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Checkpoint yield - marks a safe resume point for stateful workflows
 *
 * Place checkpoints AFTER side effects to ensure idempotency on resume.
 *
 * @example
 * // After a side effect, checkpoint to preserve state
 * const posted = await this.slack.post_message({ ... });
 * yield { checkpoint: true, state: { step: 1, messageTs: posted.ts } };
 */
export interface CheckpointYield {
  /** Marker for checkpoint yield */
  checkpoint: true;
  /** State snapshot to preserve (accumulated data at this point) */
  state: Record<string, any>;
  /** Optional checkpoint ID (auto-generated if not provided) */
  id?: string;
}

/**
 * Type guard for checkpoint yields
 */
export function isCheckpointYield(y: any): y is CheckpointYield {
  return y && 'checkpoint' in y && y.checkpoint === true;
}

/**
 * All possible yield types from a photon generator
 */
export type PhotonYield = AskYield | EmitYield;

/**
 * Extended yield type including checkpoint (for stateful workflows)
 */
export type StatefulYield = PhotonYield | CheckpointYield;

// ══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS - Check what kind of yield we have
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if yield is an ask (requires user input)
 *
 * @example
 * if (isAskYield(yielded)) {
 *   const userInput = await promptUser(yielded);
 *   generator.next(userInput);
 * }
 */
export function isAskYield(y: PhotonYield | any): y is AskYield {
  return typeof y === 'object' && y !== null && 'ask' in y;
}

/**
 * Check if yield is an emit (output only, no response needed)
 *
 * @example
 * if (isEmitYield(yielded)) {
 *   handleOutput(yielded);
 *   generator.next(); // Continue without value
 * }
 */
export function isEmitYield(y: PhotonYield | any): y is EmitYield {
  return typeof y === 'object' && y !== null && 'emit' in y;
}

/**
 * Get the type of an ask yield
 */
export function getAskType(y: AskYield): AskYield['ask'] {
  return y.ask;
}

/**
 * Get the type of an emit yield
 */
export function getEmitType(y: EmitYield): EmitYield['emit'] {
  return y.emit;
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERATOR DETECTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a function is an async generator function
 *
 * @example
 * if (isAsyncGeneratorFunction(method)) {
 *   const gen = method.call(instance, params);
 *   await executeGenerator(gen, config);
 * }
 */
export function isAsyncGeneratorFunction(fn: any): fn is (...args: any[]) => AsyncGenerator {
  if (!fn) return false;
  const constructor = fn.constructor;
  if (!constructor) return false;
  if (constructor.name === 'AsyncGeneratorFunction') return true;
  const prototype = Object.getPrototypeOf(fn);
  return prototype?.constructor?.name === 'AsyncGeneratorFunction';
}

/**
 * Check if a value is an async generator instance (already invoked)
 *
 * @example
 * const result = method.call(instance, params);
 * if (isAsyncGenerator(result)) {
 *   await executeGenerator(result, config);
 * }
 */
export function isAsyncGenerator(obj: any): obj is AsyncGenerator {
  return obj &&
    typeof obj.next === 'function' &&
    typeof obj.return === 'function' &&
    typeof obj.throw === 'function' &&
    typeof obj[Symbol.asyncIterator] === 'function';
}

// ══════════════════════════════════════════════════════════════════════════════
// INPUT PROVIDER - How runtimes supply values for ask yields
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Function that provides input for an ask yield.
 *
 * Runtimes implement this based on their capabilities:
 * - CLI: readline prompts
 * - MCP: elicitation dialogs
 * - WebSocket: request/response messages
 * - REST: throw NeedsInputError for continuation flow
 *
 * @example
 * const cliInputProvider: InputProvider = async (ask) => {
 *   if (ask.ask === 'text') return await readline(ask.message);
 *   if (ask.ask === 'confirm') return await confirm(ask.message);
 *   // ...
 * };
 */
export type InputProvider = (ask: AskYield) => Promise<any>;

/**
 * Handler for emit yields (output).
 *
 * Runtimes implement this to handle output:
 * - CLI: console.log, progress bar
 * - WebSocket: push message to client
 * - REST: collect for response or send via SSE
 *
 * @example
 * const cliOutputHandler: OutputHandler = (emit) => {
 *   if (emit.emit === 'status') console.log(emit.message);
 *   if (emit.emit === 'progress') updateProgressBar(emit.value);
 * };
 */
export type OutputHandler = (emit: EmitYield) => void | Promise<void>;

/**
 * Configuration for generator execution
 */
export interface GeneratorExecutorConfig {
  /**
   * Provides input values for ask yields.
   * Required unless all asks are pre-provided.
   */
  inputProvider: InputProvider;

  /**
   * Handles emit yields (optional).
   * If not provided, emits are silently ignored.
   */
  outputHandler?: OutputHandler;

  /**
   * Pre-provided inputs keyed by ask id.
   * Used by REST APIs to pass all inputs upfront.
   *
   * @example
   * // If photon yields { ask: 'text', id: 'name', message: '...' }
   * // and preProvidedInputs = { name: 'John' }
   * // The generator receives 'John' without calling inputProvider
   */
  preProvidedInputs?: Record<string, any>;

  /**
   * Timeout for waiting on input (ms).
   * @default 300000 (5 minutes)
   */
  inputTimeout?: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERATOR EXECUTOR - Runs generator tools to completion
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a generator-based photon tool to completion.
 *
 * Handles the yield/resume loop:
 * 1. Run generator until it yields
 * 2. If ask yield: get input from provider (or pre-provided), resume with value
 * 3. If emit yield: call output handler, resume without value
 * 4. Repeat until generator returns
 *
 * @param generator - The async generator to execute
 * @param config - Configuration for handling yields
 * @returns The final return value of the generator
 *
 * @example
 * const result = await executeGenerator(photon.connect({ ip: '192.168.1.1' }), {
 *   inputProvider: async (ask) => {
 *     if (ask.ask === 'text') return await readline(ask.message);
 *     if (ask.ask === 'confirm') return await confirm(ask.message);
 *   },
 *   outputHandler: (emit) => {
 *     if (emit.emit === 'progress') console.log(`${emit.value * 100}%`);
 *   }
 * });
 */
export async function executeGenerator<T>(
  generator: AsyncGenerator<PhotonYield, T, any>,
  config: GeneratorExecutorConfig
): Promise<T> {
  const { inputProvider, outputHandler, preProvidedInputs } = config;

  let askIndex = 0;
  let result = await generator.next();

  while (!result.done) {
    const yielded = result.value;

    // Handle ask yields (need input)
    if (isAskYield(yielded)) {
      // Generate id if not provided
      const askId = yielded.id || `ask_${askIndex++}`;

      // Check for pre-provided input (REST API style)
      if (preProvidedInputs && askId in preProvidedInputs) {
        result = await generator.next(preProvidedInputs[askId]);
        continue;
      }

      // Get input from provider
      const input = await inputProvider(yielded);
      result = await generator.next(input);
    }
    // Handle emit yields (output only)
    else if (isEmitYield(yielded)) {
      if (outputHandler) {
        await outputHandler(yielded);
      }
      // Continue without providing a value
      result = await generator.next();
    }
    // Handle raw values (strings, numbers, objects without emit/ask)
    else {
      if (outputHandler) {
        await outputHandler({ emit: 'stream', data: yielded } as EmitStream);
      } else {
        console.warn('[generator] Unknown yield type without output handler:', yielded);
      }
      result = await generator.next();
    }
  }

  return result.value;
}

// ══════════════════════════════════════════════════════════════════════════════
// YIELD EXTRACTION - For REST API schema generation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Information about an ask yield extracted from a generator.
 * Used to generate REST API schemas (optional parameters).
 */
export interface ExtractedAsk {
  id: string;
  type: AskYield['ask'];
  message: string;
  required?: boolean;
  default?: any;
  options?: Array<string | { value: string; label: string }>;
  pattern?: string;
  min?: number;
  max?: number;
}

/**
 * Extract ask yield information by running generator with mock provider.
 *
 * This is used for REST API schema generation - each ask becomes
 * an optional request parameter.
 *
 * Note: Only extracts asks reachable with default/empty inputs.
 * Conditional asks may not be discovered.
 *
 * @example
 * const asks = await extractAsks(Photon.prototype.connect, { ip: '' });
 * // Returns: [{ id: 'pairing_code', type: 'text', message: '...' }]
 * // These become optional query/body params in REST API
 */
export async function extractAsks(
  generatorFn: (...args: any[]) => AsyncGenerator<PhotonYield, any, any>,
  mockParams: any = {}
): Promise<ExtractedAsk[]> {
  const asks: ExtractedAsk[] = [];
  let askIndex = 0;

  try {
    const generator = generatorFn(mockParams);
    let result = await generator.next();

    while (!result.done) {
      const yielded = result.value;

      if (isAskYield(yielded)) {
        const id = yielded.id || `ask_${askIndex++}`;

        const extracted: ExtractedAsk = {
          id,
          type: yielded.ask,
          message: yielded.message,
          required: yielded.required,
        };

        // Extract type-specific properties
        if (yielded.ask === 'text') {
          extracted.default = yielded.default;
          extracted.pattern = yielded.pattern;
        } else if (yielded.ask === 'confirm') {
          extracted.default = yielded.default;
        } else if (yielded.ask === 'select') {
          extracted.options = yielded.options;
          extracted.default = yielded.default;
        } else if (yielded.ask === 'number') {
          extracted.default = yielded.default;
          extracted.min = yielded.min;
          extracted.max = yielded.max;
        }

        asks.push(extracted);

        // Provide mock value to continue
        const mockValue = getMockValue(yielded);
        result = await generator.next(mockValue);
      } else {
        // Skip emit yields
        result = await generator.next();
      }
    }
  } catch (error) {
    // Generator may throw if it needs real resources
    // Return what we've extracted so far
    console.warn('[generator] Ask extraction incomplete:', error);
  }

  return asks;
}

/**
 * Get a mock value for an ask yield (for extraction purposes)
 */
function getMockValue(ask: AskYield): any {
  switch (ask.ask) {
    case 'text':
    case 'password':
      return (ask as AskText).default || '';
    case 'confirm':
      return (ask as AskConfirm).default ?? true;
    case 'select':
      const select = ask as AskSelect;
      const firstOpt = select.options[0];
      const firstVal = typeof firstOpt === 'string' ? firstOpt : firstOpt.value;
      return select.multi ? [firstVal] : firstVal;
    case 'number':
      return (ask as AskNumber).default ?? 0;
    case 'file':
      return null;
    case 'date':
      return (ask as AskDate).default || new Date().toISOString();
    case 'form':
      // Return object with defaults from schema
      const form = ask as AskForm;
      const result: Record<string, any> = {};
      for (const [key, prop] of Object.entries(form.schema.properties)) {
        if ('default' in prop && prop.default !== undefined) {
          result[key] = prop.default;
        } else if (prop.type === 'string') {
          result[key] = '';
        } else if (prop.type === 'number' || prop.type === 'integer') {
          result[key] = 0;
        } else if (prop.type === 'boolean') {
          result[key] = false;
        } else if (prop.type === 'array') {
          result[key] = [];
        }
      }
      return { action: 'accept', content: result };
    case 'url':
      return { action: 'accept' };
    default:
      return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILT-IN INPUT PROVIDERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Error thrown when input is required but not available.
 *
 * REST APIs can catch this to return a continuation response.
 *
 * @example
 * try {
 *   await executeGenerator(gen, { inputProvider: createPrefilledProvider({}) });
 * } catch (e) {
 *   if (e instanceof NeedsInputError) {
 *     return {
 *       status: 'awaiting_input',
 *       ask: e.ask,
 *       continuation_id: saveContinuation(gen)
 *     };
 *   }
 * }
 */
export class NeedsInputError extends Error {
  public readonly ask: AskYield;

  constructor(ask: AskYield) {
    super(`Input required: ${ask.message}`);
    this.name = 'NeedsInputError';
    this.ask = ask;
  }
}

/**
 * Create an input provider from pre-provided values.
 * Throws NeedsInputError if a required value is missing.
 *
 * Use for REST APIs where all inputs are provided upfront.
 *
 * @example
 * const provider = createPrefilledProvider({
 *   name: 'John',
 *   confirmed: true
 * });
 */
export function createPrefilledProvider(inputs: Record<string, any>): InputProvider {
  let askIndex = 0;

  return async (ask: AskYield) => {
    const id = ask.id || `ask_${askIndex++}`;

    if (id in inputs) {
      return inputs[id];
    }

    // Check for default value
    if ('default' in ask && ask.default !== undefined) {
      return ask.default;
    }

    // No input available
    throw new NeedsInputError(ask);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY: Wrap regular function as generator
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Wrap a regular async function to behave like a generator.
 * Useful for uniform handling in runtimes.
 *
 * @example
 * const gen = wrapAsGenerator(() => photon.simpleMethod(params));
 * const result = await executeGenerator(gen, config);
 */
export async function* wrapAsGenerator<T>(
  asyncFn: () => Promise<T>
): AsyncGenerator<never, T, unknown> {
  return await asyncFn();
}

// ══════════════════════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY - Map old format to new
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Use AskYield instead
 */
export type PromptYield = AskText | AskPassword;

/**
 * @deprecated Use AskConfirm instead
 */
export type ConfirmYield = AskConfirm;

/**
 * @deprecated Use AskSelect instead
 */
export type SelectYield = AskSelect;

/**
 * @deprecated Use EmitProgress instead
 */
export type ProgressYield = EmitProgress;

/**
 * @deprecated Use EmitStream instead
 */
export type StreamYield = EmitStream;

/**
 * @deprecated Use EmitLog instead
 */
export type LogYield = EmitLog;

/**
 * @deprecated Use isAskYield instead
 */
export const isInputYield = isAskYield;

/**
 * @deprecated Use isEmitYield instead
 */
export function isProgressYield(y: PhotonYield): y is EmitProgress {
  return isEmitYield(y) && y.emit === 'progress';
}

/**
 * @deprecated Use isEmitYield instead
 */
export function isStreamYield(y: PhotonYield): y is EmitStream {
  return isEmitYield(y) && y.emit === 'stream';
}

/**
 * @deprecated Use isEmitYield instead
 */
export function isLogYield(y: PhotonYield): y is EmitLog {
  return isEmitYield(y) && y.emit === 'log';
}

/**
 * @deprecated Use extractAsks instead
 */
export const extractYields = extractAsks;

/**
 * @deprecated Use ExtractedAsk instead
 */
export type ExtractedYield = ExtractedAsk;
