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

// ===== RE-EXPORT FROM @portel/cli =====
// CLI formatting, progress, text utils, fuzzy matching, logging
export {
  // Types
  type OutputFormat,
  type TextWrapOptions,
  type FuzzyMatch,
  type ExecutionContext,
  type LogLevel,
  type LoggerOptions,

  // CLI Formatting
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

  // Progress
  ProgressRenderer,
  getProgressRenderer,
  startSpinner,
  showProgress,
  updateProgressMessage,
  stopProgress,
  isProgressActive,

  // Execution Context
  executionContext,
  runWithContext,
  getContext,

  // Text Utils
  TextUtils,

  // Fuzzy Matching
  FuzzyMatcher,
  fuzzyMatch,
  fuzzyScore,
  findBestMatch,

  // Logger
  Logger,
  createLogger,
  getLogger,
} from '@portel/cli';

// ===== RE-EXPORT FROM @portel/mcp =====
// MCP client, transport, configuration, elicitation
export {
  // Types
  type MCPToolInfo,
  type MCPToolResult,
  type MCPTransport,
  type MCPSourceType,
  type MissingMCPInfo,
  type MCPServerConfig,
  type MCPConfig,
  type PhotonMCPConfig,
  type ElicitOptions,
  type ElicitResult,
  type PromptHandler,
  type ElicitHandler,

  // MCP Client
  MCPClient,
  type MCPClientFactory,
  MCPError,
  MCPNotConnectedError,
  MCPToolError,
  MCPConfigurationError,
  createMCPProxy,

  // MCP SDK Transport
  SDKMCPTransport,
  SDKMCPClientFactory,
  loadMCPConfig,
  createSDKMCPClientFactory,
  resolveMCPSource,

  // MCP Configuration
  PHOTON_CONFIG_DIR,
  MCP_SERVERS_CONFIG_FILE,
  loadPhotonMCPConfig,
  savePhotonMCPConfig,
  isMCPConfigured,
  getMCPServerConfig,
  listMCPServers,
  setMCPServerConfig,
  removeMCPServerConfig,
  toMCPConfig,
  resolveEnvVars,

  // Elicitation
  prompt,
  confirm,
  elicit,
  elicitReadline,
  elicitNativeDialog,
  setPromptHandler,
  getPromptHandler,
  setElicitHandler,
  getElicitHandler,
} from '@portel/mcp';

// ===== PHOTON-SPECIFIC EXPORTS =====

// Core base class with lifecycle hooks
export { PhotonMCP } from './base.js';

// Dependency management
export { DependencyManager } from './dependency-manager.js';

// Schema extraction
export { SchemaExtractor } from './schema-extractor.js';

// Path resolution (Photon-specific paths)
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

