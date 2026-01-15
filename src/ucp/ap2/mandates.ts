/**
 * AP2 Mandate Creation and Validation Helpers
 */

import * as crypto from 'crypto';
import {
  CartMandate,
  CartMandateContents,
  IntentMandate,
  IntentMandateContents,
  PaymentMandate,
  PaymentMandateContents,
  PaymentResponse,
  PaymentMethodType,
  TransactionContext,
  RiskPayload
} from './types.js';
import { Money, Address, LineItem } from '../types.js';

// ============================================================================
// Cart Mandate Helpers
// ============================================================================

export interface CreateCartMandateParams {
  items: LineItem[];
  total: Money;
  merchant: {
    id: string;
    name: string;
    url?: string;
  };
  paymentMethods: PaymentMethodType[];
  fulfillment?: {
    method: string;
    destination: Address;
    estimatedDelivery?: string;
  };
  refundPeriodDays?: number;
}

/**
 * Create a new Cart Mandate for human-present transactions
 */
export function createCartMandate(
  params: CreateCartMandateParams,
  merchantPrivateKey?: string
): CartMandate {
  const contents: CartMandateContents = {
    id: `cart_${crypto.randomUUID()}`,
    userSignatureRequired: true,
    paymentRequest: {
      methodData: params.paymentMethods.map(method => ({
        supportedMethods: method,
        data: {}
      })),
      details: {
        id: `order_${crypto.randomUUID()}`,
        displayItems: params.items.map(item => ({
          label: item.label,
          amount: item.totalPrice
        })),
        total: {
          label: 'Total',
          amount: params.total
        }
      }
    },
    merchant: params.merchant,
    fulfillment: params.fulfillment,
    refundConditions: params.refundPeriodDays ? {
      period: params.refundPeriodDays,
      policy: `Full refund within ${params.refundPeriodDays} days of delivery`
    } : undefined
  };

  const timestamp = new Date().toISOString();
  const merchantSignature = merchantPrivateKey
    ? signMandate(contents, merchantPrivateKey)
    : `sig_merchant_${crypto.randomBytes(16).toString('hex')}`;

  return {
    contents,
    merchantSignature,
    timestamp
  };
}

/**
 * Add user signature to Cart Mandate
 */
export function signCartMandate(
  mandate: CartMandate,
  userPrivateKey?: string
): CartMandate {
  const userSignature = userPrivateKey
    ? signMandate(mandate.contents, userPrivateKey)
    : `sig_user_${crypto.randomBytes(16).toString('hex')}`;

  return {
    ...mandate,
    userSignature,
    userSignatureTimestamp: new Date().toISOString()
  };
}

// ============================================================================
// Intent Mandate Helpers
// ============================================================================

export interface CreateIntentMandateParams {
  description: string;
  productCategories?: string[];
  specificSkus?: string[];
  keywords?: string[];
  maxPrice: Money;
  minPrice?: Money;
  quantity?: { min?: number; max?: number };
  allowedMerchants?: string[];
  validForHours?: number;
  executeWhen?: 'immediately' | 'price_drop' | 'in_stock' | 'scheduled';
  paymentMethods: PaymentMethodType[];
  promptPlayback?: string;
}

/**
 * Create a new Intent Mandate for autonomous agent purchases
 */
export function createIntentMandate(
  params: CreateIntentMandateParams,
  userPrivateKey?: string
): IntentMandate {
  const now = new Date();
  const validUntil = new Date(now.getTime() + (params.validForHours || 24) * 60 * 60 * 1000);

  const contents: IntentMandateContents = {
    id: `intent_${crypto.randomUUID()}`,
    intent: {
      description: params.description,
      productCategories: params.productCategories,
      specificSkus: params.specificSkus,
      keywords: params.keywords
    },
    constraints: {
      maxPrice: params.maxPrice,
      minPrice: params.minPrice,
      quantity: params.quantity,
      merchants: params.allowedMerchants
    },
    timing: {
      validFrom: now.toISOString(),
      validUntil: validUntil.toISOString(),
      executeWhen: params.executeWhen || 'immediately'
    },
    paymentAuthorization: {
      methodCategories: params.paymentMethods,
      preAuthorizedAmount: params.maxPrice
    },
    promptPlayback: params.promptPlayback
  };

  const userSignature = userPrivateKey
    ? signMandate(contents, userPrivateKey)
    : `sig_user_${crypto.randomBytes(16).toString('hex')}`;

  return {
    contents,
    userSignature,
    userSignatureTimestamp: now.toISOString()
  };
}

/**
 * Check if Intent Mandate is still valid
 */
export function isIntentMandateValid(mandate: IntentMandate): boolean {
  const now = new Date();
  const validFrom = new Date(mandate.contents.timing.validFrom);
  const validUntil = new Date(mandate.contents.timing.validUntil);

  return now >= validFrom && now <= validUntil;
}

