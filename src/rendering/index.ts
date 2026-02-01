/**
 * Smart Rendering Module
 *
 * iOS-inspired, React Admin-influenced rendering system that:
 * - Convention over configuration - works beautifully with zero annotations
 * - Smart field detection - guesses meaning from field names and types
 * - Progressive customization - JSDoc annotations for fine-tuning
 * - List-centric paradigm - everything renders as configurable list items
 *
 * Design System based on:
 * - Material Design 3 tokens: https://m3.material.io/foundations/design-tokens
 * - Apple HIG (8pt grid): https://developer.apple.com/design/human-interface-guidelines/layout
 */

export * from './field-analyzer.js';
export * from './layout-selector.js';
export * from './components.js';
export * from './field-renderers.js';
export * from './template-engine.js';
export * from '../design-system/index.js';

import { analyzeFields, type FieldMapping } from './field-analyzer.js';
import { selectLayout, type LayoutType } from './layout-selector.js';
import { generateFieldAnalyzerJS } from './field-analyzer.js';
import { generateLayoutSelectorJS } from './layout-selector.js';
import { generateComponentsJS, generateComponentCSS } from './components.js';
import { generateFieldRenderersJS, generateFieldRendererCSS } from './field-renderers.js';
import { generateTemplateEngineJS, generateTemplateEngineCSS } from './template-engine.js';
import { generateDesignSystemCSS, generateDesignSystemJS } from '../design-system/index.js';

/**
 * Generate all JavaScript code for embedding in HTML
 */
export function generateSmartRenderingJS(): string {
  return [
    '// ==========================================================================',
    '// Photon Design System + Smart Rendering',
    '// Based on Material Design 3 + Apple HIG',
    '// ==========================================================================',
    '',
    generateDesignSystemJS(),
    '',
    generateFieldAnalyzerJS(),
    '',
    generateLayoutSelectorJS(),
    '',
    generateFieldRenderersJS(),
    '',
    generateComponentsJS(),
    '',
    generateTemplateEngineJS(),
  ].join('\n');
}

/**
 * Generate all CSS for embedding in HTML
 */
export function generateSmartRenderingCSS(): string {
  return [
    generateDesignSystemCSS(),
    generateComponentCSS(),
    generateFieldRendererCSS(),
    generateTemplateEngineCSS(),
  ].join('\n');
}

// ===== Smart Rendering Utilities =====
// Shared by NCP, Lumina, and other runtimes

/**
 * Check if data would benefit from rich HTML rendering
 * (arrays of objects, nested structures, etc.)
 */
export function shouldUseRichRendering(data: any): boolean {
  if (!data) return false;

  // Arrays of objects benefit from list/grid rendering
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    return true;
  }

  // Nested objects benefit from tree/card rendering
  if (typeof data === 'object' && !Array.isArray(data)) {
    const values = Object.values(data);
    if (values.some(v => typeof v === 'object' && v !== null)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate an HTML content block for MCP tool responses.
 * Analyses data, selects layout, and embeds CSS/JS for rich rendering.
 */
export function generateHTMLContent(
  data: any,
  options: {
    title?: string;
    format?: LayoutType;
    standalone?: boolean;
    theme?: 'light' | 'dark';
  } = {}
): string {
  const { title, format, standalone = false, theme } = options;

  let fieldMapping: FieldMapping | undefined;
  if (data && typeof data === 'object') {
    fieldMapping = analyzeFields(data);
  }

  const layout = format || selectLayout(data);

  const renderScript = `
    <script>
      ${generateSmartRenderingJS()}

      document.addEventListener('DOMContentLoaded', function() {
        const container = document.getElementById('smart-render-container');
        const data = ${JSON.stringify(data)};
        const layout = '${layout}';
        const fieldMapping = ${JSON.stringify(fieldMapping || {})};

        if (window.TemplateEngine && window.TemplateEngine.render) {
          container.innerHTML = window.TemplateEngine.render(data, {
            layout,
            fieldMapping,
            title: ${JSON.stringify(title || '')}
          });
        } else {
          container.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        }
      });
    </script>
  `;

  const themeVars = theme ? `
    :root {
      --bg-primary: ${theme === 'dark' ? '#0a0a0a' : '#ffffff'};
      --text-primary: ${theme === 'dark' ? '#f5f5f5' : '#1a1a1a'};
    }
  ` : '';

  const styles = `
    <style>
      ${generateSmartRenderingCSS()}
      ${themeVars}
    </style>
  `;

  const content = `
    ${styles}
    <div id="smart-render-container" class="smart-render">
      ${title ? `<h2 class="smart-render-title">${title}</h2>` : ''}
      <div class="loading">Loading...</div>
    </div>
    ${renderScript}
  `;

  if (standalone) {
    return `<!DOCTYPE html>
<html${theme ? ` data-theme="${theme}"` : ''}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Result'}</title>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  return content;
}

/**
 * Create an MCP content block with HTML type
 */
export function createHTMLContentBlock(
  data: any,
  options: {
    title?: string;
    format?: LayoutType;
  } = {}
): { type: 'text'; text: string; mimeType?: string } {
  return {
    type: 'text',
    text: generateHTMLContent(data, { ...options, standalone: false }),
    mimeType: 'text/html'
  };
}

/**
 * Generate an HTML fragment for embedding, returning separate html/css/js parts
 */
export function generateSmartRenderFragment(
  data: any,
  options: { format?: LayoutType } = {}
): { html: string; css: string; js: string } {
  const { format } = options;

  let fieldMapping: FieldMapping | undefined;
  if (data && typeof data === 'object') {
    fieldMapping = analyzeFields(data);
  }

  const layout = format || selectLayout(data);

  const html = `<div id="smart-render-${Date.now()}" class="smart-render-container"></div>`;
  const css = generateSmartRenderingCSS();
  const js = `
    ${generateSmartRenderingJS()}
    (function() {
      const containers = document.querySelectorAll('.smart-render-container');
      const container = containers[containers.length - 1];
      const data = ${JSON.stringify(data)};
      if (window.TemplateEngine && window.TemplateEngine.render) {
        container.innerHTML = window.TemplateEngine.render(data, {
          layout: '${layout}',
          fieldMapping: ${JSON.stringify(fieldMapping || {})}
        });
      }
    })();
  `;

  return { html, css, js };
}

/**
 * Generate MCP content blocks with smart rendering.
 * Returns JSON text block + optional HTML block for rich clients.
 */
export function generateMCPSmartContent(
  data: any,
  options: { includeHtml?: boolean; format?: LayoutType } = {}
): Array<{ type: string; text?: string; mimeType?: string }> {
  const { includeHtml = true, format } = options;

  const content: Array<{ type: string; text?: string; mimeType?: string }> = [];

  // Always include JSON for compatibility
  content.push({
    type: 'text',
    text: JSON.stringify(data, null, 2)
  });

  // Optionally include HTML for rich rendering
  if (includeHtml && shouldUseRichRendering(data)) {
    const { html, css, js } = generateSmartRenderFragment(data, { format });
    content.push({
      type: 'text',
      text: `<style>${css}</style>${html}<script>${js}</script>`,
      mimeType: 'text/html'
    });
  }

  return content;
}
