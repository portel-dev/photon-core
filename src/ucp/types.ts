/**
 * Universal Commerce Protocol (UCP) Type Definitions
 *
 * Based on UCP specification from https://ucp.dev/
 * Compatible with MCP transport for Photon integration.
 */

// ============================================================================
// Core Types
// ============================================================================

export interface Money {
  amount: number;
  currency: string;  // ISO 4217 currency code
}

export interface Address {
  name?: string;
  organization?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;  // State/Province
  postalCode: string;
  country: string;  // ISO 3166-1 alpha-2
  phone?: string;
}

export interface BuyerInfo {
  email: string;
  name?: string;
  phone?: string;
  billingAddress?: Address;
}

// ============================================================================
// Checkout Types
// ============================================================================

export type CheckoutSessionStatus =
  | 'open'              // Session active, can modify cart
  | 'ready_for_complete' // Cart finalized, ready for payment
  | 'processing'        // Payment being processed
  | 'completed'         // Successfully completed
  | 'expired'           // Session timed out
  | 'cancelled';        // User cancelled

export interface LineItem {
  id: string;
  sku?: string;
  label: string;
  description?: string;
  quantity: number;
  unitPrice: Money;
  totalPrice: Money;
  productUrl?: string;
  imageUrl?: string;
  metadata?: Record<string, any>;
}

export interface DiscountAllocation {
  code: string;
  label: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  appliedAmount: Money;
  lineItemAllocations?: { lineItemId: string; amount: Money }[];
}

export interface TaxLine {
  label: string;
  rate: number;  // Decimal (0.08 = 8%)
  amount: Money;
}

export interface Totals {
  subtotal: Money;
  discounts: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  taxLines?: TaxLine[];
}

export interface FulfillmentOption {
  id: string;
  label: string;
  description?: string;
  carrier?: string;
  estimatedDelivery?: string;
  price: Money;
}

export interface FulfillmentDestination {
  type: 'shipping' | 'pickup' | 'digital';
  address?: Address;
  pickupLocation?: {
    id: string;
    name: string;
    address: Address;
  };
}

export interface PaymentMethodInfo {
  id: string;
  type: 'card' | 'bank_transfer' | 'wallet' | 'crypto' | 'other';
  label: string;
  icon?: string;
  lastFour?: string;
  expiryMonth?: number;
  expiryYear?: number;
}

export interface CheckoutSession {
  id: string;
  merchantId: string;
  status: CheckoutSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;

  // Buyer
  buyer?: BuyerInfo;

  // Cart
  lineItems: LineItem[];

  // Discounts
  discounts: DiscountAllocation[];

  // Fulfillment
  fulfillmentOptions: FulfillmentOption[];
  selectedFulfillment?: {
    optionId: string;
    destination: FulfillmentDestination;
  };

  // Payment
  availablePaymentMethods: PaymentMethodInfo[];
  selectedPaymentMethod?: PaymentMethodInfo;

  // Totals
  totals: Totals;

  // Metadata
  metadata?: Record<string, any>;
}

// ============================================================================
// Order Types
// ============================================================================

export type OrderStatus =
  | 'pending'           // Order created, awaiting confirmation
  | 'confirmed'         // Payment confirmed
  | 'processing'        // Being prepared
  | 'shipped'           // In transit
  | 'delivered'         // Successfully delivered
  | 'cancelled'         // Cancelled
  | 'refunded';         // Fully refunded

export type ShipmentStatus =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_delivery'
  | 'returned';

export interface TrackingEvent {
  timestamp: string;
  status: ShipmentStatus;
  location?: string;
  description: string;
}

export interface Shipment {
  id: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  status: ShipmentStatus;
  estimatedDelivery?: string;
  events: TrackingEvent[];
  lineItemIds: string[];
}

export interface FulfillmentExpectation {
  id: string;
  type: 'shipping' | 'pickup' | 'digital';
  description: string;
  estimatedDate?: string;
  lineItemIds: string[];
}

export interface Adjustment {
  id: string;
  type: 'refund' | 'partial_refund' | 'price_adjustment' | 'return';
  amount: Money;
  reason: string;
  createdAt: string;
  lineItemIds?: string[];
}

export interface ReturnRequest {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'refunded';
  items: { lineItemId: string; quantity: number; reason: string }[];
  createdAt: string;
  updatedAt: string;
  refundAmount?: Money;
  returnLabel?: {
    carrier: string;
    trackingNumber: string;
    labelUrl: string;
  };
}

export interface Order {
  id: string;
  checkoutSessionId: string;
  merchantId: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;

  // Buyer
  buyer: BuyerInfo;

  // Items
  lineItems: LineItem[];

  // Fulfillment
  fulfillmentExpectations: FulfillmentExpectation[];
  shipments: Shipment[];

