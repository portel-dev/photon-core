/**
 * Central Data Path Resolver
 *
 * Single source of truth for ALL runtime data paths in photon.
 * Everything lives under `.data/` inside the photon base directory.
 *
 * Structure:
 *   {baseDir}/.data/
 *     # Global
 *     daemon.sock / .pid / .log
 *     audit.jsonl
 *     .metadata.json
 *     .cache/
 *     _global/                              ← global shared memory
 *     _sessions/{sessionId}/{ns}/{photon}/  ← session-scoped memory
 *     tasks/                                ← ephemeral async task state
 *
 *     # Per-photon (always namespaced)
 *     {namespace}/{photon-name}/
 *       state/{instance}/state.json + state.log
 *       memory/
 *       env.json
 *       context.json
 *       runs/
 *       logs/
 *       schedules/
 *       config.json
 */

import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Default PHOTON_DIR when none is explicitly resolved: the user's home
 * `.photon` directory. Single source of truth — path-resolver.ts and
 * photon/src/context.ts re-export this so there is exactly one constant
 * for the concept.
 */
export const DEFAULT_PHOTON_DIR = path.join(os.homedir(), '.photon');

function getBase(baseDir?: string): string {
  return baseDir || process.env.PHOTON_DIR || DEFAULT_PHOTON_DIR;
}

// ── Root ─────────────────────────────────────────────────────────────────────

/** Root of all runtime data: {baseDir}/.data/ */
export function getDataRoot(baseDir?: string): string {
  return path.join(getBase(baseDir), '.data');
}

// ── Per-Photon ───────────────────────────────────────────────────────────────

/** Per-photon data root: .data/{photonName}/ for local, .data/{namespace}/{photonName}/ for marketplace */
export function getPhotonDataDir(namespace: string, photonName: string, baseDir?: string): string {
  if (!namespace || namespace === 'local') {
    return path.join(getDataRoot(baseDir), photonName);
  }
  return path.join(getDataRoot(baseDir), namespace, photonName);
}

/** Instance state file: .data/{ns}/{name}/state/{instance}/state.json */
export function getPhotonStatePath(namespace: string, photonName: string, instance: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'state', instance || 'default', 'state.json');
}

/** Instance event log: .data/{ns}/{name}/state/{instance}/state.log */
export function getPhotonStateLogPath(namespace: string, photonName: string, instance: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'state', instance || 'default', 'state.log');
}

/** Per-photon memory directory: .data/{ns}/{name}/memory/ */
export function getPhotonMemoryDir(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'memory');
}

/** Per-photon env vars: .data/{ns}/{name}/env.json */
export function getPhotonEnvPath(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'env.json');
}

/** Current instance selector: .data/{ns}/{name}/context.json */
export function getPhotonContextPath(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'context.json');
}

/** Workflow checkpoint runs: .data/{ns}/{name}/runs/ */
export function getPhotonRunsDir(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'runs');
}

/** Execution audit logs: .data/{ns}/{name}/logs/ */
export function getPhotonLogsDir(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'logs');
}

/** Schedule definitions: .data/{ns}/{name}/schedules/ */
export function getPhotonSchedulesDir(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'schedules');
}

/** Per-photon config: .data/{ns}/{name}/config.json */
export function getPhotonConfigPath(namespace: string, photonName: string, baseDir?: string): string {
  return path.join(getPhotonDataDir(namespace, photonName, baseDir), 'config.json');
}

// ── Global ───────────────────────────────────────────────────────────────────

/** Global shared memory: .data/_global/ */
export function getGlobalMemoryDir(baseDir?: string): string {
  return path.join(getDataRoot(baseDir), '_global');
}

/** Session-scoped memory: .data/_sessions/{sessionId}/{photon}/ or .data/_sessions/{sessionId}/{ns}/{photon}/ */
export function getSessionMemoryDir(sessionId: string, namespace: string, photonName: string, baseDir?: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!namespace || namespace === 'local') {
    return path.join(getDataRoot(baseDir), '_sessions', safeSession, photonName);
  }
  return path.join(getDataRoot(baseDir), '_sessions', safeSession, namespace, photonName);
}

/** Compilation & marketplace cache: .data/.cache/ */
export function getCacheDir(baseDir?: string): string {
  return path.join(getDataRoot(baseDir), '.cache');
}

/** Ephemeral async task state: .data/tasks/ */
export function getTasksDir(baseDir?: string): string {
  return path.join(getDataRoot(baseDir), 'tasks');
}

/** Global audit log: .data/audit.jsonl */
export function getAuditPath(baseDir?: string): string {
  return path.join(getDataRoot(baseDir), 'audit.jsonl');
}

/** Marketplace install metadata: .data/.metadata.json */
export function getMetadataPath(baseDir?: string): string {
  return path.join(getDataRoot(baseDir), '.metadata.json');
}

// ── Daemon (always global ~/.photon/.data/) ──────────────────────────────────

/** Daemon socket: always ~/.photon/.data/daemon.sock (global, one per user) */
export function getDaemonSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\photon-daemon';
  }
  return path.join(DEFAULT_PHOTON_DIR, '.data', 'daemon.sock');
}

/** Daemon PID file: always ~/.photon/.data/daemon.pid */
export function getDaemonPidPath(): string {
  return path.join(DEFAULT_PHOTON_DIR, '.data', 'daemon.pid');
}

/** Daemon log file: always ~/.photon/.data/daemon.log */
export function getDaemonLogPath(): string {
  return path.join(DEFAULT_PHOTON_DIR, '.data', 'daemon.log');
}

