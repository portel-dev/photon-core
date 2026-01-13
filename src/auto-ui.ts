/**
 * Auto-UI System
 *
 * Automatically generates UI components based on data introspection and JSDoc hints.
 * This allows .photon.ts files to return raw data without worrying about presentation.
 *
 * Features:
 * - Automatic format detection (primitive, list, table, tree)
 * - JSDoc hint support (@format, @ui-component, @ui-layout)
 * - Extensible component registry
 * - Support for CLI, MCP, and Web UIs
 */

import { OutputFormat } from './types.js';
import { detectFormat } from '@portel/cli';

/**
 * UI Component types that can be auto-generated
 */
export type UIComponentType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'list'
  | 'table'
  | 'tree'
  | 'card'
  | 'chart'
  | 'progress'
  | 'code'
  | 'markdown'
  | 'json'
  | 'form'
  | 'tabs'
  | 'accordion';

/**
 * UI Layout types
 */
export type UILayout = 'single' | 'grid' | 'flex' | 'stack' | 'tabs';

/**
 * UI Component descriptor
 */
export interface UIComponent {
  type: UIComponentType;
  data: any;
  layout?: UILayout;
  metadata?: {
    title?: string;
    description?: string;
    format?: OutputFormat;
    interactive?: boolean;
    collapsible?: boolean;
    searchable?: boolean;
  };
}

/**
 * Auto-UI configuration from JSDoc hints
 */
export interface AutoUIConfig {
  component?: UIComponentType;
  layout?: UILayout;
  format?: OutputFormat;
  title?: string;
  description?: string;
  interactive?: boolean;
}

/**
 * Extract Auto-UI hints from JSDoc
 *
 * Supports:
 * - @format <type> - Data format
 * - @ui-component <type> - Explicit UI component
 * - @ui-layout <layout> - Layout style
 * - @ui-title <title> - Display title
 * - @ui-interactive - Enable interactivity
 */
export function extractUIHints(jsdoc?: string): AutoUIConfig {
  if (!jsdoc) return {};

  const config: AutoUIConfig = {};

  // Extract @format
  const formatMatch = jsdoc.match(/@format\s+([\w:-]+)/);
  if (formatMatch) {
    config.format = formatMatch[1] as OutputFormat;
  }

  // Extract @ui-component
  const componentMatch = jsdoc.match(/@ui-component\s+(\w+)/);
  if (componentMatch) {
    config.component = componentMatch[1] as UIComponentType;
  }

  // Extract @ui-layout
  const layoutMatch = jsdoc.match(/@ui-layout\s+(\w+)/);
  if (layoutMatch) {
    config.layout = layoutMatch[1] as UILayout;
  }

  // Extract @ui-title
  const titleMatch = jsdoc.match(/@ui-title\s+(.+?)(?:\n|$)/);
  if (titleMatch) {
    config.title = titleMatch[1].trim();
  }

  // Check for @ui-interactive
  if (jsdoc.includes('@ui-interactive')) {
    config.interactive = true;
  }

  return config;
}

/**
 * Generate UI component from data and hints
 */
export function generateUIComponent(
  data: any,
  config: AutoUIConfig = {}
): UIComponent {
  // Use explicit component type if provided
  if (config.component) {
    return {
      type: config.component,
      data,
      layout: config.layout,
      metadata: {
        format: config.format,
        title: config.title,
        interactive: config.interactive,
      },
    };
  }

  // Auto-detect component from data structure
  const format = config.format || detectFormat(data);
  const component = formatToComponent(format, data);

  return {
    type: component,
    data,
    layout: config.layout || inferLayout(component, data),
    metadata: {
      format,
      title: config.title,
      interactive: config.interactive,
    },
  };
}

/**
 * Map output format to UI component type
 */
function formatToComponent(format: OutputFormat, data: any): UIComponentType {
  switch (format) {
    case 'primitive':
      if (typeof data === 'boolean') return 'boolean';
      if (typeof data === 'number') return 'number';
      return 'text';

    case 'list':
      return 'list';

    case 'table':
      return 'table';

    case 'tree':
      return 'tree';

    case 'markdown':
      return 'markdown';

    case 'json':
      return 'json';

    case 'code':
      return 'code';

    case 'none':
      return 'text';

    default:
      // Handle code:lang format
      if (format.startsWith('code:')) {
        return 'code';
      }
      return 'text';
  }
}

/**
 * Infer optimal layout from component and data
 */
