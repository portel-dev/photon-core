/**
 * Field - Unified field system for UI types
 *
 * Fields define how data is displayed. They work across Table, Cards, List, etc.
 * Each field type handles its own rendering logic and formatting.
 *
 * @example
 * ```typescript
 * import { Field, Table, Cards } from '@portel/photon-core';
 *
 * // Define fields once, use anywhere
 * const productFields = [
 *   Field.image('thumbnail', { width: 80, rounded: true }),
 *   Field.text('name', { link: '/products/{id}' }),
 *   Field.price('price', { original: 'msrp', currency: 'USD' }),
 *   Field.rating('rating', { count: 'reviewCount' }),
 *   Field.badge('status', { colors: { active: 'green' } }),
 *   Field.actions([{ label: 'Edit', method: 'edit' }]),
 * ];
 *
 * // Works in Table
 * new Table().fields(productFields).rows(data);
 *
 * // Works in Cards
 * new Cards().fields(productFields).items(data);
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Common Types
// ═══════════════════════════════════════════════════════════════════════════════

export type FieldAlignment = 'left' | 'center' | 'right';

export interface BaseFieldOptions {
  /** Display label (auto-inferred from source if not provided) */
  label?: string;
  /** Enable sorting on this field */
  sortable?: boolean;
  /** Sort by different field */
  sortBy?: string;
  /** Text alignment */
  align?: FieldAlignment;
  /** Column width (CSS value like '100px', '20%') */
  columnWidth?: string;
  /** Text to show when value is empty/null */
  emptyText?: string;
  /** Hide this field */
  hidden?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Tooltip text */
  tooltip?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Text Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface TextFieldOptions extends BaseFieldOptions {
  /** Make text a link. Use {field} for interpolation */
  link?: string;
  /** Open link in new tab */
  external?: boolean;
  /** Truncate text to max characters */
  truncate?: number;
  /** Text variant */
  variant?: 'heading' | 'body' | 'caption' | 'code';
  /** Make text copyable */
  copyable?: boolean;
}

export interface EmailFieldOptions extends BaseFieldOptions {
  /** Show as mailto link */
  linked?: boolean;
}

export interface UrlFieldOptions extends BaseFieldOptions {
  /** Display text (otherwise shows URL) */
  text?: string;
  /** Truncate URL display */
  truncate?: number;
}

