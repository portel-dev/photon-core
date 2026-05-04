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
 * Conventions (both supported, dual-layout):
 * - Asset folder: {photon-name}/ next to {photon-name}.photon.ts
 * - Old layout: subfolders ui/, prompts/, resources/ live directly under {photon-name}/
 * - New layout: subfolders live under {photon-name}/assets/ (canonical bundle root)
 *
 * When {photon-name}/assets/ exists, it becomes the resolution root for
 * explicit @ui declarations and the source for auto-discovery. The plain
 * {photon-name}/ folder remains a fallback so older photons keep working
 * without modification.
 *
 * @param photonPath - Absolute path to the .photon.ts file
 * @param source - Source code content of the Photon file
 */
export async function discoverAssets(
  photonPath: string,
  source: string,
): Promise<PhotonAssets | undefined> {
  const extractor = new SchemaExtractor();
  const basename = path.basename(photonPath, '.photon.ts');

  // If the .photon.ts file is a symlink, resolve it so asset folders are
  // discovered from the source repository (e.g. ~/Projects/photons/boards/ui/)
  // rather than the symlink location (e.g. ~/.photon/boards/ui/).
  // Data/state files are keyed on photonPath itself, so those remain local.
  let assetBase = path.dirname(photonPath);
  try {
    const lstat = await fs.lstat(photonPath);
    if (lstat.isSymbolicLink()) {
      const realPath = await fs.realpath(photonPath);
      assetBase = path.dirname(realPath);
    }
  } catch {
    // Not a symlink or unreadable — fall back to dirname of photonPath
  }
  const dir = assetBase;

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

  // Dual-layout: prefer {photon}/assets/ as the canonical root when present.
  // Falling back to the plain folder keeps every pre-v1.29 fixture working.
  let assetRoot = assetFolder;
  if (folderExists) {
    const nestedRoot = path.join(assetFolder, 'assets');
    try {
      const nestedStat = await fs.stat(nestedRoot);
      if (nestedStat.isDirectory()) {
        assetRoot = nestedRoot;
      }
    } catch {
      // No assets/ subfolder — keep the legacy root.
    }
  }

  // Extract explicit asset declarations from source annotations
  const assets = extractor.extractAssets(source, folderExists ? assetRoot : undefined);

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
    // Resolve paths for explicitly declared assets. Try the canonical root
    // first; if a declaration was written against the legacy root convention
    // (./ui/foo.html with no assets/ wrapper), fall back to assetFolder so
    // the directive keeps resolving without source edits.
    const resolveAssetPath = async (declared: string): Promise<string> => {
      const cleaned = declared.replace(/^\.\//, '');
      const primary = path.resolve(assetRoot, cleaned);
      if (assetRoot === assetFolder) return primary;
      try {
        await fs.access(primary);
        return primary;
      } catch {
        return path.resolve(assetFolder, cleaned);
      }
    };
    for (const ui of assets.ui) {
      ui.resolvedPath = await resolveAssetPath(ui.path);
    }
    for (const prompt of assets.prompts) {
      prompt.resolvedPath = await resolveAssetPath(prompt.path);
    }
    for (const resource of assets.resources) {
      resource.resolvedPath = await resolveAssetPath(resource.path);
    }

    // Auto-discover assets from folder structure (new convention root first).
    await autoDiscoverAssets(assetRoot, assets);
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
  // Priority: .photon.html > .photon.tsx > .html > .tsx
  // Photon-prefixed variants (declarative mode) take priority over plain variants.
  const uiDir = path.join(assetFolder, 'ui');
  if (await fileExists(uiDir)) {
    try {
      const files = await fs.readdir(uiDir);
      // Collect photon-prefixed files so they take priority over plain variants
      const photonPrefixed = new Map<string, string>(); // baseName → extension
      for (const file of files) {
        if (file.endsWith('.photon.html')) {
          const base = file.replace(/\.photon\.html$/, '');
          photonPrefixed.set(base, '.photon.html');
        } else if (file.endsWith('.photon.tsx')) {
          const base = file.replace(/\.photon\.tsx$/, '');
          if (!photonPrefixed.has(base)) {
            photonPrefixed.set(base, '.photon.tsx');
          }
        }
      }
      for (const file of files) {
        // Supported extensions: .photon.html, .photon.tsx, .html, .tsx
        const isPhotonHtml = file.endsWith('.photon.html');
        const isPhotonTsx = file.endsWith('.photon.tsx');
        const isHtml = !isPhotonHtml && file.endsWith('.html');
        const isTsx = !isPhotonTsx && file.endsWith('.tsx');

        if (!isPhotonHtml && !isPhotonTsx && !isHtml && !isTsx) continue;

        let id: string;
        if (isPhotonHtml) {
          id = file.replace(/\.photon\.html$/, '');
        } else if (isPhotonTsx) {
          id = file.replace(/\.photon\.tsx$/, '');
          // Skip if .photon.html exists for same base name
          if (photonPrefixed.get(id) === '.photon.html') continue;
        } else {
          id = path.basename(file, path.extname(file));
          // Skip plain variants when a photon-prefixed variant exists
          if (photonPrefixed.has(id)) continue;
          // Among plain variants, .html takes priority over .tsx
          if (isTsx) {
            const htmlSibling = `${id}.html`;
            if (files.includes(htmlSibling)) continue;
          }
        }

        if (!assets.ui.find((u) => u.id === id)) {
          assets.ui.push({
            id,
            path: `./ui/${file}`,
            resolvedPath: path.join(uiDir, file),
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
