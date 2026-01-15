/**
 * Universal Commerce Protocol (UCP) Module
 *
 * Provides UCP support for Photon, enabling agentic commerce
 * with checkout, identity, order management, and AP2 payments.
 */

// Core UCP Types
export * from './types.js';

// AP2 Payment Types & Helpers
export * from './ap2/types.js';
export * from './ap2/mandates.js';
export * from './ap2/handlers.js';

// Manifest Generation
export * from './manifest.js';

// Capabilities
export { CheckoutService, MemorySessionStorage } from './capabilities/checkout.js';
export type { SessionStorage, CheckoutConfig, TaxCalculator, DiscountValidator, FulfillmentProvider } from './capabilities/checkout.js';

export { OrderService, MemoryOrderStorage, HttpWebhookDispatcher } from './capabilities/order.js';
export type { OrderStorage, WebhookDispatcher, OrderServiceConfig } from './capabilities/order.js';

export { IdentityService, MemoryTokenStorage } from './capabilities/identity.js';
export type { TokenStorage, IdentityServiceConfig } from './capabilities/identity.js';
