/**
 * PhotonWatcher
 *
 * Reusable file watcher for .photon.ts/.photon.js files.
 * Extracted from the daemon's battle-tested implementation with:
 * - Symlink resolution (macOS fs.watch fix)
 * - Debouncing (configurable, default 100ms)
 * - Temp file filtering (.swp, .bak, ~, .DS_Store, vim 4913)
 * - Rename handling (macOS sed -i new inode → re-establish watcher)
 * - Directory watching for added/removed photons
 *
 * Zero new dependencies — uses Node.js fs.watch().
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

export interface PhotonWatcherOptions {
  /** Directories to scan for photon files */
  directories: string[];
  /** File extensions to watch (default: ['.photon.ts', '.photon.js']) */
  extensions?: string[];
  /** Debounce interval in ms (default: 100) */
  debounceMs?: number;
  /** Watch directories for new/removed files (default: true) */
  watchDirectories?: boolean;
}

/** Temp/junk files to ignore */
const IGNORED_PATTERNS = [
  /\.swp$/,
  /\.bak$/,
  /~$/,
  /\.DS_Store$/,
  /^4913$/,       // vim temp file check
  /\.tmp$/,
  /^\.#/,         // emacs lock files
];

function isIgnored(filename: string): boolean {
  return IGNORED_PATTERNS.some((p) => p.test(filename));
}

function isPhotonFile(filename: string, extensions: string[]): boolean {
  return extensions.some((ext) => filename.endsWith(ext));
}

