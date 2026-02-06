/**
 * Stats - Purpose-driven type for key metrics/KPIs
 *
 * Automatically renders as a dashboard-style stats display.
 *
 * @example
 * ```typescript
 * async overview() {
 *   return new Stats()
 *     .stat('Users', 1234, { trend: '+12%', trendUp: true })
 *     .stat('Revenue', 50000, { format: 'currency', prefix: '$' })
 *     .stat('Orders', 89, { suffix: 'today' })
 *     .stat('Conversion', 3.2, { format: 'percent' });
 * }
 * ```
 */

import { PhotonUIType } from './base.js';

export type StatFormat = 'number' | 'currency' | 'percent' | 'compact';

export interface StatItem {
  label: string;
  value: number | string;
  format?: StatFormat;
  prefix?: string;
  suffix?: string;
  trend?: string;
  trendUp?: boolean;
  icon?: string;
  color?: string;
  description?: string;
}

export interface StatsOptions {
  title?: string;
  columns?: 2 | 3 | 4 | 6;
  compact?: boolean;
  bordered?: boolean;
  animated?: boolean;
}

export class Stats extends PhotonUIType {
  readonly _photonType = 'stats' as const;

  private _stats: StatItem[] = [];
  private _options: StatsOptions = {
    columns: 4,
    bordered: true,
    animated: true,
  };

  /**
   * Create a new Stats display
   */
  constructor() {
    super();
  }

  /**
   * Add a stat
   */
  stat(label: string, value: number | string, options?: Partial<Omit<StatItem, 'label' | 'value'>>): this {
    this._stats.push({
      label,
      value,
      ...options,
    });
    return this;
  }

  /**
   * Add a currency stat
   */
  currency(label: string, value: number, options?: { prefix?: string; trend?: string; trendUp?: boolean }): this {
    return this.stat(label, value, {
      format: 'currency',
      prefix: options?.prefix ?? '$',
      trend: options?.trend,
      trendUp: options?.trendUp,
    });
  }

  /**
   * Add a percentage stat
   */
  percent(label: string, value: number, options?: { trend?: string; trendUp?: boolean }): this {
    return this.stat(label, value, {
      format: 'percent',
      suffix: '%',
      ...options,
    });
  }

  /**
   * Add a count stat with compact formatting (1.2K, 5M, etc.)
   */
  count(label: string, value: number, options?: { trend?: string; trendUp?: boolean; suffix?: string }): this {
    return this.stat(label, value, {
      format: 'compact',
      ...options,
    });
  }

  /**
   * Set section title
   */
  title(title: string): this {
    this._options.title = title;
    return this;
  }

  /**
   * Set number of columns
   */
  columns(count: 2 | 3 | 4 | 6): this {
    this._options.columns = count;
    return this;
  }

  /**
   * Use compact layout
   */
  compact(enabled: boolean = true): this {
    this._options.compact = enabled;
    return this;
  }

  /**
   * Show borders
   */
  bordered(enabled: boolean = true): this {
    this._options.bordered = enabled;
    return this;
  }

  /**
   * Enable count-up animation
   */
  animated(enabled: boolean = true): this {
    this._options.animated = enabled;
    return this;
  }

  /**
   * Get stat count
   */
  get length(): number {
    return this._stats.length;
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      stats: this._stats,
      options: this._options,
    };
  }
}
