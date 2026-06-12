/**
 * Photon Base Class
 *
 * Optional base class for creating Photons.
 * You don't need to extend this - any class with async methods works!
 *
 * Usage:
 * ```typescript
 * export default class Calculator extends Photon {
 *   /**
 *    * Add two numbers together
 *    * @param a First number
 *    * @param b Second number
 *    *\/
 *   async add(params: { a: number; b: number }) {
 *     return params.a + params.b;
 *   }
 * }
 * ```
 *
 * Or without extending (plain class):
 * ```typescript
 * export default class Calculator {
 *   async add(params: { a: number; b: number }) {
 *     return params.a + params.b;
 *   }
 * }
 * ```
 *
 * With MCP access (requires runtime support):
 * ```typescript
 * export default class SlackReporter extends Photon {
 *   async report() {
 *     const github = this.mcp('github');
 *     const issues = await github.call('list_issues', { repo: 'foo/bar' });
 *     // Or with proxy: await github.list_issues({ repo: 'foo/bar' })
 *   }
 * }
 * ```
 */

import { MCPClient, MCPClientFactory, createMCPProxy } from '@portel/mcp';
import { executionContext, type CallerInfo } from '@portel/cli';
import { getBroker } from './channels/index.js';
import { withLock as withLockHelper } from './decorators.js';
import { MemoryProvider } from './memory.js';
import { ScheduleProvider } from './schedule.js';
import * as path from 'path';
import * as fs from 'fs';
import { getPhotonDataDir } from './data-paths.js';
import type {
  AskYield,
  InputProvider,
  SampleParams,
  SamplingMessage,
  SamplingProvider,
} from './generator.js';

/**
 * Simple base class for creating Photons
 *
 * - Class name = Photon name
 * - Public async methods = Tools
 * - Return value = Tool result
 */
export class Photon {
  /**
   * Photon name (MCP name) - set by runtime loader
   * Used to identify the source of emitted events for injected photon routing
   * @internal
   */
  _photonName?: string;

  /**
   * Photon namespace (marketplace owner) - set by runtime loader
   * Used for data path resolution: .data/{namespace}/{name}/
   * @internal
   */
  _photonNamespace?: string;

  /**
   * PHOTON_DIR this instance was loaded from - set by runtime loader.
   * Pinned so .data/ resolves to the same root regardless of which
   * process (CLI, daemon, worker) reads the photon back later. Without
   * this pin, MemoryProvider falls back to getDefaultContext().baseDir
   * and writes/reads can drift between cwd-derived locations.
   * @internal
   */
  _baseDir?: string;

  /**
   * Absolute path to the .photon.ts/.photon.js source file - set by runtime loader
   * Used for storage() and assets() path resolution
   * @internal
   */
  _photonFilePath?: string;

  /**
   * Stat snapshot captured when the current photon instance was loaded.
   * Used by executeTool() to detect out-of-band edits so CLI-direct and
   * lite-loader callers see new code immediately after a file save.
   * See `_photonReloader` for the callback invoked on change.
   * @internal
   */
  _photonSourceStat?: { mtimeMs: number; size: number; ino: number };

  /**
   * Callback the loader registers so executeTool() can trigger a live
   * reload when `_photonFilePath` has changed since load. The loader is
   * expected to re-evaluate the file, replace the cached module, and
   * update `_photonSourceStat` on success. Missing callback means the
   * gate is a no-op (the original behavior).
   * @internal
   */
  _photonReloader?: () => Promise<void>;

  /**
   * Dynamic photon resolver - injected by runtime loader
   * Used by this.photon.use() for runtime photon access
   * @internal
   */
  _photonResolver?: (name: string, instance?: string) => Promise<any>;

  /**
   * Scoped memory provider - lazy-initialized on first access
   * @internal
   */
  private _memory?: MemoryProvider;

  /**
   * Scoped schedule provider - lazy-initialized on first access
   * @internal
   */
  private _schedule?: ScheduleProvider;

  /**
   * Session ID for session-scoped memory - set by runtime
   * @internal
   */
  _sessionId?: string;

  /**
   * Cloudflare Worker env, present only when the photon runs on a
   * deployed CF Worker. Carries bindings (KV, R2, secrets, custom env
   * vars) that aren't part of the typed `this.cf.*` namespace. Undefined
   * on the local CLI / Beam daemon.
   *
   * Typed loosely so photon-core stays free of `@cloudflare/workers-types`.
   * Photons that need exact binding shapes can re-declare the property
   * with a stricter type.
   */
  readonly env?: Record<string, unknown>;

