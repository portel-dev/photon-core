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

// Types
export * from './types.js';