  // Payment
  paymentMethod: PaymentMethodInfo;
  paymentStatus: 'pending' | 'authorized' | 'captured' | 'refunded' | 'failed';

  // Totals
  totals: Totals;

  // Adjustments & Returns
  adjustments: Adjustment[];
  returns: ReturnRequest[];

  // Metadata
  metadata?: Record<string, any>;
}

// ============================================================================
// Identity Linking Types (OAuth 2.0)
// ============================================================================

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  scopes: string[];
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
  scope: string;
}

export interface IdentityLink {
  id: string;
  agentId: string;
  userId: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
}

// ============================================================================
// Webhook Types
// ============================================================================

export type WebhookEventType =
  | 'checkout.created'
  | 'checkout.updated'
  | 'checkout.completed'
  | 'order.created'
  | 'order.updated'
  | 'order.cancelled'
  | 'shipment.created'
  | 'shipment.updated'
  | 'delivery.completed'
  | 'return.requested'
  | 'return.approved'
  | 'refund.created';

export interface WebhookRegistration {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret: string;
  active: boolean;
  createdAt: string;
}

export interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: any;
}

// ============================================================================
// UCP Manifest Types
// ============================================================================

export type UCPCapability = 'checkout' | 'identity' | 'order' | 'payment_token_exchange';

export interface UCPCapabilityConfig {
  supported: boolean;
  endpoint?: string;
  webhooks?: boolean;
  extensions?: string[];
}

export interface UCPManifest {
  ucp_version: string;
  merchant: {
    id: string;
    name: string;
    logo?: string;
    supportUrl?: string;
  };
  capabilities: Record<UCPCapability, UCPCapabilityConfig>;
  payment_handlers: string[];
  supported_currencies: string[];
  supported_countries: string[];
  oauth?: OAuthConfig;
  mcp?: {
    server_name: string;
    tools_prefix?: string;
  };
}

// ============================================================================
// Capability Interfaces
// ============================================================================

export interface CheckoutCapability {
  createSession(params: {
    currency?: string;
    locale?: string;
    metadata?: Record<string, any>;
  }): Promise<CheckoutSession>;

  getSession(sessionId: string): Promise<CheckoutSession>;

  updateCart(sessionId: string, updates: {
    add?: Omit<LineItem, 'id' | 'totalPrice'>[];
    remove?: string[];
    update?: { id: string; quantity: number }[];
  }): Promise<CheckoutSession>;

  setBuyer(sessionId: string, buyer: BuyerInfo): Promise<CheckoutSession>;

  setFulfillment(sessionId: string, params: {
    optionId: string;
    destination: FulfillmentDestination;
  }): Promise<CheckoutSession>;

  applyDiscount(sessionId: string, code: string): Promise<{
    success: boolean;
    session: CheckoutSession;
    error?: string;
  }>;

  removeDiscount(sessionId: string, code: string): Promise<CheckoutSession>;

  complete(sessionId: string, payment: {
    methodId?: string;
    mandate?: any;  // AP2 PaymentMandate
  }): Promise<Order>;
}

export interface IdentityCapability {
  getOAuthConfig(): Promise<OAuthConfig>;

  requestAuthorization(params: {
    agentId: string;
    scopes: string[];
    redirectUri: string;
    state?: string;
  }): Promise<{ authorizationUrl: string }>;

  exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<TokenResponse>;

  refreshToken(refreshToken: string): Promise<TokenResponse>;

  revokeToken(token: string): Promise<void>;

  getIdentityLink(agentId: string): Promise<IdentityLink | null>;
}

export interface OrderCapability {
  getOrder(orderId: string): Promise<Order>;

  listOrders(params?: {
    status?: OrderStatus[];
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: Order[]; nextCursor?: string }>;

  cancelOrder(orderId: string, reason?: string): Promise<Order>;

  trackShipment(orderId: string, shipmentId?: string): Promise<Shipment[]>;

  initiateReturn(orderId: string, params: {
    items: { lineItemId: string; quantity: number; reason: string }[];
  }): Promise<ReturnRequest>;

  getReturn(orderId: string, returnId: string): Promise<ReturnRequest>;

  // Webhooks
  registerWebhook(params: {
    url: string;
    events: WebhookEventType[];
    secret: string;
  }): Promise<WebhookRegistration>;

  listWebhooks(): Promise<WebhookRegistration[]>;

  deleteWebhook(webhookId: string): Promise<void>;
}

// ============================================================================
// UCP Class Decorator Metadata
// ============================================================================

export interface UCPMetadata {
  enabled: boolean;
  capabilities: UCPCapability[];
  merchantId?: string;
  merchantName?: string;
}

export interface UCPMethodMetadata {
  capability: UCPCapability;
  operation: string;
}
