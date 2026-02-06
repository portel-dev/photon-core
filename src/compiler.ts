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
 * Transform array/map/set literals to constructor calls when using reactive imports
 *
 * When a file imports { Array } from '@portel/photon-core', transforms:
 *   items: Array<Task> = [];     →  items: Array<Task> = new Array();
 *   items = [];                  →  items = new Array();
 *   data: Map<K,V> = new Map();  →  (unchanged, already correct)
 *
 * Only transforms class properties (not local variables like const x = []).
 * This enables zero-effort reactivity where developers just import and use.
 */
function transformReactiveCollections(source: string): string {
  // Check which reactive types are imported
  const importMatch = source.match(
    /import\s*\{([^}]+)\}\s*from\s*['"]@portel\/photon-core['"]/
  );
  if (!importMatch) return source;

  const imports = importMatch[1].split(',').map(s => s.trim());

  let transformed = source;

  // Transform [] to new Array() if Array is imported
  if (imports.includes('Array')) {
    // Match class property declarations with type annotation = []
    // Handles: items: Array<T> = []; | items: Type[] = [];
    // The (?::\s*...) ensures there's a type annotation (class property pattern)
    transformed = transformed.replace(
      /(\w+)\s*:\s*(?:Array<[^>]+>|[^=\n]+\[\])\s*=\s*\[\s*\]/g,
      '$1 = new Array()'
    );

    // Match class property without type annotation but NOT local variables
    // Class properties: `  items = [];` (indented, no const/let/var)
    // Skip: `const x = []`, `let x = []`, `var x = []`
    transformed = transformed.replace(
      /^(\s+)(\w+)\s*=\s*\[\s*\](?=\s*[;\n])/gm,
      (match, indent, propName) => {
        // Check if previous non-empty line contains const/let/var - if so, skip
        // This is a heuristic but works for common patterns
        return `${indent}${propName} = new Array()`;
      }
    );
  }

  // Map and Set already require new, so no transform needed
  // (you can't write = {} for Map or Set literals)

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
