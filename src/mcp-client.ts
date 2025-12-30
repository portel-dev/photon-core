/**
 * MCP Protocol Client for Photons
 *
 * Enables Photons to call external MCPs via the MCP protocol.
 * This is runtime-agnostic - the actual transport is provided by the runtime (NCP, Lumina, etc.)
 *
 * Usage in Photon:
 * ```typescript
 * export default class MyPhoton extends PhotonMCP {
 *   async doSomething() {
 *     const github = this.mcp('github');
 *     const issues = await github.call('list_issues', { repo: 'foo/bar' });
 *   }
 * }
 * ```
 */

/**
 * Tool information returned from MCP discovery
 */
export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * Result from an MCP tool call
 */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Interface that runtimes must implement to provide MCP connectivity
 * This keeps photon-core runtime-agnostic
 */
export interface MCPTransport {
  /**
   * Call a tool on an MCP server
   * @param mcpName The MCP server name
   * @param toolName The tool to call
   * @param parameters Tool parameters
   */
  callTool(
    mcpName: string,
    toolName: string,
    parameters: Record<string, any>
  ): Promise<MCPToolResult>;

  /**
   * List available tools on an MCP server
   * @param mcpName The MCP server name
   */
  listTools(mcpName: string): Promise<MCPToolInfo[]>;

  /**
   * Check if an MCP server is connected/available
   * @param mcpName The MCP server name
   */
  isConnected(mcpName: string): Promise<boolean>;
}

/**
 * Factory interface for creating MCP clients
 * Runtimes implement this to provide MCP access to Photons
 */
export interface MCPClientFactory {
  /**
   * Create an MCP client for a specific server
   * @param mcpName The MCP server name
   */
  create(mcpName: string): MCPClient;

  /**
   * List all available MCP servers
   */
  listServers(): Promise<string[]>;
}

/**
 * MCP Client - Protocol wrapper for calling external MCPs
 *
 * Provides a clean async interface for Photons to call MCP tools.
 * The actual protocol communication is handled by the transport layer.
 */
export class MCPClient {
  private toolsCache: MCPToolInfo[] | null = null;

  constructor(
    private mcpName: string,
    private transport: MCPTransport
  ) {}

  /**
   * Get the MCP server name
   */
  get name(): string {
    return this.mcpName;
  }

  /**
   * Call a tool on this MCP server
   *
   * @param toolName The tool to call
   * @param parameters Tool parameters
   * @returns Tool result (parsed from MCP response)
   *
   * @example
   * ```typescript
   * const github = this.mcp('github');
   * const issues = await github.call('list_issues', { repo: 'owner/repo', state: 'open' });
   * ```
   */
  async call(toolName: string, parameters: Record<string, any> = {}): Promise<any> {
    // Check connection first
    const connected = await this.transport.isConnected(this.mcpName);
    if (!connected) {
      throw new MCPNotConnectedError(this.mcpName);
    }

    try {
      const result = await this.transport.callTool(this.mcpName, toolName, parameters);

      if (result.isError) {
        const errorText = result.content.find(c => c.type === 'text')?.text || 'Unknown error';
        throw new MCPToolError(this.mcpName, toolName, errorText);
      }

      // Extract and parse the result
      return this.parseResult(result);
    } catch (error) {
      if (error instanceof MCPError) {
        throw error;
      }
      throw new MCPToolError(
        this.mcpName,
        toolName,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * List all available tools on this MCP server
   *
   * @returns Array of tool information
   *
   * @example
   * ```typescript
   * const github = this.mcp('github');
   * const tools = await github.list();
   * // [{ name: 'list_issues', description: '...' }, ...]
   * ```
   */
  async list(): Promise<MCPToolInfo[]> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    const connected = await this.transport.isConnected(this.mcpName);
    if (!connected) {
      throw new MCPNotConnectedError(this.mcpName);
    }

    this.toolsCache = await this.transport.listTools(this.mcpName);
    return this.toolsCache;
  }

  /**
   * Find tools matching a query
   *
   * @param query Search query (matches name or description)
   * @returns Matching tools
   *
   * @example
   * ```typescript
   * const github = this.mcp('github');
   * const issueTools = await github.find('issue');
   * ```
   */
  async find(query: string): Promise<MCPToolInfo[]> {
    const tools = await this.list();
    const lowerQuery = query.toLowerCase();
    return tools.filter(
      t =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Check if this MCP server is connected
   */
  async isConnected(): Promise<boolean> {
    return this.transport.isConnected(this.mcpName);
  }

  /**
   * Clear the tools cache (useful after reconnection)
   */
  clearCache(): void {
    this.toolsCache = null;
  }

  /**
   * Parse MCP tool result into a usable value
   */
  private parseResult(result: MCPToolResult): any {
    if (!result.content || result.content.length === 0) {
      return null;
    }

    // Single text result - try to parse as JSON
    if (result.content.length === 1 && result.content[0].type === 'text') {
      const text = result.content[0].text || '';
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    // Multiple results or non-text - return as-is
    return result.content.map(c => {
      if (c.type === 'text') {
        try {
          return JSON.parse(c.text || '');
        } catch {
          return c.text;
        }
      }
      return c;
    });
  }
}

/**
 * Base class for MCP-related errors
 */
export class MCPError extends Error {
  constructor(
    public readonly mcpName: string,
    message: string
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

/**
 * Error thrown when MCP server is not connected
 */
export class MCPNotConnectedError extends MCPError {
  constructor(mcpName: string) {
    super(mcpName, `MCP server '${mcpName}' is not connected`);
    this.name = 'MCPNotConnectedError';
  }
}

/**
 * Error thrown when MCP tool call fails
 */
export class MCPToolError extends MCPError {
  constructor(
    mcpName: string,
    public readonly toolName: string,
    public readonly details: string
  ) {
    super(mcpName, `MCP tool '${mcpName}:${toolName}' failed: ${details}`);
    this.name = 'MCPToolError';
  }
}

/**
 * Create a proxy-based MCP client that allows direct method calls
 *
 * This enables a more fluent API:
 * ```typescript
 * const github = this.mcp('github');
 * // Instead of: await github.call('list_issues', { repo: 'foo/bar' })
 * // You can do: await github.list_issues({ repo: 'foo/bar' })
 * ```
 */
export function createMCPProxy(client: MCPClient): MCPClient & Record<string, (params?: any) => Promise<any>> {
  return new Proxy(client, {
    get(target, prop: string) {
      // Return existing methods
      if (prop in target) {
        return (target as any)[prop];
      }

      // Return a function that calls the tool
      return (params: Record<string, any> = {}) => target.call(prop, params);
    },
  }) as MCPClient & Record<string, (params?: any) => Promise<any>>;
}
