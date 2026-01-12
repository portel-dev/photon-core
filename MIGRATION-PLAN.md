# Migration Plan: Splitting photon-core into Three Packages

## Executive Summary

Split `@portel/photon-core` (18 files) into three focused packages:
- **@portel/core** - Universal utilities with zero MCP/Photon dependencies
- **@portel/mcp** - MCP protocol utilities (client, transport, config)
- **@portel/photon-core** - Photon-specific (depends on both above)

This enables:
- NCP to use `@portel/core` without pulling in Photon-specific code
- MCP-only projects to use `@portel/mcp` without Photon
- Full Photon functionality via the existing package name

---

## 1. Package File Allocation

### @portel/core (Universal Utilities)

**Files from photon-core:**
```
cli-formatter.ts      # CLI output formatting, tables, trees
progress.ts           # Spinners, progress bars
context.ts            # AsyncLocalStorage execution context
```

**Files to consolidate from NCP:**
```
text-utils.ts         # Text wrapping (merge with cli-formatter)
markdown-renderer.ts  # Markdown-to-terminal (merge with cli-formatter)
progress-spinner.ts   # Duplicate - use photon-core version
fuzzy-matcher.ts      # Fuzzy string matching
logger.ts             # Structured logging
```

**Exports:**
```typescript
// CLI Formatting
export { formatOutput, detectFormat, renderPrimitive, renderList,
         renderTable, renderTree, renderNone, formatKey, formatValue,
         formatToMimeType, printSuccess, printError, printInfo,
         printWarning, printHeader, STATUS } from './cli-formatter.js';

// Progress
export { ProgressRenderer, getProgressRenderer, startSpinner,
         showProgress, updateProgressMessage, stopProgress,
         isProgressActive } from './progress.js';

// Execution Context
export { executionContext, type ExecutionContext } from './context.js';

// Text Utilities (from NCP)
export { TextUtils, type TextWrapOptions } from './text-utils.js';

// Fuzzy Matching (from NCP)
export { fuzzyMatch, fuzzyScore } from './fuzzy-matcher.js';

// Logging (from NCP)
export { Logger, createLogger, type LogLevel } from './logger.js';
```

**Dependencies:**
```json
{
  "dependencies": {
    "chalk": "^5.3.0",
    "cli-highlight": "^2.1.11"
  }
}
```

---

### @portel/mcp (MCP Protocol Utilities)

**Files from photon-core:**
```
mcp-client.ts         # MCPClient, MCPError, createMCPProxy
mcp-sdk-transport.ts  # SDKMCPTransport, loadMCPConfig
photon-config.ts      # ~/.photon/mcp-servers.json management
elicit.ts             # MCP elicitation (prompt, confirm handlers)
```

**Files to consolidate from NCP:**
```
elicitation-helper.ts # Similar to elicit.ts (merge)
mcp-error-parser.ts   # MCP error handling (add to mcp-client.ts)
mcp-protocol-logger.ts # Protocol logging
```

**Exports:**
```typescript
// MCP Client
export { MCPClient, MCPError, MCPNotConnectedError, MCPToolError,
         MCPConfigurationError, createMCPProxy,
         type MCPToolInfo, type MCPToolResult, type MCPTransport,
         type MCPClientFactory, type MCPSourceType } from './mcp-client.js';

// MCP SDK Transport
export { SDKMCPTransport, SDKMCPClientFactory, loadMCPConfig,
         createSDKMCPClientFactory, resolveMCPSource,
         type MCPServerConfig, type MCPConfig } from './mcp-sdk-transport.js';

// MCP Configuration
export { PHOTON_CONFIG_DIR, MCP_SERVERS_CONFIG_FILE,
         loadPhotonMCPConfig, savePhotonMCPConfig, isMCPConfigured,
         getMCPServerConfig, listMCPServers, setMCPServerConfig,
         removeMCPServerConfig, toMCPConfig, resolveEnvVars,
         type PhotonMCPConfig } from './photon-config.js';

// Elicitation
export { prompt, confirm, elicit, elicitReadline, elicitNativeDialog,
         setPromptHandler, getPromptHandler, setElicitHandler,
         getElicitHandler, type ElicitOptions, type ElicitResult,
         type ElicitHandler, type PromptHandler } from './elicit.js';
```

**Dependencies:**
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.18.0",
    "@portel/core": "^1.0.0"
  }
}
```

---

### @portel/photon-core (Photon-Specific)

**Files remaining:**
```
base.ts               # PhotonMCP base class
generator.ts          # Generator patterns (ask/emit yields)
stateful.ts           # Stateful workflow execution
io.ts                 # io.emit.*, io.ask.* helpers
auto-ui.ts            # Auto UI component generation
cli-ui-renderer.ts    # CLI UI renderer
schema-extractor.ts   # Photon schema extraction
dependency-manager.ts # Photon dependency management
types.ts              # Photon-specific types
index.ts              # Re-exports from all three packages
```

**Exports:**
```typescript
// Re-export everything from sub-packages
export * from '@portel/core';
export * from '@portel/mcp';

// Photon Base Class
export { PhotonMCP } from './base.js';

// Generator System
export { isAskYield, isEmitYield, executeGenerator, extractAsks,
         createPrefilledProvider, NeedsInputError, wrapAsGenerator,
         type AskYield, type EmitYield, type PhotonYield,
         type InputProvider, type OutputHandler } from './generator.js';

// IO Helper API
export { io, emit, ask } from './io.js';