  /**
   * True when the active `/mcp` request passed the `PHOTON_MCP_BEARER`
   * Worker secret check. False/undefined when:
   *  - no secret is configured (the bearer gate is off),
   *  - the photon is running locally (CLI / Beam),
   *  - the call arrived via `/api/*`, `__call`, or any path other than
   *    a transport-authed `tools/call`.
   *
   * User code can guard sensitive methods with:
   * ```typescript
   * if (!this.mcpAuthed) throw new Error('unauthorized');
   * ```
   * Backed by AsyncLocalStorage on the deployed Worker so concurrent
   * tool calls each see their own value.
   */
  readonly mcpAuthed?: boolean;

  /**
   * Authenticated caller identity
   *
   * Populated from MCP OAuth when `@auth` is enabled on the photon.
   * Returns the identity of whoever is calling the current method —
   * human (via social login) or agent (via API key).
   *
   * Returns an anonymous caller if no auth token was provided.
   *
   * @example
   * ```typescript
   * // In a method:
   * const userId = this.caller.id;     // stable user ID from JWT
   * const name = this.caller.name;     // display name
   * const isAnon = this.caller.anonymous; // true if no auth
   * ```
   */
  get caller(): CallerInfo {
    const store = executionContext.getStore();
    return store?.caller ?? { id: 'anonymous', anonymous: true };
  }

  /**
   * Ask the caller a yes/no question and await the answer.
   *
   * Imperative sugar over the existing `{ ask: 'confirm' }` yield.
   * Works in any method (generator or plain async), routed through the
   * runtime's elicitation pipeline — returns `true`/`false` based on the
   * user's response in whichever surface the client offers (Beam
   * dialog, Claude confirm prompt, CLI readline, etc.).
   *
   * @throws If no client with elicitation capability is connected.
   *
   * @example
   * ```typescript
   * if (await this.confirm('Delete all records?')) {
   *   await purge();
   * }
   * ```
   */
  async confirm(question: string): Promise<boolean> {
    const provider = this._resolveInputProvider('this.confirm()');
    const result = await provider({ ask: 'confirm', question, message: question } as AskYield);
    return Boolean(result);
  }

  /**
   * Pose an arbitrary elicitation request and await the answer.
   *
   * Accepts any `AskYield` (text, password, select, number, form, etc.)
   * and returns the client's response. Prefer `this.confirm()` for
   * yes/no; use `yield { ask: ... }` inside async-generator workflows.
   * `this.elicit()` is the imperative form for plain async methods
   * that need a single input without the generator plumbing.
   *
   * The name matches MCP spec terminology (`elicitation/create`) to
   * avoid ambiguity with the legacy `this.ask(type, message, opts)`
   * factory, which just constructs an `AskYield` object for use with
   * `yield`.
   *
   * @throws If no client with elicitation capability is connected.
   */
  async elicit<T = unknown>(params: AskYield): Promise<T> {
    const provider = this._resolveInputProvider('this.elicit()');
    return (await provider(params)) as T;
  }

  /**
   * Ask the client's LLM to generate text (MCP `sampling/createMessage`).
   *
   * The caller's agent model generates the completion — no API key
   * needed in the photon, and inference cost is borne by whoever is
   * driving the tool. The client must declare the `sampling`
   * capability during initialize; otherwise this throws.
   *
   * Returns just the generated text for the common case. For
   * multi-block / image / structured responses, access the underlying
   * provider via the runtime.
   *
   * @example
   * ```typescript
   * async summarize(params: { text: string }) {
   *   return await this.sample({
   *     prompt: `Summarize this in one sentence:\n\n${params.text}`,
   *     maxTokens: 128,
   *   });
   * }
   * ```
   */
  async sample(params: SampleParams): Promise<string> {
    const store = executionContext.getStore() as { samplingProvider?: SamplingProvider } | undefined;
    const provider = store?.samplingProvider;
    if (!provider) {
      throw new Error(
        'this.sample() requires the connected MCP client to declare the ' +
          '`sampling` capability. None is available in this invocation — ' +
          "either the client didn't declare sampling during initialize, or " +
          'this method is being called outside an MCP request context (e.g. ' +
          'from a scheduled task without a live session).'
      );
    }
    if (!params.prompt && !params.messages?.length) {
      throw new Error('this.sample() requires either `prompt` or `messages`.');
    }
    const messages: SamplingMessage[] =
      params.messages ??
      [{ role: 'user', content: { type: 'text', text: params.prompt! } }];
    const result = await provider({
      messages,
      systemPrompt: params.systemPrompt,
      maxTokens: params.maxTokens ?? 1024,
      temperature: params.temperature,
      modelPreferences: params.modelPreferences,
      stopSequences: params.stopSequences,
      includeContext: params.includeContext,
    });
    const first = Array.isArray(result.content) ? result.content[0] : result.content;
    if (first && first.type === 'text') return first.text;
    // Non-text responses (image-only) — return empty string rather than
    // a JSON-stringified blob so callers can reliably concatenate the
    // result. Users needing image output should hit the provider directly.
    return '';
  }

