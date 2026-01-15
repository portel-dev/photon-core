/**
 * AP2 Payment Handler Implementations
 *
 * Adapters for various payment providers that implement the AP2 PaymentHandler interface.
 */

import * as crypto from 'crypto';
import {
  PaymentMandate,
  PaymentHandler,
  PaymentMethodType,
  PaymentMethodData,
  RiskPayload
} from './types.js';
import { Money } from '../types.js';

// ============================================================================
// Base Payment Handler
// ============================================================================

export interface PaymentHandlerConfig {
  merchantId: string;
  environment: 'sandbox' | 'production';
}

export abstract class BasePaymentHandler implements PaymentHandler {
  abstract name: string;
  abstract supportedMethods: PaymentMethodType[];
  abstract supportedCurrencies: string[];

  protected config: PaymentHandlerConfig;

  constructor(config: PaymentHandlerConfig) {
    this.config = config;
  }

  abstract tokenize(params: {
    mandate: PaymentMandate;
    paymentMethod: PaymentMethodData;
  }): Promise<{ token: string; expiresAt: string }>;

  abstract authorize(params: {
    token: string;
    amount: Money;
    mandate: PaymentMandate;
    riskPayload?: RiskPayload;
  }): Promise<{
    authorizationId: string;
    status: 'authorized' | 'declined' | 'pending';
    declineReason?: string;
  }>;

  abstract capture(params: {
    authorizationId: string;
    amount?: Money;
  }): Promise<{
    captureId: string;
    status: 'captured' | 'failed';
  }>;

  abstract refund(params: {
    captureId: string;
    amount?: Money;
    reason?: string;
  }): Promise<{
    refundId: string;
    status: 'refunded' | 'pending' | 'failed';
  }>;

  abstract void(authorizationId: string): Promise<{
    status: 'voided' | 'failed';
  }>;

  protected generateId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
  }
}

// ============================================================================
// Mock Payment Handler (for testing/development)
// ============================================================================

export interface MockPaymentHandlerConfig extends PaymentHandlerConfig {
  /** Simulate processing delay in ms */
  processingDelayMs?: number;
  /** Failure rate (0-1) for testing error handling */
  failureRate?: number;
  /** Specific error to return */
  simulatedError?: string;
}

interface MockToken {
  mandate: PaymentMandate;
  paymentMethod: PaymentMethodData;
  expiresAt: string;
}

interface MockAuthorization {
  token: string;
  amount: Money;
  mandate: PaymentMandate;
  status: 'authorized' | 'captured' | 'voided' | 'refunded';
  captureId?: string;
}

/**
 * Mock payment handler for testing and development.
 * Simulates payment processing without actual charges.
 */
export class MockPaymentHandler extends BasePaymentHandler {
  name = 'mock';
  supportedMethods: PaymentMethodType[] = ['CARD', 'BANK_TRANSFER', 'WALLET'];
  supportedCurrencies = ['USD', 'EUR', 'GBP'];

  private mockConfig: MockPaymentHandlerConfig;
  private tokens = new Map<string, MockToken>();
  private authorizations = new Map<string, MockAuthorization>();

  constructor(config: MockPaymentHandlerConfig) {
    super(config);
    this.mockConfig = config;
  }

  async tokenize(params: {
    mandate: PaymentMandate;
    paymentMethod: PaymentMethodData;
  }): Promise<{ token: string; expiresAt: string }> {
    await this.maybeDelay();

    if (this.shouldFail()) {
      throw new Error(this.mockConfig.simulatedError || 'Simulated tokenization failure');
    }

    const token = this.generateId('tok');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    this.tokens.set(token, {
      mandate: params.mandate,
      paymentMethod: params.paymentMethod,
      expiresAt
    });

    return { token, expiresAt };
  }

  async authorize(params: {
    token: string;
    amount: Money;
    mandate: PaymentMandate;
    riskPayload?: RiskPayload;
  }): Promise<{
    authorizationId: string;
    status: 'authorized' | 'declined' | 'pending';
    declineReason?: string;
  }> {
    await this.maybeDelay();

    const tokenData = this.tokens.get(params.token);
    if (!tokenData) {
      return {
        authorizationId: this.generateId('auth'),
        status: 'declined',
        declineReason: 'Invalid or expired token'
      };
    }

    if (this.shouldFail()) {
      return {
        authorizationId: this.generateId('auth'),
        status: 'declined',
        declineReason: this.mockConfig.simulatedError || 'Simulated authorization failure'
      };
    }

    const authorizationId = this.generateId('auth');

    this.authorizations.set(authorizationId, {
      token: params.token,
      amount: params.amount,
      mandate: params.mandate,
      status: 'authorized'
    });

    // Delete used token
    this.tokens.delete(params.token);

    return {
      authorizationId,
      status: 'authorized'
    };
  }

