/**
 * Agent Payments Protocol (AP2) Type Definitions
 *
 * Based on AP2 specification from https://github.com/google-agentic-commerce/AP2
 * Provides secure payment mandate handling for agentic commerce.
 */

import { Money, Address, LineItem } from '../types.js';

// ============================================================================
// Core AP2 Types
// ============================================================================

export interface DeviceInfo {
  model: string;
  vendor: string;
  platform?: string;
  appPackage?: string;
  appVersion?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  version: string;
  capabilities?: string[];
}

// ============================================================================
// Payment Method Types
// ============================================================================

export type PaymentMethodType =
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'WALLET'
  | 'CRYPTO'
  | 'STABLECOIN';

export interface PaymentMethodData {
  supportedMethods: PaymentMethodType;
  data?: {
    paymentProcessorUrl?: string;
    supportedNetworks?: string[];  // visa, mastercard, amex
    supportedTypes?: string[];     // credit, debit, prepaid
  };
}

export interface PaymentDetails {
  id: string;
  displayItems: {
    label: string;
    amount: Money;
    pending?: boolean;
  }[];
  total: {
    label: string;
    amount: Money;
  };
  shippingOptions?: {
    id: string;
    label: string;
    amount: Money;
    selected?: boolean;
  }[];
}

export interface PaymentResponse {
  requestId: string;
  methodName: PaymentMethodType;
  details: {
    token?: string;
    cardNetwork?: string;
    cardLastFour?: string;
    billingAddress?: Address;
  };
}

// ============================================================================
// Cart Mandate (Human Present)
// ============================================================================

/**
 * Cart Mandate - Used when human is present for explicit approval
 *
 * Captures:
 * - Exact items being purchased
 * - Final pricing
 * - Selected payment method
 * - Merchant commitment via signature
 */
export interface CartMandateContents {
  id: string;
  userSignatureRequired: boolean;

  // Payment request details
  paymentRequest: {
    methodData: PaymentMethodData[];
    details: PaymentDetails;
    options?: {
      requestPayerName?: boolean;
      requestPayerEmail?: boolean;
      requestPayerPhone?: boolean;
      requestShipping?: boolean;
    };
  };

  // Merchant info
  merchant: {
    id: string;
    name: string;
    url?: string;
  };

  // Fulfillment
  fulfillment?: {
    method: string;
    destination: Address;
    estimatedDelivery?: string;
  };

  // Refund policy
  refundConditions?: {
    period: number;  // Days
    policy: string;
  };
}

export interface CartMandate {
  contents: CartMandateContents;
  merchantSignature: string;
  timestamp: string;
  userSignature?: string;
  userSignatureTimestamp?: string;
}

// ============================================================================
// Intent Mandate (Human Not Present)
// ============================================================================

/**
 * Intent Mandate - Used for delegated autonomous purchases
 *
 * Captures:
 * - Shopping intent (what to buy)
 * - Constraints (price limits, timing)
 * - Pre-authorization for agent to act
 */
export interface IntentMandateContents {
  id: string;

  // Shopping intent
  intent: {
    description: string;       // Natural language description
    productCategories?: string[];
    specificSkus?: string[];
    keywords?: string[];
  };

  // Constraints
  constraints: {
    maxPrice: Money;
    minPrice?: Money;
    quantity?: {
      min?: number;
      max?: number;
    };
    merchants?: string[];      // Allowed merchant IDs
    excludeMerchants?: string[];
  };

  // Timing
  timing: {
    validFrom: string;
    validUntil: string;        // TTL
    executeWhen?: 'immediately' | 'price_drop' | 'in_stock' | 'scheduled';
    scheduledTime?: string;
  };

  // Payment authorization
  paymentAuthorization: {
    methodCategories: PaymentMethodType[];  // Not specific method
    preAuthorizedAmount?: Money;
  };

  // Agent understanding (for audit)
  promptPlayback?: string;     // Agent's interpretation
}

export interface IntentMandate {
  contents: IntentMandateContents;
  userSignature: string;
  userSignatureTimestamp: string;
  deviceAttestation?: string;
}

// ============================================================================
// Payment Mandate
// ============================================================================

/**
 * Payment Mandate - Links transaction to payment
 *
 * Provides:
 * - Visibility into agentic transaction
 * - Bound reference to Cart/Intent Mandate
 * - Dispute evidence container
 */
