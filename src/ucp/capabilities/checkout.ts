/**
 * UCP Checkout Capability Implementation
 *
 * Provides cart management, pricing, and checkout session handling.
 */

import * as crypto from 'crypto';
import {
  CheckoutSession,
  CheckoutSessionStatus,
  LineItem,
  DiscountAllocation,
  Totals,
  FulfillmentOption,
  FulfillmentDestination,
  BuyerInfo,
  PaymentMethodInfo,
  Order,
  Money
} from '../types.js';
import { PaymentMandate, CartMandate } from '../ap2/types.js';
import { createCartMandate, signCartMandate, createPaymentMandate } from '../ap2/mandates.js';

// ============================================================================
// Session Storage Interface
// ============================================================================

export interface SessionStorage {
  get(sessionId: string): Promise<CheckoutSession | null>;
  set(session: CheckoutSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanup(): Promise<void>;  // Remove expired sessions
}

/**
 * In-memory session storage (for development/testing)
 */
export class MemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, CheckoutSession>();

  async get(sessionId: string): Promise<CheckoutSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  async set(session: CheckoutSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async cleanup(): Promise<void> {
    const now = new Date();
    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
      }
    }
  }
}

// ============================================================================
// Checkout Service
// ============================================================================

export interface CheckoutConfig {
  merchantId: string;
  merchantName: string;
  defaultCurrency: string;
  sessionTTLMinutes: number;
  taxCalculator?: TaxCalculator;
  discountValidator?: DiscountValidator;
  fulfillmentProvider?: FulfillmentProvider;
  paymentMethods: PaymentMethodInfo[];
}

export interface TaxCalculator {
  calculate(items: LineItem[], destination?: FulfillmentDestination): Promise<{
    taxAmount: Money;
    taxLines: { label: string; rate: number; amount: Money }[];
  }>;
}

export interface DiscountValidator {
  validate(code: string, session: CheckoutSession): Promise<{
    valid: boolean;
    discount?: DiscountAllocation;
    error?: string;
  }>;
}

export interface FulfillmentProvider {
  getOptions(items: LineItem[], destination?: FulfillmentDestination): Promise<FulfillmentOption[]>;
}

export class CheckoutService {
  private storage: SessionStorage;
  private config: CheckoutConfig;

  constructor(config: CheckoutConfig, storage?: SessionStorage) {
    this.config = config;
    this.storage = storage || new MemorySessionStorage();
  }

  // --------------------------------------------------------------------------
  // Session Management
  // --------------------------------------------------------------------------