  async capture(params: {
    authorizationId: string;
    amount?: Money;
  }): Promise<{
    captureId: string;
    status: 'captured' | 'failed';
  }> {
    await this.maybeDelay();

    const auth = this.authorizations.get(params.authorizationId);
    if (!auth || auth.status !== 'authorized') {
      return {
        captureId: this.generateId('cap'),
        status: 'failed'
      };
    }

    if (this.shouldFail()) {
      return {
        captureId: this.generateId('cap'),
        status: 'failed'
      };
    }

    const captureId = this.generateId('cap');
    auth.status = 'captured';
    auth.captureId = captureId;

    return {
      captureId,
      status: 'captured'
    };
  }

  async refund(params: {
    captureId: string;
    amount?: Money;
    reason?: string;
  }): Promise<{
    refundId: string;
    status: 'refunded' | 'pending' | 'failed';
  }> {
    await this.maybeDelay();

    // Find authorization by capture ID
    let foundAuth: MockAuthorization | undefined;
    for (const auth of this.authorizations.values()) {
      if (auth.captureId === params.captureId) {
        foundAuth = auth;
        break;
      }
    }

    if (!foundAuth || foundAuth.status !== 'captured') {
      return {
        refundId: this.generateId('ref'),
        status: 'failed'
      };
    }

    if (this.shouldFail()) {
      return {
        refundId: this.generateId('ref'),
        status: 'failed'
      };
    }

    foundAuth.status = 'refunded';

    return {
      refundId: this.generateId('ref'),
      status: 'refunded'
    };
  }

  async void(authorizationId: string): Promise<{
    status: 'voided' | 'failed';
  }> {
    await this.maybeDelay();

    const auth = this.authorizations.get(authorizationId);
    if (!auth || auth.status !== 'authorized') {
      return { status: 'failed' };
    }

    if (this.shouldFail()) {
      return { status: 'failed' };
    }

    auth.status = 'voided';
    return { status: 'voided' };
  }

  private async maybeDelay(): Promise<void> {
    if (this.mockConfig.processingDelayMs) {
      await new Promise(resolve => setTimeout(resolve, this.mockConfig.processingDelayMs));
    }
  }

  private shouldFail(): boolean {
    if (this.mockConfig.simulatedError) return true;
    if (this.mockConfig.failureRate && Math.random() < this.mockConfig.failureRate) return true;
    return false;
  }

  /** Clear all stored data (for testing) */
  clear(): void {
    this.tokens.clear();
    this.authorizations.clear();
  }
}

// ============================================================================
// Stripe Payment Handler
// ============================================================================

export interface StripeConfig extends PaymentHandlerConfig {
  secretKey: string;
  webhookSecret?: string;
}

/**
 * Stripe payment handler adapter.
 * Requires stripe package to be installed.
 */
export class StripePaymentHandler extends BasePaymentHandler {
  name = 'stripe';
  supportedMethods: PaymentMethodType[] = ['CARD', 'BANK_TRANSFER', 'WALLET'];
  supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

  private stripeConfig: StripeConfig;
  private stripe: any; // Stripe SDK instance

  constructor(config: StripeConfig) {
    super(config);
    this.stripeConfig = config;
  }

  /**
   * Initialize Stripe SDK (lazy loading)
   */
  private async getStripe(): Promise<any> {
    if (!this.stripe) {
      try {
        // Dynamic import to avoid hard dependency
        const { default: Stripe } = await import('stripe' as any);
        this.stripe = new Stripe(this.stripeConfig.secretKey, {
          apiVersion: '2024-12-18.acacia'
        });
      } catch {
        throw new Error('Stripe package not installed. Run: npm install stripe');
      }
    }
    return this.stripe;
  }