  /**
   * Workspace roots declared by the connected MCP client (per spec
   * `roots/list`). Each entry is a `{ uri, name? }` pair; URIs always start
   * with `file://` per the current spec.
   *
   * Empty when:
   *   - the client did not declare the `roots` capability,
   *   - the photon is running outside a live MCP session (CLI / unit test),
   *   - the client returned an empty list.
   *
   * The runtime fetches `roots/list` once per session and refreshes on
   * `notifications/roots/list_changed`, so reads inside a tool call are
   * synchronous and consistent.
   *
   * @example
   * ```typescript
   * async listProjectFiles() {
   *   const roots = this.roots;
   *   if (roots.length === 0) return [];
   *   // ...resolve files under each root.uri...
   * }
   * ```
   */
  get roots(): Array<{ uri: string; name?: string }> {
    const store = executionContext.getStore() as
      | { roots?: Array<{ uri: string; name?: string }> }
      | undefined;
    return store?.roots ?? [];
  }

  /**
   * Notify subscribed MCP clients that the resource at `uri` has changed.
   * Triggers `notifications/resources/updated` for every client that has
   * issued `resources/subscribe` against this exact URI.
   *
   * Default no-op so calls from CLI execution (no live MCP server) do not
   * throw. The runtime overrides this with a wired version on every
   * instance it constructs; that wired version dispatches into the
   * server's subscription registry.
   *
   * Use it from `@stateful` methods or any code path that mutates the
   * data behind a `@resource <uri-template>` resolver:
   *
   * @example
   * ```typescript
   * async upsertPerson(params: { slug: string; ... }) {
   *   this.people[params.slug] = ...;
   *   this.notifyResourceUpdated(`person://${params.slug}`);
   * }
   * ```
   */
  notifyResourceUpdated(_uri: string): void {
    // Runtime injects a wired version on every instance — see
    // photon/src/loader.ts injectResourceNotifier. This default is for
    // standalone use (CLI, unit tests) where no MCP server is attached.
  }

  /**
   * Internal: resolve the runtime-supplied input provider, throwing a
   * clear error if none is attached to the current execution context.
   * @internal
   */
  private _resolveInputProvider(forMethod: string): InputProvider {
    const store = executionContext.getStore() as { inputProvider?: InputProvider } | undefined;
    const provider = store?.inputProvider;
    if (!provider) {
      throw new Error(
        `${forMethod} requires a connected MCP client that supports elicitation. ` +
          'The runtime attaches an input provider for every tool invocation; ' +
          "this call is running outside that context (e.g. a background task " +
          'without a session, or a client that declined elicitation).'
      );
    }
    return provider;
  }

  /**
   * Scoped key-value storage for photon data
   *
   * Provides persistent storage with 3 scopes:
   * - `photon` (default): Private to this photon
   * - `session`: Per-user session
   * - `global`: Shared across all photons
   *
   * @example
   * ```typescript
   * // Store and retrieve data
   * await this.memory.set('items', [{ id: '1', text: 'Buy milk' }]);
   * const items = await this.memory.get<Item[]>('items');
   *
   * // Global scope (shared across photons)
   * await this.memory.set('theme', 'dark', 'global');
   *
   * // Atomic update
   * await this.memory.update<number>('count', n => (n ?? 0) + 1);
   * ```
   */
  get memory(): MemoryProvider {
    if (!this._memory) {
      const name = this._photonName || this.constructor.name
        .replace(/MCP$/, '')
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
      this._memory = new MemoryProvider(
        name,
        this._sessionId,
        this._photonNamespace,
        this._baseDir
      );
    }
    return this._memory;
  }

  /**
   * Runtime task scheduling
   *
   * Create, pause, resume, and cancel scheduled tasks programmatically.
   * Complements static `@scheduled`/`@cron` tags with dynamic scheduling.
   * Tasks persist to disk and are executed by the daemon.
   *
   * @example
   * ```typescript
   * // Create a cron schedule
   * await this.schedule.create({
   *   name: 'nightly-cleanup',
   *   schedule: '0 0 * * *',
   *   method: 'purge',
   *   params: { olderThan: 30 },
   * });
   *
   * // One-shot (runs once then auto-completes)
   * await this.schedule.create({
   *   name: 'delayed-notify',
   *   schedule: '@hourly',
   *   method: 'notify',
   *   fireOnce: true,
   * });
   *
   * // Manage schedules
   * const tasks = await this.schedule.list('active');
   * await this.schedule.pause(id);
   * await this.schedule.resume(id);
   * await this.schedule.cancel(id);
   * ```
   */
  get schedule(): ScheduleProvider {
    if (!this._schedule) {
      const name = this._photonName || this.constructor.name
        .replace(/MCP$/, '')
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
      this._schedule = new ScheduleProvider(
        name,
        this._baseDir,
        this._scheduleUnscheduleHook
      );
    }
    return this._schedule;
  }