function inferLayout(component: UIComponentType, data: any): UILayout {
  switch (component) {
    case 'table':
      // Large tables work better in grid
      if (Array.isArray(data) && data.length > 10) {
        return 'grid';
      }
      return 'single';

    case 'tree':
      // Trees need vertical space
      return 'stack';

    case 'card':
      // Multiple cards use grid
      if (Array.isArray(data)) {
        return 'grid';
      }
      return 'single';

    case 'tabs':
      return 'tabs';

    default:
      return 'single';
  }
}

/**
 * Detect if data should be rendered as cards
 * (Objects with multiple rich properties)
 */
export function shouldUseCards(data: any): boolean {
  if (!Array.isArray(data) || data.length === 0) {
    return false;
  }

  const firstItem = data[0];
  if (typeof firstItem !== 'object' || firstItem === null) {
    return false;
  }

  // If objects have more than 5 properties or contain nested data, use cards
  const keys = Object.keys(firstItem);
  if (keys.length > 5) {
    return true;
  }

  // Check for nested data
  for (const value of Object.values(firstItem)) {
    if (typeof value === 'object' && value !== null) {
      return true;
    }
  }

  return false;
}

/**
 * Detect if data should be rendered as chart
 * (Numeric data with labels)
 */
export function shouldUseChart(data: any): boolean {
  if (!Array.isArray(data) || data.length === 0) {
    return false;
  }

  // Check if all items are objects with numeric values
  return data.every((item) => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const values = Object.values(item);
    return values.some((v) => typeof v === 'number');
  });
}

/**
 * UI Component renderer interface
 * (To be implemented by CLI, MCP, and Web UI)
 */
export interface UIRenderer {
  renderText(value: string): void;
  renderNumber(value: number): void;
  renderBoolean(value: boolean): void;
  renderList(items: any[]): void;
  renderTable(data: any): void;
  renderTree(data: any): void;
  renderCard(data: any): void;
  renderChart(data: any): void;
  renderProgress(value: number, total?: number): void;
  renderCode(code: string, language?: string): void;
  renderMarkdown(content: string): void;
  renderJson(data: any): void;
  renderForm(fields: any): void;
  renderTabs(tabs: any): void;
  renderAccordion(items: any): void;
}

/**
 * Render UI component using the appropriate renderer
 */
export function renderUIComponent(
  component: UIComponent,
  renderer: UIRenderer
): void {
  const { type, data, metadata } = component;

  switch (type) {
    case 'text':
      renderer.renderText(String(data));
      break;

    case 'number':
      renderer.renderNumber(Number(data));
      break;

    case 'boolean':
      renderer.renderBoolean(Boolean(data));
      break;

    case 'list':
      renderer.renderList(Array.isArray(data) ? data : [data]);
      break;

    case 'table':
      renderer.renderTable(data);
      break;

    case 'tree':
      renderer.renderTree(data);
      break;

    case 'card':
      renderer.renderCard(data);
      break;

    case 'chart':
      renderer.renderChart(data);
      break;

    case 'progress':
      renderer.renderProgress(data.value, data.total);
      break;

    case 'code':
      const lang = metadata?.format?.startsWith('code:')
        ? metadata.format.split(':')[1]
        : undefined;
      renderer.renderCode(String(data), lang);
      break;

    case 'markdown':
      renderer.renderMarkdown(String(data));
      break;

    case 'json':
      renderer.renderJson(data);
      break;

    case 'form':
      renderer.renderForm(data);
      break;

    case 'tabs':
      renderer.renderTabs(data);
      break;

    case 'accordion':
      renderer.renderAccordion(data);
      break;
  }
}

/**
 * Enhanced component suggestions based on data patterns
 */
export function suggestComponents(data: any): UIComponentType[] {
  const suggestions: UIComponentType[] = [];

  // Always suggest the default component
  const format = detectFormat(data);
  suggestions.push(formatToComponent(format, data));

  // Suggest alternatives based on data
  if (Array.isArray(data) && data.length > 0) {
    const firstItem = data[0];

    if (typeof firstItem === 'object' && firstItem !== null) {
      // Could be table, tree, or cards
      suggestions.push('table', 'tree');

      if (shouldUseCards(data)) {
        suggestions.push('card');
      }

      if (shouldUseChart(data)) {
        suggestions.push('chart');
      }
    }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    // Could be card, tree, or form
    suggestions.push('card', 'tree');

    // If has many fields, suggest form
    if (Object.keys(data).length > 3) {
      suggestions.push('form');
    }
  }

  // Remove duplicates
  return Array.from(new Set(suggestions));
}