// Stateful Workflows
export { StateLog, executeStatefulGenerator, maybeStatefulExecute,
         listRuns, getRunInfo, deleteRun, cleanupRuns } from './stateful.js';

// Auto UI
export { extractUIHints, generateUIComponent, suggestComponents,
         type UIComponent, type UIRenderer } from './auto-ui.js';

// CLI UI Renderer
export { CLIUIRenderer, cliRenderer } from './cli-ui-renderer.js';

// Schema Extraction
export { SchemaExtractor } from './schema-extractor.js';

// Dependency Management
export { DependencyManager } from './dependency-manager.js';

// Types
export * from './types.js';
```

**Dependencies:**
```json
{
  "dependencies": {
    "@portel/core": "^1.0.0",
    "@portel/mcp": "^1.0.0"
  }
}
```

---

## 2. Package Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        @portel/photon-core                       │
│  (PhotonMCP, generators, stateful, io, auto-ui, schema, deps)   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│      @portel/mcp        │       │      @portel/core       │
│  (MCPClient, transport, │──────▶│  (CLI, progress, text,  │
│   config, elicit)       │       │   context, logging)     │
└─────────────────────────┘       └─────────────────────────┘
```

---

## 3. Consumer Migration

### NCP Migration

**Current:**
```json
{ "@portel/photon-core": "^1.2.0" }
```

**Target:**
```json
{
  "@portel/core": "^1.0.0",
  "@portel/mcp": "^1.0.0"
}
```

**Import changes:**
```typescript
// Before
import { formatOutput, MCPClient, startSpinner } from '@portel/photon-core';

// After
import { formatOutput, startSpinner } from '@portel/core';
import { MCPClient } from '@portel/mcp';
```

**Files to remove from NCP (consolidated):**
- `src/utils/text-utils.ts`
- `src/utils/progress-spinner.ts`
- `src/utils/markdown-renderer.ts`

### Lumina Migration

**No changes required** - continues using `@portel/photon-core` which re-exports everything.

```json
{ "@portel/photon-core": "^2.0.0" }
```

---

## 4. Breaking Changes

### Changes
1. Package split - direct imports from sub-packages require updates
2. Type reorganization - some types move between packages

### Mitigation
1. **Backward compatibility** - `@portel/photon-core@2.0.0` re-exports everything
2. **Semver** - Major version bump for restructure
3. **Deprecation period** - Old imports continue working via re-exports

---

## 5. Implementation Phases

### Phase 1: Create @portel/core (2-3 hours)
1. Create `/Users/arul/Projects/portel-core/`
2. Move: `cli-formatter.ts`, `progress.ts`, `context.ts`
3. Consolidate from NCP: `text-utils.ts`, `fuzzy-matcher.ts`, `logger.ts`
4. Create exports and package.json
5. Publish `@portel/core@1.0.0`

### Phase 2: Create @portel/mcp (2-3 hours)
1. Create `/Users/arul/Projects/portel-mcp/`
2. Move: `mcp-client.ts`, `mcp-sdk-transport.ts`, `photon-config.ts`, `elicit.ts`
3. Consolidate from NCP: `mcp-error-parser.ts`, `mcp-protocol-logger.ts`
4. Add `@portel/core` dependency
5. Publish `@portel/mcp@1.0.0`

### Phase 3: Update @portel/photon-core (1-2 hours)
1. Remove moved files
2. Add dependencies on `@portel/core` and `@portel/mcp`
3. Update `index.ts` to re-export
4. Publish `@portel/photon-core@2.0.0`

### Phase 4: Migrate NCP (1-2 hours)
1. Update dependencies
2. Replace duplicate utilities with imports
3. Remove consolidated files
4. Test and release

### Phase 5: Verify Lumina (30 min)
1. Update photon-core to v2.0.0
2. Run tests
3. No import changes needed

---

## 6. Repository Structure

```
Projects/
├── portel-core/           # NEW: @portel/core
│   ├── src/
│   │   ├── cli-formatter.ts
│   │   ├── progress.ts
│   │   ├── context.ts
│   │   ├── text-utils.ts
│   │   ├── fuzzy-matcher.ts
│   │   ├── logger.ts
│   │   └── index.ts
│   └── package.json
│
├── portel-mcp/            # NEW: @portel/mcp
│   ├── src/
│   │   ├── mcp-client.ts
│   │   ├── mcp-sdk-transport.ts
│   │   ├── photon-config.ts
│   │   ├── elicit.ts
│   │   └── index.ts
│   └── package.json
│
├── photon-core/           # UPDATED: @portel/photon-core
│   ├── src/
│   │   ├── base.ts
│   │   ├── generator.ts
│   │   ├── stateful.ts
│   │   ├── io.ts
│   │   ├── auto-ui.ts
│   │   ├── cli-ui-renderer.ts
│   │   ├── schema-extractor.ts
│   │   ├── dependency-manager.ts
│   │   ├── types.ts
│   │   └── index.ts        # Re-exports from @portel/core + @portel/mcp
│   └── package.json
│
├── ncp/                   # Uses @portel/core + @portel/mcp
├── lumina/                # Uses @portel/photon-core
└── photon/                # Uses @portel/photon-core
```

---

## 7. Versioning Strategy

| Package | Current | After Split |
|---------|---------|-------------|
| @portel/core | N/A | 1.0.0 |
| @portel/mcp | N/A | 1.0.0 |
| @portel/photon-core | 1.5.0 | 2.0.0 |

The major version bump for photon-core signals the restructure while maintaining backward compatibility through re-exports.