  async tokenize(params: {
    mandate: PaymentMandate;
    paymentMethod: PaymentMethodData;
  }): Promise<{ token: string; expiresAt: string }> {
    const stripe = await this.getStripe();

    // Create a SetupIntent to tokenize the payment method
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: this.mapMethodToStripe(params.paymentMethod.supportedMethods),
      metadata: {
        mandateId: params.mandate.paymentMandateContents.paymentMandateId
      }
    });

    return {
      token: setupIntent.client_secret,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };
  }

  async authorize(params: {
    token: string;
    amount: Money;
    mandate: PaymentMandate;
    riskPayload?: RiskPayload;
  }): Promise<{
    authorizationId: string;
    status: 'authorized' | 'declined' | 'pending';
    declineReason?: string;
  }> {
    try {
      const stripe = await this.getStripe();

      // Create PaymentIntent with capture_method = manual for auth-only
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(params.amount.amount * 100), // Stripe uses cents
        currency: params.amount.currency.toLowerCase(),
        capture_method: 'manual',
        metadata: {
          mandateId: params.mandate.paymentMandateContents.paymentMandateId
        }
      });

      return {
        authorizationId: paymentIntent.id,
        status: paymentIntent.status === 'requires_capture' ? 'authorized' : 'pending'
      };

    } catch (error: any) {
      return {
        authorizationId: this.generateId('auth'),
        status: 'declined',
        declineReason: error.message || 'Stripe authorization failed'
      };
    }
  }

  async capture(params: {
    authorizationId: string;
    amount?: Money;
  }): Promise<{
    captureId: string;
    status: 'captured' | 'failed';
  }> {
    try {
      const stripe = await this.getStripe();

      const captureParams: any = {};
      if (params.amount) {
        captureParams.amount_to_capture = Math.round(params.amount.amount * 100);
      }

      const paymentIntent = await stripe.paymentIntents.capture(
        params.authorizationId,
        captureParams
      );

      return {
        captureId: paymentIntent.latest_charge || params.authorizationId,
        status: paymentIntent.status === 'succeeded' ? 'captured' : 'failed'
      };

    } catch {
      return {
        captureId: this.generateId('cap'),
        status: 'failed'
      };
    }
  }

  async refund(params: {
    captureId: string;
    amount?: Money;
    reason?: string;
  }): Promise<{
    refundId: string;
    status: 'refunded' | 'pending' | 'failed';
  }> {
    try {
      const stripe = await this.getStripe();

      const refundParams: any = {
        charge: params.captureId,
        reason: params.reason || 'requested_by_customer'
      };

      if (params.amount) {
        refundParams.amount = Math.round(params.amount.amount * 100);
      }

      const refund = await stripe.refunds.create(refundParams);

      return {
        refundId: refund.id,
        status: refund.status === 'succeeded' ? 'refunded' : 'pending'
      };

    } catch {
      return {
        refundId: this.generateId('ref'),
        status: 'failed'
      };
    }
  }

  async void(authorizationId: string): Promise<{
    status: 'voided' | 'failed';
  }> {
    try {
      const stripe = await this.getStripe();
      await stripe.paymentIntents.cancel(authorizationId);
      return { status: 'voided' };
    } catch {
      return { status: 'failed' };
    }
  }

  private mapMethodToStripe(method: PaymentMethodType): string[] {
    switch (method) {
      case 'CARD': return ['card'];
      case 'BANK_TRANSFER': return ['us_bank_account', 'sepa_debit'];
      case 'WALLET': return ['apple_pay', 'google_pay'];
      default: return ['card'];
    }
  }

  /**
   * Verify Stripe webhook signature
   */
  verifyWebhook(payload: string, signature: string): any {
    if (!this.stripeConfig.webhookSecret) {
      throw new Error('Webhook secret not configured');
    }

    if (!this.stripe) {
      throw new Error('Stripe not initialized');
    }

    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.stripeConfig.webhookSecret
    );
  }
}

// ============================================================================
// Adyen Payment Handler
// ============================================================================

export interface AdyenConfig extends PaymentHandlerConfig {
  apiKey: string;
  merchantAccount: string;
  liveEndpointUrlPrefix?: string;
}

/**
 * Adyen payment handler adapter.
 * Requires @adyen/api-library package.
 */
export class AdyenPaymentHandler extends BasePaymentHandler {
  name = 'adyen';
  supportedMethods: PaymentMethodType[] = ['CARD', 'BANK_TRANSFER', 'WALLET'];
  supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY'];

  private adyenConfig: AdyenConfig;
  private client: any;
  private checkout: any;

  constructor(config: AdyenConfig) {
    super(config);
    this.adyenConfig = config;
  }

  /**
   * Initialize Adyen client (lazy loading)
   */
  private async getCheckout(): Promise<any> {
    if (!this.checkout) {
      try {
        // Dynamic import to avoid hard dependency
        const { Client, CheckoutAPI, Config } = await import('@adyen/api-library' as any);

        const config = new Config();
        config.apiKey = this.adyenConfig.apiKey;
        config.merchantAccount = this.adyenConfig.merchantAccount;

        if (this.config.environment === 'production') {
          config.environment = 'LIVE';
          if (this.adyenConfig.liveEndpointUrlPrefix) {
            config.liveEndpointUrlPrefix = this.adyenConfig.liveEndpointUrlPrefix;
          }
        } else {
          config.environment = 'TEST';
        }

        this.client = new Client({ config });
        this.checkout = new CheckoutAPI(this.client);
      } catch {
        throw new Error('Adyen package not installed. Run: npm install @adyen/api-library');
      }
    }
    return this.checkout;
  }

