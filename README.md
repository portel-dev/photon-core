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
