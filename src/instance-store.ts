/**
 * Instance Store
 *
 * Shared state persistence for named photon instances.
 * Used by daemon, NCP, and Lumina to manage per-instance state.
 *
 * Paths (new .data/ layout):
 * - State: .data/{namespace}/{photonName}/state/{instance}/state.json
 * - Context: .data/{namespace}/{photonName}/context.json
 *
 * Falls back to legacy paths for migration:
 * - State: ~/.photon/state/{photonName}/{instanceName}.json
 * - Context: ~/.photon/context/{photonName}.json
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import {
  getPhotonStatePath,
  getPhotonContextPath,
  getPhotonDataDir,
  getLegacyStatePath,
  getLegacyContextPath,
} from './data-paths.js';

export interface InstanceStoreOptions {
  /** Base directory (default: ~/.photon) */
  baseDir?: string;
  /** Namespace (default: 'local') */
  namespace?: string;
}

export class InstanceStore {
  private photonName: string;
  private namespace: string;
  private baseDir?: string;

  constructor(photonName: string, options?: InstanceStoreOptions) {
    this.photonName = photonName;
    this.namespace = options?.namespace || 'local';
    this.baseDir = options?.baseDir;
  }

  /**
   * Get the state directory for this photon (new layout)
   */
  private stateDir(): string {
    return path.join(getPhotonDataDir(this.namespace, this.photonName, this.baseDir), 'state');
  }

  /**
   * Get the context file path, with fallback to legacy
   */
  private contextPath(): string {
    const newPath = getPhotonContextPath(this.namespace, this.photonName, this.baseDir);
    if (!fsSync.existsSync(newPath)) {
      const legacyPath = getLegacyContextPath(this.photonName, this.baseDir);
      if (fsSync.existsSync(legacyPath)) return legacyPath;
    }
    return newPath;
  }

  /**
   * Resolve state file path with fallback to legacy
   */
  private resolveStatePath(instanceName: string): string {
    const name = instanceName || 'default';
    const newPath = getPhotonStatePath(this.namespace, this.photonName, name, this.baseDir);
    if (!fsSync.existsSync(newPath)) {
      const legacyPath = getLegacyStatePath(this.photonName, name, this.baseDir);
      if (fsSync.existsSync(legacyPath)) return legacyPath;
    }
    return newPath;
  }

  /**
   * List all named instances by scanning the state directory
   */
  async list(): Promise<string[]> {
    try {
      // New layout: state/{instance}/ directories
      const dir = this.stateDir();
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const instances = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      if (instances.length > 0) return instances;
    } catch {
      // Fall through to legacy
    }

    // Legacy: state/{photonName}/*.json files
    try {
      const legacyDir = path.dirname(getLegacyStatePath(this.photonName, 'default', this.baseDir));
      const files = await fs.readdir(legacyDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Get the current instance name. Returns 'default' if none set.
   */
  async getCurrent(): Promise<string> {
    try {
      const content = await fs.readFile(this.contextPath(), 'utf-8');
      const data = JSON.parse(content);
      return data.current || 'default';
    } catch (error: any) {
      if (error.code === 'ENOENT') return 'default';
      throw error;
    }
  }

  /**
   * Set the current instance name (always writes to new path)
   */
  async setCurrent(instanceName: string): Promise<void> {
    const filePath = getPhotonContextPath(this.namespace, this.photonName, this.baseDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ current: instanceName }, null, 2));
  }

  /**
   * Load state for an instance. Defaults to current instance.
   */
  async load<T = Record<string, unknown>>(instanceName?: string): Promise<T | null> {
    const name = instanceName ?? await this.getCurrent();
    const filePath = this.resolveStatePath(name);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Save state for an instance (always writes to new path)
   */
  async save(instanceName: string, state: Record<string, unknown>): Promise<void> {
    const filePath = getPhotonStatePath(this.namespace, this.photonName, instanceName, this.baseDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  }

  /**
   * Delete an instance's state
   */
  async delete(instanceName: string): Promise<boolean> {
    const filePath = this.resolveStatePath(instanceName);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  /**
   * Check if an instance exists. Defaults to current instance.
   */
  async exists(instanceName?: string): Promise<boolean> {
    const name = instanceName ?? await this.getCurrent();
    const filePath = this.resolveStatePath(name);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the file path for instance state (new .data/ layout)
   */
  static statePath(photonName: string, instanceName: string, baseDir?: string, namespace?: string): string {
    return getPhotonStatePath(namespace || 'local', photonName, instanceName, baseDir);
  }

  /**
   * Get the context file path for a photon (new .data/ layout)
   */
  static contextPath(photonName: string, baseDir?: string, namespace?: string): string {
    return getPhotonContextPath(namespace || 'local', photonName, baseDir);
  }
}