  /**
   * Runtime-injected hook that evicts an in-memory cron registration.
   * The photon runtime (photon-repo loader) attaches a callback that
   * IPCs the daemon's `unschedule` request; photon-core doesn't know
   * about the daemon, so the hook is passed through to ScheduleProvider
   * which calls it after unlinking the disk file. Without the hook,
   * `this.schedule.cancel()` leaves a ghost registration that keeps
   * firing until the next daemon restart.
   * @internal
   */
  _scheduleUnscheduleHook?: import('./schedule.js').UnscheduleHook;

  /**
   * Get an absolute path to a storage directory for this photon's data.
   *
   * Uses the symlink/installed path (not resolved) so data stays at the
   * installed location. Directories are auto-created.
   *
   * @param subpath Sub-directory within the photon's data folder (e.g., 'auth', 'media')
   * @returns Absolute path to the directory
   *
   * @example
   * ```typescript
   * const authDir = this.storage('auth');
   * // ~/.photon/.data/portel-dev/whatsapp/auth/
   *
   * const mediaDir = this.storage('media/images');
   * // ~/.photon/.data/portel-dev/whatsapp/media/images/
   * ```
   */
  protected storage(subpath: string): string {
    if (!this._photonFilePath) {
      throw new Error(
        'storage() requires _photonFilePath to be set by the runtime loader. ' +
        'Ensure this photon is loaded through the standard runtime.'
      );
    }
    const name = this._photonName || path.basename(this._photonFilePath).replace(/\.photon\.(ts|js)$/, '');
    const ns = this._photonNamespace || 'local';
    const target = path.join(getPhotonDataDir(ns, name, this._baseDir), subpath);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  /**
   * Get an absolute path to an assets directory for this photon.
   *
   * Uses realpathSync to follow symlinks — assets travel with source code,
   * not the installed location. Useful for marketplace-distributed resources
   * like HTML templates, images, etc.
   *
   * @param subpath Sub-path within the assets folder (e.g., 'templates', 'icons/logo.png')
   * @returns Absolute path to the asset file or directory
   *
   * @example
   * ```typescript
   * const templateDir = this.assets('templates');
   * // /real/path/to/portel-dev/whatsapp/assets/templates/
   *
   * const logo = this.assets('icons/logo.png');
   * // /real/path/to/portel-dev/whatsapp/assets/icons/logo.png
   * ```
   */
  protected assets(subpath: string): string {
    if (!this._photonFilePath) {
      throw new Error(
        'assets() requires _photonFilePath to be set by the runtime loader. ' +
        'Ensure this photon is loaded through the standard runtime.'
      );
    }
    const realPath = fs.realpathSync(this._photonFilePath);
    const dir = path.dirname(realPath);
    const name = path.basename(realPath).replace(/\.photon\.(ts|js)$/, '');
    return path.join(dir, name, 'assets', subpath);
  }

  /**
   * Get a URL path for an asset served by Beam
   *
   * Returns a relative URL like `/api/assets/my-photon/images/logo.png`
   * that Beam serves from the photon's assets directory. Use this in
   * HTML, markdown, or slides where browser-accessible URLs are needed.
   *
   * @param subpath Path within the assets folder
   * @returns URL path (relative to Beam host)
   *
   * @example
   * ```typescript
   * const logoUrl = this.assetUrl('images/logo.png');
   * // → '/api/assets/my-photon/images/logo.png'
   *
   * return `![Logo](${logoUrl})`;  // works in markdown/slides
   * ```
   */
  protected assetUrl(subpath: string): string {
    const name = this._photonName || this.constructor.name
      .replace(/MCP$/, '')
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');
    return `/api/assets/${encodeURIComponent(name)}/${subpath}`;
  }

  /**
   * Dynamic photon access
   *
   * Provides runtime access to other photons by name, with optional instance selection.
   * Supports both short names and namespace-qualified names.
   *
   * @example
   * ```typescript
   * // Get default instance
   * const wa = await this.photon.use('whatsapp');
   *
   * // Get named instance
   * const personal = await this.photon.use('whatsapp', 'personal');
   *
   * // Cross-namespace access
   * const wa2 = await this.photon.use('portel-dev:whatsapp', 'work');
   * ```
   */
  get photon(): { use: (name: string, instance?: string) => Promise<any> } {
    const resolver = this._photonResolver;
    return {
      use: async (name: string, instance?: string) => {
        if (!resolver) {
          throw new Error(
            'this.photon.use() requires a runtime with photon resolution. ' +
            'Ensure this photon is loaded through the standard runtime.'
          );
        }
        return resolver(name, instance);
      },
    };
  }

  /**
   * Emit an event/progress update
   *
   * If data includes a `channel` property, the message is also published
   * to the channel broker for cross-process notification.
   *
   * @param data Data to emit (can include channel, event, data properties for pub/sub)
   *
   * @example
   * ```typescript
   * // Simple emit (local only)
   * this.emit({ status: 'processing', progress: 50 });
   *
   * // Emit with channel (auto-prefixed with photon name)
   * // In a WhatsApp photon, this publishes to 'whatsapp:messages'
   * this.emit({ channel: 'messages', type: 'message', data: msg });
   *
   * // Explicit namespace (colon present = no auto-prefix)
   * this.emit({ channel: 'board:updates', event: 'task-moved', data: { taskId: '123' } });
   * ```
   */
  protected emit(data: any): void {
    const store = executionContext.getStore();

    // Include source photon name for injected photon event routing
    const emitData = this._photonName && typeof data === 'object' && data !== null
      ? { ...data, _source: this._photonName }
      : data;

    // Send to local output handler (current caller)
    if (store?.outputHandler) {
      store.outputHandler(emitData);
    }

    // If channel is specified, also publish to broker for cross-process notification.
    // Auto-prefix channel with photon name if not already namespaced:
    //   this.emit({ channel: 'messages', ... }) → publishes to 'whatsapp:messages'
    //   this.emit({ channel: 'board:updates', ... }) → publishes as-is (already has colon)
    if (data && typeof data.channel === 'string') {
      const rawChannel = data.channel;
      const channel = this._photonName && !rawChannel.includes(':')
        ? `${this._photonName}:${rawChannel}`
        : rawChannel;

      const broker = getBroker();
      broker.publish({
        channel,
        event: data.event || 'message',
        data: data.data !== undefined ? data.data : data,
        timestamp: Date.now(),
        source: this._photonName || this.constructor.name,
      }).catch((err) => {
        // Silent fail - channel pub is best-effort
        // Log only in debug mode
        if (process.env.PHOTON_DEBUG) {
          console.error('Channel publish error:', err);
        }
      });
    }
  }

  /**
   * Render a formatted value as an intermediate result
   *
   * Sends a value to the client (Beam, CLI, MCP) rendered with the specified
   * format — the same formats available via `@format` docblock tags. Each call
   * replaces the previous render in the result panel.
   *
   * Also supports UI feedback formats: status, progress, toast.
   * For custom formats, place an HTML renderer at `assets/formats/<name>.html`.
   *
   * @param format The format type (table, qr, status, progress, toast, guide, or custom)
   * @param value The data to render — shape depends on format
   *
   * @example
   * ```typescript
   * // Status message
   * this.render('status', 'Connecting...');
   * this.render('status', { message: 'Error!', type: 'error' });
   *
   * // Progress bar (0–1)
   * this.render('progress', 0.5);
   * this.render('progress', { value: 0.75, message: 'Almost done' });
   *
   * // Toast notification
   * this.render('toast', 'Saved!');
   * this.render('toast', { message: 'Done!', type: 'success' });
   *
   * // Multi-step guide
   * this.render('guide', [
   *   { label: 'Create bot', status: 'done' },
   *   { label: 'Enter token', status: 'active' },
   *   { label: 'Connect', status: 'pending' },
   * ]);
   *
   * // Formatted data
   * this.render('table', [['Step', 'Status'], ['Auth', 'Done']]);
   * this.render('qr', { value: 'https://wa.link/...' });
   * ```
   */
  protected render(format: string, value: any): void;
  protected render(): void;
  protected render(format?: string, value?: any): void {
    if (format === undefined) {
      this.emit({ emit: 'render:clear' });
      return;
    }

    // UI feedback formats — emit native shapes the frontend already handles
    switch (format) {
      case 'status':
        this.emit(typeof value === 'string'
          ? { emit: 'status', message: value }
          : { emit: 'status', ...value });
        return;
      case 'progress':
        this.emit(typeof value === 'number'
          ? { emit: 'progress', value }
          : { emit: 'progress', ...value });
        return;
      case 'toast':
        this.emit(typeof value === 'string'
          ? { emit: 'toast', message: value }
          : { emit: 'toast', ...value });
        return;
    }

    // All other formats — generic render
    this.emit({ emit: 'render', format, value });
  }

  /**
   * Channel interface for communicating with connected clients (e.g. Claude Code).
   * No-ops silently when the photon is not marked with @channel.
   *
   * Call directly to send a message:
   *   this.channel('Hello', { chat_id: '123' })
   *
   * Use .respond() to answer permission requests:
   *   this.channel.respond(request_id, 'allow')
   *
   * Use .onPermission() to handle incoming permission requests:
   *   this.channel.onPermission((req) => { ... })
   */
  protected channel: {
    (content: string, meta?: Record<string, string>): void;
    respond(requestId: string, behavior: 'allow' | 'deny'): void;
    onPermission(handler: (request: { request_id: string; tool_name: string; description: string; input_preview: string }) => void): void;
  } = Object.assign(
    (_content: string, _meta?: Record<string, string>) => {
      // Injected by the loader — no-op by default
    },
    {
      respond: (_requestId: string, _behavior: 'allow' | 'deny') => {
        // Injected by the loader — no-op by default
      },
      onPermission: (_handler: (request: any) => void) => {
        // Injected by the loader — no-op by default
      },
    }
  );

  /**
   * Create a blocking input request for use in generator methods.
   *
   * Returns a yield object — use with `yield` in async generators:
   * ```typescript
   * const name = yield this.ask('text', 'What is your name?');
   * ```
   *
   * @param type Input type: text, password, confirm, select, number, file, date, form, url
   * @param message The prompt message shown to the user
   * @param options Type-specific options (placeholder, pattern, min/max, etc.)
   *
   * @example
   * ```typescript
   * async *setup() {
   *   const token = yield this.ask('password', 'Enter API key:');
   *   const env = yield this.ask('select', 'Environment:', {
   *     options: ['dev', 'staging', 'prod']
   *   });
   *   const confirmed = yield this.ask('confirm', `Deploy to ${env}?`);
   * }
   * ```
   */
  protected ask(type: string, message: string, options?: Record<string, any>): { ask: string; message: string; [key: string]: any } {
    return { ask: type, message, ...options };
  }

  /**
   * Cross-photon call handler - injected by runtime
   * @internal
   */
  _callHandler?: (photon: string, method: string, params: Record<string, any>, targetInstance?: string) => Promise<any>;

  /**
   * Call another photon's method through the daemon
   *
   * Routes the call through the daemon for cross-process execution.
   * The target photon must be installed and loaded by the daemon.
   *
   * @param target Dot-separated target: 'photonName.methodName'
   * @param params Parameters to pass to the method
   * @returns The method's return value
   *
   * @example
   * ```typescript
   * // Call billing photon's generate method
   * const invoice = await this.call('billing.generate', { orderId: '123' });
   *
   * // Call shipping photon
   * const label = await this.call('shipping.createLabel', { orderId: '123' });
   * ```
   *
   * @throws Error if call handler is not set or target format is invalid
   */
  protected async call(target: string, params: Record<string, any> = {}, options?: { instance?: string }): Promise<any> {
    const dotIndex = target.indexOf('.');
    if (dotIndex === -1) {
      throw new Error(
        `Invalid call target: '${target}'. Expected format: 'photonName.methodName' (e.g., 'billing.generate')`
      );
    }

    const photonName = target.slice(0, dotIndex);
    const methodName = target.slice(dotIndex + 1);

    if (!this._callHandler) {
      throw new Error(
        `Cross-photon calls not available. To use this.call('${target}'), the Photon must be run in a runtime with a daemon (e.g., Beam or CLI with daemon enabled).`
      );
    }

    return this._callHandler(photonName, methodName, params, options?.instance);
  }

  /**
   * MCP client factory - injected by runtime
   * @internal
   */
  protected _mcpFactory?: MCPClientFactory;

  /**
   * Cache of MCP client instances
   * @internal
   */
  private _mcpClients: Map<string, MCPClient & Record<string, (params?: any) => Promise<any>>> = new Map();

  /**
   * Get MCP name from class name
   * Converts PascalCase to kebab-case (e.g., MyAwesomeMCP → my-awesome-mcp)
   */
  static getMCPName(): string {
    return this.name
      .replace(/MCP$/, '')
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, ''); // Remove leading dash
  }

