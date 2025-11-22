/**
 * CLI Output Formatter
 *
 * Shared formatting utilities for beautiful CLI output.
 * Used by photon CLI, lumina, ncp, and other projects.
 *
 * Structural formats:
 * - primitive: Single values (string, number, boolean)
 * - table: Flat objects or arrays of flat objects (bordered tables)
 * - tree: Nested/hierarchical structures (indented)
 * - list: Arrays of primitives (bullet points)
 * - none: No data to display
 *
 * Content formats:
 * - json: Pretty-printed JSON
 * - markdown: Rendered markdown
 * - yaml: YAML content
 * - code / code:<lang>: Syntax highlighted code
 */

import { OutputFormat } from './types.js';
import { highlight } from 'cli-highlight';
import chalk from 'chalk';

/**
 * Format and output data with optional format hint
 */
export function formatOutput(data: any, hint?: OutputFormat): void {
  const format = hint || detectFormat(data);

  // Handle content formats (for string data)
  if (typeof data === 'string' && isContentFormat(format)) {
    renderContent(data, format);
    return;
  }

  // Handle structural formats
  formatDataWithHint(data, format as StructuralFormat);
}

type StructuralFormat = 'primitive' | 'table' | 'tree' | 'list' | 'none';

/**
 * Check if format is a content type format
 */
function isContentFormat(format: OutputFormat): boolean {
  return ['json', 'markdown', 'yaml', 'xml', 'html'].includes(format) ||
    format === 'code' ||
    format.startsWith('code:');
}

/**
 * Render content with appropriate formatting
 */
function renderContent(content: string, format: OutputFormat): void {
  switch (format) {
    case 'json':
      renderJson(content);
      break;
    case 'markdown':
      renderMarkdown(content);
      break;
    case 'yaml':
      renderYaml(content);
      break;
    case 'xml':
    case 'html':
      renderXml(content);
      break;
    default:
      if (format === 'code' || format.startsWith('code:')) {
        const lang = format === 'code' ? undefined : format.split(':')[1];
        renderCode(content, lang);
      } else {
        console.log(content);
      }
  }
}

/**
 * Render JSON with syntax highlighting
 */
