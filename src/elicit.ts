/**
 * Elicit - Cross-platform user input for Photon
 *
 * Provides a unified API for requesting user input that works across:
 * - Native OS dialogs (default - works standalone without photon runtime)
 * - CLI readline (photon CLI overrides via globalThis.__photon_prompt__)
 * - MCP elicitation (photon MCP overrides when client supports it)
 *
 * Design:
 * - Photon files call the simple `prompt()` function (no imports needed)
 * - Standalone: Uses native OS dialogs
 * - Photon runtime: Overrides globalThis.__photon_prompt__ with appropriate handler
 */

import { exec } from 'child_process';
import * as os from 'os';
import * as readline from 'readline';

export interface ElicitOptions {
  /** The prompt/message to display to the user */
  prompt: string;
  /** Title for the dialog (used in GUI dialogs) */
  title?: string;
  /** Default value to pre-fill */
  defaultValue?: string;
  /** Type of input */
  type?: 'text' | 'password' | 'confirm';
  /** JSON schema for validation (used in MCP elicitation) */
  schema?: object;
  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
}

export interface ElicitResult {
  /** Whether the user provided input (vs cancelled) */
  success: boolean;
  /** The user's input value */
  value?: string;
  /** True if user confirmed (for confirm type) */
  confirmed?: boolean;
  /** Error message if failed */
  error?: string;
}

/** Prompt handler type - simple string in, string out */
export type PromptHandler = (message: string, defaultValue?: string) => Promise<string | null>;

/** Full elicit handler type */
export type ElicitHandler = (options: ElicitOptions) => Promise<ElicitResult>;

// Declare global override point
declare global {
  var __photon_prompt__: PromptHandler | undefined;
  var __photon_elicit__: ElicitHandler | undefined;
}

/**
 * Set the prompt handler (simple string-based)
 * Runtimes use this to override with readline, MCP elicitation, etc.
 */
export function setPromptHandler(handler: PromptHandler | null): void {
  globalThis.__photon_prompt__ = handler || undefined;
}

/**
 * Set the full elicit handler (with options)
 */
export function setElicitHandler(handler: ElicitHandler | null): void {
  globalThis.__photon_elicit__ = handler || undefined;
}

/**
 * Simple prompt function - can be called directly from photon files
 * No imports needed - uses global override or falls back to native dialog
 *
 * @example
 * ```typescript
 * // In a photon file - works standalone or with photon runtime
 * const code = await prompt('Enter the 6-digit code:');
 * if (code) {
 *   console.log('User entered:', code);
 * }
 * ```
 */
export async function prompt(message: string, defaultValue?: string): Promise<string | null> {
  // Check for runtime override
  if (globalThis.__photon_prompt__) {
    return globalThis.__photon_prompt__(message, defaultValue);
  }

  // Fall back to native dialog
  const result = await elicitNativeDialog({
    prompt: message,
    defaultValue,
    type: 'text',
  });

  return result.success ? (result.value ?? null) : null;
}

/**
 * Confirm dialog - returns true/false
 */
export async function confirm(message: string): Promise<boolean> {
  if (globalThis.__photon_elicit__) {
    const result = await globalThis.__photon_elicit__({
      prompt: message,
      type: 'confirm',
    });
    return result.confirmed ?? false;
  }

  const result = await elicitNativeDialog({
    prompt: message,
    type: 'confirm',
  });

  return result.confirmed ?? false;
}

/**
 * Full elicit with options
 */
export async function elicit(options: ElicitOptions): Promise<ElicitResult> {
  // Use custom handler if set
  if (globalThis.__photon_elicit__) {
    return globalThis.__photon_elicit__(options);
  }

  // Check if we're in a TTY (interactive terminal)
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return elicitReadline(options);
  }

  // Default to native OS dialog
  return elicitNativeDialog(options);
}

/**
 * Get the current prompt handler
 */
export function getPromptHandler(): PromptHandler | undefined {
  return globalThis.__photon_prompt__;
}

/**
 * Get the current elicit handler
 */
export function getElicitHandler(): ElicitHandler | undefined {
  return globalThis.__photon_elicit__;
}

/**
 * Elicit using readline (for CLI/terminal)
 */
export async function elicitReadline(options: ElicitOptions): Promise<ElicitResult> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = options.defaultValue
      ? `${options.prompt} [${options.defaultValue}]: `
      : `${options.prompt}: `;

    if (options.type === 'confirm') {
      rl.question(`${options.prompt} (y/n): `, (answer) => {
        rl.close();
        const confirmed = answer.toLowerCase().startsWith('y');
        resolve({
          success: true,
          confirmed,
          value: confirmed ? 'yes' : 'no',
        });
      });
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        const value = answer || options.defaultValue || '';
        resolve({
          success: true,
          value,
        });
      });
    }

    // Handle timeout
    if (options.timeout && options.timeout > 0) {
      setTimeout(() => {
        rl.close();
        resolve({
          success: false,
          error: 'Input timeout',
        });
      }, options.timeout);
    }
  });
}

/**
 * Elicit using native OS dialog
 */