  /**
   * Get all tool methods from this class
   * Returns all public async methods except lifecycle hooks and configuration methods
   */
  static getToolMethods(): string[] {
    const prototype = this.prototype;
    const methods: string[] = [];

    // Methods that are conventions, not tools
    const conventionMethods = new Set([
      'constructor',
      'onInitialize',  // Lifecycle hook
      'onShutdown',    // Lifecycle hook
      'configure',     // Configuration convention
      'getConfig',     // Configuration convention
    ]);

    // Get all property names from prototype chain
    // Use getOwnPropertyDescriptor to avoid triggering getters (which may call storage())
    let current = prototype;
    while (current && current !== Photon.prototype) {
      Object.getOwnPropertyNames(current).forEach((name) => {
        if (name.startsWith('_') || conventionMethods.has(name) || methods.includes(name)) return;
        const desc = Object.getOwnPropertyDescriptor(current, name);
        if (desc && typeof desc.value === 'function') {
          methods.push(name);
        }
      });
      current = Object.getPrototypeOf(current);
    }

    return methods;
  }

  /**
   * Execute a tool method
   */
  async executeTool(toolName: string, parameters: any, options?: { outputHandler?: (data: any) => void }): Promise<any> {
    // Stat-gate: close the edit→dispatch race on non-daemon paths. The
    // daemon has its own equivalent at src/daemon/server.ts; this runs
    // for CLI-direct dispatch and for callers using the lite loader's
    // programmatic photon() API. If the source file has changed since
    // the instance was loaded, hand off to the loader-registered
    // reloader before dispatching so the first call after a save sees
    // the new code.
    await this._statGateIfStale();

    const method = (this as any)[toolName];

    if (!method || typeof method !== 'function') {
      throw new Error(`Tool not found: ${toolName}`);
    }

    return executionContext.run({ outputHandler: options?.outputHandler }, async () => {
      try {
        const result = await method.call(this, parameters);
        return result;
      } catch (error: any) {
        console.error(`Tool execution failed: ${toolName} - ${error.message}`);
        await this._invokeErrorHook(error, { tool: toolName, params: parameters });
        throw error;
      }
    });
  }