/**
 * Check if a price satisfies Intent Mandate constraints
 */
export function checkPriceConstraints(
  mandate: IntentMandate,
  price: Money
): { valid: boolean; reason?: string } {
  const { constraints } = mandate.contents;

  if (price.currency !== constraints.maxPrice.currency) {
    return { valid: false, reason: 'Currency mismatch' };
  }

  if (price.amount > constraints.maxPrice.amount) {
    return { valid: false, reason: `Price ${price.amount} exceeds max ${constraints.maxPrice.amount}` };
  }

  if (constraints.minPrice && price.amount < constraints.minPrice.amount) {
    return { valid: false, reason: `Price ${price.amount} below min ${constraints.minPrice.amount}` };
  }

  return { valid: true };
}

// ============================================================================
// Payment Mandate Helpers
// ============================================================================

export interface CreatePaymentMandateParams {
  sourceMandate: CartMandate | IntentMandate;
  paymentResponse: PaymentResponse;
  agentName?: string;
}

/**
 * Create a Payment Mandate from Cart or Intent Mandate
 */
export function createPaymentMandate(
  params: CreatePaymentMandateParams,
  userPrivateKey?: string
): PaymentMandate {
  const { sourceMandate, paymentResponse, agentName } = params;

  const isCartMandate = 'merchantSignature' in sourceMandate;
  const sourceMandateType = isCartMandate ? 'cart' : 'intent';
  const sourceMandateId = sourceMandate.contents.id;

  // Get total from source mandate
  let total: Money;
  if (isCartMandate) {
    total = (sourceMandate as CartMandate).contents.paymentRequest.details.total.amount;
  } else {
    total = (sourceMandate as IntentMandate).contents.constraints.maxPrice;
  }

  const contents: PaymentMandateContents = {
    paymentMandateId: `pm_${crypto.randomUUID()}`,
    paymentDetailsId: paymentResponse.requestId,
    paymentDetailsTotal: {
      label: 'Total',
      amount: total,
      refundPeriod: isCartMandate
        ? (sourceMandate as CartMandate).contents.refundConditions?.period
        : 30
    },
    paymentResponse,
    merchantAgent: agentName || 'MerchantAgent',
    sourceMandateType,
    sourceMandateId,
    timestamp: new Date().toISOString()
  };

  const userAuthorization = userPrivateKey
    ? signMandate(contents, userPrivateKey)
    : `auth_${crypto.randomBytes(32).toString('base64url')}`;

  return {
    paymentMandateContents: contents,
    userAuthorization
  };
}

// ============================================================================
// Signature Helpers
// ============================================================================

/**
 * Sign mandate contents (simplified - production should use proper PKI)
 */
function signMandate(contents: any, privateKey: string): string {
  const payload = JSON.stringify(contents);
  const hmac = crypto.createHmac('sha256', privateKey);
  hmac.update(payload);
  return `sig_${hmac.digest('base64url')}`;
}

/**
 * Verify mandate signature
 */
export function verifyMandateSignature(
  contents: any,
  signature: string,
  publicKey: string
): boolean {
  // Simplified verification - production should use proper PKI
  const expectedSig = signMandate(contents, publicKey);
  return signature === expectedSig;
}

// ============================================================================
// Transaction Context
// ============================================================================

/**
 * Create transaction context for audit trail
 */
export function createTransactionContext(params: {
  modality: 'human_present' | 'human_not_present';
  initiatedBy: 'user' | 'agent';
  mandates: (CartMandate | IntentMandate | PaymentMandate)[];
}): TransactionContext {
  return {
    modality: params.modality,
    agentPresent: true,
    initiatedBy: params.initiatedBy,
    sessionId: `session_${crypto.randomUUID()}`,
    startTime: new Date().toISOString(),
    mandateChain: params.mandates.map(mandate => {
      if ('merchantSignature' in mandate) {
        return {
          type: 'cart' as const,
          id: mandate.contents.id,
          timestamp: mandate.timestamp
        };
      } else if ('paymentMandateContents' in mandate) {
        return {
          type: 'payment' as const,
          id: mandate.paymentMandateContents.paymentMandateId,
          timestamp: mandate.paymentMandateContents.timestamp
        };
      } else {
        return {
          type: 'intent' as const,
          id: mandate.contents.id,
          timestamp: mandate.userSignatureTimestamp
        };
      }
    })
  };
}

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Create risk payload for payment authorization
 */
export function createRiskPayload(params: {
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  authLevel: 'none' | 'basic' | 'mfa' | 'biometric';
  sessionDuration?: number;
  previousPurchases?: number;
  agentVerified?: boolean;
}): RiskPayload {
  return {
    ...params,
    authTimestamp: new Date().toISOString()
  };
}