export async function elicitNativeDialog(options: ElicitOptions): Promise<ElicitResult> {
  const platform = os.platform();

  try {
    switch (platform) {
      case 'darwin':
        return elicitMacOS(options);
      case 'win32':
        return elicitWindows(options);
      case 'linux':
        return elicitLinux(options);
      default:
        // Fallback to readline for unsupported platforms
        return elicitReadline(options);
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * macOS: Use osascript (AppleScript) for dialogs
 */
function elicitMacOS(options: ElicitOptions): Promise<ElicitResult> {
  return new Promise((resolve) => {
    const title = options.title || 'Input Required';
    const prompt = options.prompt;
    const defaultValue = options.defaultValue || '';
    const isPassword = options.type === 'password';
    const isConfirm = options.type === 'confirm';

    let script: string;

    if (isConfirm) {
      script = `
        display dialog "${escapeAppleScript(prompt)}" ¬
          with title "${escapeAppleScript(title)}" ¬
          buttons {"Cancel", "No", "Yes"} ¬
          default button "Yes"
        set buttonPressed to button returned of result
        return buttonPressed
      `;
    } else if (isPassword) {
      script = `
        display dialog "${escapeAppleScript(prompt)}" ¬
          with title "${escapeAppleScript(title)}" ¬
          default answer "${escapeAppleScript(defaultValue)}" ¬
          with hidden answer ¬
          buttons {"Cancel", "OK"} ¬
          default button "OK"
        return text returned of result
      `;
    } else {
      script = `
        display dialog "${escapeAppleScript(prompt)}" ¬
          with title "${escapeAppleScript(title)}" ¬
          default answer "${escapeAppleScript(defaultValue)}" ¬
          buttons {"Cancel", "OK"} ¬
          default button "OK"
        return text returned of result
      `;
    }

    exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (error, stdout, stderr) => {
      if (error) {
        // User cancelled
        if (error.code === 1) {
          resolve({
            success: false,
            error: 'User cancelled',
          });
        } else {
          resolve({
            success: false,
            error: stderr || error.message,
          });
        }
        return;
      }

      const value = stdout.trim();

      if (isConfirm) {
        resolve({
          success: true,
          confirmed: value === 'Yes',
          value,
        });
      } else {
        resolve({
          success: true,
          value,
        });
      }
    });
  });
}

/**
 * Windows: Use PowerShell for dialogs
 */
function elicitWindows(options: ElicitOptions): Promise<ElicitResult> {
  return new Promise((resolve) => {
    const title = options.title || 'Input Required';
    const prompt = options.prompt;
    const defaultValue = options.defaultValue || '';
    const isConfirm = options.type === 'confirm';

    let script: string;

    if (isConfirm) {
      script = `
        Add-Type -AssemblyName System.Windows.Forms
        $result = [System.Windows.Forms.MessageBox]::Show('${escapePowerShell(prompt)}', '${escapePowerShell(title)}', 'YesNoCancel', 'Question')
        Write-Output $result
      `;
    } else {
      script = `
        Add-Type -AssemblyName Microsoft.VisualBasic
        $result = [Microsoft.VisualBasic.Interaction]::InputBox('${escapePowerShell(prompt)}', '${escapePowerShell(title)}', '${escapePowerShell(defaultValue)}')
        Write-Output $result
      `;
    }

    exec(`powershell -Command "${script.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          error: stderr || error.message,
        });
        return;
      }

      const value = stdout.trim();

      if (isConfirm) {
        if (value === 'Cancel') {
          resolve({
            success: false,
            error: 'User cancelled',
          });
        } else {
          resolve({
            success: true,
            confirmed: value === 'Yes',
            value,
          });
        }
      } else {
        if (value === '') {
          resolve({
            success: false,
            error: 'User cancelled',
          });
        } else {
          resolve({
            success: true,
            value,
          });
        }
      }
    });
  });
}

/**
 * Linux: Use zenity or kdialog
 */
function elicitLinux(options: ElicitOptions): Promise<ElicitResult> {
  return new Promise((resolve) => {
    const title = options.title || 'Input Required';
    const prompt = options.prompt;
    const defaultValue = options.defaultValue || '';
    const isPassword = options.type === 'password';
    const isConfirm = options.type === 'confirm';

    // Try zenity first, then kdialog
    let command: string;

    if (isConfirm) {
      command = `zenity --question --title="${escapeShell(title)}" --text="${escapeShell(prompt)}" 2>/dev/null || kdialog --yesno "${escapeShell(prompt)}" --title "${escapeShell(title)}" 2>/dev/null`;
    } else if (isPassword) {
      command = `zenity --password --title="${escapeShell(title)}" 2>/dev/null || kdialog --password "${escapeShell(prompt)}" --title "${escapeShell(title)}" 2>/dev/null`;
    } else {
      command = `zenity --entry --title="${escapeShell(title)}" --text="${escapeShell(prompt)}" --entry-text="${escapeShell(defaultValue)}" 2>/dev/null || kdialog --inputbox "${escapeShell(prompt)}" "${escapeShell(defaultValue)}" --title "${escapeShell(title)}" 2>/dev/null`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 1) {
          resolve({
            success: false,
            error: 'User cancelled',
          });
        } else {
          // Neither zenity nor kdialog available, fall back to readline
          elicitReadline(options).then(resolve);
        }
        return;
      }

      const value = stdout.trim();

      if (isConfirm) {
        resolve({
          success: true,
          confirmed: true,
          value: 'yes',
        });
      } else {
        resolve({
          success: true,
          value,
        });
      }
    });
  });
}

// Helper functions for escaping strings

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePowerShell(str: string): string {
  return str.replace(/'/g, "''");
}

function escapeShell(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}
