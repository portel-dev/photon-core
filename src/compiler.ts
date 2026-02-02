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
export async function compilePhotonTS(
  tsFilePath: string,
  options: { cacheDir: string; content?: string },
): Promise<string> {
  const source = options.content ?? (await fs.readFile(tsFilePath, 'utf-8'));
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
