/**
 * PhotonMCP Base Class
 *
 * Optional base class for creating Photon MCPs.
 * You don't need to extend this - any class with async methods works!
 *
 * Usage:
 * ```typescript
 * export default class Calculator extends PhotonMCP {
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
 * export default class SlackReporter extends PhotonMCP {
 *   async report() {
 *     const github = this.mcp('github');
 *     const issues = await github.call('list_issues', { repo: 'foo/bar' });
 *     // Or with proxy: await github.list_issues({ repo: 'foo/bar' })
 *   }
 * }
 * ```
 */

import { MCPClient, MCPClientFactory, createMCPProxy } from './mcp-client.js';

/**
 * Simple base class for creating Photon MCPs
 *
 * - Class name = MCP name
 * - Public async methods = Tools
 * - Return value = Tool result
 */
export class PhotonMCP {
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
      .replace(/MCP$/, '') // Remove "MCP" suffix if present
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, ''); // Remove leading dash
  }

  /**
   * Get all tool methods from this class
   * Returns all public async methods except lifecycle hooks
   */
  static getToolMethods(): string[] {
    const prototype = this.prototype;
    const methods: string[] = [];

    // Get all property names from prototype chain
    let current = prototype;
    while (current && current !== PhotonMCP.prototype) {
      Object.getOwnPropertyNames(current).forEach((name) => {
        // Skip constructor, private methods (starting with _), and lifecycle hooks
        if (
          name !== 'constructor' &&
          !name.startsWith('_') &&
          name !== 'onInitialize' &&
          name !== 'onShutdown' &&
          typeof (prototype as any)[name] === 'function' &&
          !methods.includes(name)
        ) {
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
  async executeTool(toolName: string, parameters: any): Promise<any> {
    const method = (this as any)[toolName];

    if (!method || typeof method !== 'function') {
      throw new Error(`Tool not found: ${toolName}`);
    }

    try {
      const result = await method.call(this, parameters);
      return result;
    } catch (error: any) {
      console.error(`Tool execution failed: ${toolName} - ${error.message}`);
      throw error;
    }
  }

  /**
   * Optional lifecycle hooks
   */
  async onInitialize?(): Promise<void>;
  async onShutdown?(): Promise<void>;

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
}
