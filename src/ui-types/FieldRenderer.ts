/**
 * FieldRenderer - Render field values to text or structured data
 *
 * Handles formatting for all field types. Used by:
 * - toString() methods for plain MCP output
 * - Auto-UI components for rich rendering
 */

import {
  FieldDefinition,
  FieldType,
  getFieldValue,
  interpolateTemplate,
} from './Field.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Text Rendering (for MCP/CLI output)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Render a field value to plain text
 */
export function renderFieldToText(
  field: FieldDefinition,
  record: Record<string, any>,
): string {
  const value = getFieldValue(record, field.source);
  const opts = field.options;

  // Handle actions first (no source field)
  if (field.type === 'actions') {
    return field.actions?.map(a => `[${a.label}]`).join(' ') ?? '';
  }

  // Handle custom render function
  if (field.type === 'custom' && field.render) {
    return field.render(value, record);
  }

  if (value === undefined || value === null) {
    return opts.emptyText ?? '';
  }

  switch (field.type) {
    case 'text':
      return renderText(value, opts);

    case 'email':
      return String(value);

    case 'url':
      return opts.text ?? String(value);

    case 'phone':
      return formatPhone(value, opts.format);

    case 'number':
      return formatNumber(value, opts);

    case 'currency':
      return formatCurrency(value, opts);

    case 'percent':
      return formatPercent(value, opts);

    case 'date':
    case 'datetime':
      return formatDate(value, opts);

    case 'time':
      return formatTime(value, opts);

    case 'dateRange':
      const endValue = getFieldValue(record, opts.endSource);
      return `${formatDate(value, opts)}${opts.separator ?? ' → '}${formatDate(endValue, opts)}`;

    case 'boolean':
      return value ? (opts.trueLabel ?? 'Yes') : (opts.falseLabel ?? 'No');

    case 'image':
    case 'avatar':
      return value ? '[Image]' : '';

    case 'gallery':
      return Array.isArray(value) ? `[${value.length} images]` : '';

    case 'file':
      return typeof value === 'string' ? value.split('/').pop() ?? value : '[File]';

    case 'badge':
      return String(value);

    case 'tags':
      return Array.isArray(value) ? value.slice(0, opts.max ?? 3).join(', ') : String(value);

    case 'rating':
      return formatRating(value, opts);

    case 'price':
      return formatPrice(value, record, opts);

    case 'stock':
      return formatStock(value, opts);

    case 'quantity':
      return String(value);

    case 'user':
      return formatUser(value, record, opts);

    case 'reference':
      return opts.displaySource ? getFieldValue(record, opts.displaySource) : String(value);

    default:
      return String(value);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Format Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function renderText(value: any, opts: Record<string, any>): string {
  let text = String(value);
  if (opts.truncate && text.length > opts.truncate) {
    text = text.slice(0, opts.truncate) + '…';
  }
  return text;
}

function formatPhone(value: any, format?: string): string {
  const digits = String(value).replace(/\D/g, '');
  if (!format) {
    // Default US format
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits[0] === '1') {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
  }
  return String(value);
}

function formatNumber(value: any, opts: Record<string, any>): string {
  const num = Number(value);
  if (isNaN(num)) return String(value);

  if (opts.compact) {
    return formatCompact(num);
  }

  const formatted = opts.decimals !== undefined
    ? num.toLocaleString(opts.locale, { minimumFractionDigits: opts.decimals, maximumFractionDigits: opts.decimals })
    : num.toLocaleString(opts.locale);

  return `${opts.prefix ?? ''}${formatted}${opts.suffix ?? ''}`;
}

function formatCompact(num: number): string {
  if (Math.abs(num) >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (Math.abs(num) >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(num) >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return String(num);
}

function formatCurrency(value: any, opts: Record<string, any>): string {
  const num = Number(value);
  if (isNaN(num)) return String(value);

  return num.toLocaleString(opts.locale ?? 'en-US', {
    style: 'currency',
    currency: opts.currency ?? 'USD',
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  });
}

function formatPercent(value: any, opts: Record<string, any>): string {
  let num = Number(value);
  if (isNaN(num)) return String(value);

  if (opts.multiply) {
    num *= 100;
  }

  return num.toFixed(opts.decimals ?? 1) + '%';
}

function formatDate(value: any, opts: Record<string, any>): string {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);

  const format = opts.format ?? 'medium';

  if (format === 'relative') {
    return formatRelativeDate(date);
  }

  if (format === 'iso') {
    return date.toISOString().split('T')[0];
  }

  const dateStyle = format === 'short' ? 'short' : format === 'long' ? 'long' : 'medium';

  return date.toLocaleDateString(opts.locale, {
    dateStyle,
    ...(opts.showTime ? { timeStyle: 'short' } : {}),
  } as any);
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatTime(value: any, opts: Record<string, any>): string {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);

  return date.toLocaleTimeString(opts.locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(opts.showSeconds ? { second: '2-digit' } : {}),
    hour12: opts.format !== '24h',
  });
}

function formatRating(value: any, opts: Record<string, any>): string {
  const num = Number(value);
  if (isNaN(num)) return '';

  const max = opts.max ?? 5;
  const filled = Math.round(num);
  const empty = max - filled;
  const icon = opts.icon ?? '★';
  const emptyIcon = '☆';

  let result = icon.repeat(filled) + emptyIcon.repeat(empty);

  if (opts.showValue) {
    result += ` (${num.toFixed(1)})`;
  }

  return result;
}

function formatPrice(value: any, record: Record<string, any>, opts: Record<string, any>): string {
  const currentPrice = formatCurrency(value, opts);

  if (opts.originalSource) {
    const originalValue = getFieldValue(record, opts.originalSource);
    if (originalValue && Number(originalValue) > Number(value)) {
      const originalPrice = formatCurrency(originalValue, opts);
      let result = `${currentPrice} ~~${originalPrice}~~`;

      if (opts.showDiscount) {
        const discount = Math.round((1 - Number(value) / Number(originalValue)) * 100);
        result += ` (-${discount}%)`;
      }

      return result;
    }
  }

  return currentPrice;
}

function formatStock(value: any, opts: Record<string, any>): string {
  const qty = Number(value);

  if (isNaN(qty) || qty <= 0) {
    return opts.outOfStockLabel ?? 'Out of Stock';
  }

  const lowThreshold = opts.lowStockThreshold ?? 5;
  if (qty <= lowThreshold) {
    const label = opts.lowStockLabel ?? 'Low Stock';
    return opts.showQuantity ? `${label} (${qty})` : label;
  }

  const label = opts.inStockLabel ?? 'In Stock';
  return opts.showQuantity ? `${label} (${qty})` : label;
}

function formatUser(value: any, record: Record<string, any>, opts: Record<string, any>): string {
  const name = opts.nameSource ? getFieldValue(record, opts.nameSource) : value;
  const secondary = opts.secondarySource ? getFieldValue(record, opts.secondarySource) : null;

  if (secondary) {
    return `${name} (${secondary})`;
  }
  return String(name ?? '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Structured Rendering (for UI components)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RenderedField {
  type: FieldType;
  value: any;
  formatted: string;
  label: string;
  options: Record<string, any>;
  // Type-specific properties
  link?: string;
  color?: string;
  icon?: string;
  actions?: Array<{ label: string; method: string; [key: string]: any }>;
}

/**
 * Render a field to structured data for UI components
 */
export function renderFieldToStructured(
  field: FieldDefinition,
  record: Record<string, any>,
): RenderedField {
  const value = getFieldValue(record, field.source);
  const formatted = renderFieldToText(field, record);
  const opts = field.options;

  const result: RenderedField = {
    type: field.type,
    value,
    formatted,
    label: opts.label ?? field.source,
    options: opts,
  };

  // Add link if specified
  if (opts.link) {
    result.link = interpolateTemplate(opts.link, record);
  }

  // Add color for badge
  if (field.type === 'badge' && opts.colors && value in opts.colors) {
    result.color = opts.colors[value];
  }

  // Add icon for badge
  if (field.type === 'badge' && opts.icons && value in opts.icons) {
    result.icon = opts.icons[value];
  }

  // Add actions
  if (field.type === 'actions' && field.actions) {
    result.actions = field.actions;
  }

  return result;
}
