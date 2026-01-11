/**
 * @portel/photon-core
 *
 * Core Photon format library for parsing, loading, and managing .photon.ts files
 * WITHOUT any runtime dependencies (MCP server, CLI, etc.)
 *
 * Use this package to build custom runtimes that work with Photon classes:
 * - Multi-protocol API servers (REST, GraphQL, RPC, MCP)
 * - Orchestrators (NCP)
 * - Custom tool runners
 *
 * @example
 * ```typescript
 * import { PhotonMCP, DependencyManager, SchemaExtractor } from '@portel/photon-core';
 *
 * // Load and parse a Photon class
 * const photonClass = await import('./my-tool.photon.ts');
 * const instance = new photonClass.default();
 *
 * // Extract dependencies
 * const depManager = new DependencyManager();
 * const deps = await depManager.extractDependencies('./my-tool.photon.ts');
 * await depManager.ensureDependencies('my-tool', deps);
 *
 * // Extract schemas
 * const extractor = new SchemaExtractor();
 * const schemas = await extractor.extractFromFile('./my-tool.photon.ts');
 *
 * // Call lifecycle hooks
 * if (instance.onInitialize) {
 *   await instance.onInitialize();
 * }
 * ```
 */

// Core base class with lifecycle hooks
export { PhotonMCP } from './base.js';

// Dependency management
export { DependencyManager } from './dependency-manager.js';

// Schema extraction
export { SchemaExtractor } from './schema-extractor.js';

// CLI formatting
export {
  formatOutput,
  detectFormat,
  renderPrimitive,
  renderList,
  renderTable,
  renderTree,
  renderNone,
  formatKey,
  formatValue,
  formatToMimeType,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  printHeader,
  STATUS,
} from './cli-formatter.js';

// Path resolution
export {
  resolvePath,
  listFiles,
  ensureDir,
  resolvePhotonPath,
  listPhotonFiles,
  ensurePhotonDir,
  DEFAULT_PHOTON_DIR,
  type ResolverOptions,
} from './path-resolver.js';

// Types
export * from './types.js';

// MCP Protocol Client - for calling external MCPs from Photons
export {
  MCPClient,
  MCPError,
  MCPNotConnectedError,
  MCPToolError,
  MCPConfigurationError,
  createMCPProxy,
  type MCPToolInfo,
  type MCPToolResult,
  type MCPTransport,
  type MCPClientFactory,
  type MCPSourceType,
  type MissingMCPInfo,
} from './mcp-client.js';

// MCP SDK Transport - official SDK-based transport implementation
export {
  SDKMCPTransport,
  SDKMCPClientFactory,
  loadMCPConfig,
  createSDKMCPClientFactory,
  resolveMCPSource,
  type MCPServerConfig,
  type MCPConfig,
} from './mcp-sdk-transport.js';

// Generator-based tools with ask/emit pattern
// See generator.ts for comprehensive documentation
export {
  // Type guards - check yield direction
  isAskYield,
  isEmitYield,
  isCheckpointYield,
  getAskType,
  getEmitType,

  // Generator detection
  isAsyncGeneratorFunction,
  isAsyncGenerator,

  // Executor - runs generators to completion
  executeGenerator,

  // Ask extraction (for REST API schema generation)
  extractAsks,

  // Built-in providers
  createPrefilledProvider,
  NeedsInputError,

  // Utility
  wrapAsGenerator,

  // Ask yield types (input from user)
  type AskYield,
  type AskText,
  type AskPassword,
  type AskConfirm,
  type AskSelect,
  type AskNumber,
  type AskFile,
  type AskDate,
  type AskForm,
  type AskUrl,

  // Form schema types (for AskForm)
  type FormSchema,
  type FormSchemaProperty,
  type FormSchemaArrayProperty,

  // MCP elicitation result types
  type ElicitAction,
  type FormElicitResult,

  // Emit yield types (output to user)
  type EmitYield,
  type EmitStatus,
  type EmitProgress,
  type EmitStream,
  type EmitLog,
  type EmitToast,
  type EmitThinking,
  type EmitArtifact,
  type EmitUI,

  // Checkpoint yield type (for stateful workflows)
  type CheckpointYield,

  // Combined types
  type PhotonYield,
  type StatefulYield,

  // Execution config
  type InputProvider,
  type OutputHandler,
  type GeneratorExecutorConfig,
  type ExtractedAsk,

  // Legacy compatibility (deprecated)
  isInputYield,
  isProgressYield,
  isStreamYield,
  isLogYield,
  extractYields,
  type PromptYield,
  type ConfirmYield,
  type SelectYield,
  type ProgressYield,
  type StreamYield,
  type LogYield,
  type ExtractedYield,
} from './generator.js';

// Elicit - Cross-platform user input (legacy, prefer generators)
export {
  // Simple functions (no imports needed in photon files)
  prompt,
  confirm,
  // Full elicit with options
  elicit,
  elicitReadline,
  elicitNativeDialog,
  // Handler management (for runtimes)
  setPromptHandler,
  getPromptHandler,
  setElicitHandler,
  getElicitHandler,
  // Types
  type ElicitOptions,
  type ElicitResult,
  type ElicitHandler,
  type PromptHandler,
} from './elicit.js';

// Photon Runtime Configuration - ~/.photon/mcp-servers.json
export {
  // Constants
  PHOTON_CONFIG_DIR,
  MCP_SERVERS_CONFIG_FILE,
  // Load/Save
  loadPhotonMCPConfig,
  savePhotonMCPConfig,
  // Query
  isMCPConfigured,
  getMCPServerConfig,
  listMCPServers,
  // Modify
  setMCPServerConfig,
  removeMCPServerConfig,
  // Utilities
  toMCPConfig,
  resolveEnvVars,
  // Types
  type PhotonMCPConfig,
} from './photon-config.js';

// Stateful Workflow Execution - JSONL persistence with checkpoints
export {
  // Constants
  RUNS_DIR,

  // State Log - JSONL persistence
  StateLog,

  // Resume state parsing
  parseResumeState,

  // Stateful executor (explicit)
  executeStatefulGenerator,
  generateRunId,

  // Implicit stateful executor (auto-detect checkpoint usage)
  maybeStatefulExecute,

  // Run management
  listRuns,
  getRunInfo,
  deleteRun,
  cleanupRuns,

  // Types re-exported from stateful.ts
  type CheckpointYield as StatefulCheckpointYield,
  type StatefulYield as StatefulWorkflowYield,
  isCheckpointYield as isStatefulCheckpointYield,
  type ResumeState,
  type StatefulExecutorConfig,
  type StatefulExecutionResult,
  type MaybeStatefulConfig,
  type MaybeStatefulResult,
} from './stateful.js';

// Progress Rendering - Ephemeral spinners and progress bars
export {
  ProgressRenderer,
  getProgressRenderer,
  startSpinner,
  showProgress,
  updateProgressMessage,
  stopProgress,
  isProgressActive,
} from './progress.js';

// Auto-UI System - Automatic UI component generation
export {
  // UI Component types
  type UIComponentType,
  type UILayout,
  type UIComponent,
  type AutoUIConfig,
  
  // Hint extraction
  extractUIHints,
  
  // Component generation
  generateUIComponent,
  suggestComponents,
  shouldUseCards,
  shouldUseChart,
  
  // Renderer interface
  type UIRenderer,
  renderUIComponent,
} from './auto-ui.js';

// CLI UI Renderer - Terminal-based UI component renderer
export {
  CLIUIRenderer,
  cliRenderer,
} from './cli-ui-renderer.js';
