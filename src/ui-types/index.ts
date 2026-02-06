/**
 * Purpose-Driven UI Types
 *
 * These types enable polymorphic return values that automatically
 * render with the appropriate UI component.
 *
 * @example
 * ```typescript
 * import { Table, Chart, Cards, Stats } from '@portel/photon-core';
 *
 * export default class Dashboard {
 *   async users() {
 *     return new Table()
 *       .column('name', 'Name')
 *       .column('email', 'Email')
 *       .rows(await this.fetchUsers());
 *   }
 *
 *   async metrics() {
 *     return new Chart('line')
 *       .labels(['Jan', 'Feb', 'Mar'])
 *       .series('Revenue', [100, 200, 300]);
 *   }
 *
 *   async overview() {
 *     return new Stats()
 *       .stat('Users', 1234)
 *       .currency('Revenue', 50000);
 *   }
 * }
 * ```
 */

// Base
export { PhotonUIType, isPhotonUIType } from './base.js';

// Field System
export {
  Field,
  type FieldDefinition,
  type FieldType,
  type FieldAlignment,
  type BaseFieldOptions,
  // Field-specific options
  type TextFieldOptions,
  type EmailFieldOptions,
  type UrlFieldOptions,
  type PhoneFieldOptions,
  type NumberFieldOptions,
  type CurrencyFieldOptions,
  type PercentFieldOptions,
  type DateFieldOptions,
  type DateFormat,
  type TimeFieldOptions,
  type DateRangeFieldOptions,
  type BooleanFieldOptions,
  type ImageFieldOptions,
  type AvatarFieldOptions,
  type GalleryFieldOptions,
  type FileFieldOptions,
  type BadgeFieldOptions,
  type TagsFieldOptions,
  type RatingFieldOptions,
  type PriceFieldOptions,
  type StockFieldOptions,
  type QuantityFieldOptions,
  type UserFieldOptions,
  type ReferenceFieldOptions,
  type ActionItem,
  type ActionsFieldOptions,
  type CustomFieldOptions,
  type RenderFunction,
  // Utilities
  getFieldValue,
  formatFieldLabel,
  interpolateTemplate,
} from './Field.js';

// Field Rendering
export {
  renderFieldToText,
  renderFieldToStructured,
  type RenderedField,
} from './FieldRenderer.js';

// Data Display
export { Table, type TableColumn, type TableOptions, type ColumnType } from './Table.js';
export { Cards, type CardFieldMapping, type CardsOptions } from './Cards.js';

// Visualization
export { Chart, type ChartType, type ChartSeries, type ChartDataPoint, type ChartOptions } from './Chart.js';
export { Stats, type StatItem, type StatFormat, type StatsOptions } from './Stats.js';
export { Progress, type ProgressBar, type ProgressStep, type ProgressStyle, type StepStatus, type ProgressOptions } from './Progress.js';

// Interactive
export { Form, type FormField, type FieldType as FormFieldType, type FormOptions } from './Form.js';
