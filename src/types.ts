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

/**
 * Yield information extracted from generator methods
 * Used for REST API schema generation (yields become optional parameters)
 */
export interface YieldInfo {
  id: string;
  type: 'prompt' | 'confirm' | 'select';
  prompt?: string;
  options?: Array<string | { value: string; label: string }>;
  default?: string;
  required?: boolean;
  pattern?: string;
  dangerous?: boolean;
  multi?: boolean;
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
  /** True if this method is an async generator (uses yield for prompts) */
  isGenerator?: boolean;
  /** Yield information for generator methods (used by REST APIs) */
  yields?: YieldInfo[];
  /** True if this is a stateful workflow (supports checkpoint/resume) */
  isStateful?: boolean;
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
  /** True if type is string, number, or boolean (inject from env var) */
  isPrimitive: boolean;
}

/**
 * Injection type for constructor parameters
 */
export type InjectionType = 'env' | 'mcp' | 'photon';

/**
 * Resolved injection info for a constructor parameter
 */
export interface ResolvedInjection {
  param: ConstructorParam;
  injectionType: InjectionType;
  /** For 'mcp' - the MCP dependency info */
  mcpDependency?: MCPDependency;
  /** For 'photon' - the Photon dependency info */
  photonDependency?: PhotonDependency;
  /** For 'env' - the environment variable name */
  envVarName?: string;
}

/**
 * MCP Dependency declaration from @mcp tag
 * Format: @mcp <name> <source>
 *
 * Source formats (following marketplace conventions):
 * - GitHub shorthand: anthropics/mcp-server-github
 * - npm package: npm:@modelcontextprotocol/server-filesystem
 * - Local path: ./my-local-mcp
 * - Full URL: https://github.com/user/repo
 *
 * Example:
 * ```typescript
 * /**
 *  * @mcp github anthropics/mcp-server-github
 *  * @mcp fs npm:@modelcontextprotocol/server-filesystem
 *  *\/
 * export default class MyPhoton extends PhotonMCP {
 *   async doSomething() {
 *     const issues = await this.github.list_issues({ repo: 'owner/repo' });
 *   }
 * }
 * ```
 */
export interface MCPDependency {
  /** Local name to use for accessing this MCP (e.g., 'github') */
  name: string;
  /** Source identifier (GitHub shorthand, npm package, URL, or path) */
  source: string;
  /** Resolved source type */
  sourceType: 'github' | 'npm' | 'url' | 'local';
  /** Environment variables to pass (from @env tags) */
  env?: Record<string, string>;
}

/**
 * Photon Dependency declaration from @photon tag
 * Format: @photon <name> <source>
 *
 * Source formats (following marketplace conventions):
 * - Marketplace: rss-feed (from configured marketplace)
 * - GitHub shorthand: portel-dev/photons/rss-feed
 * - npm package: npm:@portel/rss-feed-photon
 * - Local path: ./my-local-photon.photon.ts
 *
 * Example:
 * ```typescript
 * /**
 *  * @photon rssFeed rss-feed
 *  * @photon custom ./my-photon.photon.ts
 *  *\/
 * export default class MyWorkflow {
 *   constructor(private rssFeed: any) {}
 *
 *   async run() {
 *     const items = await this.rssFeed.read({ url: '...' });
 *   }
 * }
 * ```
 */
export interface PhotonDependency {
  /** Local name to use for accessing this Photon (e.g., 'rssFeed') */
  name: string;
  /** Source identifier (marketplace name, GitHub shorthand, npm package, or path) */
  source: string;
  /** Resolved source type */
  sourceType: 'marketplace' | 'github' | 'npm' | 'local';
}

// ════════════════════════════════════════════════════════════════════════════
// PHOTON ASSETS - Static files referenced via @ui, @prompt, @resource
// ════════════════════════════════════════════════════════════════════════════

/**
 * UI Asset - HTML/React UI for MCP Apps
 *
 * Declared via @ui annotation:
 * ```
 * /** @ui preferences-form ./ui/preferences.html *\/
 * ```
 *
 * Referenced in tools via @ui JSDoc or EmitUI yield
 */
export interface UIAsset {
  /** Asset identifier (e.g., 'preferences-form') */
  id: string;
  /** Relative path from asset folder (e.g., './ui/preferences.html') */
  path: string;
  /** Resolved absolute path (set by loader) */
  resolvedPath?: string;
  /** MIME type (detected from extension) */
  mimeType?: string;
  /** Tool this UI is linked to (from method @ui annotation) */
  linkedTool?: string;
}

