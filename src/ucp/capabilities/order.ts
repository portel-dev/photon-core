/**
 * UCP Order Management Capability Implementation
 *
 * Provides order tracking, returns, and webhook handling.
 */

import * as crypto from 'crypto';
import {
  Order,
  OrderStatus,
  Shipment,
  ShipmentStatus,
  TrackingEvent,
  ReturnRequest,
  Adjustment,
  WebhookRegistration,
  WebhookEventType,
  WebhookPayload,
  Money
} from '../types.js';

// ============================================================================
// Order Storage Interface
// ============================================================================

export interface OrderStorage {
  get(orderId: string): Promise<Order | null>;
  set(order: Order): Promise<void>;
  list(params?: {
    merchantId?: string;
    status?: OrderStatus[];
    limit?: number;
    offset?: number;
  }): Promise<{ orders: Order[]; total: number }>;
  delete(orderId: string): Promise<void>;
}

/**
 * In-memory order storage (for development/testing)
 */
export class MemoryOrderStorage implements OrderStorage {
  private orders = new Map<string, Order>();

  async get(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) || null;
  }

  async set(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async list(params?: {
    merchantId?: string;
    status?: OrderStatus[];
    limit?: number;
    offset?: number;
  }): Promise<{ orders: Order[]; total: number }> {
    let orders = Array.from(this.orders.values());

    if (params?.merchantId) {
      orders = orders.filter(o => o.merchantId === params.merchantId);
    }

    if (params?.status?.length) {
      orders = orders.filter(o => params.status!.includes(o.status));
    }

    // Sort by creation date descending
    orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = orders.length;
    const offset = params?.offset || 0;
    const limit = params?.limit || 50;

    return {
      orders: orders.slice(offset, offset + limit),
      total
    };
  }

  async delete(orderId: string): Promise<void> {
    this.orders.delete(orderId);
  }
}

// ============================================================================
// Webhook Dispatcher
// ============================================================================

export interface WebhookDispatcher {
  dispatch(webhook: WebhookRegistration, payload: WebhookPayload): Promise<boolean>;
}

/**
 * Default webhook dispatcher using fetch
 */
