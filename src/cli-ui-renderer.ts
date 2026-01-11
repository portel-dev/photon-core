/**
 * CLI UI Renderer
 *
 * Implements UIRenderer interface for terminal output.
 * Uses existing cli-formatter utilities.
 */

import {
  renderPrimitive,
  renderList,
  renderTable,
  renderTree,
  formatKey,
  formatValue,
} from './cli-formatter.js';
import { UIRenderer } from './auto-ui.js';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';

export class CLIUIRenderer implements UIRenderer {
  renderText(value: string): void {
    console.log(value);
  }

  renderNumber(value: number): void {
    console.log(value);
  }

  renderBoolean(value: boolean): void {
    console.log(value ? 'yes' : 'no');
  }

  renderList(items: any[]): void {
    renderList(items);
  }

  renderTable(data: any): void {
    renderTable(data);
  }

  renderTree(data: any): void {
    renderTree(data);
  }

  renderCard(data: any): void {
    if (Array.isArray(data)) {
      // Multiple cards
      data.forEach((item, index) => {
        if (index > 0) console.log(''); // Spacing between cards
        this.renderSingleCard(item);
      });
    } else {
      // Single card
      this.renderSingleCard(data);
    }
  }

  private renderSingleCard(data: any): void {
    if (typeof data !== 'object' || data === null) {
      console.log(data);
      return;
    }

    const entries = Object.entries(data);
    const maxKeyLength = Math.max(...entries.map(([k]) => formatKey(k).length));

    // Card border
    const width = Math.min(maxKeyLength + 40, 80);
    console.log('┌' + '─'.repeat(width - 2) + '┐');

    // Card content
    entries.forEach(([key, value]) => {
      const formattedKey = chalk.bold(formatKey(key));
      const formattedValue = this.formatCardValue(value);

      if (typeof value === 'object' && value !== null) {
        console.log(`│ ${formattedKey}:`);
        const lines = formattedValue.split('\n');
        lines.forEach((line) => {
          console.log(`│   ${line}`.padEnd(width - 1) + '│');
        });
      } else {
        const line = `│ ${formattedKey}: ${formattedValue}`;
        console.log(line.padEnd(width - 1) + '│');
      }
    });

    // Card border
    console.log('└' + '─'.repeat(width - 2) + '┘');
  }

  private formatCardValue(value: any): string {
    if (Array.isArray(value)) {
      return value.map((v) => String(formatValue(v))).join(', ');
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(formatValue(value));
  }

  renderChart(data: any): void {
    if (!Array.isArray(data)) {
      console.log('Chart data must be an array');
      return;
    }

    // Simple ASCII bar chart
    console.log(chalk.bold('\nChart:'));

    data.forEach((item) => {
      if (typeof item !== 'object' || item === null) {
        return;
      }

      const entries = Object.entries(item);
      const label = String(entries[0]?.[1] ?? 'Unknown');
      const value = Number(entries[1]?.[1] ?? 0);
      const maxBarLength = 50;
      const barLength = Math.min(Math.max(0, value), maxBarLength);
      const bar = '█'.repeat(barLength);

      console.log(`${label.padEnd(20)} ${chalk.cyan(bar)} ${value}`);
    });

    console.log('');
  }

  renderProgress(value: number, total?: number): void {
    const percentage = total ? Math.round((value / total) * 100) : value;
    const barLength = 40;
    const filled = Math.round((percentage / 100) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

    console.log(`[${chalk.cyan(bar)}] ${percentage}%`);
  }

  renderCode(code: string, language?: string): void {
    try {
      if (language) {
        console.log(highlight(code, { language, ignoreIllegals: true }));
      } else {
        console.log(highlight(code, { ignoreIllegals: true }));
      }
    } catch {
      console.log(code);
    }
  }

  renderMarkdown(content: string): void {
    // Use existing markdown renderer from cli-formatter
    // Process markdown with colors for terminal
    let rendered = content;

    // Code blocks
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

    // Links
    rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
      chalk.blue.underline(text) + chalk.dim(` (${url})`)
    );

    // Headers
    rendered = rendered
      .replace(/^### (.+)$/gm, (_m, h) => '\n' + chalk.cyan('   ' + h) + '\n   ' + chalk.dim('-'.repeat(20)))
      .replace(/^## (.+)$/gm, (_m, h) => '\n' + chalk.yellow.bold('  ' + h) + '\n  ' + chalk.dim('='.repeat(30)))
      .replace(/^# (.+)$/gm, (_m, h) => '\n' + chalk.magenta.bold(h) + '\n' + chalk.dim('='.repeat(40)));

    // Blockquotes
    rendered = rendered.replace(/^> (.+)$/gm, (_m, quote) => chalk.dim('│ ') + chalk.italic(quote));

    // Horizontal rules
    rendered = rendered.replace(/^---+$/gm, chalk.dim('─'.repeat(40)));

    // Lists
    rendered = rendered.replace(/^- /gm, chalk.dim('  • '));
    rendered = rendered.replace(/^(\d+)\. /gm, (_m, num) => chalk.dim(`  ${num}. `));

    // Bold
    rendered = rendered.replace(/\*\*(.+?)\*\*/g, (_m, text) => chalk.bold(text));

    // Italic
    rendered = rendered.replace(/\*(.+?)\*/g, (_m, text) => chalk.italic(text));
    rendered = rendered.replace(/_(.+?)_/g, (_m, text) => chalk.italic(text));

    // Inline code
    rendered = rendered.replace(/`([^`]+)`/g, (_m, code) => chalk.cyan(code));

    console.log(rendered);
  }

  renderJson(data: any): void {
    try {
      const formatted = JSON.stringify(data, null, 2);
      console.log(highlight(formatted, { language: 'json', ignoreIllegals: true }));
    } catch {
      console.log(data);
    }
  }

  renderForm(fields: any): void {
    console.log(chalk.bold('\nForm Fields:'));
    renderTable(fields);
  }

  renderTabs(tabs: any): void {
    if (!Array.isArray(tabs) && typeof tabs === 'object') {
      // Object with tab data
      Object.entries(tabs).forEach(([title, content], index) => {
        if (index > 0) console.log('\n' + chalk.dim('─'.repeat(60)));
        console.log(chalk.bold.cyan(`\n▸ ${title}`));
        console.log('');
        
        if (typeof content === 'object') {
          renderTree(content, '  ');
        } else {
          console.log('  ' + content);
        }
      });
    } else {
      console.log('Tabs data should be an object with tab titles as keys');
    }
  }

  renderAccordion(items: any): void {
    if (!Array.isArray(items)) {
      console.log('Accordion data must be an array');
      return;
    }

    items.forEach((item, index) => {
      if (index > 0) console.log('');

      if (typeof item === 'object' && item !== null) {
        const title = item.title || item.name || `Item ${index + 1}`;
        const content = item.content || item.data || item;

        console.log(chalk.bold(`▸ ${title}`));
        if (typeof content === 'object') {
          renderTree(content, '  ');
        } else {
          console.log('  ' + content);
        }
      } else {
        console.log(`▸ ${item}`);
      }
    });
  }
}

/**
 * Default CLI renderer instance
 */
export const cliRenderer = new CLIUIRenderer();
