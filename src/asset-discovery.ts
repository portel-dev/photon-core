/**
 * Asset Discovery Utilities
 *
 * Discover and extract UI, prompt, and resource assets from Photon files.
 * Extracted from photon's loader.ts.
 *
 * Depends on: getMimeType (from ./mime-types), SchemaExtractor (from ./schema-extractor)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getMimeType } from './mime-types.js';
import { SchemaExtractor } from './schema-extractor.js';
import type { PhotonAssets } from './types.js';

/**
 * Check if a file or directory exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover and extract assets from a Photon file
 *
 * Convention:
 * - Asset folder: {photon-name}/ next to {photon-name}.photon.ts
 * - Subfolder: ui/, prompts/, resources/
 *
 * @param photonPath - Absolute path to the .photon.ts file
 * @param source - Source code content of the Photon file
 */
export async function discoverAssets(
  photonPath: string,
  source: string,
): Promise<PhotonAssets | undefined> {
  const extractor = new SchemaExtractor();
  const dir = path.dirname(photonPath);
  const basename = path.basename(photonPath, '.photon.ts');

  // Convention: asset folder has same name as photon (without .photon.ts)
  const assetFolder = path.join(dir, basename);

  // Check if asset folder exists
  let folderExists = false;
  try {
    const stat = await fs.stat(assetFolder);
    folderExists = stat.isDirectory();
  } catch {
    // Folder doesn't exist
  }

  // Extract explicit asset declarations from source annotations
  const assets = extractor.extractAssets(source, folderExists ? assetFolder : undefined);

  // If no folder exists and no explicit declarations, skip
  if (
    !folderExists &&
    assets.ui.length === 0 &&
    assets.prompts.length === 0 &&
    assets.resources.length === 0
  ) {
    return undefined;
  }

  if (folderExists) {
    // Resolve paths for explicitly declared assets
    for (const ui of assets.ui) {
      ui.resolvedPath = path.resolve(assetFolder, ui.path.replace(/^\.\//, ''));
    }
    for (const prompt of assets.prompts) {
      prompt.resolvedPath = path.resolve(assetFolder, prompt.path.replace(/^\.\//, ''));
    }
    for (const resource of assets.resources) {
      resource.resolvedPath = path.resolve(assetFolder, resource.path.replace(/^\.\//, ''));
    }

    // Auto-discover assets from folder structure
    await autoDiscoverAssets(assetFolder, assets);
  }

  return assets;
}

/**
 * Auto-discover assets from the ui/, prompts/, resources/ subdirectories
 */
export async function autoDiscoverAssets(
  assetFolder: string,
  assets: PhotonAssets,
): Promise<void> {
  // Auto-discover UI files
  const uiDir = path.join(assetFolder, 'ui');
  if (await fileExists(uiDir)) {
    try {
      const files = await fs.readdir(uiDir);
      for (const file of files) {
        const id = path.basename(file, path.extname(file));
        if (!assets.ui.find((u) => u.id === id)) {
          assets.ui.push({
            id,
            path: `./ui/${file}`,
            resolvedPath: path.join(uiDir, file),
            // Don't set mimeType for UI assets - let server decide based on client capabilities
            // Server will use getUIMimeType() to return text/html;profile=mcp-app for MCP Apps clients
          });
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Auto-discover prompt files
  const promptsDir = path.join(assetFolder, 'prompts');
  if (await fileExists(promptsDir)) {
    try {
      const files = await fs.readdir(promptsDir);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.txt')) {
          const id = path.basename(file, path.extname(file));
          if (!assets.prompts.find((p) => p.id === id)) {
            assets.prompts.push({
              id,
              path: `./prompts/${file}`,
              resolvedPath: path.join(promptsDir, file),
            });
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Auto-discover resource files
  const resourcesDir = path.join(assetFolder, 'resources');
  if (await fileExists(resourcesDir)) {
    try {
      const files = await fs.readdir(resourcesDir);
      for (const file of files) {
        const id = path.basename(file, path.extname(file));
        if (!assets.resources.find((r) => r.id === id)) {
          assets.resources.push({
            id,
            path: `./resources/${file}`,
            resolvedPath: path.join(resourcesDir, file),
            mimeType: getMimeType(file),
          });
        }
      }
    } catch {
      // Ignore errors
    }
  }
}
