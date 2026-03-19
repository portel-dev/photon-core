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
   * Absolute path to the .photon.ts/.photon.js source file - set by runtime loader
   * Used for storage() and assets() path resolution
   * @internal
   */
  _photonFilePath?: string;

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
      this._memory = new MemoryProvider(name, this._sessionId);
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
      this._schedule = new ScheduleProvider(name);
    }
    return this._schedule;
  }

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
   * // ~/.photon/portel-dev/whatsapp/auth/
   *
   * const mediaDir = this.storage('media/images');
   * // ~/.photon/portel-dev/whatsapp/media/images/
   * ```
   */
  protected storage(subpath: string): string {
    if (!this._photonFilePath) {
      throw new Error(
        'storage() requires _photonFilePath to be set by the runtime loader. ' +
        'Ensure this photon is loaded through the standard runtime.'
      );
    }
    const dir = path.dirname(this._photonFilePath);
    const name = path.basename(this._photonFilePath).replace(/\.photon\.(ts|js)$/, '');
    const target = path.join(dir, name, subpath);
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
   * For custom formats, place an HTML renderer at `assets/formats/<name>.html`.
   *
   * @param format The format type (table, qr, chart:bar, dashboard, or custom)
   * @param value The data to render — same shape as a return value with that @format
   *
   * @example
   * ```typescript
   * // Show a QR code mid-execution
   * this.render('qr', { value: 'https://wa.link/...' });
   *
   * // Show a status table
   * this.render('table', [['Step', 'Status'], ['Auth', 'Done']]);
   *
   * // Composite dashboard
   * this.render('dashboard', {
   *   qr: { format: 'qr', data: 'https://wa.link/...' },
   *   status: { format: 'text', data: 'Scan the QR code above' }
   * });
   * ```
   */
  protected render(format: string, value: any): void;
  protected render(): void;
  protected render(format?: string, value?: any): void {
    if (format === undefined) {
      // Clear the render zone without rendering new content
      this.emit({ emit: 'render:clear' });
    } else {
      this.emit({ emit: 'render', format, value });
    }
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
        throw error;
      }
    });
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
