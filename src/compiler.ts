/**
 * TypeScript Compiler Utilities
 *
 * Shared esbuild-based TypeScript compilation with caching.
 * Extracted from photon and ncp loaders.
 *
 * NOTE: No esbuild dependency in package.json — the consumer must provide it.
 * Uses `await import('esbuild')` for dynamic resolution.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Compile a .photon.ts file to JavaScript and cache the result
 *
 * @param tsFilePath - Absolute path to the TypeScript source file
 * @param options.cacheDir - Directory to store compiled output
 * @param options.content - Optional pre-read file content (avoids extra read)
 * @returns Absolute path to the compiled .mjs file
 */
/**
 * Transform arrays to reactive collections for PhotonMCP classes
 *
 * ZERO-EFFORT REACTIVITY: If a class extends PhotonMCP and has array properties,
 * this transform automatically:
 * 1. Injects `import { Array as ReactiveArray } from '@portel/photon-core'`
 * 2. Transforms `= []` to `= new ReactiveArray()` for class properties
 *
 * Result: Developers write normal code, arrays are automatically reactive.
 *
 * ```typescript
 * // Developer writes this (normal TypeScript):
 * export default class TodoList extends PhotonMCP {
 *   items: Task[] = [];
 *   async add(text: string) { this.items.push({...}); }
 * }
 *
 * // Compiler transforms to:
 * import { Array as ReactiveArray } from '@portel/photon-core';
 * export default class TodoList extends PhotonMCP {
 *   items = new ReactiveArray();
 *   async add(text: string) { this.items.push({...}); }  // Auto-emits!
 * }
 * ```
 */
function transformReactiveCollections(source: string): string {
  // Check if this is a PhotonMCP class (extends PhotonMCP)
  const isPhotonMCP = /class\s+\w+\s+extends\s+PhotonMCP\b/.test(source);
  if (!isPhotonMCP) return source;

  // Check if there are array properties with = [] that need transformation
  // Look for patterns like: `items: Type[] = []` or `items = []` (class properties)
  const hasArrayLiterals =
    /\w+\s*:\s*[^=\n]+\[\]\s*=\s*\[\s*\]/.test(source) || // typed: Type[] = []
    /^\s+\w+\s*=\s*\[\s*\](?=\s*[;\n])/m.test(source);     // simple: prop = []

  if (!hasArrayLiterals) return source;

  let transformed = source;

  // Check if Array is already imported from photon-core
  const hasArrayImport = /import\s*\{[^}]*\bArray\b[^}]*\}\s*from\s*['"]@portel\/photon-core['"]/.test(source);

  if (!hasArrayImport) {
    // Inject ReactiveArray import (using alias to avoid shadowing issues)
    // Find the photon-core import and add ReactiveArray to it, or add new import
    const photonCoreImport = source.match(
      /import\s*\{([^}]+)\}\s*from\s*['"]@portel\/photon-core['"]/
    );

    if (photonCoreImport) {
      // Add to existing import
      const existingImports = photonCoreImport[1];
      transformed = transformed.replace(
        photonCoreImport[0],
        `import { ${existingImports}, Array as ReactiveArray } from '@portel/photon-core'`
      );
    } else {
      // Add new import at the top (after any existing imports)
      const lastImportMatch = source.match(/^import\s+.+$/gm);
      if (lastImportMatch) {
        const lastImport = lastImportMatch[lastImportMatch.length - 1];
        transformed = transformed.replace(
          lastImport,
          `${lastImport}\nimport { Array as ReactiveArray } from '@portel/photon-core';`
        );
      } else {
        // No imports, add at top
        transformed = `import { Array as ReactiveArray } from '@portel/photon-core';\n${transformed}`;
      }
    }
  }

  // Determine the Array constructor name to use
  const arrayConstructor = hasArrayImport ? 'Array' : 'ReactiveArray';

  // Transform class property declarations with type annotation = []
  // Handles: items: Task[] = []; | items: Array<T> = [];
  transformed = transformed.replace(
    /(\w+)\s*:\s*(?:Array<[^>]+>|[^=\n]+\[\])\s*=\s*\[\s*\]/g,
    `$1 = new ${arrayConstructor}()`
  );

  // Transform class property without type annotation (indented, at start of line)
  // Skip local variables (const/let/var)
  transformed = transformed.replace(
    /^(\s+)(\w+)\s*=\s*\[\s*\](?=\s*[;\n])/gm,
    `$1$2 = new ${arrayConstructor}()`
  );

  return transformed;
}

export async function compilePhotonTS(
  tsFilePath: string,
  options: { cacheDir: string; content?: string },
): Promise<string> {
  let source = options.content ?? (await fs.readFile(tsFilePath, 'utf-8'));

  // Transform reactive collection literals before compilation
  source = transformReactiveCollections(source);

  const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

  const fileName = path.basename(tsFilePath, '.ts');
  const cachedJsPath = path.join(options.cacheDir, `${fileName}.${hash}.mjs`);

  // Check if cached version exists
  try {
    await fs.access(cachedJsPath);
    return cachedJsPath;
  } catch {
    // Cache miss — compile
  }

  // Dynamic import — consumer must have esbuild installed
  const esbuild = await import('esbuild');
  const result = await esbuild.transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    sourcemap: 'inline',
  });

  // Ensure cache directory exists
  await fs.mkdir(options.cacheDir, { recursive: true });

  // Write compiled JavaScript
  await fs.writeFile(cachedJsPath, result.code, 'utf-8');

  return cachedJsPath;
}