  /**
   * If a reloader is registered and the source file has changed since it
   * was last loaded, invoke the reloader. Silent on missing file or
   * reloader failure — dispatch continues on the stale instance rather
   * than throwing for an observability concern.
   */
  private async _statGateIfStale(): Promise<void> {
    const filePath = this._photonFilePath;
    const reloader = this._photonReloader;
    const cached = this._photonSourceStat;
    if (!filePath || !reloader || !cached) return;
    let current: { mtimeMs: number; size: number; ino: number } | null = null;
    try {
      const s = fs.statSync(filePath);
      current = { mtimeMs: s.mtimeMs, size: s.size, ino: s.ino };
    } catch {
      // Source gone or unreadable — nothing to gate against. Dispatch
      // will surface the missing-photon error through its own path.
      return;
    }
    if (
      current.mtimeMs === cached.mtimeMs &&
      current.size === cached.size &&
      current.ino === cached.ino
    ) {
      return;
    }
    try {
      await reloader();
    } catch {
      // Reloader errors are non-fatal — keep running on the stale
      // instance rather than making dispatch itself fail.
    }
  }

  /**
   * Invoke the onError observability hook with a bounded timeout. Never
   * suppresses the original error and never throws itself — a throw or
   * timeout inside the hook is logged and swallowed so observability code
   * can never cascade into the request path.
   */
  private async _invokeErrorHook(
    error: unknown,
    ctx: { tool: string; params: any }
  ): Promise<void> {
    const hook = (this as any).onError;
    if (typeof hook !== 'function') return;
    const TIMEOUT_MS = 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(hook.call(this, error, ctx)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`onError hook exceeded ${TIMEOUT_MS}ms`)),
            TIMEOUT_MS
          );
        }),
      ]);
    } catch (hookError: any) {
      console.error(
        `onError hook failed for ${ctx.tool}: ${hookError?.message ?? String(hookError)}`
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Optional lifecycle hooks
   */
  /**
   * Called once after the photon is loaded and wired.
   * During hot-reload, receives context with the old instance for resource transfer.
   */
  async onInitialize?(ctx?: { reason?: string; oldInstance?: any }): Promise<void>;
  /**
   * Called before the photon is unloaded.
   * During hot-reload, receives context so you can skip resource cleanup.
   */
  async onShutdown?(ctx?: { reason?: string }): Promise<void>;
  /**
   * Called when any tool method throws. Observability only — the hook
   * cannot suppress or transform the error. A throw or timeout inside
   * the hook is logged and swallowed. Default timeout is 5s.
   *
   * Use it for centralized logging, metrics, or error reporting instead
   * of wrapping every method in try/catch.
   */
  async onError?(error: unknown, ctx: { tool: string; params: any }): Promise<void>;

  /**
   * Get an MCP client for calling external MCP servers
   *
   * Enables Photons to call tools on other MCP servers via the MCP protocol.
   * This is language-agnostic - the MCP can be written in any language
   * (Python, Rust, Go, etc.) as long as it speaks MCP protocol.
   *
   * @param mcpName The name of the MCP server to connect to
   * @returns MCP client with call(), list(), find() methods, plus proxy for direct tool calls
   *
   * @example
   * ```typescript
   * // Using call() method
   * const github = this.mcp('github');
   * const issues = await github.call('list_issues', { repo: 'owner/repo' });
   *
   * // Using proxy (tool name as method)
   * const issues = await github.list_issues({ repo: 'owner/repo' });
   *
   * // Listing available tools
   * const tools = await github.list();
   *
   * // Finding tools
   * const issueTools = await github.find('issue');
   * ```
   *
   * @throws Error if MCP factory is not set (runtime doesn't support MCP access)
   */
  mcp(mcpName: string): MCPClient & Record<string, (params?: any) => Promise<any>> {
    if (!this._mcpFactory) {
      throw new Error(
        `MCP access not available. To use this.mcp('${mcpName}'), the Photon must be run in a runtime that supports MCP access (e.g., NCP with MCP servers configured).`
      );
    }

    // Return cached client if available
    let client = this._mcpClients.get(mcpName);
    if (client) {
      return client;
    }

    // Create new client and cache it
    const rawClient = this._mcpFactory.create(mcpName);
    client = createMCPProxy(rawClient);
    this._mcpClients.set(mcpName, client);
    return client;
  }

  /**
   * Set the MCP client factory
   * Called by the runtime to enable MCP access
   *
   * @internal
   */
  setMCPFactory(factory: MCPClientFactory): void {
    this._mcpFactory = factory;
    // Clear cached clients when factory changes
    this._mcpClients.clear();
  }

  /**
   * Check if MCP access is available
   */
  hasMCPAccess(): boolean {
    return !!this._mcpFactory;
  }

  /**
   * List all available MCP servers
   * Requires MCP factory to be set
   */
  async listMCPServers(): Promise<string[]> {
    if (!this._mcpFactory) {
      return [];
    }
    return this._mcpFactory.listServers();
  }

  /**
   * Execute a function with a distributed lock
   *
   * Acquires the lock before executing, releases after (even on error).
   * If the lock cannot be acquired, throws an error.
   *
   * @param lockName Name of the lock to acquire
   * @param fn Function to execute while holding the lock
   * @param timeout Optional lock timeout in ms (default 30000)
   *
   * @example
   * ```typescript
   * async moveTask(params: { taskId: string; column: string }) {
   *   return this.withLock('board:write', async () => {
   *     const task = await this.loadTask(params.taskId);
   *     task.column = params.column;
   *     await this.saveTask(task);
   *     return task;
   *   });
   * }
   * ```
   */
  protected async withLock<T>(
    lockName: string,
    fn: () => Promise<T>,
    timeout?: number
  ): Promise<T> {
    return withLockHelper(lockName, fn, timeout);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY-AWARE LOCK MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Identity-aware lock handler - injected by runtime
   * @internal
   */
  _lockHandler?: {
    assign(lockName: string, holder: string, timeout?: number): Promise<boolean>;
    transfer(lockName: string, fromHolder: string, toHolder: string, timeout?: number): Promise<boolean>;
    release(lockName: string, holder: string): Promise<boolean>;
    query(lockName: string): Promise<{ holder: string | null; acquiredAt?: number; expiresAt?: number }>;
  };

  /**
   * Assign a lock to a specific caller (identity-aware)
   *
   * Unlike `withLock` which auto-acquires/releases around a function,
   * this explicitly assigns a lock to a caller ID. The lock persists
   * until transferred or released.
   *
   * @param lockName Name of the lock
   * @param callerId Caller ID to assign the lock to
   * @param timeout Lock timeout in ms (default 30000, auto-extended on transfer)
   *
   * @example
   * ```typescript
   * // Assign "turn" lock to first player
   * await this.acquireLock('turn', this.caller.id);
   * ```
   */
  protected async acquireLock(lockName: string, callerId: string, timeout?: number): Promise<boolean> {
    if (!this._lockHandler) {
      console.warn(`[photon] acquireLock('${lockName}'): no lock handler configured`);
      return true;
    }
    return this._lockHandler.assign(lockName, callerId, timeout);
  }

  /**
   * Transfer a lock from the current holder to another caller
   *
   * Only succeeds if `fromCallerId` is the current holder.
   *
   * @param lockName Name of the lock
   * @param toCallerId Caller ID to transfer the lock to
   * @param fromCallerId Current holder (defaults to this.caller.id)
   *
   * @example
   * ```typescript
   * // After a chess move, transfer turn to opponent
   * await this.transferLock('turn', opponentId);
   * ```
   */
  protected async transferLock(lockName: string, toCallerId: string, fromCallerId?: string): Promise<boolean> {
    if (!this._lockHandler) {
      console.warn(`[photon] transferLock('${lockName}'): no lock handler configured`);
      return true;
    }
    return this._lockHandler.transfer(lockName, fromCallerId ?? this.caller.id, toCallerId);
  }

  /**
   * Release a lock (make the method open to anyone)
   *
   * @param lockName Name of the lock
   * @param callerId Holder to release from (defaults to this.caller.id)
   *
   * @example
   * ```typescript
   * // Presenter releases navigation control to audience
   * await this.releaseLock('navigation');
   * ```
   */
  protected async releaseLock(lockName: string, callerId?: string): Promise<boolean> {
    if (!this._lockHandler) {
      console.warn(`[photon] releaseLock('${lockName}'): no lock handler configured`);
      return true;
    }
    return this._lockHandler.release(lockName, callerId ?? this.caller.id);
  }

  /**
   * Query who holds a specific lock
   *
   * @param lockName Name of the lock
   * @returns Lock holder info, or null holder if unlocked
   *
   * @example
   * ```typescript
   * const lock = await this.getLock('turn');
   * if (lock.holder === this.caller.id) { ... }
   * ```
   */
  protected async getLock(lockName: string): Promise<{ holder: string | null; acquiredAt?: number; expiresAt?: number }> {
    if (!this._lockHandler) {
      return { holder: null };
    }
    return this._lockHandler.query(lockName);
  }
}
