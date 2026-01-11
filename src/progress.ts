/**
 * Progress Rendering Utilities
 * 
 * Provides ephemeral progress indicators that clear when done:
 * - Spinners for indeterminate progress (EmitStatus)
 * - Progress bars for determinate progress (EmitProgress with value)
 * 
 * Used by CLI and other interactive runtimes to show temporary progress.
 * Always writes to stderr to avoid interfering with stdout data.
 */

import * as readline from 'readline';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Progress renderer that manages ephemeral output
 * All progress is shown on stderr and clears when complete
 */
export class ProgressRenderer {
  private spinnerInterval?: NodeJS.Timeout;
  private currentFrame = 0;
  private isActive = false;
  private lastMessage = '';
  private lastLength = 0;

  /**
   * Start an indeterminate spinner with auto-animation
   * Updates every 80ms until stopped
   */
  startSpinner(message: string): void {
    this.stop(); // Clear any previous progress
    this.isActive = true;
    this.lastMessage = message;
    
    // Initial render
    this.renderSpinner();
    
    // Update spinner every 80ms
    this.spinnerInterval = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % SPINNER_FRAMES.length;
      this.renderSpinner();
    }, 80);
  }

  /**
   * Show a single frame of spinner (no auto-animation)
   * Use this for manual control, or startSpinner() for auto-animation
   */
  showSpinner(message: string): void {
    this.clearLine();
    this.isActive = true;
    this.lastMessage = message;
    this.renderSpinner();
  }

  /**
   * Show a progress bar with percentage (0-1)
   * Use for determinate progress
   */
  showProgress(value: number, message?: string): void {
    this.stop(); // Clear any spinner
    this.isActive = true;
    this.lastMessage = message || '';
    this.renderProgressBar(value);
  }

  /**
   * Render progress bar with optional spinner animation
   * Combines progress bar with spinner for better UX
   */
  render(value: number, message?: string): void {
    this.isActive = true;
    this.lastMessage = message || '';
    const pct = Math.round(value * 100);
    const barWidth = 20;
    const filled = Math.round(value * barWidth);
    const empty = barWidth - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const spinner = pct < 100 ? SPINNER_FRAMES[this.currentFrame++ % SPINNER_FRAMES.length] : '✓';

    const text = `${spinner} [${bar}] ${pct.toString().padStart(3)}%${this.lastMessage ? ` ${this.lastMessage}` : ''}`;

    this.clearLine();
    process.stderr.write(text);
    this.lastLength = text.length;
  }

  /**
   * Update message without restarting animation
   */
  updateMessage(message: string): void {
    if (this.isActive) {
      this.lastMessage = message;
      if (this.spinnerInterval) {
        this.renderSpinner();
      }
    }
  }

  /**
   * Stop and clear progress display
   * Alias for done() for consistency
   */
  stop(): void {
    this.done();
  }

  /**
   * End progress display (clears the line completely)
   */
  done(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
    
    if (this.isActive) {
      this.clearLine();
      this.isActive = false;
    }
    
    this.currentFrame = 0;
    this.lastMessage = '';
    this.lastLength = 0;
  }

  /**
   * Print a persistent status message (clears progress first, then prints)
   */
  status(message: string): void {
    this.done();
    console.error(`ℹ ${message}`);
  }

  /**
   * Check if progress is currently active
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Clear the current progress line
   */
  private clearLine(): void {
    if ((this.lastLength > 0 || this.isActive) && process.stderr.isTTY) {
      readline.clearLine(process.stderr, 0);
      readline.cursorTo(process.stderr, 0);
      this.lastLength = 0;
    }
  }

  private renderSpinner(): void {
    const frame = SPINNER_FRAMES[this.currentFrame];
    const text = `${frame} ${this.lastMessage}`;
    this.clearLine();
    process.stderr.write(text);
    this.lastLength = text.length;
  }

  private renderProgressBar(value: number): void {
    const percentage = Math.round(value * 100);
    const barLength = 30;
    const filled = Math.round(barLength * value);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    
    const text = `[${bar}] ${percentage}%${this.lastMessage ? ` ${this.lastMessage}` : ''}`;
    this.clearLine();
    process.stderr.write(text);
    this.lastLength = text.length;
  }
}

/**
 * Global progress renderer instance
 */
let globalRenderer: ProgressRenderer | null = null;

/**
 * Get or create the global progress renderer
 */
export function getProgressRenderer(): ProgressRenderer {
  if (!globalRenderer) {
    globalRenderer = new ProgressRenderer();
  }
  return globalRenderer;
}

/**
 * Start a spinner with message
 */
export function startSpinner(message: string): void {
  getProgressRenderer().startSpinner(message);
}

/**
 * Show progress bar (0-1)
 */
export function showProgress(value: number, message?: string): void {
  getProgressRenderer().showProgress(value, message);
}

/**
 * Update current progress message
 */
export function updateProgressMessage(message: string): void {
  getProgressRenderer().updateMessage(message);
}

/**
 * Stop and clear progress display
 */
export function stopProgress(): void {
  getProgressRenderer().stop();
}

/**
 * Check if progress is active
 */
export function isProgressActive(): boolean {
  return getProgressRenderer().active;
}
