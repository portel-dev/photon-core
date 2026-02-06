/**
 * Table - Purpose-driven type for tabular data
 *
 * Automatically renders as a table UI with sorting, filtering, etc.
 *
 * @example Basic usage
 * ```typescript
 * async users() {
 *   return new Table()
 *     .column('name', 'Name', 'string')
 *     .column('email', 'Email', 'string')
 *     .rows(users);
 * }
 * ```
 *
 * @example With Field system (React Admin-style)
 * ```typescript
 * async products() {
 *   return new Table()
 *     .fields([
 *       Field.image('thumbnail', { width: 60, rounded: true }),
 *       Field.text('name', { link: '/products/{id}' }),
 *       Field.price('price', { originalSource: 'msrp', currency: 'USD' }),
 *       Field.rating('rating', { countSource: 'reviewCount' }),
 *       Field.badge('status', { colors: { active: 'green', draft: 'gray' } }),
 *       Field.actions([
 *         { label: 'Edit', method: 'edit', icon: 'pencil' },
 *         { label: 'Delete', method: 'delete', confirm: true },
 *       ]),
 *     ])
 *     .rows(products);
 * }
 * ```
 */

import { PhotonUIType } from './base.js';
import { FieldDefinition, formatFieldLabel, Field } from './Field.js';
import { renderFieldToText } from './FieldRenderer.js';

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
  private _fields: FieldDefinition[] = [];
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Field-based API (React Admin-style)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add fields using the Field system
   */
  fields(fieldDefs: FieldDefinition[]): this {
    this._fields = fieldDefs;
    return this;
  }

  /**
   * Add a single field
   */
  field(fieldDef: FieldDefinition): this {
    this._fields.push(fieldDef);
    return this;
  }

  // Convenience methods for common field types

  /** Add text field */
  text(source: string, options?: Parameters<typeof Field.text>[1]): this {
    return this.field(Field.text(source, options));
  }

  /** Add email field */
  email(source: string, options?: Parameters<typeof Field.email>[1]): this {
    return this.field(Field.email(source, options));
  }

  /** Add URL field */
  url(source: string, options?: Parameters<typeof Field.url>[1]): this {
    return this.field(Field.url(source, options));
  }

  /** Add phone field */
  phone(source: string, options?: Parameters<typeof Field.phone>[1]): this {
    return this.field(Field.phone(source, options));
  }

  /** Add number field */
  number(source: string, options?: Parameters<typeof Field.number>[1]): this {
    return this.field(Field.number(source, options));
  }

  /** Add currency field */
  currency(source: string, options?: Parameters<typeof Field.currency>[1]): this {
    return this.field(Field.currency(source, options));
  }

  /** Add percent field */
  percent(source: string, options?: Parameters<typeof Field.percent>[1]): this {
    return this.field(Field.percent(source, options));
  }

  /** Add date field */
  date(source: string, options?: Parameters<typeof Field.date>[1]): this {
    return this.field(Field.date(source, options));
  }

  /** Add datetime field */
  datetime(source: string, options?: Parameters<typeof Field.datetime>[1]): this {
    return this.field(Field.datetime(source, options));
  }

  /** Add boolean field */
  boolean(source: string, options?: Parameters<typeof Field.boolean>[1]): this {
    return this.field(Field.boolean(source, options));
  }

  /** Add image field */
  image(source: string, options?: Parameters<typeof Field.image>[1]): this {
    return this.field(Field.image(source, options));
  }

  /** Add avatar field */
  avatar(source: string, options?: Parameters<typeof Field.avatar>[1]): this {
    return this.field(Field.avatar(source, options));
  }

  /** Add badge field */
  badge(source: string, options?: Parameters<typeof Field.badge>[1]): this {
    return this.field(Field.badge(source, options));
  }

  /** Add tags field */
  tags(source: string, options?: Parameters<typeof Field.tags>[1]): this {
    return this.field(Field.tags(source, options));
  }

  /** Add rating field */
  rating(source: string, options?: Parameters<typeof Field.rating>[1]): this {
    return this.field(Field.rating(source, options));
  }

  /** Add price field */
  price(source: string, options?: Parameters<typeof Field.price>[1]): this {
    return this.field(Field.price(source, options));
  }

  /** Add stock field */
  stock(source: string, options?: Parameters<typeof Field.stock>[1]): this {
    return this.field(Field.stock(source, options));
  }

  /** Add user field */
  user(source: string, options?: Parameters<typeof Field.user>[1]): this {
    return this.field(Field.user(source, options));
  }

  /** Add reference field */
  reference(source: string, options?: Parameters<typeof Field.reference>[1]): this {
    return this.field(Field.reference(source, options));
  }

  /** Add actions field */
  actions(items: Parameters<typeof Field.actions>[0], options?: Parameters<typeof Field.actions>[1]): this {
    return this.field(Field.actions(items, options));
  }

  /** Add custom field */
  custom(source: string, render: Parameters<typeof Field.custom>[1], options?: Parameters<typeof Field.custom>[2]): this {
    return this.field(Field.custom(source, render, options));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Methods
  // ═══════════════════════════════════════════════════════════════════════════

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

  /**
   * Check if using Field system or legacy columns
   */
  private get _useFields(): boolean {
    return this._fields.length > 0;
  }

  /**
   * Get effective headers for display
   */
  private _getHeaders(): string[] {
    if (this._useFields) {
      return this._fields.map(f => f.options.label ?? formatFieldLabel(f.source));
    }
    return this._columns.map(c => c.label);
  }

  /**
   * Get cell values for a row
   */
  private _getCells(row: Record<string, any>): string[] {
    if (this._useFields) {
      return this._fields.map(f => renderFieldToText(f, row));
    }
    return this._columns.map(c => String(row[c.key] ?? ''));
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      columns: this._columns,
      fields: this._fields,
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
    const headers = this._getHeaders();
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (const row of this._rows) {
      const cells = this._getCells(row);
      lines.push('| ' + cells.join(' | ') + ' |');
    }

    return lines.join('\n');
  }
}
