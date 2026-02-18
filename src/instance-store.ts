/**
 * Instance Store
 *
 * Shared state persistence for named photon instances.
 * Used by daemon, NCP, and Lumina to manage per-instance state.
 *
 * Paths (matching daemon convention):
 * - State: ~/.photon/state/{photonName}/{instanceName}.json
 * - Context: ~/.photon/context/{photonName}.json → { current: "name" }
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface InstanceStoreOptions {
  /** Base directory (default: ~/.photon) */
  baseDir?: string;
}

function getBaseDir(options?: InstanceStoreOptions): string {
  return options?.baseDir || process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
}

export class InstanceStore {
  private photonName: string;
  private baseDir: string;

  constructor(photonName: string, options?: InstanceStoreOptions) {
    this.photonName = photonName;
    this.baseDir = getBaseDir(options);
  }

  /**
   * Get the state directory for this photon
   */
  private stateDir(): string {
    return path.join(this.baseDir, 'state', this.photonName);
  }

  /**
   * Get the context file path for this photon
   */
  private contextPath(): string {
    return path.join(this.baseDir, 'context', `${this.photonName}.json`);
  }

  /**
   * List all named instances by scanning the state directory
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.stateDir());
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
   * Set the current instance name
   */
  async setCurrent(instanceName: string): Promise<void> {
    const filePath = this.contextPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ current: instanceName }, null, 2));
  }

  /**
   * Load state for an instance. Defaults to current instance.
   */
  async load<T = Record<string, unknown>>(instanceName?: string): Promise<T | null> {
    const name = instanceName ?? await this.getCurrent();
    const filePath = InstanceStore.statePath(this.photonName, name, this.baseDir);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Save state for an instance
   */
  async save(instanceName: string, state: Record<string, unknown>): Promise<void> {
    const filePath = InstanceStore.statePath(this.photonName, instanceName, this.baseDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  }

  /**
   * Delete an instance's state
   */
  async delete(instanceName: string): Promise<boolean> {
    const filePath = InstanceStore.statePath(this.photonName, instanceName, this.baseDir);
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
    const filePath = InstanceStore.statePath(this.photonName, name, this.baseDir);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the file path for instance state
   */
  static statePath(photonName: string, instanceName: string, baseDir?: string): string {
    const dir = baseDir || getBaseDir();
    const name = instanceName || 'default';
    return path.join(dir, 'state', photonName, `${name}.json`);
  }

  /**
   * Get the context file path for a photon
   */
  static contextPath(photonName: string, baseDir?: string): string {
    const dir = baseDir || getBaseDir();
    return path.join(dir, 'context', `${photonName}.json`);
  }
}
