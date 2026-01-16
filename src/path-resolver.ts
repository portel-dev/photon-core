/**
 * Path Resolver for Photon files
 *
 * Generic path resolution utilities used by photon, lumina, ncp.
 * Configurable file extensions and default directories.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export const DEFAULT_PHOTON_DIR = path.join(os.homedir(), '.photon');

/**
 * Expand tilde (~) to user's home directory
 * Shell does this automatically, but Node.js CLI args don't get shell expansion
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath === '~') {
    return os.homedir();
  }
  return filePath;
}

export interface ResolverOptions {
  /** File extensions to look for (default: ['.photon.ts', '.photon.js']) */
  extensions?: string[];
  /** Default working directory */
  defaultDir?: string;
}

const defaultOptions: Required<ResolverOptions> = {
  extensions: ['.photon.ts', '.photon.js'],
  defaultDir: DEFAULT_PHOTON_DIR,
};

/**
 * Resolve a file path from name
 * Looks in the specified working directory, or uses absolute path if provided
 */
export async function resolvePath(
  name: string,
  workingDir?: string,
  options?: ResolverOptions
): Promise<string | null> {
  const opts = { ...defaultOptions, ...options };
  const dir = expandTilde(workingDir || opts.defaultDir);

  // If absolute path provided, check if it exists
  if (path.isAbsolute(name)) {
    try {
      await fs.access(name);
      return name;
    } catch {
      return null;
    }
  }

  // Remove extension if provided (match any configured extension)
  let basename = name;
  for (const ext of opts.extensions) {
    if (name.endsWith(ext)) {
      basename = name.slice(0, -ext.length);
      break;
    }
  }

  // Try each extension
  for (const ext of opts.extensions) {
    const filePath = path.join(dir, `${basename}${ext}`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Continue to next extension
    }
  }

  // Not found
  return null;
}

/**
 * List all matching files in a directory
 */
export async function listFiles(
  workingDir?: string,
  options?: ResolverOptions
): Promise<string[]> {
  const opts = { ...defaultOptions, ...options };
  const dir = expandTilde(workingDir || opts.defaultDir);

  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      // Include both regular files and symlinks
      if (entry.isFile() || entry.isSymbolicLink()) {
        // Check if file matches any extension
        for (const ext of opts.extensions) {
          if (entry.name.endsWith(ext)) {
            // Remove extension for display
            const name = entry.name.slice(0, -ext.length);
            files.push(name);
            break;
          }
        }
      }
    }

    return files.sort();
  } catch {
    return [];
  }
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dir?: string): Promise<void> {
  const targetDir = expandTilde(dir || DEFAULT_PHOTON_DIR);
  await fs.mkdir(targetDir, { recursive: true });
}

// Convenience aliases for photon-specific usage
export const resolvePhotonPath = resolvePath;
export const listPhotonFiles = listFiles;
export const ensurePhotonDir = ensureDir;