/**
 * Prompt Asset - Static MCP Prompt template
 *
 * Declared via @prompt annotation:
 * ```
 * /** @prompt system ./prompts/system.md *\/
 * ```
 */
export interface PromptAsset {
  /** Asset identifier (e.g., 'system') */
  id: string;
  /** Relative path from asset folder */
  path: string;
  /** Resolved absolute path (set by loader) */
  resolvedPath?: string;
  /** Prompt description (from file frontmatter or annotation) */
  description?: string;
  /** Prompt arguments schema (from file frontmatter) */
  arguments?: Record<string, { type: string; description?: string; required?: boolean }>;
}

/**
 * Resource Asset - Static MCP Resource
 *
 * Declared via @resource annotation:
 * ```
 * /** @resource config ./resources/config.json *\/
 * ```
 */
export interface ResourceAsset {
  /** Asset identifier (e.g., 'config') */
  id: string;
  /** Relative path from asset folder */
  path: string;
  /** Resolved absolute path (set by loader) */
  resolvedPath?: string;
  /** MIME type (detected from extension) */
  mimeType?: string;
  /** Resource description */
  description?: string;
}

/**
 * All assets extracted from a Photon
 */
export interface PhotonAssets {
  /** UI assets for MCP Apps */
  ui: UIAsset[];
  /** Static prompt templates */
  prompts: PromptAsset[];
  /** Static resources */
  resources: ResourceAsset[];
  /** Asset folder path (e.g., './my-photon/') */
  assetFolder?: string;
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
  /** Assets from the Photon's asset folder (UI, prompts, resources) */
  assets?: PhotonAssets;
}

// ══════════════════════════════════════════════════════════════════════════════
// STATEFUL WORKFLOW TYPES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * State log entry types for JSONL persistence
 */
export type StateLogType = 'start' | 'emit' | 'checkpoint' | 'ask' | 'answer' | 'return' | 'error';

/**
 * Base state log entry
 */
interface StateLogBase {
  /** Entry type */
  t: StateLogType;
  /** Timestamp (Unix ms) */
  ts: number;
}

/**
 * Workflow start entry
 */
export interface StateLogStart extends StateLogBase {
  t: 'start';
  /** Tool/method name being executed */
  tool: string;
  /** Input parameters */
  params: Record<string, any>;
}

/**
 * Emit entry (status, progress, etc.)
 */
export interface StateLogEmit extends StateLogBase {
  t: 'emit';
  /** Emit type (status, progress, stream, log, etc.) */
  emit: string;
  /** Emit message */
  message?: string;
  /** Additional emit data */
  data?: any;
}

/**
 * Checkpoint entry - marks safe resume point with state snapshot
 */
export interface StateLogCheckpoint extends StateLogBase {
  t: 'checkpoint';
  /** Checkpoint ID (auto-generated or explicit) */
  id: string;
  /** Accumulated state at this point */
  state: Record<string, any>;
}

/**
 * Ask entry - input request
 */
export interface StateLogAsk extends StateLogBase {
  t: 'ask';
  /** Ask ID */
  id: string;
  /** Ask type (text, confirm, select, etc.) */
  ask: string;
  /** Ask message */
  message: string;
}

/**
 * Answer entry - input response
 */
export interface StateLogAnswer extends StateLogBase {
  t: 'answer';
  /** Ask ID this answers */
  id: string;
  /** User's response value */
  value: any;
}

/**
 * Return entry - workflow completion
 */
export interface StateLogReturn extends StateLogBase {
  t: 'return';
  /** Final return value */
  value: any;
}

/**
 * Error entry - workflow failed
 */
export interface StateLogError extends StateLogBase {
  t: 'error';
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
}

/**
 * Union of all state log entry types
 */
export type StateLogEntry =
  | StateLogStart
  | StateLogEmit
  | StateLogCheckpoint
  | StateLogAsk
  | StateLogAnswer
  | StateLogReturn
  | StateLogError;

/**
 * Workflow run status
 */
export type WorkflowStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'paused';

/**
 * Workflow run metadata
 */
export interface WorkflowRun {
  /** Unique run ID */
  runId: string;
  /** Photon name */
  photon: string;
  /** Tool/method name */
  tool: string;
  /** Input parameters */
  params: Record<string, any>;
  /** Current status */
  status: WorkflowStatus;
  /** Start timestamp */
  startedAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Completion timestamp (if completed/failed) */
  completedAt?: number;
  /** Final result (if completed) */
  result?: any;
  /** Error message (if failed) */
  error?: string;
  /** Last checkpoint state */
  lastCheckpoint?: {
    id: string;
    state: Record<string, any>;
    ts: number;
  };
}
