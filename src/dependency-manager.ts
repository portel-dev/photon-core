/**
 * Dependency Manager for Photon MCPs
 *
 * Handles automatic installation of dependencies declared in MCP files
 * Similar to Python's UV or npx behavior
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

interface DependencySpec {
  name: string;
  version: string;
}

/**
 * Manages dependencies for Photon MCPs
 */
export class DependencyManager {
  private cacheDir: string;

  constructor() {
    // Store dependencies in ~/.cache/photon-mcp/dependencies/
    this.cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'dependencies');
  }

  /**
   * Extract dependencies from MCP source file
   *
   * Looks for @dependencies JSDoc tag:
   * @dependencies axios@^1.0.0, date-fns@^2.0.0
   * @dependencies octokit@^3.1.0
   */
  async extractDependencies(sourceFilePath: string): Promise<DependencySpec[]> {
    const content = await fs.readFile(sourceFilePath, 'utf-8');

    const dependencies: DependencySpec[] = [];

    // Match @dependencies tags in JSDoc comments
    // Regex: @dependencies package@version, package2@version2
    const dependencyRegex = /@dependencies\s+([\w@^~.,\s/-]+)/g;

    let match;
    while ((match = dependencyRegex.exec(content)) !== null) {
      const depString = match[1].trim();

      // Split by comma for multiple dependencies
      const deps = depString.split(',').map(d => d.trim());

      for (const dep of deps) {
        // Parse: package@version
        const parts = dep.split('@');
        // Handle scoped packages like @octokit/rest@^1.0.0
        let name, version;
        if (dep.startsWith('@')) {
          // Scoped package: @scope/package@version
          const atIndex = dep.indexOf('@', 1); // Find second @
          if (atIndex > 0) {
            name = dep.substring(0, atIndex);
            version = dep.substring(atIndex + 1);
          }
        } else {
          // Regular package: package@version
          [name, version] = parts;
        }

        if (name && version) {
          dependencies.push({ name, version });
        }
      }
    }

    return dependencies;
  }

  /**
   * Ensure dependencies are installed for an MCP
   *
   * Returns the path to node_modules where dependencies are installed
   */
  async ensureDependencies(
    mcpName: string,
    dependencies: DependencySpec[]
  ): Promise<string | null> {
    if (dependencies.length === 0) {
      return null;
    }

    // Create MCP-specific directory
    const mcpDir = path.join(this.cacheDir, mcpName);
    const nodeModules = path.join(mcpDir, 'node_modules');

    // Check if already installed
    const installed = await this.checkInstalled(mcpDir, dependencies);
    if (installed) {
      return nodeModules;
    }

    // Create directory
    await fs.mkdir(mcpDir, { recursive: true });

    // Create minimal package.json
    const packageJson = {
      name: `photon-${mcpName}`,
      version: '1.0.0',
      type: 'module',
      dependencies: Object.fromEntries(
        dependencies.map(d => [d.name, d.version])
      ),
    };

    await fs.writeFile(
      path.join(mcpDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // Install dependencies
    console.error(`📦 Installing dependencies for ${mcpName}...`);
    await this.runNpmInstall(mcpDir);

    // Fix broken @portel/photon-core symlinks caused by npm link in dev environments.
    // npm install may create a relative symlink that doesn't resolve from the cache dir.
    await this.fixBrokenPhotonCoreLink(nodeModules);

    console.error(`✅ Dependencies installed for ${mcpName}`);
    return nodeModules;
  }

  /**
   * Check if dependencies are already installed
   */
  private async checkInstalled(
    mcpDir: string,
    dependencies: DependencySpec[]
  ): Promise<boolean> {
    try {
      const packageJsonPath = path.join(mcpDir, 'package.json');
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf-8')
      );

      // Check if dependency count matches (catches added/removed dependencies)
      const installedCount = Object.keys(packageJson.dependencies || {}).length;
      if (installedCount !== dependencies.length) {
        return false;
      }

      // Check if all dependencies match
      for (const dep of dependencies) {
        if (packageJson.dependencies?.[dep.name] !== dep.version) {
          return false;
        }
      }

      // Check if node_modules exists
      const nodeModules = path.join(mcpDir, 'node_modules');
      await fs.access(nodeModules);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run npm install in a directory
   */
  private async runNpmInstall(cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

      const child = spawn(npmCmd, ['install', '--omit=dev', '--silent'], {
        cwd,
        stdio: 'inherit',
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * Fix broken @portel/photon-core symlinks in node_modules.
   * When photon-core is npm-linked in dev, npm install in the cache dir
   * may create a relative symlink that doesn't resolve. Replace it with
   * an absolute symlink to the actual photon-core package.
   */
  private async fixBrokenPhotonCoreLink(nodeModules: string): Promise<void> {
    const corePath = path.join(nodeModules, '@portel', 'photon-core');
    try {
      const stat = await fs.lstat(corePath);
      if (!stat.isSymbolicLink()) return;

      // Check if the symlink target actually exists
      try {
        await fs.access(corePath);
        return; // Symlink is valid
      } catch {
        // Broken symlink — resolve the real photon-core location
      }

      // Find photon-core by resolving from the main process
      let realCorePath: string | undefined;
      try {
        const resolved = require.resolve('@portel/photon-core/package.json');
        realCorePath = path.dirname(resolved);
      } catch {
        // Try import.meta-based resolution
        try {
          const resolved = require.resolve('@portel/photon-core');
          realCorePath = path.dirname(resolved);
          // Walk up to find the package root (contains package.json)
          while (realCorePath !== path.dirname(realCorePath)) {
            try {
              await fs.access(path.join(realCorePath, 'package.json'));
              break;
            } catch {
              realCorePath = path.dirname(realCorePath);
            }
          }
        } catch {
          return; // Can't find photon-core at all
        }
      }

      if (realCorePath) {
        await fs.rm(corePath, { force: true });
        await fs.symlink(realCorePath, corePath);
      }
    } catch {
      // Best effort — don't fail the install
    }
  }

  /**
   * Clear cache for an MCP
   */
  async clearCache(mcpName: string): Promise<void> {
    const mcpDir = path.join(this.cacheDir, mcpName);
    try {
      await fs.rm(mcpDir, { recursive: true, force: true });
      console.error(`🗑️  Cleared cache for ${mcpName}`);
    } catch (error: any) {
      console.error(`Failed to clear cache for ${mcpName}: ${error.message}`);
    }
  }

  /**
   * Clear all cached dependencies
   */
  async clearAllCache(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      console.error(`🗑️  Cleared all MCP dependency cache`);
    } catch (error: any) {
      console.error(`Failed to clear cache: ${error.message}`);
    }
  }
}