  /**
   * Create a new checkout session
   */
  async createSession(params?: {
    currency?: string;
    locale?: string;
    metadata?: Record<string, any>;
  }): Promise<CheckoutSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTTLMinutes * 60 * 1000);

    const session: CheckoutSession = {
      id: `cs_${crypto.randomUUID()}`,
      merchantId: this.config.merchantId,
      status: 'open',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lineItems: [],
      discounts: [],
      fulfillmentOptions: [],
      availablePaymentMethods: this.config.paymentMethods,
      totals: this.calculateTotals([]),
      metadata: params?.metadata
    };

    await this.storage.set(session);
    return session;
  }

  /**
   * Get checkout session by ID
   */
  async getSession(sessionId: string): Promise<CheckoutSession> {
    const session = await this.storage.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  // --------------------------------------------------------------------------
  // Cart Management
  // --------------------------------------------------------------------------

  /**
   * Update cart items
   */
  async updateCart(sessionId: string, updates: {
    add?: Omit<LineItem, 'id' | 'totalPrice'>[];
    remove?: string[];
    update?: { id: string; quantity: number }[];
  }): Promise<CheckoutSession> {
    const session = await this.getSession(sessionId);
    this.assertSessionOpen(session);

    let items = [...session.lineItems];

    // Remove items
    if (updates.remove) {
      items = items.filter(item => !updates.remove!.includes(item.id));
    }

    // Update quantities
    if (updates.update) {
      for (const update of updates.update) {
        const item = items.find(i => i.id === update.id);
        if (item) {
          if (update.quantity <= 0) {
            items = items.filter(i => i.id !== update.id);
          } else {
            item.quantity = update.quantity;
            item.totalPrice = {
              amount: item.unitPrice.amount * update.quantity,
              currency: item.unitPrice.currency
            };
          }
        }
      }
    }

    // Add new items
    if (updates.add) {
      for (const newItem of updates.add) {
        items.push({
          ...newItem,
          id: `li_${crypto.randomUUID()}`,
          totalPrice: {
            amount: newItem.unitPrice.amount * newItem.quantity,
            currency: newItem.unitPrice.currency
          }
        });
      }
    }

    session.lineItems = items;
    session.totals = this.calculateTotals(items, session.discounts, session.selectedFulfillment);
    session.updatedAt = new Date().toISOString();

    // Update fulfillment options if provider available
    if (this.config.fulfillmentProvider) {
      session.fulfillmentOptions = await this.config.fulfillmentProvider.getOptions(
        items,
        session.selectedFulfillment?.destination
      );
    }

    await this.storage.set(session);
    return session;
  }

  /**
   * Set buyer information
   */
  async setBuyer(sessionId: string, buyer: BuyerInfo): Promise<CheckoutSession> {
    const session = await this.getSession(sessionId);
    this.assertSessionOpen(session);

    session.buyer = buyer;
    session.updatedAt = new Date().toISOString();

    await this.storage.set(session);
    return session;
  }

  /**
   * Set fulfillment option
   */
  async setFulfillment(sessionId: string, params: {
    optionId: string;
    destination: FulfillmentDestination;
  }): Promise<CheckoutSession> {
    const session = await this.getSession(sessionId);
    this.assertSessionOpen(session);

    const option = session.fulfillmentOptions.find(o => o.id === params.optionId);
    if (!option) {
      throw new Error(`Fulfillment option not found: ${params.optionId}`);
    }

    session.selectedFulfillment = {
      optionId: params.optionId,
      destination: params.destination
    };

    // Recalculate totals with shipping
    session.totals = this.calculateTotals(
      session.lineItems,
      session.discounts,
      session.selectedFulfillment,
      option.price
    );

    // Recalculate tax if calculator available
    if (this.config.taxCalculator) {
      const taxResult = await this.config.taxCalculator.calculate(
        session.lineItems,
        params.destination
      );
      session.totals.tax = taxResult.taxAmount;
      session.totals.taxLines = taxResult.taxLines;
      session.totals.total = {
        amount: session.totals.subtotal.amount - session.totals.discounts.amount +
                session.totals.shipping.amount + session.totals.tax.amount,
        currency: session.totals.subtotal.currency
      };
    }

    session.updatedAt = new Date().toISOString();
    await this.storage.set(session);
    return session;
  }

  // --------------------------------------------------------------------------
  // Discounts
  // --------------------------------------------------------------------------

  /**
   * Apply discount code
   */
  async applyDiscount(sessionId: string, code: string): Promise<{
    success: boolean;
    session: CheckoutSession;
    error?: string;
  }> {
    const session = await this.getSession(sessionId);
    this.assertSessionOpen(session);

    // Check if already applied
    if (session.discounts.some(d => d.code === code)) {
      return { success: false, session, error: 'Discount already applied' };
    }

    // Validate discount
    if (this.config.discountValidator) {
      const result = await this.config.discountValidator.validate(code, session);
      if (!result.valid) {
        return { success: false, session, error: result.error };
      }
      if (result.discount) {
        session.discounts.push(result.discount);
      }
    } else {
      // Simple default discount handling
      const discount: DiscountAllocation = {
        code,
        label: `Discount: ${code}`,
        type: 'percentage',
        value: 10,
        appliedAmount: {
          amount: session.totals.subtotal.amount * 0.1,
          currency: session.totals.subtotal.currency
        }
      };
      session.discounts.push(discount);
    }

    session.totals = this.calculateTotals(
      session.lineItems,
      session.discounts,
      session.selectedFulfillment
    );
    session.updatedAt = new Date().toISOString();

    await this.storage.set(session);
    return { success: true, session };
  }

  /**
   * Remove discount code
   */
  async removeDiscount(sessionId: string, code: string): Promise<CheckoutSession> {
    const session = await this.getSession(sessionId);
    this.assertSessionOpen(session);

    session.discounts = session.discounts.filter(d => d.code !== code);
    session.totals = this.calculateTotals(
      session.lineItems,
      session.discounts,
      session.selectedFulfillment
    );
    session.updatedAt = new Date().toISOString();

    await this.storage.set(session);
    return session;
  }

  // --------------------------------------------------------------------------
  // Checkout Completion
  // --------------------------------------------------------------------------

  /**
   * Complete checkout with payment
   */
  async complete(sessionId: string, payment: {
    methodId?: string;
    mandate?: PaymentMandate;
  }): Promise<Order> {
    const session = await this.getSession(sessionId);
    this.assertSessionOpen(session);

    // Validate session is ready
    if (session.lineItems.length === 0) {
      throw new Error('Cart is empty');
    }
    if (!session.buyer?.email) {
      throw new Error('Buyer email is required');
    }

    // Mark as processing
    session.status = 'processing';
    session.updatedAt = new Date().toISOString();
    await this.storage.set(session);

    try {
      // Create order from session
      const order: Order = {
        id: `order_${crypto.randomUUID()}`,
        checkoutSessionId: session.id,
        merchantId: session.merchantId,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        buyer: session.buyer,
        lineItems: session.lineItems,
        fulfillmentExpectations: session.selectedFulfillment ? [{
          id: `fe_${crypto.randomUUID()}`,
          type: session.selectedFulfillment.destination.type,
          description: `Shipping to ${session.selectedFulfillment.destination.address?.city || 'destination'}`,
          lineItemIds: session.lineItems.map(i => i.id)
        }] : [],
        shipments: [],
        paymentMethod: session.selectedPaymentMethod || session.availablePaymentMethods[0],
        paymentStatus: 'captured',
        totals: session.totals,
        adjustments: [],
        returns: []
      };

      // Mark session as completed
      session.status = 'completed';
      session.updatedAt = new Date().toISOString();
      await this.storage.set(session);

      return order;

    } catch (error) {
      // Revert to open status on failure
      session.status = 'open';
      session.updatedAt = new Date().toISOString();
      await this.storage.set(session);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // AP2 Integration
  // --------------------------------------------------------------------------

  /**
   * Generate Cart Mandate for the session
   */
  generateCartMandate(session: CheckoutSession): CartMandate {
    return createCartMandate({
      items: session.lineItems,
      total: session.totals.total,
      merchant: {
        id: this.config.merchantId,
        name: this.config.merchantName
      },
      paymentMethods: session.availablePaymentMethods.map(m => {
        switch (m.type) {
          case 'card': return 'CARD';
          case 'bank_transfer': return 'BANK_TRANSFER';
          case 'wallet': return 'WALLET';
          case 'crypto': return 'CRYPTO';
          default: return 'CARD';
        }
      }),
      fulfillment: session.selectedFulfillment?.destination.address ? {
        method: session.fulfillmentOptions.find(o => o.id === session.selectedFulfillment?.optionId)?.label || 'Standard',
        destination: session.selectedFulfillment.destination.address
      } : undefined,
      refundPeriodDays: 30
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private assertSessionOpen(session: CheckoutSession): void {
    if (session.status !== 'open') {
      throw new Error(`Session is ${session.status}, cannot modify`);
    }
  }

  private calculateTotals(
    items: LineItem[],
    discounts: DiscountAllocation[] = [],
    fulfillment?: { optionId: string; destination: FulfillmentDestination },
    shippingCost?: Money
  ): Totals {
    const currency = items[0]?.unitPrice.currency || this.config.defaultCurrency;

    const subtotal = items.reduce((sum, item) => sum + item.totalPrice.amount, 0);
    const discountTotal = discounts.reduce((sum, d) => sum + d.appliedAmount.amount, 0);
    const shipping = shippingCost?.amount || 0;
    const tax = 0; // Calculated separately if tax calculator provided

    return {
      subtotal: { amount: subtotal, currency },
      discounts: { amount: discountTotal, currency },
      shipping: { amount: shipping, currency },
      tax: { amount: tax, currency },
      total: { amount: subtotal - discountTotal + shipping + tax, currency }
    };
  }
}