export interface PhoneFieldOptions extends BaseFieldOptions {
  /** Show as tel: link */
  linked?: boolean;
  /** Format pattern */
  format?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Numeric Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface NumberFieldOptions extends BaseFieldOptions {
  /** Decimal places */
  decimals?: number;
  /** Use compact notation (1.2K, 5M) */
  compact?: boolean;
  /** Prefix text */
  prefix?: string;
  /** Suffix text */
  suffix?: string;
  /** Locale for formatting */
  locale?: string;
}

export interface CurrencyFieldOptions extends BaseFieldOptions {
  /** Currency code (USD, EUR, etc.) */
  currency?: string;
  /** Locale for formatting */
  locale?: string;
  /** Show currency symbol */
  showSymbol?: boolean;
  /** Decimal places */
  decimals?: number;
}

export interface PercentFieldOptions extends BaseFieldOptions {
  /** Decimal places */
  decimals?: number;
  /** Multiply by 100 (if value is 0.5 for 50%) */
  multiply?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Date Fields
// ═══════════════════════════════════════════════════════════════════════════════

export type DateFormat = 'relative' | 'short' | 'medium' | 'long' | 'iso' | string;

export interface DateFieldOptions extends BaseFieldOptions {
  /** Date format */
  format?: DateFormat;
  /** Show time component */
  showTime?: boolean;
  /** Locale for formatting */
  locale?: string;
}

export interface TimeFieldOptions extends BaseFieldOptions {
  /** Time format */
  format?: '12h' | '24h';
  /** Show seconds */
  showSeconds?: boolean;
}

export interface DateRangeFieldOptions extends BaseFieldOptions {
  /** End date source */
  endSource: string;
  /** Format for dates */
  format?: DateFormat;
  /** Separator between dates */
  separator?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Boolean Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface BooleanFieldOptions extends BaseFieldOptions {
  /** Label for true value */
  trueLabel?: string;
  /** Label for false value */
  falseLabel?: string;
  /** Icon for true value */
  trueIcon?: string;
  /** Icon for false value */
  falseIcon?: string;
  /** Use colored badges instead of icons */
  asBadge?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Media Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface ImageFieldOptions extends BaseFieldOptions {
  /** Image width */
  width?: number;
  /** Image height */
  height?: number;
  /** Make image circular */
  rounded?: boolean;
  /** Fallback image URL */
  fallback?: string;
  /** Alt text source */
  altSource?: string;
  /** Enable lightbox on click */
  lightbox?: boolean;
}

export interface AvatarFieldOptions extends BaseFieldOptions {
  /** Size in pixels */
  size?: number;
  /** Source for name (for initials fallback) */
  nameSource?: string;
}

export interface GalleryFieldOptions extends BaseFieldOptions {
  /** Max images to show inline */
  maxVisible?: number;
  /** Thumbnail size */
  thumbnailSize?: number;
}

export interface FileFieldOptions extends BaseFieldOptions {
  /** Show file size */
  showSize?: boolean;
  /** Show file type icon */
  showIcon?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Status/Category Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface BadgeFieldOptions extends BaseFieldOptions {
  /** Color mapping: { value: color } */
  colors?: Record<string, string>;
  /** Icon mapping: { value: icon } */
  icons?: Record<string, string>;
  /** Variant style */
  variant?: 'solid' | 'outline' | 'subtle';
  /** Size */
  size?: 'sm' | 'md' | 'lg';
}

export interface TagsFieldOptions extends BaseFieldOptions {
  /** Max tags to show */
  max?: number;
  /** Color for tags */
  color?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rating Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface RatingFieldOptions extends BaseFieldOptions {
  /** Maximum rating value */
  max?: number;
  /** Source for review count */
  countSource?: string;
  /** Show numeric value */
  showValue?: boolean;
  /** Icon for filled star */
  icon?: string;
  /** Color for stars */
  color?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Commerce Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface PriceFieldOptions extends BaseFieldOptions {
  /** Source for original/compare-at price */
  originalSource?: string;
  /** Currency code */
  currency?: string;
  /** Locale for formatting */
  locale?: string;
  /** Show discount percentage badge */
  showDiscount?: boolean;
}

export interface StockFieldOptions extends BaseFieldOptions {
  /** Label when in stock */
  inStockLabel?: string;
  /** Label when out of stock */
  outOfStockLabel?: string;
  /** Threshold for "low stock" warning */
  lowStockThreshold?: number;
  /** Label for low stock */
  lowStockLabel?: string;
  /** Show quantity */
  showQuantity?: boolean;
}

export interface QuantityFieldOptions extends BaseFieldOptions {
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Method to call on change */
  onChange?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reference Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface UserFieldOptions extends BaseFieldOptions {
  /** Source for avatar image */
  avatarSource?: string;
  /** Source for display name */
  nameSource?: string;
  /** Source for secondary text (email, role) */
  secondarySource?: string;
  /** Link template */
  link?: string;
}

export interface ReferenceFieldOptions extends BaseFieldOptions {
  /** Source for display text */
  displaySource?: string;
  /** Link template */
  link?: string;
  /** Resource type (for routing) */
  resource?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action Fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface ActionItem {
  /** Button label */
  label: string;
  /** Photon method to call */
  method: string;
  /** Icon name */
  icon?: string;
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Require confirmation */
  confirm?: boolean | string;
  /** Confirmation message */
  confirmMessage?: string;
  /** Disable condition (field name that must be truthy to disable) */
  disabledWhen?: string;
  /** Hide condition */
  hiddenWhen?: string;
}

export interface ActionsFieldOptions extends BaseFieldOptions {
  /** Show as dropdown menu */
  dropdown?: boolean;
  /** Dropdown trigger label */
  dropdownLabel?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Custom Field
// ═══════════════════════════════════════════════════════════════════════════════

export type RenderFunction = (value: any, record: Record<string, any>) => string;

export interface CustomFieldOptions extends BaseFieldOptions {
  /** Render function */
  render: RenderFunction;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Field Definition
// ═══════════════════════════════════════════════════════════════════════════════

export type FieldType =
  | 'text' | 'email' | 'url' | 'phone'
  | 'number' | 'currency' | 'percent'
  | 'date' | 'datetime' | 'time' | 'dateRange'
  | 'boolean'
  | 'image' | 'avatar' | 'gallery' | 'file'
  | 'badge' | 'tags'
  | 'rating'
  | 'price' | 'stock' | 'quantity'
  | 'user' | 'reference'
  | 'actions'
  | 'custom';

export interface FieldDefinition {
  type: FieldType;
  source: string;
  options: Record<string, any>;
  actions?: ActionItem[];
  render?: RenderFunction;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Field Factory
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Field factory for creating field definitions
 *
 * @example
 * ```typescript
 * const fields = [
 *   Field.text('name'),
 *   Field.email('email'),
 *   Field.price('price', { currency: 'USD', originalSource: 'msrp' }),
 *   Field.badge('status', { colors: { active: 'green', inactive: 'gray' } }),
 *   Field.actions([{ label: 'Edit', method: 'edit' }]),
 * ];
 * ```
 */
export const Field = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Text Fields
  // ─────────────────────────────────────────────────────────────────────────────

  text(source: string, options?: TextFieldOptions): FieldDefinition {
    return { type: 'text', source, options: options ?? {} };
  },

  email(source: string, options?: EmailFieldOptions): FieldDefinition {
    return { type: 'email', source, options: { linked: true, ...options } };
  },

  url(source: string, options?: UrlFieldOptions): FieldDefinition {
    return { type: 'url', source, options: options ?? {} };
  },

  phone(source: string, options?: PhoneFieldOptions): FieldDefinition {
    return { type: 'phone', source, options: { linked: true, ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Numeric Fields
  // ─────────────────────────────────────────────────────────────────────────────

  number(source: string, options?: NumberFieldOptions): FieldDefinition {
    return { type: 'number', source, options: options ?? {} };
  },

  currency(source: string, options?: CurrencyFieldOptions): FieldDefinition {
    return { type: 'currency', source, options: { currency: 'USD', showSymbol: true, ...options } };
  },

  percent(source: string, options?: PercentFieldOptions): FieldDefinition {
    return { type: 'percent', source, options: { decimals: 1, ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Date Fields
  // ─────────────────────────────────────────────────────────────────────────────

  date(source: string, options?: DateFieldOptions): FieldDefinition {
    return { type: 'date', source, options: { format: 'medium', ...options } };
  },

  datetime(source: string, options?: DateFieldOptions): FieldDefinition {
    return { type: 'datetime', source, options: { format: 'medium', showTime: true, ...options } };
  },

  time(source: string, options?: TimeFieldOptions): FieldDefinition {
    return { type: 'time', source, options: options ?? {} };
  },

  dateRange(startSource: string, options: DateRangeFieldOptions): FieldDefinition {
    return { type: 'dateRange', source: startSource, options: { separator: ' → ', ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Boolean Fields
  // ─────────────────────────────────────────────────────────────────────────────

  boolean(source: string, options?: BooleanFieldOptions): FieldDefinition {
    return { type: 'boolean', source, options: { trueIcon: '✓', falseIcon: '✗', ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Media Fields
  // ─────────────────────────────────────────────────────────────────────────────

  image(source: string, options?: ImageFieldOptions): FieldDefinition {
    return { type: 'image', source, options: options ?? {} };
  },

  avatar(source: string, options?: AvatarFieldOptions): FieldDefinition {
    return { type: 'avatar', source, options: { size: 40, ...options } };
  },

  gallery(source: string, options?: GalleryFieldOptions): FieldDefinition {
    return { type: 'gallery', source, options: { maxVisible: 4, thumbnailSize: 60, ...options } };
  },

  file(source: string, options?: FileFieldOptions): FieldDefinition {
    return { type: 'file', source, options: { showIcon: true, ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Status/Category Fields
  // ─────────────────────────────────────────────────────────────────────────────

  badge(source: string, options?: BadgeFieldOptions): FieldDefinition {
    return { type: 'badge', source, options: { variant: 'subtle', ...options } };
  },

  tags(source: string, options?: TagsFieldOptions): FieldDefinition {
    return { type: 'tags', source, options: { max: 3, ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Rating Fields
  // ─────────────────────────────────────────────────────────────────────────────

  rating(source: string, options?: RatingFieldOptions): FieldDefinition {
    return { type: 'rating', source, options: { max: 5, icon: '★', color: '#f59e0b', ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Commerce Fields
  // ─────────────────────────────────────────────────────────────────────────────

  price(source: string, options?: PriceFieldOptions): FieldDefinition {
    return { type: 'price', source, options: { currency: 'USD', ...options } };
  },

  stock(source: string, options?: StockFieldOptions): FieldDefinition {
    return {
      type: 'stock',
      source,
      options: {
        inStockLabel: 'In Stock',
        outOfStockLabel: 'Out of Stock',
        lowStockThreshold: 5,
        lowStockLabel: 'Low Stock',
        ...options,
      },
    };
  },

  quantity(source: string, options?: QuantityFieldOptions): FieldDefinition {
    return { type: 'quantity', source, options: { min: 1, max: 99, step: 1, ...options } };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Fields
  // ─────────────────────────────────────────────────────────────────────────────

  user(source: string, options?: UserFieldOptions): FieldDefinition {
    return { type: 'user', source, options: options ?? {} };
  },

  reference(source: string, options?: ReferenceFieldOptions): FieldDefinition {
    return { type: 'reference', source, options: options ?? {} };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Action Fields
  // ─────────────────────────────────────────────────────────────────────────────

  actions(items: ActionItem[], options?: ActionsFieldOptions): FieldDefinition {
    return { type: 'actions', source: '', options: options ?? {}, actions: items };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Custom Field
  // ─────────────────────────────────────────────────────────────────────────────

  custom(source: string, render: RenderFunction, options?: BaseFieldOptions): FieldDefinition {
    return { type: 'custom', source, options: options ?? {}, render };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Field Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get value from record using dot notation
 */
export function getFieldValue(record: Record<string, any>, source: string): any {
  if (!source) return undefined;
  return source.split('.').reduce((obj, key) => obj?.[key], record);
}

/**
 * Format label from source (camelCase → Title Case)
 */
export function formatFieldLabel(source: string): string {
  const lastPart = source.split('.').pop() ?? source;
  return lastPart
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

/**
 * Interpolate template string with record values
 * e.g., "/users/{id}" with { id: 123 } → "/users/123"
 */
export function interpolateTemplate(template: string, record: Record<string, any>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = getFieldValue(record, key);
    return value !== undefined ? String(value) : '';
  });
}