export class HttpWebhookDispatcher implements WebhookDispatcher {
  async dispatch(webhook: WebhookRegistration, payload: WebhookPayload): Promise<boolean> {
    try {
      // Generate signature
      const signature = this.generateSignature(payload, webhook.secret);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UCP-Signature': signature,
          'X-UCP-Event': payload.type
        },
        body: JSON.stringify(payload)
      });

      return response.ok;
    } catch (error) {
      console.error(`Webhook dispatch failed: ${error}`);
      return false;
    }
  }

  private generateSignature(payload: WebhookPayload, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest('hex')}`;
  }
}

// ============================================================================
// Order Service
// ============================================================================

export interface OrderServiceConfig {
  merchantId: string;
}

export class OrderService {
  private storage: OrderStorage;
  private webhooks: WebhookRegistration[] = [];
  private dispatcher: WebhookDispatcher;
  private config: OrderServiceConfig;

  constructor(
    config: OrderServiceConfig,
    storage?: OrderStorage,
    dispatcher?: WebhookDispatcher
  ) {
    this.config = config;
    this.storage = storage || new MemoryOrderStorage();
    this.dispatcher = dispatcher || new HttpWebhookDispatcher();
  }

  // --------------------------------------------------------------------------
  // Order Retrieval
  // --------------------------------------------------------------------------

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<Order> {
    const order = await this.storage.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    return order;
  }

  /**
   * List orders with optional filters
   */
  async listOrders(params?: {
    status?: OrderStatus[];
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: Order[]; nextCursor?: string }> {
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;
    const limit = params?.limit || 20;

    const result = await this.storage.list({
      merchantId: this.config.merchantId,
      status: params?.status,
      limit: limit + 1,  // Fetch one extra to check for more
      offset
    });

    const hasMore = result.orders.length > limit;
    const orders = hasMore ? result.orders.slice(0, limit) : result.orders;

    return {
      orders,
      nextCursor: hasMore ? String(offset + limit) : undefined
    };
  }

  // --------------------------------------------------------------------------
  // Order Updates
  // --------------------------------------------------------------------------

  /**
   * Update order status
   */
  async updateStatus(orderId: string, status: OrderStatus, reason?: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    const previousStatus = order.status;

    order.status = status;
    order.updatedAt = new Date().toISOString();

    if (reason && status === 'cancelled') {
      order.adjustments.push({
        id: `adj_${crypto.randomUUID()}`,
        type: 'refund',
        amount: order.totals.total,
        reason,
        createdAt: new Date().toISOString()
      });
    }

    await this.storage.set(order);

    // Dispatch webhook
    await this.dispatchWebhook('order.updated', {
      order,
      previousStatus,
      newStatus: status
    });

    return order;
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, reason?: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (!['pending', 'confirmed', 'processing'].includes(order.status)) {
      throw new Error(`Cannot cancel order in ${order.status} status`);
    }

    return this.updateStatus(orderId, 'cancelled', reason || 'Cancelled by customer');
  }

  // --------------------------------------------------------------------------
  // Shipment Tracking
  // --------------------------------------------------------------------------

  /**
   * Add shipment to order
   */
  async addShipment(orderId: string, shipment: Omit<Shipment, 'id' | 'events'>): Promise<Order> {
    const order = await this.getOrder(orderId);

    const newShipment: Shipment = {
      ...shipment,
      id: `ship_${crypto.randomUUID()}`,
      events: [{
        timestamp: new Date().toISOString(),
        status: 'label_created',
        description: 'Shipping label created'
      }]
    };

    order.shipments.push(newShipment);
    order.status = 'shipped';
    order.updatedAt = new Date().toISOString();

    await this.storage.set(order);

    // Dispatch webhook
    await this.dispatchWebhook('shipment.created', {
      order,
      shipment: newShipment
    });

    return order;
  }

  /**
   * Update shipment status
   */
  async updateShipment(
    orderId: string,
    shipmentId: string,
    update: {
      status: ShipmentStatus;
      location?: string;
      description: string;
    }
  ): Promise<Order> {
    const order = await this.getOrder(orderId);
    const shipment = order.shipments.find(s => s.id === shipmentId);

    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    shipment.status = update.status;
    shipment.events.push({
      timestamp: new Date().toISOString(),
      status: update.status,
      location: update.location,
      description: update.description
    });

    // Update order status if delivered
    if (update.status === 'delivered') {
      const allDelivered = order.shipments.every(s => s.status === 'delivered');
      if (allDelivered) {
        order.status = 'delivered';
      }
    }

    order.updatedAt = new Date().toISOString();
    await this.storage.set(order);

    // Dispatch webhook
    const eventType = update.status === 'delivered' ? 'delivery.completed' : 'shipment.updated';
    await this.dispatchWebhook(eventType, {
      order,
      shipment
    });

    return order;
  }

  /**
   * Get shipment tracking info
   */
  async trackShipment(orderId: string, shipmentId?: string): Promise<Shipment[]> {
    const order = await this.getOrder(orderId);

    if (shipmentId) {
      const shipment = order.shipments.find(s => s.id === shipmentId);
      if (!shipment) {
        throw new Error(`Shipment not found: ${shipmentId}`);
      }
      return [shipment];
    }

    return order.shipments;
  }

  // --------------------------------------------------------------------------
  // Returns & Refunds
  // --------------------------------------------------------------------------

  /**
   * Initiate return request
   */
  async initiateReturn(orderId: string, params: {
    items: { lineItemId: string; quantity: number; reason: string }[];
  }): Promise<ReturnRequest> {
    const order = await this.getOrder(orderId);

    if (order.status !== 'delivered') {
      throw new Error('Can only return delivered orders');
    }

    // Validate items
    for (const item of params.items) {
      const lineItem = order.lineItems.find(li => li.id === item.lineItemId);
      if (!lineItem) {
        throw new Error(`Line item not found: ${item.lineItemId}`);
      }
      if (item.quantity > lineItem.quantity) {
        throw new Error(`Return quantity exceeds order quantity for ${lineItem.label}`);
      }
    }

    // Calculate refund amount
    const refundAmount: Money = {
      amount: params.items.reduce((sum, item) => {
        const lineItem = order.lineItems.find(li => li.id === item.lineItemId)!;
        return sum + (lineItem.unitPrice.amount * item.quantity);
      }, 0),
      currency: order.totals.total.currency
    };

    const returnRequest: ReturnRequest = {
      id: `ret_${crypto.randomUUID()}`,
      status: 'requested',
      items: params.items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      refundAmount
    };

    order.returns.push(returnRequest);
    order.updatedAt = new Date().toISOString();

    await this.storage.set(order);

    // Dispatch webhook
    await this.dispatchWebhook('return.requested', {
      order,
      return: returnRequest
    });

    return returnRequest;
  }

  /**
   * Approve return request
   */
  async approveReturn(orderId: string, returnId: string, params?: {
    returnLabel?: {
      carrier: string;
      trackingNumber: string;
      labelUrl: string;
    };
  }): Promise<ReturnRequest> {
    const order = await this.getOrder(orderId);
    const returnRequest = order.returns.find(r => r.id === returnId);

    if (!returnRequest) {
      throw new Error(`Return request not found: ${returnId}`);
    }

    if (returnRequest.status !== 'requested') {
      throw new Error(`Cannot approve return in ${returnRequest.status} status`);
    }

    returnRequest.status = 'approved';
    returnRequest.updatedAt = new Date().toISOString();
    returnRequest.returnLabel = params?.returnLabel;

    order.updatedAt = new Date().toISOString();
    await this.storage.set(order);

    // Dispatch webhook
    await this.dispatchWebhook('return.approved', {
      order,
      return: returnRequest
    });

    return returnRequest;
  }

  /**
   * Process refund for return
   */
  async processRefund(orderId: string, returnId: string): Promise<Adjustment> {
    const order = await this.getOrder(orderId);
    const returnRequest = order.returns.find(r => r.id === returnId);

    if (!returnRequest) {
      throw new Error(`Return request not found: ${returnId}`);
    }

    if (returnRequest.status !== 'received' && returnRequest.status !== 'approved') {
      throw new Error(`Cannot process refund for return in ${returnRequest.status} status`);
    }

    const adjustment: Adjustment = {
      id: `adj_${crypto.randomUUID()}`,
      type: 'refund',
      amount: returnRequest.refundAmount!,
      reason: `Return refund for ${returnRequest.items.length} item(s)`,
      createdAt: new Date().toISOString(),
      lineItemIds: returnRequest.items.map(i => i.lineItemId)
    };

    returnRequest.status = 'refunded';
    returnRequest.updatedAt = new Date().toISOString();

    order.adjustments.push(adjustment);
    order.updatedAt = new Date().toISOString();

    // Check if fully refunded
    const totalRefunded = order.adjustments
      .filter(a => a.type === 'refund')
      .reduce((sum, a) => sum + a.amount.amount, 0);

    if (totalRefunded >= order.totals.total.amount) {
      order.status = 'refunded';
    }

    await this.storage.set(order);

    // Dispatch webhook
    await this.dispatchWebhook('refund.created', {
      order,
      adjustment
    });

    return adjustment;
  }

  // --------------------------------------------------------------------------
  // Webhooks
  // --------------------------------------------------------------------------

  /**
   * Register webhook
   */
  async registerWebhook(params: {
    url: string;
    events: WebhookEventType[];
    secret: string;
  }): Promise<WebhookRegistration> {
    const webhook: WebhookRegistration = {
      id: `wh_${crypto.randomUUID()}`,
      url: params.url,
      events: params.events,
      secret: params.secret,
      active: true,
      createdAt: new Date().toISOString()
    };

    this.webhooks.push(webhook);
    return webhook;
  }

  /**
   * List webhooks
   */
  async listWebhooks(): Promise<WebhookRegistration[]> {
    return this.webhooks.filter(w => w.active);
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    const index = this.webhooks.findIndex(w => w.id === webhookId);
    if (index !== -1) {
      this.webhooks[index].active = false;
    }
  }

  /**
   * Dispatch webhook to registered endpoints
   */
  private async dispatchWebhook(type: WebhookEventType, data: any): Promise<void> {
    const payload: WebhookPayload = {
      id: `evt_${crypto.randomUUID()}`,
      type,
      timestamp: new Date().toISOString(),
      data
    };

    const relevantWebhooks = this.webhooks.filter(
      w => w.active && w.events.includes(type)
    );

    await Promise.all(
      relevantWebhooks.map(w => this.dispatcher.dispatch(w, payload))
    );
  }
}
