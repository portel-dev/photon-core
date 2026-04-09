/**
 * Path Resolver for Photon files
 *
 * Generic path resolution utilities used by photon, lumina, ncp.
 * Configurable file extensions and default directories.
 *
 * Supports namespace-based directory structure:
 *   ~/.photon/
 *     portel-dev/          ← namespace (marketplace author)
 *       whatsapp.photon.ts
 *     local/               ← implicit namespace for user-created photons
 *       todo.photon.ts
 *     legacy.photon.ts     ← flat files (pre-migration, still supported)
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
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

/** Directories to skip when scanning for namespace subdirectories */
const SKIP_DIRS = new Set([
  '.data', '.cache', '.config',
  'state', 'context', 'env', // legacy data dirs (pre-.data/ consolidation)
  'node_modules', 'marketplace', 'photons', 'templates',
]);

/**
 * Resolve a file path from name.
 *
 * Supports namespace-qualified names: 'namespace:photonName'
 * For unqualified names, searches flat files first, then namespace subdirectories.
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

  // Parse namespace:name format
  const colonIndex = name.indexOf(':');
  let namespace: string | undefined;
  let photonName: string;
  if (colonIndex !== -1) {
    namespace = name.slice(0, colonIndex);
    photonName = name.slice(colonIndex + 1);
  } else {
    photonName = name;
  }

  // Remove extension if provided (match any configured extension)
  let basename = photonName;
  for (const ext of opts.extensions) {
    if (photonName.endsWith(ext)) {
      basename = photonName.slice(0, -ext.length);
      break;
    }
  }

  // If namespace is specified, search only that namespace directory
  if (namespace) {
    for (const ext of opts.extensions) {
      const filePath = path.join(dir, namespace, `${basename}${ext}`);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // Continue
      }
    }
    return null;
  }

  // Unqualified name: search flat files first (backward compat)
  for (const ext of opts.extensions) {
    const filePath = path.join(dir, `${basename}${ext}`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Continue
    }
  }

  // Then search namespace subdirectories (one level deep)
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      for (const ext of opts.extensions) {
        const filePath = path.join(dir, entry.name, `${basename}${ext}`);
        try {
          await fs.access(filePath);
          return filePath;
        } catch {
          // Continue
        }
      }
    }
  } catch {
    // dir doesn't exist
  }

  return null;
}

/**
 * Result from listing files, including namespace information.
 */
export interface ListedPhoton {
  /** Short name (e.g., 'whatsapp') */
  name: string;
  /** Namespace (e.g., 'portel-dev') or empty string for flat/root-level files */
  namespace: string;
  /** Qualified name (e.g., 'portel-dev:whatsapp' or 'whatsapp' for flat) */
  qualifiedName: string;
  /** Full absolute path to the file */
  filePath: string;
}

/**
 * List all matching files in a directory.
 *
 * Scans both flat files (backward compat) and namespace subdirectories.
 * Returns short names for backward compatibility.
 */
export async function listFiles(
  workingDir?: string,
  options?: ResolverOptions
): Promise<string[]> {
  const listed = await listFilesWithNamespace(workingDir, options);
  return listed.map((l) => l.name).sort();
}

/**
 * List all matching files with full namespace metadata.
 *
 * Scans flat files at the root level and one level of namespace subdirectories.
 * Automatically removes broken symlinks (target deleted) and reports via onCleanup.
 */
export async function listFilesWithNamespace(
  workingDir?: string,
  options?: ResolverOptions & {
    onCleanup?: (name: string, symlinkPath: string) => void;
  }
): Promise<ListedPhoton[]> {
  const opts = { ...defaultOptions, ...options };
  const dir = expandTilde(workingDir || opts.defaultDir);
  const results: ListedPhoton[] = [];

  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });

    // Scan flat files at root level (backward compat / pre-migration)
    for (const entry of entries) {
      if (entry.isFile() || entry.isSymbolicLink()) {
        if (entry.isSymbolicLink()) {
          const fullPath = path.join(dir, entry.name);
          try { await fs.access(fullPath); } catch {
            // Broken symlink — auto-remove and notify caller
            const name = entry.name.replace(/\.photon\.(ts|js)$/, '');
            await fs.unlink(fullPath).catch(() => {});
            options?.onCleanup?.(name, fullPath);
            continue;
          }
        }
        for (const ext of opts.extensions) {
          if (entry.name.endsWith(ext)) {
            const name = entry.name.slice(0, -ext.length);
            results.push({
              name,
              namespace: '',
              qualifiedName: name,
              filePath: path.join(dir, entry.name),
            });
            break;
          }
        }
      }
    }

    // Scan namespace subdirectories (one level deep)
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      const nsDir = path.join(dir, entry.name);
      try {
        const nsEntries = await fs.readdir(nsDir, { withFileTypes: true });
        for (const nsEntry of nsEntries) {
          if (nsEntry.isFile() || nsEntry.isSymbolicLink()) {
            if (nsEntry.isSymbolicLink()) {
              const fullPath = path.join(nsDir, nsEntry.name);
              try { await fs.access(fullPath); } catch {
                const name = nsEntry.name.replace(/\.photon\.(ts|js)$/, '');
                await fs.unlink(fullPath).catch(() => {});
                options?.onCleanup?.(name, fullPath);
                continue;
              }
            }
            for (const ext of opts.extensions) {
              if (nsEntry.name.endsWith(ext)) {
                const name = nsEntry.name.slice(0, -ext.length);
                results.push({
                  name,
                  namespace: entry.name,
                  qualifiedName: `${entry.name}:${name}`,
                  filePath: path.join(nsDir, nsEntry.name),
                });
                break;
              }
            }
          }
        }
      } catch {
        // Namespace dir unreadable, skip
      }
    }
  } catch {
    // Root dir doesn't exist
  }

  return results;
}

/** Runtime data patterns that should never be committed to a marketplace repo */
const GITIGNORE_DATA_PATTERNS = [
  '# Photon runtime data (auto-generated)',
  '.data/',
];

/**
 * Check if a directory is inside a git repository
 */
function isGitRepo(dir: string): boolean {
  let current = dir;
  while (true) {
    if (fsSync.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Ensure .gitignore in a git-tracked photon dir excludes runtime data.
 * Only adds missing patterns — never removes or overwrites existing entries.
 */
async function ensureGitignore(dir: string): Promise<void> {
  const gitignorePath = path.join(dir, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    // No .gitignore yet
  }

  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = GITIGNORE_DATA_PATTERNS.filter((p) => !existingLines.has(p));

  if (missing.length === 0) return;

  const append = (existing && !existing.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
  await fs.appendFile(gitignorePath, append);
}

/**
 * Ensure directory exists.
 * If the directory is inside a git repo (e.g., a marketplace repo),
 * auto-generates .gitignore entries for runtime data directories.
 */
export async function ensureDir(dir?: string): Promise<void> {
  const targetDir = expandTilde(dir || DEFAULT_PHOTON_DIR);
  await fs.mkdir(targetDir, { recursive: true });

  // Auto-exclude runtime data when developing in a git-tracked marketplace repo
  if (targetDir !== DEFAULT_PHOTON_DIR && isGitRepo(targetDir)) {
    await ensureGitignore(targetDir);
  }
}

// Convenience aliases for photon-specific usage
export const resolvePhotonPath = resolvePath;
export const listPhotonFiles = listFiles;
export const listPhotonFilesWithNamespace = listFilesWithNamespace;
export const ensurePhotonDir = ensureDir;
