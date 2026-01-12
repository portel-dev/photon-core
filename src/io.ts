/**
 * IO Helper API
 *
 * Clean, ergonomic API for yielding emit and ask messages in Photon generators.
 *
 * @example
 * ```typescript
 * import { io } from '@portel/photon-core';
 *
 * async *myTool() {
 *   yield io.emit.status('Starting...');
 *   yield io.emit.progress(0.5, 'Halfway there');
 *
 *   const name = yield io.ask.text('What is your name?');
 *   const confirmed = yield io.ask.confirm('Continue?');
 *
 *   return { name, confirmed };
 * }
 * ```
 *
 * @module io
 */

import type {
  EmitStatus,
  EmitProgress,
  EmitStream,
  EmitLog,
  EmitToast,
  EmitThinking,
  EmitArtifact,
  EmitUI,
  AskText,
  AskPassword,
  AskConfirm,
  AskSelect,
  AskNumber,
  AskFile,
  AskDate,
  AskForm,
  AskUrl,
  FormSchema,
} from './generator.js';

// ══════════════════════════════════════════════════════════════════════════════
// EMIT HELPERS - Output to user (fire and forget)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Emit a status message
 *
 * @example
 * yield io.emit.status('Connecting...');
 * yield io.emit.status('Done!', 'success');
 */
function status(message: string, type?: EmitStatus['type']): EmitStatus {
  return { emit: 'status', message, ...(type && { type }) };
}

/**
 * Emit a progress update
 *
 * @example
 * yield io.emit.progress(0.5); // 50%
 * yield io.emit.progress(0.75, 'Almost done');
 */
function progress(value: number, message?: string, meta?: Record<string, any>): EmitProgress {
  return {
    emit: 'progress',
    value,
    ...(message && { message }),
    ...(meta && { meta }),
  };
}

/**
 * Emit a stream chunk
 *
 * @example
 * for await (const chunk of stream) {
 *   yield io.emit.stream(chunk);
 * }
 * yield io.emit.stream('', true); // final
 */
function stream(data: any, final?: boolean, contentType?: string): EmitStream {
  return {
    emit: 'stream',
    data,
    ...(final && { final }),
    ...(contentType && { contentType }),
  };
}

/**
 * Emit a log message (for debugging)
 *
 * @example
 * yield io.emit.log('Processing item', 'debug', { id: 123 });
 */
function log(message: string, level?: EmitLog['level'], data?: Record<string, any>): EmitLog {
  return {
    emit: 'log',
    message,
    ...(level && { level }),
    ...(data && { data }),
  };
}

/**
 * Emit a toast notification
 *
 * @example
 * yield io.emit.toast('Saved!', 'success');
 * yield io.emit.toast('Error!', 'error', 5000);
 */
function toast(message: string, type?: EmitToast['type'], duration?: number): EmitToast {
  return {
    emit: 'toast',
    message,
    ...(type && { type }),
    ...(duration !== undefined && { duration }),
  };
}

/**
 * Emit thinking indicator
 *
 * @example
 * yield io.emit.thinking(true);
 * // ... heavy computation
 * yield io.emit.thinking(false);
 */
function thinking(active: boolean): EmitThinking {
  return { emit: 'thinking', active };
}

/**
 * Emit an artifact (image, code, document)
 *
 * @example
 * yield io.emit.artifact('image', { url: 'https://...', title: 'Chart' });
 * yield io.emit.artifact('code', { content: 'const x = 1;', language: 'typescript' });
 */
function artifact(
  type: EmitArtifact['type'],
  options: Omit<EmitArtifact, 'emit' | 'type'>
): EmitArtifact {
  return { emit: 'artifact', type, ...options };
}

/**
 * Emit a UI component
 *
 * @example
 * yield io.emit.ui('preferences', { currentTheme: 'dark' });
 * yield io.emit.ui(null, { inline: '<div>Hello</div>' });
 */
function ui(id: string | null, options?: Omit<EmitUI, 'emit' | 'id'>): EmitUI {
  return { emit: 'ui', ...(id && { id }), ...options };
}

// ══════════════════════════════════════════════════════════════════════════════
// ASK HELPERS - Input from user (blocks until response)
// ══════════════════════════════════════════════════════════════════════════════

/** Options for text input */
interface TextOptions {
  id?: string;
  default?: string;
  placeholder?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}