export interface PaymentMandateContents {
  paymentMandateId: string;
  paymentDetailsId: string;    // From PaymentDetails

  // Transaction details
  paymentDetailsTotal: {
    label: string;
    amount: Money;
    refundPeriod?: number;
  };

  // Payment response
  paymentResponse: PaymentResponse;

  // Agent info
  agentInfo?: AgentInfo;
  merchantAgent: string;

  // Reference to source mandate
  sourceMandateType: 'cart' | 'intent';
  sourceMandateId: string;

  timestamp: string;
}

export interface PaymentMandate {
  paymentMandateContents: PaymentMandateContents;
  userAuthorization: string;   // Verifiable credential / signature
}

// ============================================================================
// Verifiable Credentials
// ============================================================================

export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: {
    id: string;
    [key: string]: any;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

// ============================================================================
// Risk & Fraud Signals
// ============================================================================

export interface RiskPayload {
  // Device signals
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;

  // Behavioral signals
  sessionDuration?: number;
  interactionCount?: number;
  previousPurchases?: number;

  // Authentication level
  authLevel: 'none' | 'basic' | 'mfa' | 'biometric';
  authTimestamp?: string;

  // Agent signals
  agentTrustScore?: number;
  agentVerified?: boolean;

  // Custom signals
  custom?: Record<string, any>;
}

// ============================================================================
// Dispute Evidence
// ============================================================================

export type DisputeReason =
  | 'unauthorized'
  | 'not_received'
  | 'not_as_described'
  | 'duplicate'
  | 'cancelled'
  | 'credit_not_processed'
  | 'other';

export interface DisputeEvidence {
  transactionId: string;
  reason: DisputeReason;

  // Mandate evidence
  cartMandate?: CartMandate;
  intentMandate?: IntentMandate;
  paymentMandate?: PaymentMandate;

  // Fulfillment evidence
  fulfillmentProof?: {
    carrier: string;
    trackingNumber: string;
    deliveryConfirmation?: string;
    signatureImage?: string;
  };

  // Communication evidence
  communications?: {
    timestamp: string;
    channel: string;
    content: string;
  }[];

  // Additional documentation
  additionalDocs?: {
    type: string;
    url: string;
    description: string;
  }[];
}

// ============================================================================
// Agent Cards (Discovery)
// ============================================================================

export interface AgentCapabilityExtension {
  description: string;
  required: boolean;
  uri: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  url: string;

  capabilities?: {
    extensions?: AgentCapabilityExtension[];
  };

  skills?: AgentSkill[];

  security?: {
    oauth2?: string[];
  }[];
}

// ============================================================================
// Transaction Flow Types
// ============================================================================

export type TransactionModality = 'human_present' | 'human_not_present';

export interface TransactionContext {
  modality: TransactionModality;
  agentPresent: boolean;
  initiatedBy: 'user' | 'agent';

  // Session info
  sessionId: string;
  startTime: string;

  // Mandate chain
  mandateChain: {
    type: 'cart' | 'intent' | 'payment';
    id: string;
    timestamp: string;
  }[];
}

// ============================================================================
// Payment Handler Interface
// ============================================================================

export interface PaymentHandler {
  name: string;
  supportedMethods: PaymentMethodType[];
  supportedCurrencies: string[];

  // Tokenization
  tokenize(params: {
    mandate: PaymentMandate;
    paymentMethod: PaymentMethodData;
  }): Promise<{ token: string; expiresAt: string }>;

  // Authorization
  authorize(params: {
    token: string;
    amount: Money;
    mandate: PaymentMandate;
    riskPayload?: RiskPayload;
  }): Promise<{
    authorizationId: string;
    status: 'authorized' | 'declined' | 'pending';
    declineReason?: string;
  }>;

  // Capture
  capture(params: {
    authorizationId: string;
    amount?: Money;  // Partial capture
  }): Promise<{
    captureId: string;
    status: 'captured' | 'failed';
  }>;

  // Refund
  refund(params: {
    captureId: string;
    amount?: Money;  // Partial refund
    reason?: string;
  }): Promise<{
    refundId: string;
    status: 'refunded' | 'pending' | 'failed';
  }>;

  // Void (before capture)
  void(authorizationId: string): Promise<{
    status: 'voided' | 'failed';
  }>;
}
