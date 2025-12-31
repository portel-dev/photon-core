/**
 * Photon Runtime Configuration
 *
 * Manages ~/.photon/mcp-servers.json for MCP server configuration.
 * Compatible with Claude Desktop's mcpServers format.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { MCPConfig, MCPServerConfig } from './mcp-sdk-transport.js';

/**
 * Default config directory
 */
export const PHOTON_CONFIG_DIR = path.join(os.homedir(), '.photon');

/**
 * Default MCP servers config file
 */
export const MCP_SERVERS_CONFIG_FILE = path.join(PHOTON_CONFIG_DIR, 'mcp-servers.json');

/**
 * Photon MCP servers configuration file format
 * Compatible with Claude Desktop's mcpServers format
 */
export interface PhotonMCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Load MCP servers configuration from ~/.photon/mcp-servers.json
 *
 * @param configPath Optional custom config path (defaults to ~/.photon/mcp-servers.json)
 * @returns The MCP configuration, or empty config if file doesn't exist
 */
export async function loadPhotonMCPConfig(configPath?: string): Promise<PhotonMCPConfig> {
  const filePath = configPath || MCP_SERVERS_CONFIG_FILE;

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const config = JSON.parse(content) as PhotonMCPConfig;

    // Validate structure
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      console.error(`Invalid config format in ${filePath}: missing mcpServers`);
      return { mcpServers: {} };
    }

    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - return empty config
      return { mcpServers: {} };
    }
    console.error(`Failed to load config from ${filePath}: ${error.message}`);
    return { mcpServers: {} };
  }
}

/**
 * Save MCP servers configuration to ~/.photon/mcp-servers.json
 *
 * @param config The configuration to save
 * @param configPath Optional custom config path
 */
export async function savePhotonMCPConfig(
  config: PhotonMCPConfig,
  configPath?: string
): Promise<void> {
  const filePath = configPath || MCP_SERVERS_CONFIG_FILE;
  const dir = path.dirname(filePath);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Write config with pretty formatting
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Check if an MCP server is configured
 *
 * @param mcpName The MCP server name to check
 * @param config Optional pre-loaded config (loads from file if not provided)
 */
export async function isMCPConfigured(
  mcpName: string,
  config?: PhotonMCPConfig
): Promise<boolean> {
  const cfg = config || await loadPhotonMCPConfig();
  return mcpName in cfg.mcpServers;
}

/**
 * Get configuration for a specific MCP server
 *
 * @param mcpName The MCP server name
 * @param config Optional pre-loaded config
 * @returns The server config or undefined if not found
 */
export async function getMCPServerConfig(
  mcpName: string,
  config?: PhotonMCPConfig
): Promise<MCPServerConfig | undefined> {
  const cfg = config || await loadPhotonMCPConfig();
  return cfg.mcpServers[mcpName];
}

/**
 * Add or update an MCP server configuration
 *
 * @param mcpName The MCP server name
 * @param serverConfig The server configuration
 * @param configPath Optional custom config path
 */
export async function setMCPServerConfig(
  mcpName: string,
  serverConfig: MCPServerConfig,
  configPath?: string
): Promise<void> {
  const config = await loadPhotonMCPConfig(configPath);
  config.mcpServers[mcpName] = serverConfig;
  await savePhotonMCPConfig(config, configPath);
}

/**
 * Remove an MCP server configuration
 *
 * @param mcpName The MCP server name to remove
 * @param configPath Optional custom config path
 */
export async function removeMCPServerConfig(
  mcpName: string,
  configPath?: string
): Promise<void> {
  const config = await loadPhotonMCPConfig(configPath);
  delete config.mcpServers[mcpName];
  await savePhotonMCPConfig(config, configPath);
}

/**
 * List all configured MCP servers
 *
 * @param configPath Optional custom config path
 * @returns Array of MCP server names
 */
export async function listMCPServers(configPath?: string): Promise<string[]> {
  const config = await loadPhotonMCPConfig(configPath);
  return Object.keys(config.mcpServers);
}

/**
 * Convert PhotonMCPConfig to MCPConfig (for SDK transport)
 */
export function toMCPConfig(config: PhotonMCPConfig): MCPConfig {
  return {
    mcpServers: config.mcpServers,
  };
}

/**
 * Merge environment variables into MCP server config
 * Supports ${VAR_NAME} syntax for env var references
 *
 * @param serverConfig The server config to process
 * @returns Config with env vars resolved
 */
export function resolveEnvVars(serverConfig: MCPServerConfig): MCPServerConfig {
  const resolved = { ...serverConfig };

  // Process env object if present
  if (resolved.env) {
    const processedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(resolved.env)) {
      processedEnv[key] = resolveEnvValue(value);
    }
    resolved.env = processedEnv;
  }

  // Process args if present
  if (resolved.args) {
    resolved.args = resolved.args.map(resolveEnvValue);
  }

  // Process url if present
  if (resolved.url) {
    resolved.url = resolveEnvValue(resolved.url);
  }

  return resolved;
}

/**
 * Resolve ${VAR_NAME} references in a string value
 */
function resolveEnvValue(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}
