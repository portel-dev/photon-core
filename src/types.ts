/**
 * Photon MCP Core Types
 */

/**
 * Output format types
 * - Structural: primitive, table, tree, list, none
 * - Content: json, markdown, yaml, xml, html, code, code:<lang>
 */
export type OutputFormat =
  | 'primitive' | 'table' | 'tree' | 'list' | 'none'
  | 'json' | 'markdown' | 'yaml' | 'xml' | 'html'
  | `code` | `code:${string}`;

export interface PhotonTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  outputFormat?: OutputFormat;
}

export interface ExtractedSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  outputFormat?: OutputFormat;
}

export interface PhotonMCPClass {
  name: string;
  description?: string;
  tools: PhotonTool[];
  instance: any;
}

export interface ConstructorParam {
  name: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
}

/**
 * Template type - for text generation with variable substitution
 * Maps to MCP Prompts, HTTP template endpoints, CLI help generators, etc.
 */
export type Template = string & { __brand: 'Template' };

/**
 * Static type - for read-only data/content
 * Maps to MCP Resources, HTTP GET endpoints, CLI read commands, etc.
 */
export type Static = string & { __brand: 'Static' };

/**
 * Helper to cast string as Template (optional, for clarity)
 */
export const asTemplate = (str: string): Template => str as Template;

/**
 * Helper to cast string as Static (optional, for clarity)
 */
export const asStatic = (str: string): Static => str as Static;

/**
 * Message format for templates (MCP compatibility)
 */
export interface TemplateMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  };
}

/**
 * Template response format (for advanced cases)
 */
export interface TemplateResponse {
  messages: TemplateMessage[];
}

/**
 * Template metadata
 */
export interface TemplateInfo {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Static resource metadata
 */
export interface StaticInfo {
  name: string;
  uri: string;
  description: string;
  mimeType?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Extended PhotonMCPClass with templates and statics
 */
export interface PhotonMCPClassExtended extends PhotonMCPClass {
  templates: TemplateInfo[];
  statics: StaticInfo[];
}
