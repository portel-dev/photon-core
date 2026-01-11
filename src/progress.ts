/**
 * Progress Rendering Utilities
 * 
 * Provides ephemeral progress indicators that clear when done:
 * - Spinners for indeterminate progress (EmitStatus)
 * - Progress bars for determinate progress (EmitProgress with value)
 * 
 * Used by CLI and other interactive runtimes to show temporary progress.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CLEAR_LINE = '\r\x1b[K';

/**
 * Progress renderer that manages ephemeral output
 */
export class ProgressRenderer {
  private spinnerInterval?: NodeJS.Timeout;
  private currentFrame = 0;
  private isActive = false;
  private lastMessage = '';

  /**
   * Start an indeterminate spinner
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
   * Show a progress bar (0-1)
   */
  showProgress(value: number, message?: string): void {
    this.stop(); // Clear any spinner
    this.isActive = true;
    this.lastMessage = message || '';
    this.renderProgressBar(value);
  }

  /**
   * Update spinner message without restarting
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
   */
  stop(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
    
    if (this.isActive) {
      // Clear the line
      process.stderr.write(CLEAR_LINE);
      this.isActive = false;
    }
    
    this.currentFrame = 0;
    this.lastMessage = '';
  }

  /**
   * Check if progress is currently active
   */
  get active(): boolean {
    return this.isActive;
  }

  private renderSpinner(): void {
    const frame = SPINNER_FRAMES[this.currentFrame];
    const output = `${CLEAR_LINE}${frame} ${this.lastMessage}`;
    process.stderr.write(output);
  }

  private renderProgressBar(value: number): void {
    const percentage = Math.round(value * 100);
    const barLength = 30;
    const filled = Math.round(barLength * value);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    
    const output = `${CLEAR_LINE}[${bar}] ${percentage}%${this.lastMessage ? ` ${this.lastMessage}` : ''}`;
    process.stderr.write(output);
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