// Generator-based tools with ask/emit pattern
export {
  // Type guards
  isAskYield,
  isEmitYield,
  isCheckpointYield,
  getAskType,
  getEmitType,

  // Generator detection
  isAsyncGeneratorFunction,
  isAsyncGenerator,

  // Executor
  executeGenerator,

  // Ask extraction
  extractAsks,

  // Built-in providers
  createPrefilledProvider,
  NeedsInputError,

  // Utility
  wrapAsGenerator,

  // Ask yield types
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

  // Rich select option types (e-commerce, catalogs)
  type SelectOption,
  type SelectOptionObject,

  // Form schema types
  type FormSchema,
  type FormSchemaProperty,
  type FormSchemaArrayProperty,

  // MCP elicitation result types
  type ElicitAction,
  type FormElicitResult,

  // Emit yield types
  type EmitYield,
  type EmitStatus,
  type EmitProgress,
  type EmitStream,
  type EmitLog,
  type EmitToast,
  type EmitThinking,
  type EmitArtifact,
  type EmitUI,

  // Checkpoint yield type
  type CheckpointYield,

  // Combined types
  type PhotonYield,
  type StatefulYield,

  // Execution config
  type InputProvider,
  type OutputHandler,
  type GeneratorExecutorConfig,
  type ExtractedAsk,

  // Legacy compatibility
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

// Stateful Workflow Execution
export {
  RUNS_DIR,
  StateLog,
  parseResumeState,
  executeStatefulGenerator,
  generateRunId,
  maybeStatefulExecute,
  listRuns,
  getRunInfo,
  deleteRun,
  cleanupRuns,
  type CheckpointYield as StatefulCheckpointYield,
  type StatefulYield as StatefulWorkflowYield,
  isCheckpointYield as isStatefulCheckpointYield,
  type ResumeState,
  type StatefulExecutorConfig,
  type StatefulExecutionResult,
  type MaybeStatefulConfig,
  type MaybeStatefulResult,
} from './stateful.js';

// Auto-UI System
export {
  type UIComponentType,
  type UILayout,
  type UIComponent,
  type AutoUIConfig,
  extractUIHints,
  generateUIComponent,
  suggestComponents,
  shouldUseCards,
  shouldUseChart,
  type UIRenderer,
  renderUIComponent,
} from './auto-ui.js';

// CLI UI Renderer
export {
  CLIUIRenderer,
  cliRenderer,
} from './cli-ui-renderer.js';

// IO Helper API
export { io, emit, ask } from './io.js';

// ===== SMART RENDERING (HTML/Web UI) =====
// Design system tokens and utilities
export * from './design-system/index.js';

// Smart rendering modules for auto-UI generation
export * from './rendering/index.js';

// ===== UCP (Universal Commerce Protocol) =====
// Agentic commerce with checkout, identity, orders, and AP2 payments
export * from './ucp/index.js';

// ===== CHANNEL-BASED PUB/SUB =====
// Cross-process messaging with pluggable brokers (daemon, Redis, HTTP, etc.)
export * from './channels/index.js';

// ===== LOCK HELPERS =====
// Runtime support for distributed locking via daemon
export {
  withLock,
  setLockManager,
  getLockManager,
  type LockManager,
} from './decorators.js';

// ===== MCP APPS STANDARD =====
// Types and helpers for MCP Apps Extension (2026-01-26) compliance
export {
  type McpAppsInitialize,
  type McpAppsToolInput,
  type McpAppsToolResult,
  type McpAppsHostContextChanged,
  type McpAppsResourceTeardown,
  type McpAppsModelContextUpdate,
  type PlatformContext,
  createMcpAppsInitialize,
  createThemeChangeMessages,
} from './mcp-apps.js';

// ===== CONFIGURATION CONVENTION =====
// Utilities for photons implementing the configure() convention
export {
  getPhotonConfigDir,
  getPhotonConfigPath,
  loadPhotonConfig,
  savePhotonConfig,
  hasPhotonConfig,
  deletePhotonConfig,
  listConfiguredPhotons,
} from './config.js';

// ===== CLASS DETECTION =====
// Shared Photon class detection for loaders
export {
  isClass,
  hasAsyncMethods,
  findPhotonClass,
  findPhotonClasses,
} from './class-detection.js';

// ===== ENVIRONMENT UTILITIES =====
// Env var resolution for constructor injection
export {
  toEnvVarName,
  parseEnvValue,
  generateExampleValue,
  summarizeConstructorParams,
  generateConfigErrorMessage,
  resolveEnvArgs,
  type MissingParamInfo,
  type EnvConstructorParam,
} from './env-utils.js';

// ===== TYPESCRIPT COMPILER =====
// esbuild-based .photon.ts compilation with caching
export { compilePhotonTS } from './compiler.js';

// ===== MIME TYPES =====
// Extension-to-MIME mapping for assets
export { getMimeType } from './mime-types.js';

// ===== VERSION CHECK =====
// @runtime tag parsing and semver-lite compatibility check
export {
  parseRuntimeRequirement,
  checkRuntimeCompatibility,
} from './version-check.js';

// ===== VALIDATION =====
// Input validation utilities and error base classes
export {
  PhotonError,
  ValidationError,
  type ValidationResult,
  type Validator,
  combineResults,
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
  notEmpty,
  hasLength,
  matchesPattern,
  isEmail,
  isUrl,
  inRange,
  isPositive,
  isInteger,
  hasArrayLength,
  arrayOf,
  hasFields,
  oneOf,
  validate,
  validateOrThrow,
  pathExists,
  hasExtension,
  assertDefined,
  assertString,
  assertNumber,
  assertObject,
  assertArray,
} from './validation.js';

// ===== EXECUTION AUDIT TRAIL =====
// Zero-effort execution recording for debugging and observability
export {
  AuditTrail,
  getAuditTrail,
  setAuditTrail,
  generateExecutionId,
  type ExecutionRecord,
  type AuditQueryOptions,
} from './audit.js';

// ===== SCOPED MEMORY =====
// Framework-level key-value storage (this.memory on PhotonMCP)
export {
  MemoryProvider,
  type MemoryScope,
} from './memory.js';

// ===== ASSET DISCOVERY =====
// Discover UI, prompt, and resource assets from Photon files
export {
  discoverAssets,
  autoDiscoverAssets,
} from './asset-discovery.js';

// ===== MANAGED COLLECTIONS =====
// Auto-emit events on mutations for seamless real-time sync
export {
  // Level 1: Zero-effort - just import and use (runtime auto-wires)
  Array,  // Shadows global Array
  Map,    // Shadows global Map
  Set,    // Shadows global Set
  // Level 2: Explicit control - use .create() for custom wiring
  ReactiveArray,
  ReactiveMap,
  ReactiveSet,
  type Emitter,
  // Level 2+: Rich queryable collection with rendering hints
  Collection,
  type RenderHint,
  type RenderFormat,
  type CompareOp,
} from './collections/index.js';

// ===== PURPOSE-DRIVEN UI TYPES =====
// Polymorphic return types that auto-render with appropriate UI
export {
  // Base
  PhotonUIType,
  isPhotonUIType,

  // Field System (React Admin-style)
  Field,
  type FieldDefinition,
  type FieldType,
  type FieldAlignment,
  type BaseFieldOptions,
  type TextFieldOptions,
  type NumberFieldOptions,
  type CurrencyFieldOptions,
  type DateFieldOptions,
  type DateFormat,
  type ImageFieldOptions,
  type BadgeFieldOptions,
  type RatingFieldOptions,
  type PriceFieldOptions,
  type StockFieldOptions,
  type ActionItem,
  type ActionsFieldOptions,
  type RenderFunction,
  getFieldValue,
  formatFieldLabel,
  interpolateTemplate,
  renderFieldToText,
  renderFieldToStructured,
  type RenderedField,

  // Data Display
  Table,
  type TableColumn,
  type TableOptions,
  type ColumnType,
  Cards,
  type CardFieldMapping,
  type CardsOptions,

  // Visualization
  Chart,
  type ChartType,
  type ChartSeries,
  type ChartDataPoint,
  type ChartOptions,
  Stats,
  type StatItem,
  type StatFormat,
  type StatsOptions,
  Progress,
  type ProgressBar,
  type ProgressStep,
  type ProgressStyle,
  type StepStatus,
  type ProgressOptions,

  // Interactive
  Form,
  type FormField,
  type FieldType as FormFieldType,
  type FormOptions,
} from './ui-types/index.js';
