/**
 * Photon Capabilities Mixin
 *
 * Injects all Photon framework capabilities into any class without requiring inheritance.
 * Works with classes that already extend other bases.
 *
 * @example
 * ```typescript
 * // Plain class (no inheritance)
 * export default class Calculator {
 *   async add(a: number, b: number) { return a + b; }
 * }
 * // Gets wrapped: withPhotonCapabilities(Calculator)
 * // Now has: this.emit(), this.memory, this.mcp(), this.call()
 *
 * // Class with own parent
 * export default class Todo extends TodoBase {
 *   async add(text: string) { ... }
 * }
 * // Gets wrapped: withPhotonCapabilities(Todo)
 * // Still works: this.someBaseMethod() + this.emit() + this.memory
 * ```
 */

import { MCPClient, MCPClientFactory, createMCPProxy } from '@portel/mcp';
import { executionContext } from '@portel/cli';
import { getBroker } from './channels/index.js';
import { MemoryProvider } from './memory.js';

/**
 * Type for a constructor that may or may not extend Photon base class
 */
type Constructor<T = any> = new (...args: any[]) => T;

/**
 * Injects Photon framework capabilities into any class via mixin composition.
 *
 * Works with:
 * - Plain classes (no parent)
 * - Classes extending user-defined bases
 * - Classes extending imported library classes
 * - Classes already extending Photon (no-op, already has capabilities)
 *
 * @param Base The class to enhance with Photon capabilities
 * @returns Enhanced class with all Photon methods and properties
 */
export function withPhotonCapabilities<T extends Constructor>(Base: T): T {
  // If already has Photon capabilities, return as-is
  if ((Base.prototype as any)._photonName !== undefined || (Base.prototype as any).emit) {
    return Base;
  }

  return class PhotonEnhanced extends Base {
    /**
     * Photon name (MCP name) - set by runtime loader
     * @internal
     */
    _photonName?: string;

    /**
     * Session ID for session-scoped memory - set by runtime
     * @internal
     */
    _sessionId?: string;

    /**
     * Scoped memory provider - lazy-initialized on first access
     * @internal
     */
    private _memory?: MemoryProvider;

    /**
     * Cross-photon call handler - injected by runtime
     * @internal
     */
    _callHandler?: (photon: string, method: string, params: Record<string, any>, targetInstance?: string) => Promise<any>;

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
     * Scoped key-value storage for photon data
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
     * Emit an event/progress update
     */
    protected emit(data: any): void {
      const store = executionContext.getStore();

      const emitData = this._photonName && typeof data === 'object' && data !== null
        ? { ...data, _source: this._photonName }
        : data;

      if (store?.outputHandler) {
        store.outputHandler(emitData);
      }

      if (data && typeof data.channel === 'string') {
        const broker = getBroker();
        broker.publish({
          channel: data.channel,
          event: data.event || 'message',
          data: data.data !== undefined ? data.data : data,
          timestamp: Date.now(),
          source: this.constructor.name,
        }).catch((err) => {
          if (process.env.PHOTON_DEBUG) {
            console.error('Channel publish error:', err);
          }
        });
      }
    }

    /**
     * Call another photon's method through the daemon
     */
    protected async call(target: string, params: Record<string, any> = {}, options?: { instance?: string }): Promise<any> {
      const dotIndex = target.indexOf('.');
      if (dotIndex === -1) {
        throw new Error(
          `Invalid call target: '${target}'. Expected format: 'photonName.methodName'`
        );
      }

      const photonName = target.slice(0, dotIndex);
      const methodName = target.slice(dotIndex + 1);

      if (!this._callHandler) {
        throw new Error(
          `Cross-photon calls not available. To use this.call('${target}'), the Photon must be run in a runtime with a daemon.`
        );
      }

      return this._callHandler(photonName, methodName, params, options?.instance);
    }

    /**
     * Get an MCP client for calling external MCP servers
     */
    mcp(mcpName: string): MCPClient & Record<string, (params?: any) => Promise<any>> {
      if (!this._mcpFactory) {
        throw new Error(
          `MCP access not available. To use this.mcp('${mcpName}'), the Photon must be run in a runtime that supports MCP access.`
        );
      }

      let client = this._mcpClients.get(mcpName);
      if (client) {
        return client;
      }

      const rawClient = this._mcpFactory.create(mcpName);
      client = createMCPProxy(rawClient);
      this._mcpClients.set(mcpName, client);
      return client;
    }

    /**
     * Set the MCP client factory
     * @internal
     */
    setMCPFactory(factory: MCPClientFactory): void {
      this._mcpFactory = factory;
    }
  } as T;
}
