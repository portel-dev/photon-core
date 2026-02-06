/**
 * Chart - Purpose-driven type for data visualization
 *
 * Automatically renders as a chart with the specified type.
 *
 * @example
 * ```typescript
 * async revenue() {
 *   return new Chart('line')
 *     .title('Monthly Revenue')
 *     .labels(['Jan', 'Feb', 'Mar', 'Apr'])
 *     .series('Revenue', [1000, 1500, 1200, 1800])
 *     .series('Costs', [800, 900, 850, 950]);
 * }
 *
 * async distribution() {
 *   return new Chart('pie')
 *     .title('User Distribution')
 *     .data([
 *       { label: 'Free', value: 1000 },
 *       { label: 'Pro', value: 500 },
 *       { label: 'Enterprise', value: 100 },
 *     ]);
 * }
 * ```
 */

import { PhotonUIType } from './base.js';

export type ChartType = 'line' | 'bar' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'radar';

export interface ChartSeries {
  name: string;
  data: number[];
  color?: string;
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface ChartOptions {
  title?: string;
  subtitle?: string;
  legend?: boolean | 'top' | 'bottom' | 'left' | 'right';
  stacked?: boolean;
  showGrid?: boolean;
  showValues?: boolean;
  animate?: boolean;
  height?: number;
  colors?: string[];
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export class Chart extends PhotonUIType {
  readonly _photonType = 'chart' as const;

  private _type: ChartType;
  private _labels: string[] = [];
  private _series: ChartSeries[] = [];
  private _data: ChartDataPoint[] = []; // For pie/doughnut
  private _options: ChartOptions = {
    legend: true,
    showGrid: true,
    animate: true,
  };

  /**
   * Create a new Chart
   * @param type Chart type (line, bar, pie, etc.)
   */
  constructor(type: ChartType = 'line') {
    super();
    this._type = type;
  }

  /**
   * Set chart title
   */
  title(title: string): this {
    this._options.title = title;
    return this;
  }

  /**
   * Set chart subtitle
   */
  subtitle(subtitle: string): this {
    this._options.subtitle = subtitle;
    return this;
  }

  /**
   * Set X-axis labels (for line, bar, area charts)
   */
  labels(labels: string[]): this {
    this._labels = labels;
    return this;
  }

  /**
   * Add a data series (for line, bar, area charts)
   */
  series(name: string, data: number[], color?: string): this {
    this._series.push({ name, data, color });
    return this;
  }

  /**
   * Set pie/doughnut data points
   */
  data(points: ChartDataPoint[] | Array<{ label: string; value: number }>): this {
    this._data = points;
    return this;
  }

  /**
   * Configure legend
   */
  legend(position: boolean | 'top' | 'bottom' | 'left' | 'right' = true): this {
    this._options.legend = position;
    return this;
  }

  /**
   * Enable stacked mode (for bar/area charts)
   */
  stacked(enabled: boolean = true): this {
    this._options.stacked = enabled;
    return this;
  }

  /**
   * Show/hide grid lines
   */
  grid(enabled: boolean = true): this {
    this._options.showGrid = enabled;
    return this;
  }

  /**
   * Show values on chart
   */
  showValues(enabled: boolean = true): this {
    this._options.showValues = enabled;
    return this;
  }

  /**
   * Enable/disable animations
   */
  animate(enabled: boolean = true): this {
    this._options.animate = enabled;
    return this;
  }

  /**
   * Set chart height
   */
  height(pixels: number): this {
    this._options.height = pixels;
    return this;
  }

  /**
   * Set color palette
   */
  colors(colors: string[]): this {
    this._options.colors = colors;
    return this;
  }

  /**
   * Set X-axis label
   */
  xAxis(label: string): this {
    this._options.xAxisLabel = label;
    return this;
  }

  /**
   * Set Y-axis label
   */
  yAxis(label: string): this {
    this._options.yAxisLabel = label;
    return this;
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      chartType: this._type,
      labels: this._labels,
      series: this._series,
      data: this._data,
      options: this._options,
    };
  }

  /**
   * Render as plain text for MCP clients
   */
  toString(): string {
    const lines: string[] = [];

    if (this._options.title) {
      lines.push(`## ${this._options.title}`);
      if (this._options.subtitle) lines.push(this._options.subtitle);
      lines.push('');
    }

    // Pie/doughnut: show as list
    if ((this._type === 'pie' || this._type === 'doughnut') && this._data.length > 0) {
      const total = this._data.reduce((sum, d) => sum + d.value, 0);
      for (const d of this._data) {
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
        lines.push(`- ${d.label}: ${d.value} (${pct}%)`);
      }
      return lines.join('\n');
    }

    // Series charts: show as table
    if (this._series.length > 0 && this._labels.length > 0) {
      const headers = ['', ...this._series.map(s => s.name)];
      lines.push('| ' + headers.join(' | ') + ' |');
      lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

      for (let i = 0; i < this._labels.length; i++) {
        const row = [this._labels[i], ...this._series.map(s => String(s.data[i] ?? ''))];
        lines.push('| ' + row.join(' | ') + ' |');
      }
    }

    return lines.join('\n');
  }
}
