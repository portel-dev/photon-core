/**
 * Photon Configuration Utilities
 *
 * Provides standard config storage for photons.
 * Config is stored at .data/{namespace}/{photonName}/config.json
 *
 * Usage in a Photon:
 * ```typescript
 * import { loadPhotonConfig, savePhotonConfig } from '@portel/photon-core';
 *
 * export default class MyPhoton extends Photon {
 *   async configure(params: { apiKey: string }) {
 *     savePhotonConfig('my-photon', params);
 *     return { success: true, config: params };
 *   }
 * }
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  getPhotonConfigPath as getNewConfigPath,
  getLegacyPhotonConfigPath,
  getDataRoot,
} from './data-paths.js';

/**
 * Get the config file path for a specific photon.
 * Uses new .data/ layout, falls back to legacy path for reads.
 */
export function getPhotonConfigPath(photonName: string, namespace?: string): string {
  const ns = namespace || 'local';
  const newPath = getNewConfigPath(ns, photonName);

  // Fallback: check legacy path for existing config
  if (!fs.existsSync(newPath)) {
    const legacyPath = getLegacyPhotonConfigPath(photonName);
    if (fs.existsSync(legacyPath)) return legacyPath;
  }

  return newPath;
}

/**
 * Get the config directory for photons (legacy compat)
 * @deprecated Use getPhotonConfigPath with namespace instead
 */
export function getPhotonConfigDir(): string {
  return process.env.PHOTON_CONFIG_DIR || getDataRoot();
}

/**
 * Load configuration for a photon
 */
export function loadPhotonConfig<T extends Record<string, any>>(
  photonName: string,
  defaults?: T,
  namespace?: string
): T {
  const configPath = getPhotonConfigPath(photonName, namespace);

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return defaults ? { ...defaults, ...config } : config;
    }
  } catch (error) {
    if (process.env.PHOTON_DEBUG) {
      console.error(`Failed to load config for ${photonName}:`, error);
    }
  }

  return defaults || ({} as T);
}

/**
 * Save configuration for a photon (always writes to new .data/ path)
 */
export function savePhotonConfig<T extends Record<string, any>>(
  photonName: string,
  config: T,
  namespace?: string
): void {
  const ns = namespace || 'local';
  const configPath = getNewConfigPath(ns, photonName);
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Check if a photon has been configured
 */
export function hasPhotonConfig(photonName: string, namespace?: string): boolean {
  return fs.existsSync(getPhotonConfigPath(photonName, namespace));
}

/**
 * Delete configuration for a photon
 */
export function deletePhotonConfig(photonName: string, namespace?: string): void {
  const configPath = getPhotonConfigPath(photonName, namespace);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * List all configured photons
 */
export function listConfiguredPhotons(): string[] {
  const dataRoot = getDataRoot();

  if (!fs.existsSync(dataRoot)) {
    return [];
  }

  const results: string[] = [];
  try {
    // Scan namespace directories inside .data/
    const nsDirs = fs.readdirSync(dataRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'));

    for (const nsDir of nsDirs) {
      const nsPath = path.join(dataRoot, nsDir.name);
      const photonDirs = fs.readdirSync(nsPath, { withFileTypes: true })
        .filter(e => e.isDirectory());

      for (const pDir of photonDirs) {
        if (fs.existsSync(path.join(nsPath, pDir.name, 'config.json'))) {
          results.push(pDir.name);
        }
      }
    }
  } catch {
    // Data root doesn't exist or is unreadable
  }

  return results;
}
