# @portel/photon-core

**Core library for parsing, loading, and managing `.photon.ts` files**

[![npm version](https://badge.fury.io/js/@portel%2Fphoton-core.svg)](https://www.npmjs.com/package/@portel/photon-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 What is Photon Core?

Photon Core is the **runtime-agnostic foundation** for working with `.photon.ts` files. It provides:

- ✅ **Base class** with lifecycle hooks (`onInitialize`, `onShutdown`)
- ✅ **Dependency management** - Extract and install `@dependencies` from JSDoc
- ✅ **Schema extraction** - Parse TypeScript types and JSDoc into JSON schemas
- ❌ **NO runtime layers** - No MCP server, no CLI, no transport

This allows you to build **custom runtimes** on top of the Photon format:
- **Multi-protocol API servers** (REST, GraphQL, RPC, MCP) → [Lumina](https://github.com/portel-dev/lumina)
- **Orchestrators** → [NCP](https://github.com/portel-dev/ncp)
- **MCP/CLI runners** → [@portel/photon](https://github.com/portel-dev/photon)

---

## 📦 Installation

```bash
npm install @portel/photon-core
```

---

## 🚀 Quick Start

### 1. Create a Photon class

```typescript
// calculator.photon.ts

/**
 * Simple calculator with basic math operations
 * @dependencies lodash@^4.17.21
 */
export default class Calculator {
  /**
   * Add two numbers together
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }

  /**
   * Multiply two numbers
   * @param a First number
   * @param b Second number
   */
  async multiply(params: { a: number; b: number }) {
    return params.a * params.b;
  }

  /**
   * Lifecycle hook called when photon is initialized
   */
  async onInitialize() {
    console.log('Calculator initialized!');
  }

  /**
   * Lifecycle hook called when photon is shut down
   */
  async onShutdown() {
    console.log('Calculator shutting down!');
  }
}
```

### 2. Use Photon Core to load and manage it

```typescript
import { PhotonMCP, DependencyManager, SchemaExtractor } from '@portel/photon-core';

// 1. Extract and install dependencies
const depManager = new DependencyManager();
const deps = await depManager.extractDependencies('./calculator.photon.ts');
// Found: [{ name: 'lodash', version: '^4.17.21' }]

await depManager.ensureDependencies('calculator', deps);
// ✅ Dependencies installed

// 2. Load the class
const CalculatorClass = (await import('./calculator.photon.ts')).default;
const instance = new CalculatorClass();

// 3. Call lifecycle hook
if (instance.onInitialize) {
  await instance.onInitialize();
}

// 4. Extract schemas (optional)
const extractor = new SchemaExtractor();
const schemas = await extractor.extractFromFile('./calculator.photon.ts');
console.log(schemas);
// [
//   {
//     name: 'add',
//     description: 'Add two numbers together',
//     inputSchema: {
//       type: 'object',
//       properties: {
//         a: { type: 'number', description: 'First number' },
//         b: { type: 'number', description: 'Second number' }
//       },
//       required: ['a', 'b']
//     }
//   },
//   ...
// ]

// 5. Execute methods
const result = await instance.add({ a: 5, b: 3 });
console.log(result); // 8

// 6. Cleanup
if (instance.onShutdown) {
  await instance.onShutdown();
}
```

---

## 📚 API Reference

### `PhotonMCP`

Base class for creating Photon classes (optional - you can use plain classes too).

```typescript
import { PhotonMCP } from '@portel/photon-core';

export default class MyPhoton extends PhotonMCP {
  async myMethod(params: { input: string }) {
    return `Hello ${params.input}`;
  }

  async onInitialize() {
    // Called when photon is loaded
  }

  async onShutdown() {
    // Called when photon is unloaded
  }
}
```

**Static methods:**
- `getMCPName()` - Convert class name to kebab-case (e.g., `MyAwesomeMCP` → `my-awesome-mcp`)
- `getToolMethods()` - Get all public async methods (excludes lifecycle hooks and private methods)

**Instance methods:**
- `executeTool(name, params)` - Execute a method by name

**Lifecycle hooks:**
- `onInitialize()` - Called when photon is initialized
- `onShutdown()` - Called when photon is shut down

---

### `DependencyManager`

Extracts and installs npm dependencies declared in JSDoc `@dependencies` tags.

```typescript
import { DependencyManager } from '@portel/photon-core';

const depManager = new DependencyManager();

// Extract dependencies from source file
const deps = await depManager.extractDependencies('./my-tool.photon.ts');
// [{ name: 'axios', version: '^1.0.0' }, { name: 'date-fns', version: '^2.0.0' }]

// Install dependencies to isolated cache
await depManager.ensureDependencies('my-tool', deps);
// Creates ~/.cache/photon-mcp/dependencies/my-tool/node_modules/

// Clear cache for a specific photon
await depManager.clearCache('my-tool');

// Clear all caches
await depManager.clearAllCache();
```

**Supported JSDoc format:**
```typescript
/**
 * @dependencies axios@^1.0.0, date-fns@^2.0.0
 * @dependencies @octokit/rest@^19.0.0
 */
```

---

### MCP SDK Transport

Connect to external MCPs using the official `@modelcontextprotocol/sdk`. Supports multiple transports:

```typescript
import {
  SDKMCPClientFactory,
  SDKMCPTransport,
  loadMCPConfig,
  createSDKMCPClientFactory,
  resolveMCPSource
} from '@portel/photon-core';

// Create from config
const config = {
  mcpServers: {
    // stdio transport (local process)
    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'your-token' }
    },
    // SSE transport (HTTP)
    remote: {
      url: 'http://localhost:3000/mcp',
      transport: 'sse'
    },
    // WebSocket transport
    realtime: {
      url: 'ws://localhost:8080/mcp',
      transport: 'websocket'
    },
    // Streamable HTTP transport
    streaming: {
      url: 'http://localhost:3000/mcp',
      transport: 'streamable-http'
    }
  }
};

const factory = new SDKMCPClientFactory(config);
const github = factory.create('github');

// List tools
const tools = await github.list();

// Call a tool
const issues = await github.call('list_issues', { repo: 'owner/repo' });

// Or use the proxy for fluent API
import { createMCPProxy } from '@portel/photon-core';
const githubProxy = createMCPProxy(github);
const issues = await githubProxy.list_issues({ repo: 'owner/repo' });
```

**Transport Types:**

| Transport | Config | Use Case |
|-----------|--------|----------|
| `stdio` | `command`, `args` | Local CLI-based MCPs |
| `sse` | `url`, `transport: 'sse'` | HTTP Server-Sent Events |
| `streamable-http` | `url`, `transport: 'streamable-http'` | HTTP streaming |
| `websocket` | `url`, `transport: 'websocket'` | WebSocket connections |

**Helper Functions:**

```typescript
// Load config from standard locations
// Checks: PHOTON_MCP_CONFIG env, ./photon.mcp.json, ~/.config/photon/mcp.json
const config = await loadMCPConfig();

// Create factory from default config
const factory = await createSDKMCPClientFactory();

// Resolve marketplace sources to config
const config = resolveMCPSource('github', 'anthropics/mcp-server-github', 'github');
// → { command: 'npx', args: ['-y', '@anthropics/mcp-server-github'], transport: 'stdio' }
```

---

### `SchemaExtractor`

Extracts JSON schemas from TypeScript method signatures and JSDoc comments.

```typescript
import { SchemaExtractor } from '@portel/photon-core';

const extractor = new SchemaExtractor();

// Extract from file
const schemas = await extractor.extractFromFile('./my-tool.photon.ts');

// Extract from source string
const source = await fs.readFile('./my-tool.photon.ts', 'utf-8');
const schemas = extractor.extractFromSource(source);

// Extract constructor parameters
const constructorParams = extractor.extractConstructorParams(source);
```

**Schema format:**
```typescript
interface ExtractedSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}
```

**Supported JSDoc constraints:**
```typescript
/**
 * @param age User age {@min 0} {@max 120}
 * @param email Email address {@format email}
 * @param username Username {@pattern ^[a-z0-9_]+$}
 * @param count Count {@default 10}
 */
```

---

### Generator Support (Ask/Emit Pattern)

Photon methods can be async generators that yield interactive prompts and progress updates:

```typescript
import { PhotonMCP } from '@portel/photon-core';

export default class DeployTool extends PhotonMCP {
  /**
   * Deploy with confirmation and progress
   */
  async *deploy(params: { env: string }) {
    // Ask for confirmation
    const confirmed = yield { ask: 'confirm', message: `Deploy to ${params.env}?` };
    if (!confirmed) return { status: 'cancelled' };

    // Show progress
    yield { emit: 'progress', value: 0.3, message: 'Building...' };
    await this.build();

    yield { emit: 'progress', value: 0.7, message: 'Deploying...' };
    const result = await this.push(params.env);

    yield { emit: 'progress', value: 1.0, message: 'Done!' };
    return result;
  }
}
```

**Ask yields** (input from user):
- `{ ask: 'text', message: string }` - Text input
- `{ ask: 'confirm', message: string }` - Yes/no confirmation
- `{ ask: 'select', message: string, options: string[] }` - Selection
- `{ ask: 'number', message: string }` - Number input
- `{ ask: 'password', message: string }` - Hidden input

**Emit yields** (output to user):
- `{ emit: 'progress', value: number, message?: string }` - Progress bar (0-1)
- `{ emit: 'status', message: string }` - Status update
- `{ emit: 'log', level: 'info'|'warn'|'error', message: string }` - Log message
- `{ emit: 'stream', data: string }` - Streaming output

---

### Stateful Workflows (Checkpoint Pattern)

For long-running workflows that need to survive interruptions, use checkpoint yields:

```typescript
export default class ReportGenerator extends PhotonMCP {
  /**
   * Generate weekly report with checkpoints for resume
   */
  async *generate(params: { week: number }) {
    // Step 1: Collect data
    const commits = await this.github.list_commits({ since: params.week });
    yield { checkpoint: true, state: { step: 1, commits } };

    // Step 2: Analyze
    const analysis = await this.analyze(commits);
    yield { checkpoint: true, state: { step: 2, commits, analysis } };

    // Step 3: Generate report
    const report = await this.format(analysis);
    yield { checkpoint: true, state: { step: 3, report } };

    return report;
  }
}
```

**Key concepts:**
- **Checkpoint** - marks a safe resume point with accumulated state
- **State** - preserved data to restore on resume
- **Idempotency** - place checkpoint AFTER side effects to avoid repeating them

**Using the stateful executor:**

```typescript
import { maybeStatefulExecute } from '@portel/photon-core';

// Execute with implicit checkpoint detection
const result = await maybeStatefulExecute(
  () => instance.generate({ week: 52 }),
  {
    photon: 'report-generator',
    tool: 'generate',
    params: { week: 52 },
    inputProvider: async (ask) => { /* handle asks */ },
    outputHandler: (emit) => { /* handle emits */ },
  }
);

// If workflow used checkpoints, result includes runId
if (result.isStateful) {
  console.log(`Run ID: ${result.runId}`);
}

// Resume an interrupted workflow
const resumed = await maybeStatefulExecute(
  () => instance.generate({ week: 52 }),
  {
    photon: 'report-generator',
    tool: 'generate',
    params: { week: 52 },
    resumeRunId: 'run_abc123_xyz',  // Resume from this run
    inputProvider,
    outputHandler,
  }
);
```

**JSONL persistence:** Workflows are persisted to `~/.photon/runs/{runId}.jsonl`:

```jsonl
{"t":"start","tool":"generate","params":{"week":52},"ts":1704067200}
{"t":"checkpoint","id":"cp_0","state":{"step":1,"commits":[...]},"ts":1704067205}
{"t":"checkpoint","id":"cp_1","state":{"step":2,"analysis":{...}},"ts":1704067210}
{"t":"return","value":{"report":"..."},"ts":1704067215}
```

---

### Channel-Based Pub/Sub

Photon Core provides a pluggable channel broker architecture for cross-process messaging. This enables real-time updates between MCP processes, Beam UI, and other services.

```typescript
import { PhotonMCP } from '@portel/photon-core';

export default class KanbanBoard extends PhotonMCP {
  async moveTask(params: { taskId: string; column: string }) {
    const task = await this.updateTask(params);

    // Emit to local output handler (current caller)
    this.emit({ emit: 'board-update', board: 'default' });

    // Also publish to channel for cross-process subscribers
    this.emit({
      channel: 'kanban:default',  // Format: photonName:subChannel
      event: 'task-moved',
      data: { task }
    });

    return task;
  }
}
```

**Broker Types:**

| Broker | Use Case | Configuration |
|--------|----------|---------------|
| `daemon` | Local dev, single-server | Default (uses Unix sockets) |
| `redis` | Multi-server, production | `PHOTON_REDIS_URL` |
| `http` | Webhook integrations | `PHOTON_CHANNEL_HTTP_URL` |
| `noop` | Testing, disabled | `PHOTON_CHANNEL_BROKER=noop` |

**Subscribing to channels:**

```typescript
import { getBroker } from '@portel/photon-core';

const broker = getBroker();

// Subscribe
const sub = await broker.subscribe('kanban:default', (message) => {
  console.log('Received:', message.event, message.data);
});

// Later: unsubscribe
sub.unsubscribe();
```

**Environment Variables:**
- `PHOTON_CHANNEL_BROKER` - Explicit broker type (`daemon`, `redis`, `http`, `noop`)
- `PHOTON_NAME` - Photon name for daemon socket path
- `PHOTON_REDIS_URL` - Redis connection URL (auto-enables redis broker)
- `PHOTON_CHANNEL_HTTP_URL` - HTTP webhook URL (auto-enables http broker)

See [CHANNELS.md](./CHANNELS.md) for full architecture documentation.

---

## 🏗️ Building Custom Runtimes

Photon Core is designed to be the foundation for custom runtimes. Here are examples:

### Example 1: REST API Server

```typescript
import express from 'express';
import { PhotonMCP, DependencyManager, SchemaExtractor } from '@portel/photon-core';

class PhotonRESTServer {
  async serve(photonPath: string) {
    const app = express();

    // Load photon
    const PhotonClass = (await import(photonPath)).default;
    const instance = new PhotonClass();
    await instance.onInitialize?.();

    // Extract schemas
    const extractor = new SchemaExtractor();
    const schemas = await extractor.extractFromFile(photonPath);

    // Create REST endpoints
    schemas.forEach(schema => {
      app.post(`/api/${schema.name}`, async (req, res) => {
        try {
          const result = await instance[schema.name](req.body);
          res.json({ result });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    app.listen(3000);
  }
}
```

### Example 2: GraphQL Server

```typescript
import { buildSchema } from 'graphql';
import { PhotonMCP, SchemaExtractor } from '@portel/photon-core';

class PhotonGraphQLServer {
  async generateSchema(photonPath: string) {
    const extractor = new SchemaExtractor();
    const schemas = await extractor.extractFromFile(photonPath);

    const mutations = schemas.map(s =>
      `${s.name}(${this.paramsToGraphQL(s.inputSchema)}): JSON`
    ).join('\n');

    return buildSchema(`
      type Mutation {
        ${mutations}
      }
    `);
  }
}
```

### Example 3: MCP Orchestrator

```typescript
import { PhotonMCP, DependencyManager } from '@portel/photon-core';

class PhotonOrchestrator {
  private photons = new Map();

  async loadPhoton(path: string) {
    // Install dependencies
    const depManager = new DependencyManager();
    const deps = await depManager.extractDependencies(path);
    const name = basename(path, '.photon.ts');
    await depManager.ensureDependencies(name, deps);

    // Load class
    const PhotonClass = (await import(path)).default;
    const instance = new PhotonClass();
    await instance.onInitialize?.();

    this.photons.set(name, instance);
  }

  async execute(photonName: string, method: string, params: any) {
    const photon = this.photons.get(photonName);
    return await photon[method](params);
  }
}
```

---

## 🎯 Use Cases

| Project | Description | Runtime Layer |
|---------|-------------|---------------|
| **[@portel/photon](https://github.com/portel-dev/photon)** | CLI tool for running Photons as MCP servers or CLI tools | MCP server (stdio), CLI runner |
| **[NCP](https://github.com/portel-dev/ncp)** | Multi-MCP orchestrator with discovery and semantic search | Orchestrator, unified MCP interface |
| **[Lumina](https://github.com/portel-dev/lumina)** | Multi-protocol API server | REST, GraphQL, RPC, HTTP streaming MCP |

All three projects use `@portel/photon-core` for the shared format, but each adds its own runtime layer.

---

## 🔧 Development

```bash
# Clone the repository
git clone https://github.com/portel-dev/photon-core.git
cd photon-core

# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

---

## 📄 License

MIT © [Portel](https://github.com/portel-dev)

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 🔗 Related Projects

- **[@portel/photon](https://github.com/portel-dev/photon)** - CLI tool for running Photons
- **[NCP](https://github.com/portel-dev/ncp)** - Multi-MCP orchestrator
- **[Lumina](https://github.com/portel-dev/lumina)** - Multi-protocol API server

---

## 📖 Documentation

For more information about the Photon format and ecosystem:
- [Photon Documentation](https://github.com/portel-dev/photon)
- [NCP Documentation](https://github.com/portel-dev/ncp)
- [Lumina Documentation](https://github.com/portel-dev/lumina)