/**
 * Bases registry: always ~/.photon/.data/.bases.json (global, one per user).
 *
 * The daemon maintains this file to track every PHOTON_DIR it has served.
 * On startup it reads the registry and scans each base for schedules and
 * other long-lived per-photon state that must survive daemon restarts.
 *
 * The `PHOTON_BASES_REGISTRY` env var exists as a test-only override;
 * production always uses the fixed global path.
 *
 * See docs/internals/PHOTON-DIR-AND-NAMESPACE.md §8.
 */
export function getBasesRegistryPath(): string {
  return process.env.PHOTON_BASES_REGISTRY ?? path.join(DEFAULT_PHOTON_DIR, '.data', '.bases.json');
}

// ── Namespace Detection ──────────────────────────────────────────────────────

/**
 * Detect the namespace for a photon directory by reading git remote origin.
 * Returns the owner/org from the remote URL, or '' if not a git repo.
 *
 * Examples:
 *   git@github.com:portel-dev/photons.git     → 'portel-dev'
 *   https://github.com/arul-kumar/my-photons  → 'arul-kumar'
 *   (no git remote)                           → ''
 */
export function detectNamespace(dir: string): string {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // SSH: git@github.com:owner/repo.git
    const sshMatch = remote.match(/git@[^:]+:([^/]+)\//);
    if (sshMatch) return sshMatch[1];

    // HTTPS: https://github.com/owner/repo[.git]
    const httpsMatch = remote.match(/https?:\/\/[^/]+\/([^/]+)\//);
    if (httpsMatch) return httpsMatch[1];
  } catch {
    // Not a git repo or no remote — expected
  }
  return '';
}

// ── Legacy Path Helpers (for migration fallback) ─────────────────────────────

/** Old state path: {baseDir}/state/{photonName}/{instance}.json */
export function getLegacyStatePath(photonName: string, instance: string, baseDir?: string): string {
  return path.join(getBase(baseDir), 'state', photonName, `${instance || 'default'}.json`);
}

/** Old state log: {baseDir}/state/{photonName}/{instance}.log */
export function getLegacyStateLogPath(photonName: string, instance: string, baseDir?: string): string {
  return path.join(getBase(baseDir), 'state', photonName, `${instance || 'default'}.log`);
}

/** Old context path: {baseDir}/context/{photonName}.json */
export function getLegacyContextPath(photonName: string, baseDir?: string): string {
  return path.join(getBase(baseDir), 'context', `${photonName}.json`);
}

/** Old env path: {baseDir}/env/{photonName}.json */
export function getLegacyEnvPath(photonName: string, baseDir?: string): string {
  return path.join(getBase(baseDir), 'env', `${photonName}.json`);
}

/** Old memory dir: {baseDir}/data/{photonId}/ */
export function getLegacyMemoryDir(photonName: string, baseDir?: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getBase(baseDir), 'data', safeName);
}

/** Old global memory: {baseDir}/data/_global/ */
export function getLegacyGlobalMemoryDir(baseDir?: string): string {
  return path.join(getBase(baseDir), 'data', '_global');
}

/** Old session memory: {baseDir}/sessions/{sessionId}/{photonId}/ */
export function getLegacySessionMemoryDir(sessionId: string, photonName: string, baseDir?: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getBase(baseDir), 'sessions', safeSession, safeName);
}

/** Old runs dir: {baseDir}/runs/ */
export function getLegacyRunsDir(baseDir?: string): string {
  return path.join(getBase(baseDir), 'runs');
}

/** Old logs dir: {baseDir}/logs/{photonId}/ */
export function getLegacyLogsDir(photonName: string, baseDir?: string): string {
  return path.join(getBase(baseDir), 'logs', photonName);
}

/** Old tasks dir: {baseDir}/tasks/ */
export function getLegacyTasksDir(baseDir?: string): string {
  return path.join(getBase(baseDir), 'tasks');
}

/** Old audit path: ~/.photon/audit.jsonl */
export function getLegacyAuditPath(): string {
  return path.join(DEFAULT_PHOTON_DIR, 'audit.jsonl');
}

/** Old metadata path: {baseDir}/.metadata.json */
export function getLegacyMetadataPath(baseDir?: string): string {
  return path.join(getBase(baseDir), '.metadata.json');
}

/** Old daemon socket: ~/.photon/daemon.sock */
export function getLegacyDaemonSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\photon-daemon';
  }
  return path.join(DEFAULT_PHOTON_DIR, 'daemon.sock');
}

/** Old daemon PID: ~/.photon/daemon.pid */
export function getLegacyDaemonPidPath(): string {
  return path.join(DEFAULT_PHOTON_DIR, 'daemon.pid');
}

/** Old daemon log: ~/.photon/daemon.log */
export function getLegacyDaemonLogPath(): string {
  return path.join(DEFAULT_PHOTON_DIR, 'daemon.log');
}

/** Old cache dir: {baseDir}/.cache/ or {baseDir}/cache/ */
export function getLegacyCacheDir(baseDir?: string): string {
  return path.join(getBase(baseDir), '.cache');
}

/** Old schedules dir: ~/.photon/schedules/{photonName}/ */
export function getLegacySchedulesDir(photonName: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DEFAULT_PHOTON_DIR, 'schedules', safeName);
}

/** Old per-photon config: ~/.photon/{photonName}/config.json */
export function getLegacyPhotonConfigPath(photonName: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DEFAULT_PHOTON_DIR, safeName, 'config.json');
}
