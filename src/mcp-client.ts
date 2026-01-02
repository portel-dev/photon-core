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
 * MCP source type - how the MCP was declared
 */
export type MCPSourceType = 'npm' | 'github' | 'local' | 'url' | 'unknown';

/**
 * Information about a missing MCP dependency
 */
export interface MissingMCPInfo {
  name: string;
  source: string;
  sourceType: MCPSourceType;
  declaredIn?: string; // Photon file that declared this dependency
  originalError?: string;
}

/**
 * Error thrown when MCP is not configured correctly
 * Provides detailed, actionable guidance for users
 */
export class MCPConfigurationError extends MCPError {
  public readonly configPath: string;
  public readonly missingMCPs: MissingMCPInfo[];

  constructor(missingMCPs: MissingMCPInfo[]) {
    const configPath = `~/.photon/mcp-servers.json`;
    const message = MCPConfigurationError.formatMessage(missingMCPs, configPath);
    super(missingMCPs[0]?.name || 'unknown', message);
    this.name = 'MCPConfigurationError';
    this.configPath = configPath;
    this.missingMCPs = missingMCPs;
  }

  /**
   * Format detailed error message with configuration instructions
   */
  private static formatMessage(missingMCPs: MissingMCPInfo[], configPath: string): string {
    const lines: string[] = [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '❌ MCP Configuration Required',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    ];

    // List missing MCPs
    lines.push(`The following MCP server${missingMCPs.length > 1 ? 's are' : ' is'} required but not configured:`);
    lines.push('');

    for (const mcp of missingMCPs) {
      lines.push(`  • ${mcp.name}`);
      if (mcp.source) {
        lines.push(`    Source: ${mcp.source} (${mcp.sourceType})`);
      }
      if (mcp.declaredIn) {
        lines.push(`    Declared in: ${mcp.declaredIn}`);
      }
      if (mcp.originalError) {
        lines.push(`    Error: ${mcp.originalError}`);
      }
      lines.push('');
    }

    // Configuration instructions
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('🔧 How to Fix');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push(`Add the following to ${configPath}:`);
    lines.push('');

    // Generate example config
    const exampleConfig = MCPConfigurationError.generateExampleConfig(missingMCPs);
    lines.push(exampleConfig);
    lines.push('');

    // Step-by-step instructions
    lines.push('Steps:');
    lines.push(`  1. Create or edit ${configPath}`);
    lines.push('  2. Add the configuration above');
    lines.push('  3. Replace placeholder values with your actual configuration');
    lines.push('  4. Restart the Photon');
    lines.push('');

    // Per-source-type guidance
    const uniqueTypes = new Set(missingMCPs.map(m => m.sourceType));
    if (uniqueTypes.size > 0) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('📖 Configuration Guide');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');

      for (const type of uniqueTypes) {
        lines.push(...MCPConfigurationError.getSourceTypeGuide(type));
        lines.push('');
      }
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return lines.join('\n');
  }

  /**
   * Generate example JSON config for missing MCPs
   */
  private static generateExampleConfig(missingMCPs: MissingMCPInfo[]): string {
    const servers: Record<string, any> = {};

    for (const mcp of missingMCPs) {
      servers[mcp.name] = MCPConfigurationError.getExampleServerConfig(mcp);
    }

    const config = { mcpServers: servers };
    return JSON.stringify(config, null, 2)
      .split('\n')
      .map(line => '  ' + line)
      .join('\n');
  }

  /**
   * Get example server config based on source type
   */
  private static getExampleServerConfig(mcp: MissingMCPInfo): Record<string, any> {
    switch (mcp.sourceType) {
      case 'npm':
        return {
          command: 'npx',
          args: ['-y', mcp.source],
          env: {
            '// Add required environment variables here': '',
          },
        };

      case 'github': {
        // Parse github source: owner/repo or owner/repo#branch
        const [repo, branch] = mcp.source.split('#');
        const args = ['-y', `github:${repo}`];
        if (branch) {
          args[1] = `github:${repo}#${branch}`;
        }
        return {
          command: 'npx',
          args,
          env: {
            '// Add required environment variables here': '',
          },
        };
      }

      case 'url':
        if (mcp.source.startsWith('ws://') || mcp.source.startsWith('wss://')) {
          return {
            url: mcp.source,
            transport: 'websocket',
          };
        }
        return {
          url: mcp.source,
          transport: 'sse',
        };

      case 'local':
        return {
          command: mcp.source,
          args: [],
          cwd: '// Optional: working directory',
        };

      default:
        return {
          '// Configure this MCP server': '',
          command: 'npx',
          args: ['-y', '<package-name>'],
        };
    }
  }

  /**
   * Get source-type specific guidance
   */
  private static getSourceTypeGuide(type: MCPSourceType): string[] {
    switch (type) {
      case 'npm':
        return [
          '📦 NPM Packages:',
          '   MCP servers from npm are run via npx.',
          '   Example: @modelcontextprotocol/server-github',
          '',
          '   {',
          '     "command": "npx",',
          '     "args": ["-y", "@modelcontextprotocol/server-github"],',
          '     "env": {',
          '       "GITHUB_TOKEN": "ghp_your_token_here"',
          '     }',
          '   }',
        ];

      case 'github':
        return [
          '🐙 GitHub Repositories:',
          '   MCP servers from GitHub repos are cloned and run.',
          '   Format: owner/repo or owner/repo#branch',
          '',
          '   {',
          '     "command": "npx",',
          '     "args": ["-y", "github:anthropics/mcp-server-github"],',
          '     "env": {',
          '       "GITHUB_TOKEN": "ghp_your_token_here"',
          '     }',
          '   }',
        ];

      case 'url':
        return [
          '🌐 Remote URLs:',
          '   MCP servers running on remote hosts.',
          '',
          '   HTTP/SSE:',
          '   {',
          '     "url": "https://mcp.example.com/api",',
          '     "transport": "sse",',
          '     "headers": { "Authorization": "Bearer token" }',
          '   }',
          '',
          '   WebSocket:',
          '   {',
          '     "url": "wss://mcp.example.com/ws",',
          '     "transport": "websocket"',
          '   }',
        ];

      case 'local':
        return [
          '💻 Local Commands:',
          '   MCP servers running as local processes.',
          '',
          '   {',
          '     "command": "/path/to/mcp-server",',
          '     "args": ["--port", "3000"],',
          '     "cwd": "/working/directory",',
          '     "env": { "CONFIG": "value" }',
          '   }',
        ];

      default:
        return [
          '⚙️ Custom Configuration:',
          '   Configure the MCP server based on its documentation.',
        ];
    }
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
