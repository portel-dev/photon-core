/**
 * Photon Configuration Utilities
 *
 * Provides standard config storage for photons that implement the configure() convention.
 * Config is stored at ~/.photon/{photonName}/config.json
 *
 * Usage in a Photon:
 * ```typescript
 * import { loadPhotonConfig, savePhotonConfig, getPhotonConfigPath } from '@portel/photon-core';
 *
 * export default class MyPhoton extends PhotonMCP {
 *   async configure(params: { apiKey: string }) {
 *     savePhotonConfig('my-photon', params);
 *     return { success: true, config: params };
 *   }
 *
 *   async getConfig() {
 *     return loadPhotonConfig('my-photon');
 *   }
 * }
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get the config directory for photons
 * Default: ~/.photon/
 */
export function getPhotonConfigDir(): string {
  return process.env.PHOTON_CONFIG_DIR || path.join(os.homedir(), '.photon');
}

/**
 * Get the config file path for a specific photon
 * @param photonName The photon name (kebab-case)
 * @returns Path to config.json for this photon
 */
export function getPhotonConfigPath(photonName: string): string {
  const safeName = photonName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getPhotonConfigDir(), safeName, 'config.json');
}

/**
 * Load configuration for a photon
 * @param photonName The photon name (kebab-case)
 * @param defaults Default values if config doesn't exist
 * @returns The config object or defaults
 */
export function loadPhotonConfig<T extends Record<string, any>>(
  photonName: string,
  defaults?: T
): T {
  const configPath = getPhotonConfigPath(photonName);

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      // Merge with defaults
      return defaults ? { ...defaults, ...config } : config;
    }
  } catch (error) {
    // Log but don't throw - return defaults
    if (process.env.PHOTON_DEBUG) {
      console.error(`Failed to load config for ${photonName}:`, error);
    }
  }

  return defaults || ({} as T);
}

/**
 * Save configuration for a photon
 * @param photonName The photon name (kebab-case)
 * @param config The configuration object to save
 */
export function savePhotonConfig<T extends Record<string, any>>(
  photonName: string,
  config: T
): void {
  const configPath = getPhotonConfigPath(photonName);
  const configDir = path.dirname(configPath);

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Check if a photon has been configured
 * @param photonName The photon name (kebab-case)
 * @returns true if config file exists
 */
export function hasPhotonConfig(photonName: string): boolean {
  return fs.existsSync(getPhotonConfigPath(photonName));
}

/**
 * Delete configuration for a photon
 * @param photonName The photon name (kebab-case)
 */
export function deletePhotonConfig(photonName: string): void {
  const configPath = getPhotonConfigPath(photonName);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * List all configured photons
 * @returns Array of photon names that have config
 */
export function listConfiguredPhotons(): string[] {
  const configDir = getPhotonConfigDir();

  if (!fs.existsSync(configDir)) {
    return [];
  }

  try {
    return fs.readdirSync(configDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(configDir, entry.name, 'config.json')))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}
