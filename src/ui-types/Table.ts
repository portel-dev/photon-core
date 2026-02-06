/**
 * Table - Purpose-driven type for tabular data
 *
 * Automatically renders as a table UI with sorting, filtering, etc.
 *
 * @example
 * ```typescript
 * async users() {
 *   return new Table()
 *     .column('name', 'Name', 'string')
 *     .column('email', 'Email', 'string')
 *     .column('role', 'Role', 'string')
 *     .rows([
 *       { name: 'Alice', email: 'alice@example.com', role: 'Admin' },
 *       { name: 'Bob', email: 'bob@example.com', role: 'User' },
 *     ]);
 * }
 * ```
 */

import { PhotonUIType } from './base.js';

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'link' | 'image' | 'badge';

export interface TableColumn {
  key: string;
  label: string;
  type: ColumnType;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  format?: string; // For date/currency formatting
}

export interface TableOptions {
  title?: string;
  searchable?: boolean;
  sortable?: boolean;
  paginated?: boolean;
  pageSize?: number;
  selectable?: boolean;
  striped?: boolean;
  compact?: boolean;
}

export class Table extends PhotonUIType {
  readonly _photonType = 'table' as const;

  private _columns: TableColumn[] = [];
  private _rows: Record<string, any>[] = [];
  private _options: TableOptions = {};

  /**
   * Create a new Table
   * @param data Optional initial data (array of objects)
   */
  constructor(data?: Record<string, any>[]) {
    super();
    if (data && data.length > 0) {
      this._rows = data;
      // Auto-infer columns from first row
      this._inferColumns(data[0]);
    }
  }

  /**
   * Add a column definition
   */
  column(key: string, label: string, type: ColumnType = 'string', options?: Partial<TableColumn>): this {
    this._columns.push({
      key,
      label,
      type,
      sortable: this._options.sortable ?? true,
      ...options,
    });
    return this;
  }

  /**
   * Add multiple columns at once
   */
  columns(cols: Array<[key: string, label: string, type?: ColumnType] | TableColumn>): this {
    for (const col of cols) {
      if (Array.isArray(col)) {
        this.column(col[0], col[1], col[2] ?? 'string');
      } else {
        this._columns.push(col);
      }
    }
    return this;
  }

  /**
   * Set the table rows
   */
  rows(data: Record<string, any>[]): this {
    this._rows = data;
    // If no columns defined, infer from data
    if (this._columns.length === 0 && data.length > 0) {
      this._inferColumns(data[0]);
    }
    return this;
  }

  /**
   * Add a single row
   */
  row(data: Record<string, any>): this {
    this._rows.push(data);
    if (this._columns.length === 0) {
      this._inferColumns(data);
    }
    return this;
  }

  /**
   * Set table title
   */
  title(title: string): this {
    this._options.title = title;
    return this;
  }

  /**
   * Enable/disable search
   */
  searchable(enabled: boolean = true): this {
    this._options.searchable = enabled;
    return this;
  }

  /**
   * Enable/disable sorting
   */
  sortable(enabled: boolean = true): this {
    this._options.sortable = enabled;
    return this;
  }

  /**
   * Enable pagination
   */
  paginated(pageSize: number = 10): this {
    this._options.paginated = true;
    this._options.pageSize = pageSize;
    return this;
  }

  /**
   * Enable row selection
   */
  selectable(enabled: boolean = true): this {
    this._options.selectable = enabled;
    return this;
  }

  /**
   * Use striped rows
   */
  striped(enabled: boolean = true): this {
    this._options.striped = enabled;
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
   * Infer columns from a data row
   */
  private _inferColumns(row: Record<string, any>): void {
    for (const [key, value] of Object.entries(row)) {
      const type = this._inferType(value);
      const label = this._formatLabel(key);
      this._columns.push({ key, label, type, sortable: true });
    }
  }

  /**
   * Infer column type from value
   */
  private _inferType(value: any): ColumnType {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Date) return 'date';
    if (typeof value === 'string') {
      if (value.match(/^\d{4}-\d{2}-\d{2}/)) return 'date';
      if (value.match(/^https?:\/\//)) return 'link';
      if (value.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return 'image';
    }
    return 'string';
  }

  /**
   * Format key to human-readable label
   */
  private _formatLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1') // camelCase to spaces
      .replace(/[_-]/g, ' ') // snake_case/kebab-case to spaces
      .replace(/^\w/, c => c.toUpperCase()) // Capitalize first letter
      .trim();
  }

  /**
   * Get row count
   */
  get length(): number {
    return this._rows.length;
  }

  /**
   * Check if table is empty
   */
  get isEmpty(): boolean {
    return this._rows.length === 0;
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      columns: this._columns,
      rows: this._rows,
      options: this._options,
    };
  }

  /**
   * Render as plain text/markdown for MCP clients
   */
  toString(): string {
    if (this._rows.length === 0) {
      return this._options.title ? `${this._options.title}\n\n(No data)` : '(No data)';
    }

    const lines: string[] = [];

    if (this._options.title) {
      lines.push(`## ${this._options.title}`, '');
    }

    // Header row
    const headers = this._columns.map(c => c.label);
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (const row of this._rows) {
      const cells = this._columns.map(c => String(row[c.key] ?? ''));
      lines.push('| ' + cells.join(' | ') + ' |');
    }

    return lines.join('\n');
  }
}