/**
 * Ask for text input
 *
 * @example
 * const name = yield io.ask.text('What is your name?');
 * const email = yield io.ask.text('Email:', { pattern: '.*@.*' });
 */
function text(message: string, options?: TextOptions): AskText {
  return { ask: 'text', message, ...options };
}

/**
 * Ask for password input (masked)
 *
 * @example
 * const apiKey = yield io.ask.password('Enter API key:');
 */
function password(message: string, options?: Pick<TextOptions, 'id' | 'required'>): AskPassword {
  return { ask: 'password', message, ...options };
}

/** Options for confirm input */
interface ConfirmOptions {
  id?: string;
  default?: boolean;
  dangerous?: boolean;
  required?: boolean;
}

/**
 * Ask for confirmation (yes/no)
 *
 * @example
 * const ok = yield io.ask.confirm('Delete this file?');
 * const dangerous = yield io.ask.confirm('Proceed?', { dangerous: true });
 */
function confirm(message: string, options?: ConfirmOptions): AskConfirm {
  return { ask: 'confirm', message, ...options };
}

/** Options for select input */
interface SelectOptions {
  id?: string;
  default?: string | string[];
  multi?: boolean;
  required?: boolean;
}

/** Select option type */
type SelectOption = string | { value: string; label: string; description?: string };

/**
 * Ask for selection from options
 *
 * @example
 * const env = yield io.ask.select('Choose environment:', ['dev', 'staging', 'prod']);
 * const features = yield io.ask.select('Enable features:', ['auth', 'logs'], { multi: true });
 */
function select(message: string, options: SelectOption[], config?: SelectOptions): AskSelect {
  return { ask: 'select', message, options, ...config };
}

/** Options for number input */
interface NumberOptions {
  id?: string;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

/**
 * Ask for number input
 *
 * @example
 * const qty = yield io.ask.number('Quantity:', { min: 1, max: 100 });
 */
function number(message: string, options?: NumberOptions): AskNumber {
  return { ask: 'number', message, ...options };
}

/** Options for file input */
interface FileOptions {
  id?: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
}

/**
 * Ask for file selection
 *
 * @example
 * const file = yield io.ask.file('Select a document:', { accept: '.pdf,.doc' });
 */
function file(message: string, options?: FileOptions): AskFile {
  return { ask: 'file', message, ...options };
}

/** Options for date input */
interface DateOptions {
  id?: string;
  default?: string;
  min?: string;
  max?: string;
  includeTime?: boolean;
  required?: boolean;
}

/**
 * Ask for date selection
 *
 * @example
 * const date = yield io.ask.date('Select delivery date:');
 * const datetime = yield io.ask.date('When?', { includeTime: true });
 */
function date(message: string, options?: DateOptions): AskDate {
  return { ask: 'date', message, ...options };
}

/** Options for form input */
interface FormOptions {
  id?: string;
  required?: boolean;
}

/**
 * Ask for form input (structured data)
 *
 * @example
 * const contact = yield io.ask.form('Enter contact details:', {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string', title: 'Full Name' },
 *     email: { type: 'string', format: 'email', title: 'Email' }
 *   },
 *   required: ['name', 'email']
 * });
 */
function form(message: string, schema: FormSchema, options?: FormOptions): AskForm {
  return { ask: 'form', message, schema, ...options };
}

/** Options for url input */
interface UrlOptions {
  id?: string;
  elicitationId?: string;
  required?: boolean;
}

/**
 * Ask via URL (OAuth, external auth)
 *
 * @example
 * const auth = yield io.ask.url('Authenticate with GitHub:', 'https://github.com/login/...');
 */
function url(message: string, urlValue: string, options?: UrlOptions): AskUrl {
  return { ask: 'url', message, url: urlValue, ...options };
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTED API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * IO helper namespace for emit and ask yields
 *
 * @example
 * ```typescript
 * import { io } from '@portel/photon-core';
 *
 * async *myTool() {
 *   yield io.emit.status('Starting...');
 *   const name = yield io.ask.text('Name?');
 * }
 * ```
 */
export const io = {
  /**
   * Emit helpers - fire and forget output
   */
  emit: {
    status,
    progress,
    stream,
    log,
    toast,
    thinking,
    artifact,
    ui,
  },

  /**
   * Ask helpers - blocking input from user
   */
  ask: {
    text,
    password,
    confirm,
    select,
    number,
    file,
    date,
    form,
    url,
  },
} as const;

// Also export individual functions for direct import
export const emit = io.emit;
export const ask = io.ask;