  async tokenize(params: {
    mandate: PaymentMandate;
    paymentMethod: PaymentMethodData;
  }): Promise<{ token: string; expiresAt: string }> {
    // Adyen tokenization typically happens client-side
    // Server-side we just return a session ID
    const sessionId = this.generateId('adyen_session');
    return {
      token: sessionId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
  }

  async authorize(params: {
    token: string;
    amount: Money;
    mandate: PaymentMandate;
    riskPayload?: RiskPayload;
  }): Promise<{
    authorizationId: string;
    status: 'authorized' | 'declined' | 'pending';
    declineReason?: string;
  }> {
    try {
      const checkout = await this.getCheckout();

      const paymentRequest = {
        amount: {
          value: Math.round(params.amount.amount * 100),
          currency: params.amount.currency
        },
        reference: params.mandate.paymentMandateContents.paymentMandateId,
        merchantAccount: this.adyenConfig.merchantAccount,
        metadata: {
          mandateId: params.mandate.paymentMandateContents.paymentMandateId
        }
      };

      const response = await checkout.PaymentsApi.payments(paymentRequest);

      return {
        authorizationId: response.pspReference,
        status: this.mapAdyenStatus(response.resultCode),
        declineReason: response.refusalReason
      };

    } catch (error: any) {
      return {
        authorizationId: this.generateId('auth'),
        status: 'declined',
        declineReason: error.message || 'Adyen authorization failed'
      };
    }
  }

  async capture(params: {
    authorizationId: string;
    amount?: Money;
  }): Promise<{
    captureId: string;
    status: 'captured' | 'failed';
  }> {
    try {
      const checkout = await this.getCheckout();

      const captureRequest: any = {
        merchantAccount: this.adyenConfig.merchantAccount,
        originalReference: params.authorizationId,
        reference: `capture_${this.generateId('cap')}`
      };

      if (params.amount) {
        captureRequest.amount = {
          value: Math.round(params.amount.amount * 100),
          currency: params.amount.currency
        };
      }

      const response = await checkout.ModificationsApi.captureAuthorisedPayment(
        params.authorizationId,
        captureRequest
      );

      return {
        captureId: response.pspReference,
        status: response.status === 'received' ? 'captured' : 'failed'
      };

    } catch {
      return {
        captureId: this.generateId('cap'),
        status: 'failed'
      };
    }
  }

  async refund(params: {
    captureId: string;
    amount?: Money;
    reason?: string;
  }): Promise<{
    refundId: string;
    status: 'refunded' | 'pending' | 'failed';
  }> {
    try {
      const checkout = await this.getCheckout();

      const refundRequest: any = {
        merchantAccount: this.adyenConfig.merchantAccount,
        originalReference: params.captureId,
        reference: `refund_${this.generateId('ref')}`
      };

      if (params.amount) {
        refundRequest.amount = {
          value: Math.round(params.amount.amount * 100),
          currency: params.amount.currency
        };
      }

      const response = await checkout.ModificationsApi.refundCapturedPayment(
        params.captureId,
        refundRequest
      );

      return {
        refundId: response.pspReference,
        status: response.status === 'received' ? 'pending' : 'failed'
      };

    } catch {
      return {
        refundId: this.generateId('ref'),
        status: 'failed'
      };
    }
  }

  async void(authorizationId: string): Promise<{
    status: 'voided' | 'failed';
  }> {
    try {
      const checkout = await this.getCheckout();

      const cancelRequest = {
        merchantAccount: this.adyenConfig.merchantAccount,
        originalReference: authorizationId,
        reference: `cancel_${this.generateId('void')}`
      };

      const response = await checkout.ModificationsApi.cancelAuthorisedPayment(
        authorizationId,
        cancelRequest
      );

      return {
        status: response.status === 'received' ? 'voided' : 'failed'
      };

    } catch {
      return { status: 'failed' };
    }
  }

  private mapAdyenStatus(resultCode: string): 'authorized' | 'declined' | 'pending' {
    switch (resultCode) {
      case 'Authorised':
        return 'authorized';
      case 'Pending':
      case 'Received':
        return 'pending';
      default:
        return 'declined';
    }
  }
}

// ============================================================================
// Payment Handler Factory
// ============================================================================

export type PaymentHandlerType = 'mock' | 'stripe' | 'adyen';

export interface CreatePaymentHandlerParams {
  type: PaymentHandlerType;
  config: PaymentHandlerConfig & Record<string, any>;
}

/**
 * Factory function to create payment handlers
 */
export function createPaymentHandler(params: CreatePaymentHandlerParams): PaymentHandler {
  switch (params.type) {
    case 'mock':
      return new MockPaymentHandler(params.config as MockPaymentHandlerConfig);

    case 'stripe':
      return new StripePaymentHandler(params.config as StripeConfig);

    case 'adyen':
      return new AdyenPaymentHandler(params.config as AdyenConfig);

    default:
      throw new Error(`Unknown payment handler type: ${params.type}`);
  }
}