function renderJson(content: string): void {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    const formatted = JSON.stringify(parsed, null, 2);
    console.log(highlight(formatted, { language: 'json', ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

/**
 * Render markdown with colored terminal output
 */
function renderMarkdown(content: string): void {
  // Process markdown with colors for terminal
  let rendered = content;

  // Code blocks - highlight with language if specified
  rendered = rendered.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const trimmedCode = code.trim();
    if (lang && lang !== '') {
      try {
        return '\n' + highlight(trimmedCode, { language: lang, ignoreIllegals: true }) + '\n';
      } catch {
        return '\n' + chalk.gray(trimmedCode) + '\n';
      }
    }
    return '\n' + chalk.gray(trimmedCode) + '\n';
  });

  // Headers with colors
  rendered = rendered
    .replace(/^### (.+)$/gm, (_m, h) => '\n' + chalk.cyan('   ' + h) + '\n   ' + chalk.dim('-'.repeat(20)))
    .replace(/^## (.+)$/gm, (_m, h) => '\n' + chalk.yellow.bold('  ' + h) + '\n  ' + chalk.dim('='.repeat(30)))
    .replace(/^# (.+)$/gm, (_m, h) => '\n' + chalk.magenta.bold(h) + '\n' + chalk.dim('='.repeat(40)));

  // Bold
  rendered = rendered.replace(/\*\*(.+?)\*\*/g, (_m, text) => chalk.bold(text));

  // Italic
  rendered = rendered.replace(/\*(.+?)\*/g, (_m, text) => chalk.italic(text));
  rendered = rendered.replace(/_(.+?)_/g, (_m, text) => chalk.italic(text));

  // Inline code
  rendered = rendered.replace(/`([^`]+)`/g, (_m, code) => chalk.cyan(code));

  // Lists
  rendered = rendered.replace(/^- /gm, chalk.dim('  • '));
  rendered = rendered.replace(/^(\d+)\. /gm, (_m, num) => chalk.dim(`  ${num}. `));

  // Links
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    chalk.blue.underline(text) + chalk.dim(` (${url})`)
  );

  // Blockquotes
  rendered = rendered.replace(/^> (.+)$/gm, (_m, quote) => chalk.dim('│ ') + chalk.italic(quote));

  // Horizontal rules
  rendered = rendered.replace(/^---+$/gm, chalk.dim('─'.repeat(40)));

  console.log(rendered);
}

/**
 * Render YAML with syntax highlighting
 */
function renderYaml(content: string): void {
  try {
    console.log(highlight(content, { language: 'yaml', ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

/**
 * Render XML/HTML with syntax highlighting
 */
function renderXml(content: string): void {
  try {
    console.log(highlight(content, { language: 'xml', ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

/**
 * Render code with syntax highlighting
 */
function renderCode(content: string, lang?: string): void {
  try {
    if (lang) {
      console.log(highlight(content, { language: lang, ignoreIllegals: true }));
    } else {
      // Auto-detect language
      console.log(highlight(content, { ignoreIllegals: true }));
    }
  } catch {
    console.log(content);
  }
}

/**
 * Format data using specified or detected format
 */
function formatDataWithHint(data: any, format: StructuralFormat): void {
  switch (format) {
    case 'primitive':
      renderPrimitive(data);
      break;
    case 'list':
      renderList(Array.isArray(data) ? data : [data]);
      break;
    case 'table':
      renderTable(data);
      break;
    case 'tree':
      renderTree(data);
      break;
    case 'none':
      renderNone();
      break;
  }
}

/**
 * Detect format type from data structure
 */
export function detectFormat(data: any): OutputFormat {
  // null/undefined = none
  if (data === null || data === undefined) {
    return 'none';
  }

  // Primitive types
  if (
    typeof data === 'string' ||
    typeof data === 'number' ||
    typeof data === 'boolean'
  ) {
    return 'primitive';
  }

  // Array handling
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return 'list';
    }

    // Check first element to determine list vs table
    const firstItem = data[0];

    // Array of primitives = list
    if (typeof firstItem !== 'object' || firstItem === null) {
      return 'list';
    }

    // Array of flat objects = table
    if (isFlatObject(firstItem)) {
      return 'table';
    }

    // Array of nested objects = tree
    return 'tree';
  }

  // Single object
  if (typeof data === 'object') {
    // Flat object = table
    if (isFlatObject(data)) {
      return 'table';
    }

    // Nested object = tree
    return 'tree';
  }

  // Default fallback
  return 'none';
}

/**
 * Check if an object is flat (no nested objects or arrays)
 */
function isFlatObject(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      return false;
    }
  }

  return true;
}

/**
 * Render primitive value
 */
export function renderPrimitive(value: any): void {
  if (typeof value === 'boolean') {
    console.log(value ? 'yes' : 'no');
  } else {
    console.log(value);
  }
}

/**
 * Render list (array of primitives)
 */
export function renderList(data: any[]): void {
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }

  data.forEach(item => {
    console.log(`  * ${item}`);
  });
}

/**
 * Render table (flat object or array of flat objects)
 */
export function renderTable(data: any): void {
  // Single flat object - show as bordered key-value table
  if (!Array.isArray(data)) {
    const entries = Object.entries(data).filter(
      ([key, value]) => !(key === 'returnValue' && value === true)
    );

    if (entries.length === 0) {
      console.log('(empty)');
      return;
    }

    const maxKeyLength = Math.max(...entries.map(([k]) => formatKey(k).length));
    const maxValueLength = Math.max(
      ...entries.map(([_, v]) => String(formatValue(v)).length)
    );

    // Top border
    console.log(
      `┌─${'─'.repeat(maxKeyLength)}─┬─${'─'.repeat(maxValueLength)}─┐`
    );

    // Rows
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const formattedKey = formatKey(key);
      const formattedValue = String(formatValue(value));
      const keyPadding = ' '.repeat(maxKeyLength - formattedKey.length);
      const valuePadding = ' '.repeat(maxValueLength - formattedValue.length);

      console.log(
        `| ${formattedKey}${keyPadding} | ${formattedValue}${valuePadding} |`
      );

      // Add separator between rows (not after last row)
      if (i < entries.length - 1) {
        console.log(
          `├─${'─'.repeat(maxKeyLength)}─┼─${'─'.repeat(maxValueLength)}─┤`
        );
      }
    }

    // Bottom border
    console.log(
      `└─${'─'.repeat(maxKeyLength)}─┴─${'─'.repeat(maxValueLength)}─┘`
    );
    return;
  }

  // Array of flat objects - show as bordered table
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }

  // Get all unique keys across all objects
  const allKeys = Array.from(
    new Set(data.flatMap(obj => Object.keys(obj)))
  ).filter(k => k !== 'returnValue');

  if (allKeys.length === 0) {
    console.log('(no data)');
    return;
  }

  // Calculate column widths
  const columnWidths = new Map<string, number>();
  for (const key of allKeys) {
    const headerWidth = formatKey(key).length;
    const maxValueWidth = Math.max(
      ...data.map(obj => String(formatValue(obj[key] ?? '')).length)
    );
    columnWidths.set(key, Math.max(headerWidth, maxValueWidth));
  }

  // Top border
  const topBorderParts = allKeys.map(
    key => '─'.repeat(columnWidths.get(key)! + 2)
  );
  console.log('┌' + topBorderParts.join('┬') + '┐');

  // Header
  const headerParts = allKeys.map(key => {
    const formattedKey = formatKey(key);
    const width = columnWidths.get(key)!;
    return ' ' + formattedKey.padEnd(width) + ' ';
  });
  console.log('│' + headerParts.join('│') + '│');

  // Header separator
  const separatorParts = allKeys.map(
    key => '─'.repeat(columnWidths.get(key)! + 2)
  );
  console.log('├' + separatorParts.join('┼') + '┤');

  // Rows
  for (const row of data) {
    const rowParts = allKeys.map(key => {
      const value = formatValue(row[key] ?? '');
      const width = columnWidths.get(key)!;
      return ' ' + String(value).padEnd(width) + ' ';
    });
    console.log('│' + rowParts.join('│') + '│');
  }

  // Bottom border
  const bottomBorderParts = allKeys.map(
    key => '─'.repeat(columnWidths.get(key)! + 2)
  );
  console.log('└' + bottomBorderParts.join('┴') + '┘');
}

/**
 * Render tree (nested/hierarchical structure)
 */
export function renderTree(data: any, indent: string = ''): void {
  // Array of objects
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(`${indent}(empty)`);
      return;
    }

    data.forEach((item, index) => {
      if (typeof item === 'object' && item !== null) {
        console.log(`${indent}[${index}]`);
        renderTree(item, indent + '  ');
      } else {
        console.log(`${indent}* ${item}`);
      }
    });
    return;
  }

  // Object
  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data).filter(
      ([key, value]) => !(key === 'returnValue' && value === true)
    );

    for (const [key, value] of entries) {
      const formattedKey = formatKey(key);

      if (value === null || value === undefined) {
        console.log(`${indent}${formattedKey}: (none)`);
      } else if (Array.isArray(value)) {
        console.log(`${indent}${formattedKey}:`);
        renderTree(value, indent + '  ');
      } else if (typeof value === 'object') {
        console.log(`${indent}${formattedKey}:`);
        renderTree(value, indent + '  ');
      } else {
        console.log(`${indent}${formattedKey}: ${formatValue(value)}`);
      }
    }
    return;
  }

  // Primitive (shouldn't happen but handle it)
  console.log(`${indent}${formatValue(data)}`);
}

/**
 * Render none format (operation with no data)
 */
export function renderNone(): void {
  console.log('Done');
}

/**
 * Format a key for display (camelCase to Title Case)
 */
export function formatKey(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format a value for display
 */
export function formatValue(value: any): string | number | boolean {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return value;
}

/**
 * Status indicators for tables (ASCII only for proper alignment)
 */
export const STATUS = {
  OK: 'ok',
  UPDATE: 'update',
  WARN: 'warn',
  ERROR: '!',
  OFF: 'off',
  UNKNOWN: '?',
} as const;

/**
 * Convert output format to MIME type (for MCP responses)
 */
export function formatToMimeType(format: OutputFormat): string | undefined {
  const mimeTypes: Record<string, string> = {
    json: 'application/json',
    markdown: 'text/markdown',
    yaml: 'text/yaml',
    xml: 'application/xml',
    html: 'text/html',
  };

  if (mimeTypes[format]) {
    return mimeTypes[format];
  }

  if (format === 'code') {
    return 'text/plain';
  }

  if (format.startsWith('code:')) {
    const lang = format.split(':')[1];
    return `text/x-${lang}`;
  }

  return undefined;
}

/**
 * Print a success message
 */
export function printSuccess(message: string): void {
  console.error(`✓ ${message}`);
}

/**
 * Print an error message
 */
export function printError(message: string): void {
  console.error(`✗ ${message}`);
}

/**
 * Print an info message
 */
export function printInfo(message: string): void {
  console.error(`${message}`);
}

/**
 * Print a warning message
 */
export function printWarning(message: string): void {
  console.error(`! ${message}`);
}

/**
 * Print a section header
 */
export function printHeader(title: string): void {
  console.error(`\n${title}`);
  console.error('─'.repeat(title.length));
}
