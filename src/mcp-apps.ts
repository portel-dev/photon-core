/**
 * MCP Apps Standard (2026-01-26) - Types & Helpers
 *
 * Standard types and helper functions for implementing the MCP Apps Extension
 * protocol. Used by hosts (Beam, NCP, Lumina) to communicate with embedded
 * UI iframes following the MCP Apps specification.
 *
 * @see https://modelcontextprotocol.github.io/ext-apps/api/
 */

import { getThemeTokens } from './design-system/tokens.js';

// =============================================================================
// TYPES - MCP Apps Standard Messages
// =============================================================================

/**
 * MCP Apps ui/initialize message sent to iframe on load
 */
export interface McpAppsInitialize {
  jsonrpc: '2.0';
  method: 'ui/initialize';
  params: {
    hostContext: {
      name: string;
      version: string;
      theme: 'light' | 'dark';
      styles: {
        variables: Record<string, string>; // CSS custom properties
      };
    };
    hostCapabilities: {
      toolCalling: boolean;
      resourceReading: boolean;
      elicitation: boolean;
    };
    containerDimensions: {
      mode: 'fixed' | 'responsive' | 'auto';
      width?: number;
      height?: number;
    };
    // Legacy flat theme tokens (kept for backward compat with Photon apps)
    theme: Record<string, string>;
    safeAreaInsets?: { top: number; bottom: number; left: number; right: number };
  };
}

/**
 * MCP Apps tool input (streamed during LLM generation)
 */
export interface McpAppsToolInput {
  jsonrpc: '2.0';
  method: 'ui/notifications/tool-input' | 'ui/notifications/tool-input-partial';
  params: {
    toolName: string;
    input: Record<string, unknown>;
  };
}

/**
 * MCP Apps tool result (sent after tool execution)
 */
export interface McpAppsToolResult {
  jsonrpc: '2.0';
  method: 'ui/notifications/tool-result';
  params: {
    toolName: string;
    result: unknown;
  };
}

/**
 * MCP Apps host context changed notification (theme changes, etc.)
 */
export interface McpAppsHostContextChanged {
  jsonrpc: '2.0';
  method: 'ui/notifications/host-context-changed';
  params: {
    theme?: 'light' | 'dark';
    styles?: {
      variables: Record<string, string>;
    };
  };
}

/**
 * MCP Apps resource teardown request
 */
export interface McpAppsResourceTeardown {
  jsonrpc: '2.0';
  id: string;
  method: 'ui/resource-teardown';
  params: Record<string, never>;
}

/**
 * MCP Apps model context update (from iframe to host)
 */
export interface McpAppsModelContextUpdate {
  jsonrpc: '2.0';
  id: string;
  method: 'ui/update-model-context';
  params: {
    content?: string;
    structuredContent?: unknown;
  };
}

/**
 * Platform context for bridge script generation
 */
export interface PlatformContext {
  theme: 'light' | 'dark';
  locale: string;
  displayMode: 'inline' | 'fullscreen' | 'modal';
  photon: string;
  method: string;
  hostName: string;
  hostVersion: string;
  safeAreaInsets?: { top: number; bottom: number; left: number; right: number };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create the MCP Apps ui/initialize message to send to an iframe
 */
export function createMcpAppsInitialize(
  context: PlatformContext,
  dimensions: { width: number; height: number }
): McpAppsInitialize {
  const themeTokens = getThemeTokens(context.theme);
  return {
    jsonrpc: '2.0',
    method: 'ui/initialize',
    params: {
      hostContext: {
        name: context.hostName,
        version: context.hostVersion,
        theme: context.theme,
        styles: {
          variables: themeTokens,
        },
      },
      hostCapabilities: {
        toolCalling: true,
        resourceReading: true,
        elicitation: true,
      },
      containerDimensions: {
        mode: 'responsive',
        width: dimensions.width,
        height: dimensions.height,
      },
      // Legacy flat theme tokens for backward compat
      theme: themeTokens,
      ...(context.safeAreaInsets ? { safeAreaInsets: context.safeAreaInsets } : {}),
    },
  };
}

/**
 * Create theme change notifications for all supported platforms
 * Returns an array of messages to postMessage to iframes
 */
export function createThemeChangeMessages(theme: 'light' | 'dark'): unknown[] {
  const themeTokens = getThemeTokens(theme);

  return [
    // MCP Apps Extension (standard spec name)
    {
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: {
        theme,
        styles: { variables: themeTokens },
      },
    },
    // MCP Apps Extension (legacy name for backward compat)
    {
      jsonrpc: '2.0',
      method: 'ui/notifications/context',
      params: { theme: themeTokens },
    },
    // Photon Bridge
    {
      type: 'photon:context',
      context: { theme },
      themeTokens,
    },
    // Claude Artifacts
    {
      type: 'theme',
      theme,
    },
    // OpenAI Apps SDK
    {
      type: 'openai:set_globals',
      theme,
    },
  ];
}
