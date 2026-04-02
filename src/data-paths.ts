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

const DEFAULT_BASE = path.join(os.homedir(), '.photon');

function getBase(baseDir?: string): string {
  return baseDir || process.env.PHOTON_DIR || DEFAULT_BASE;
}

// ── Root ─────────────────────────────────────────────────────────────────────

/** Root of all runtime data: {baseDir}/.data/ */
export function getDataRoot(baseDir?: string): string {
  return path.join(getBase(baseDir), '.data');
}

// ── Per-Photon ───────────────────────────────────────────────────────────────

/** Per-photon data root: .data/{namespace}/{photonName}/ */
export function getPhotonDataDir(namespace: string, photonName: string, baseDir?: string): string {
  const ns = namespace || 'local';
  return path.join(getDataRoot(baseDir), ns, photonName);
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

/** Session-scoped memory: .data/_sessions/{sessionId}/{ns}/{photon}/ */
export function getSessionMemoryDir(sessionId: string, namespace: string, photonName: string, baseDir?: string): string {
  const ns = namespace || 'local';
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getDataRoot(baseDir), '_sessions', safeSession, ns, photonName);
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
  return path.join(DEFAULT_BASE, '.data', 'daemon.sock');
}

/** Daemon PID file: always ~/.photon/.data/daemon.pid */
export function getDaemonPidPath(): string {
  return path.join(DEFAULT_BASE, '.data', 'daemon.pid');
}

/** Daemon log file: always ~/.photon/.data/daemon.log */
export function getDaemonLogPath(): string {
  return path.join(DEFAULT_BASE, '.data', 'daemon.log');
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

/** Old runs dir: ~/.photon/runs/ */
export function getLegacyRunsDir(): string {
  return path.join(DEFAULT_BASE, 'runs');
}

/** Old logs dir: ~/.photon/logs/{photonId}/ */
export function getLegacyLogsDir(photonName: string): string {
  return path.join(DEFAULT_BASE, 'logs', photonName);
}

/** Old tasks dir: ~/.photon/tasks/ */
export function getLegacyTasksDir(): string {
  return path.join(DEFAULT_BASE, 'tasks');
}

/** Old audit path: ~/.photon/audit.jsonl */
export function getLegacyAuditPath(): string {
  return path.join(DEFAULT_BASE, 'audit.jsonl');
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
  return path.join(DEFAULT_BASE, 'daemon.sock');
}

/** Old daemon PID: ~/.photon/daemon.pid */
export function getLegacyDaemonPidPath(): string {
  return path.join(DEFAULT_BASE, 'daemon.pid');
}

/** Old daemon log: ~/.photon/daemon.log */
export function getLegacyDaemonLogPath(): string {
  return path.join(DEFAULT_BASE, 'daemon.log');
}

/** Old cache dir: {baseDir}/.cache/ or {baseDir}/cache/ */
export function getLegacyCacheDir(baseDir?: string): string {
  return path.join(getBase(baseDir), '.cache');
}

/** Old schedules dir: ~/.photon/schedules/{photonName}/ */
export function getLegacySchedulesDir(photonName: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DEFAULT_BASE, 'schedules', safeName);
}

/** Old per-photon config: ~/.photon/{photonName}/config.json */
export function getLegacyPhotonConfigPath(photonName: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DEFAULT_BASE, safeName, 'config.json');
}
