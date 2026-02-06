/**
 * Progress - Purpose-driven type for progress indicators
 *
 * Automatically renders as progress bars or steps.
 *
 * @example
 * ```typescript
 * // Simple progress bar
 * async uploadStatus() {
 *   return new Progress(75)
 *     .label('Uploading files...')
 *     .color('blue');
 * }
 *
 * // Multiple progress bars
 * async projectStatus() {
 *   return new Progress()
 *     .bar('Design', 100, { color: 'green' })
 *     .bar('Development', 65, { color: 'blue' })
 *     .bar('Testing', 20, { color: 'yellow' });
 * }
 *
 * // Step indicator
 * async checkoutSteps() {
 *   return new Progress('steps')
 *     .step('Cart', 'completed')
 *     .step('Shipping', 'current')
 *     .step('Payment', 'pending')
 *     .step('Confirm', 'pending');
 * }
 * ```
 */

import { PhotonUIType } from './base.js';

export type ProgressStyle = 'bar' | 'steps' | 'circle';
export type StepStatus = 'pending' | 'current' | 'completed' | 'error';

export interface ProgressBar {
  label: string;
  value: number;
  max?: number;
  color?: string;
  showValue?: boolean;
}

export interface ProgressStep {
  label: string;
  status: StepStatus;
  description?: string;
  icon?: string;
}

export interface ProgressOptions {
  title?: string;
  style?: ProgressStyle;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  striped?: boolean;
  animated?: boolean;
  showValue?: boolean;
}

export class Progress extends PhotonUIType {
  readonly _photonType = 'progress' as const;

  private _bars: ProgressBar[] = [];
  private _steps: ProgressStep[] = [];
  private _value: number = 0;
  private _max: number = 100;
  private _options: ProgressOptions = {
    style: 'bar',
    size: 'md',
    showValue: true,
    animated: true,
  };

  /**
   * Create a new Progress indicator
   * @param valueOrStyle Initial value (0-100) or style ('steps', 'circle')
   */
  constructor(valueOrStyle?: number | ProgressStyle) {
    super();
    if (typeof valueOrStyle === 'number') {
      this._value = valueOrStyle;
    } else if (valueOrStyle) {
      this._options.style = valueOrStyle;
    }
  }

  /**
   * Set progress value (0-100)
   */
  value(val: number, max?: number): this {
    this._value = val;
    if (max !== undefined) this._max = max;
    return this;
  }

  /**
   * Set label
   */
  label(text: string): this {
    this._options.title = text;
    return this;
  }

  /**
   * Add a progress bar (for multi-bar display)
   */
  bar(label: string, value: number, options?: { max?: number; color?: string; showValue?: boolean }): this {
    this._bars.push({
      label,
      value,
      max: options?.max ?? 100,
      color: options?.color,
      showValue: options?.showValue ?? true,
    });
    return this;
  }

  /**
   * Add a step (for step indicator)
   */
  step(label: string, status: StepStatus = 'pending', options?: { description?: string; icon?: string }): this {
    this._options.style = 'steps';
    this._steps.push({
      label,
      status,
      ...options,
    });
    return this;
  }

  /**
   * Set color
   */
  color(color: string): this {
    this._options.color = color;
    return this;
  }

  /**
   * Set size
   */
  size(size: 'sm' | 'md' | 'lg'): this {
    this._options.size = size;
    return this;
  }

  /**
   * Use striped style
   */
  striped(enabled: boolean = true): this {
    this._options.striped = enabled;
    return this;
  }

  /**
   * Enable animation
   */
  animated(enabled: boolean = true): this {
    this._options.animated = enabled;
    return this;
  }

  /**
   * Show/hide value text
   */
  showValue(enabled: boolean = true): this {
    this._options.showValue = enabled;
    return this;
  }

  /**
   * Use circle style
   */
  circle(): this {
    this._options.style = 'circle';
    return this;
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      value: this._value,
      max: this._max,
      bars: this._bars,
      steps: this._steps,
      options: this._options,
    };
  }
}
