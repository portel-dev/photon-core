/**
 * Bases Registry
 *
 * Tracks every PHOTON_DIR the daemon has served. The daemon upserts an
 * entry on every photon invocation and, on startup, scans each surviving
 * base for long-lived per-photon state (schedules, etc.) that must be
 * reinstated across restarts.
 *
 * The registry itself is daemon infrastructure and lives at the global
 * path `~/.photon/.data/.bases.json`. The data it points at is NOT — each
 * listed base owns its own data under `{base}/.data/`.
 *
 * See docs/internals/PHOTON-DIR-AND-NAMESPACE.md §8.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBasesRegistryPath } from './data-paths.js';

export interface BaseRegistryEntry {
  /** Absolute, resolved path to the PHOTON_DIR. */
  path: string;
  /** ISO-8601 timestamp of first record. */
  firstSeen: string;
  /** ISO-8601 timestamp of most recent invocation. */
  lastSeen: string;
}

export interface BasesRegistry {
  bases: BaseRegistryEntry[];
}

const EMPTY_REGISTRY: BasesRegistry = { bases: [] };

function normalizeBase(basePath: string): string {
  return path.resolve(basePath);
}

/**
 * Read the registry from disk. Returns an empty registry if the file is
 * missing or malformed. Never throws for absent data.
 */
export function readBasesRegistry(): BasesRegistry {
  const file = getBasesRegistryPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return { bases: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.bases)) return { bases: [] };
    // Trust the shape but filter out entries that are obviously broken.
    const bases = parsed.bases.filter(
      (b: any) =>
        b &&
        typeof b.path === 'string' &&
        typeof b.firstSeen === 'string' &&
        typeof b.lastSeen === 'string'
    );
    return { bases };
  } catch {
    return { bases: [] };
  }
}

/**
 * Write the registry to disk atomically. Creates the parent directory if
 * needed. Uses a temp-file + rename pattern so readers never observe a
 * half-written file.
 */
export function writeBasesRegistry(registry: BasesRegistry): void {
  const file = getBasesRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Upsert a base with a fresh `lastSeen`. Sets `firstSeen` on new entries.
 * Safe to call on every photon invocation — cost is one JSON round-trip
 * per call.
 */
export function touchBase(basePath: string, now: Date = new Date()): void {
  const normalized = normalizeBase(basePath);
  const iso = now.toISOString();
  const registry = readBasesRegistry();
  const existing = registry.bases.find((b) => b.path === normalized);
  if (existing) {
    existing.lastSeen = iso;
  } else {
    registry.bases.push({ path: normalized, firstSeen: iso, lastSeen: iso });
  }
  writeBasesRegistry(registry);
}

/**
 * Return registry entries whose path still exists on disk as a directory.
 * Entries whose path cannot be confirmed (permission errors, unmounted
 * drives, transient failures) are KEPT — we only filter on confirmed
 * absence, so a momentarily-unreachable path does not get silently
 * dropped.
 */
export function listActiveBases(): BaseRegistryEntry[] {
  const registry = readBasesRegistry();
  return registry.bases.filter((b) => {
    try {
      return fs.statSync(b.path).isDirectory();
    } catch (err: any) {
      // Only treat "does not exist" as inactive. Other errors keep the entry.
      return err?.code !== 'ENOENT';
    }
  });
}

/**
 * Remove entries whose path is confirmed absent on disk (ENOENT only).
 * Writes the pruned registry back. Returns the list of entries that were
 * removed so callers can log them.
 */
export function pruneBasesRegistry(): BaseRegistryEntry[] {
  const registry = readBasesRegistry();
  const removed: BaseRegistryEntry[] = [];
  const kept: BaseRegistryEntry[] = [];
  for (const b of registry.bases) {
    let confirmedAbsent = false;
    try {
      fs.statSync(b.path);
    } catch (err: any) {
      if (err?.code === 'ENOENT') confirmedAbsent = true;
    }
    if (confirmedAbsent) removed.push(b);
    else kept.push(b);
  }
  if (removed.length > 0) {
    writeBasesRegistry({ bases: kept });
  }
  return removed;
}
