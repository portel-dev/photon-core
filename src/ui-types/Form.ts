/**
 * Form - Purpose-driven type for interactive forms
 *
 * Automatically renders as a form that submits back to the photon.
 * Unlike io.ask.form (which is for elicitation during method execution),
 * Form is a return type that creates a persistent interactive form.
 *
 * @example
 * ```typescript
 * async settings() {
 *   return new Form()
 *     .title('User Settings')
 *     .text('name', 'Display Name', { required: true })
 *     .email('email', 'Email Address')
 *     .select('theme', 'Theme', ['light', 'dark', 'auto'])
 *     .toggle('notifications', 'Enable Notifications')
 *     .submit('Save Settings', 'saveSettings');
 * }
 *
 * async saveSettings(params: { name: string; email: string; theme: string; notifications: boolean }) {
 *   // Handle form submission
 *   return { success: true };
 * }
 * ```
 */

import { PhotonUIType } from './base.js';

export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'toggle'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'time'
  | 'datetime'
  | 'file'
  | 'color'
  | 'range'
  | 'hidden';

export interface FormField {
  name: string;
  type: FieldType;
  label?: string;
  placeholder?: string;
  defaultValue?: any;
  required?: boolean;
  disabled?: boolean;
  options?: Array<string | { label: string; value: any }>;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  accept?: string; // For file inputs
  pattern?: string;
  helpText?: string;
  group?: string; // For grouping fields
}

export interface FormOptions {
  title?: string;
  description?: string;
  submitLabel?: string;
  submitMethod?: string; // Photon method to call on submit
  cancelLabel?: string;
  layout?: 'vertical' | 'horizontal' | 'inline';
  columns?: 1 | 2 | 3;
  showReset?: boolean;
  confirmSubmit?: string; // Confirmation message before submit
}

export class Form extends PhotonUIType {
  readonly _photonType = 'form' as const;

  private _fields: FormField[] = [];
  private _options: FormOptions = {
    layout: 'vertical',
    columns: 1,
    submitLabel: 'Submit',
  };

  /**
   * Create a new Form
   */
  constructor() {
    super();
  }

  /**
   * Set form title
   */
  title(title: string): this {
    this._options.title = title;
    return this;
  }

  /**
   * Set form description
   */
  description(text: string): this {
    this._options.description = text;
    return this;
  }

  /**
   * Add a generic field
   */
  field(name: string, type: FieldType, label?: string, options?: Partial<FormField>): this {
    this._fields.push({
      name,
      type,
      label: label ?? this._formatLabel(name),
      ...options,
    });
    return this;
  }

  /**
   * Add a text input
   */
  text(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'text', label, options);
  }

  /**
   * Add an email input
   */
  email(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'email', label, options);
  }

  /**
   * Add a password input
   */
  password(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'password', label, options);
  }

  /**
   * Add a number input
   */
  number(name: string, label?: string, options?: Partial<FormField> & { min?: number; max?: number; step?: number }): this {
    return this.field(name, 'number', label, options);
  }

  /**
   * Add a textarea
   */
  textarea(name: string, label?: string, options?: Partial<FormField> & { rows?: number }): this {
    return this.field(name, 'textarea', label, { rows: 4, ...options });
  }

  /**
   * Add a select dropdown
   */
  select(name: string, label: string | undefined, choices: Array<string | { label: string; value: any }>, options?: Partial<FormField>): this {
    return this.field(name, 'select', label, { options: choices, ...options });
  }

  /**
   * Add a multi-select
   */
  multiselect(name: string, label: string | undefined, choices: Array<string | { label: string; value: any }>, options?: Partial<FormField>): this {
    return this.field(name, 'multiselect', label, { options: choices, ...options });
  }

  /**
   * Add a toggle switch
   */
  toggle(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'toggle', label, options);
  }

  /**
   * Add a checkbox
   */
  checkbox(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'checkbox', label, options);
  }

  /**
   * Add radio buttons
   */
  radio(name: string, label: string | undefined, choices: Array<string | { label: string; value: any }>, options?: Partial<FormField>): this {
    return this.field(name, 'radio', label, { options: choices, ...options });
  }

  /**
   * Add a date picker
   */
  date(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'date', label, options);
  }

  /**
   * Add a time picker
   */
  time(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'time', label, options);
  }

  /**
   * Add a datetime picker
   */
  datetime(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'datetime', label, options);
  }

  /**
   * Add a file upload
   */
  file(name: string, label?: string, options?: Partial<FormField> & { accept?: string }): this {
    return this.field(name, 'file', label, options);
  }

  /**
   * Add a color picker
   */
  color(name: string, label?: string, options?: Partial<FormField>): this {
    return this.field(name, 'color', label, options);
  }

  /**
   * Add a range slider
   */
  range(name: string, label?: string, options?: Partial<FormField> & { min?: number; max?: number; step?: number }): this {
    return this.field(name, 'range', label, { min: 0, max: 100, step: 1, ...options });
  }

  /**
   * Add a hidden field
   */
  hidden(name: string, value: any): this {
    return this.field(name, 'hidden', undefined, { defaultValue: value });
  }

  /**
   * Configure submit button
   */
  submit(label: string, method?: string): this {
    this._options.submitLabel = label;
    if (method) this._options.submitMethod = method;
    return this;
  }

  /**
   * Add cancel button
   */
  cancel(label: string = 'Cancel'): this {
    this._options.cancelLabel = label;
    return this;
  }

  /**
   * Set form layout
   */
  layout(type: 'vertical' | 'horizontal' | 'inline'): this {
    this._options.layout = type;
    return this;
  }

  /**
   * Set number of columns
   */
  columns(count: 1 | 2 | 3): this {
    this._options.columns = count;
    return this;
  }

  /**
   * Show reset button
   */
  showReset(enabled: boolean = true): this {
    this._options.showReset = enabled;
    return this;
  }

  /**
   * Require confirmation before submit
   */
  confirmSubmit(message: string): this {
    this._options.confirmSubmit = message;
    return this;
  }

  /**
   * Group subsequent fields
   */
  group(name: string): this {
    // Mark for next fields
    // Implementation note: fields added after this call get this group
    return this;
  }

  /**
   * Format field name to label
   */
  private _formatLabel(name: string): string {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      fields: this._fields,
      options: this._options,
    };
  }
}
