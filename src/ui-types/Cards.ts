/**
 * Cards - Purpose-driven type for card-based layouts
 *
 * Automatically renders as a grid of cards with customizable fields.
 *
 * @example
 * ```typescript
 * async products() {
 *   return new Cards()
 *     .title('Featured Products')
 *     .image('imageUrl')
 *     .heading('name')
 *     .subtitle('category')
 *     .description('summary')
 *     .badge('status')
 *     .items([
 *       { name: 'Widget', category: 'Tools', summary: '...', status: 'New', imageUrl: '...' },
 *     ]);
 * }
 * ```
 */

import { PhotonUIType } from './base.js';

export interface CardFieldMapping {
  image?: string;
  heading?: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  footer?: string;
  link?: string;
  meta?: string[];
}

export interface CardsOptions {
  title?: string;
  columns?: 1 | 2 | 3 | 4 | 6;
  compact?: boolean;
  clickable?: boolean;
  hoverable?: boolean;
  bordered?: boolean;
  aspectRatio?: 'square' | 'video' | 'portrait' | 'auto';
}

export class Cards extends PhotonUIType {
  readonly _photonType = 'cards' as const;

  private _items: Record<string, any>[] = [];
  private _fields: CardFieldMapping = {};
  private _options: CardsOptions = {
    columns: 3,
    hoverable: true,
    bordered: true,
    aspectRatio: 'auto',
  };

  /**
   * Create a new Cards layout
   * @param items Optional initial items
   */
  constructor(items?: Record<string, any>[]) {
    super();
    if (items) {
      this._items = items;
      this._inferFields(items[0]);
    }
  }

  /**
   * Set section title
   */
  title(title: string): this {
    this._options.title = title;
    return this;
  }

  /**
   * Set field for card image
   */
  image(field: string): this {
    this._fields.image = field;
    return this;
  }

  /**
   * Set field for card heading
   */
  heading(field: string): this {
    this._fields.heading = field;
    return this;
  }

  /**
   * Set field for card subtitle
   */
  subtitle(field: string): this {
    this._fields.subtitle = field;
    return this;
  }

  /**
   * Set field for card description
   */
  description(field: string): this {
    this._fields.description = field;
    return this;
  }

  /**
   * Set field for badge/tag
   */
  badge(field: string): this {
    this._fields.badge = field;
    return this;
  }

  /**
   * Set field for footer text
   */
  footer(field: string): this {
    this._fields.footer = field;
    return this;
  }

  /**
   * Set field for click link
   */
  link(field: string): this {
    this._fields.link = field;
    this._options.clickable = true;
    return this;
  }

  /**
   * Set fields for meta info
   */
  meta(...fields: string[]): this {
    this._fields.meta = fields;
    return this;
  }

  /**
   * Set card items
   */
  items(data: Record<string, any>[]): this {
    this._items = data;
    if (Object.keys(this._fields).length === 0 && data.length > 0) {
      this._inferFields(data[0]);
    }
    return this;
  }

  /**
   * Add a single item
   */
  item(data: Record<string, any>): this {
    this._items.push(data);
    return this;
  }

  /**
   * Set number of columns
   */
  columns(count: 1 | 2 | 3 | 4 | 6): this {
    this._options.columns = count;
    return this;
  }

  /**
   * Use compact card style
   */
  compact(enabled: boolean = true): this {
    this._options.compact = enabled;
    return this;
  }

  /**
   * Enable click interaction
   */
  clickable(enabled: boolean = true): this {
    this._options.clickable = enabled;
    return this;
  }

  /**
   * Enable hover effect
   */
  hoverable(enabled: boolean = true): this {
    this._options.hoverable = enabled;
    return this;
  }

  /**
   * Show card borders
   */
  bordered(enabled: boolean = true): this {
    this._options.bordered = enabled;
    return this;
  }

  /**
   * Set image aspect ratio
   */
  aspectRatio(ratio: 'square' | 'video' | 'portrait' | 'auto'): this {
    this._options.aspectRatio = ratio;
    return this;
  }

  /**
   * Infer field mappings from data
   */
  private _inferFields(item: Record<string, any>): void {
    const keys = Object.keys(item);

    // Look for common field names
    const findField = (patterns: string[]): string | undefined => {
      return keys.find(k => patterns.some(p => k.toLowerCase().includes(p)));
    };

    this._fields.image = findField(['image', 'img', 'photo', 'picture', 'avatar', 'thumbnail']);
    this._fields.heading = findField(['name', 'title', 'heading']);
    this._fields.subtitle = findField(['subtitle', 'category', 'type']);
    this._fields.description = findField(['description', 'summary', 'text', 'body', 'content']);
    this._fields.badge = findField(['status', 'badge', 'tag', 'label']);
    this._fields.link = findField(['url', 'link', 'href']);
  }

  /**
   * Get item count
   */
  get length(): number {
    return this._items.length;
  }

  toJSON() {
    return {
      _photonType: this._photonType,
      items: this._items,
      fields: this._fields,
      options: this._options,
    };
  }
}