function photonNameFromFile(filename: string, extensions: string[]): string | null {
  for (const ext of extensions) {
    if (filename.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
  }
  return null;
}

export class PhotonWatcher extends EventEmitter {
  private options: Required<PhotonWatcherOptions>;
  private fileWatchers = new Map<string, fs.FSWatcher>();
  private dirWatchers = new Map<string, fs.FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Maps watchPath (real) → { photonName, originalPath } */
  private watchedFiles = new Map<string, { photonName: string; originalPath: string }>();
  /** Tracks known photon files per directory for diff-based add/remove detection */
  private knownFiles = new Map<string, Set<string>>();
  private running = false;

  constructor(options: PhotonWatcherOptions) {
    super();
    this.options = {
      directories: options.directories,
      extensions: options.extensions ?? ['.photon.ts', '.photon.js'],
      debounceMs: options.debounceMs ?? 100,
      watchDirectories: options.watchDirectories ?? true,
    };
  }

  /**
   * Start watching. Scans directories for existing photon files and sets up watchers.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const dir of this.options.directories) {
      await this.scanDirectory(dir);
      if (this.options.watchDirectories) {
        this.watchDirectory(dir);
      }
    }
  }

  /**
   * Stop all watchers and clean up.
   */
  async stop(): Promise<void> {
    this.running = false;

    for (const [, watcher] of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers.clear();

    for (const [, watcher] of this.dirWatchers) {
      watcher.close();
    }
    this.dirWatchers.clear();

    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.watchedFiles.clear();
    this.knownFiles.clear();
  }

  /**
   * Watch a specific photon file. Called automatically during scan,
   * but can also be called manually for dynamically discovered files.
   */
  watchFile(photonName: string, filePath: string): void {
    // Resolve symlink so fs.watch() fires when the real file changes.
    // On macOS, fs.watch on a symlink only detects changes to the symlink inode itself.
    let watchPath = filePath;
    try {
      watchPath = fs.realpathSync(filePath);
    } catch {
      // Symlink target doesn't exist yet — fall back to original path
    }

    if (this.fileWatchers.has(watchPath)) return;

    try {
      const watcher = fs.watch(watchPath, (eventType) => {
        this.handleFileEvent(eventType, watchPath, photonName, filePath);
      });

      watcher.on('error', (err) => {
        this.emit('error', err, { photonName, path: filePath });
        this.unwatchByRealPath(watchPath);
      });

      this.fileWatchers.set(watchPath, watcher);
      this.watchedFiles.set(watchPath, { photonName, originalPath: filePath });
    } catch (err) {
      this.emit('error', err, { photonName, path: filePath });
    }
  }

  /**
   * Stop watching a specific file by its original path.
   */
  unwatchFile(filePath: string): void {
    // Find the real path entry
    for (const [watchPath, info] of this.watchedFiles) {
      if (info.originalPath === filePath) {
        this.unwatchByRealPath(watchPath);
        return;
      }
    }
  }

  /**
   * Get a map of currently watched files: photonName → originalPath
   */
  getWatchedFiles(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [, info] of this.watchedFiles) {
      result.set(info.photonName, info.originalPath);
    }
    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Internal
  // ──────────────────────────────────────────────────────────────────────────────

  private handleFileEvent(
    eventType: string,
    watchPath: string,
    photonName: string,
    originalPath: string
  ): void {
    // Debounce
    const existing = this.debounceTimers.get(watchPath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      watchPath,
      setTimeout(() => {
        this.debounceTimers.delete(watchPath);

        // On macOS, editors like sed -i replace the file (new inode),
        // killing the watcher. Re-watch via original path to re-resolve symlinks.
        if (eventType === 'rename') {
          this.unwatchByRealPath(watchPath);
          if (fs.existsSync(originalPath)) {
            this.watchFile(photonName, originalPath);
          } else {
            this.emit('removed', photonName);
            return;
          }
        }

        if (!fs.existsSync(originalPath)) {
          this.emit('removed', photonName);
          return;
        }

        this.emit('changed', photonName, originalPath);
      }, this.options.debounceMs)
    );
  }

  private unwatchByRealPath(watchPath: string): void {
    const watcher = this.fileWatchers.get(watchPath);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(watchPath);
    }
    this.watchedFiles.delete(watchPath);

    const timer = this.debounceTimers.get(watchPath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(watchPath);
    }
  }

  private async scanDirectory(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.emit('error', error, { directory: dir });
      }
      return;
    }

    const currentFiles = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (isIgnored(entry.name)) continue;
      if (!isPhotonFile(entry.name, this.options.extensions)) continue;

      const photonName = photonNameFromFile(entry.name, this.options.extensions);
      if (!photonName) continue;

      const filePath = path.join(dir, entry.name);
      currentFiles.add(entry.name);

      // Only emit 'added' and watch if this is a new file
      const known = this.knownFiles.get(dir);
      if (!known || !known.has(entry.name)) {
        this.emit('added', photonName, filePath);
        this.watchFile(photonName, filePath);
      }
    }

    // Detect removals (files that were known but no longer present)
    const previousFiles = this.knownFiles.get(dir);
    if (previousFiles) {
      for (const filename of previousFiles) {
        if (!currentFiles.has(filename)) {
          const photonName = photonNameFromFile(filename, this.options.extensions);
          if (photonName) {
            const filePath = path.join(dir, filename);
            this.unwatchFile(filePath);
            this.emit('removed', photonName);
          }
        }
      }
    }

    this.knownFiles.set(dir, currentFiles);
  }

  private watchDirectory(dir: string): void {
    if (this.dirWatchers.has(dir)) return;

    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;
        if (isIgnored(filename)) return;
        if (!isPhotonFile(filename, this.options.extensions)) return;

        // Debounce directory events
        const key = `dir:${dir}`;
        const existing = this.debounceTimers.get(key);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          key,
          setTimeout(() => {
            this.debounceTimers.delete(key);
            if (this.running) {
              this.scanDirectory(dir);
            }
          }, this.options.debounceMs)
        );
      });

      watcher.on('error', (err) => {
        this.emit('error', err, { directory: dir });
      });

      this.dirWatchers.set(dir, watcher);
    } catch (err) {
      this.emit('error', err, { directory: dir });
    }
  }
}
