/**
 * UCP Manifest Generator
 *
 * Auto-generates /.well-known/ucp manifest from Photon class metadata.
 */

import {
  UCPManifest,
  UCPCapability,
  UCPCapabilityConfig,
  UCPMetadata,
  UCPMethodMetadata
} from './types.js';

// ============================================================================
// Manifest Generation
// ============================================================================

export interface GenerateManifestParams {
  merchantId: string;
  merchantName: string;
  merchantLogo?: string;
  supportUrl?: string;
  capabilities: UCPCapability[];
  paymentHandlers?: string[];
  supportedCurrencies?: string[];
  supportedCountries?: string[];
  baseUrl?: string;
  mcpServerName?: string;
}

/**
 * Generate UCP manifest from parameters
 */
export function generateUCPManifest(params: GenerateManifestParams): UCPManifest {
  const {
    merchantId,
    merchantName,
    merchantLogo,
    supportUrl,
    capabilities,
    paymentHandlers = ['stripe'],
    supportedCurrencies = ['USD'],
    supportedCountries = ['US'],
    baseUrl = '',
    mcpServerName
  } = params;

  const capabilityConfigs: Record<UCPCapability, UCPCapabilityConfig> = {
    checkout: {
      supported: capabilities.includes('checkout'),
      endpoint: capabilities.includes('checkout') ? `${baseUrl}/ucp/checkout` : undefined,
      webhooks: false
    },
    identity: {
      supported: capabilities.includes('identity'),
      endpoint: capabilities.includes('identity') ? `${baseUrl}/ucp/identity` : undefined
    },
    order: {
      supported: capabilities.includes('order'),
      endpoint: capabilities.includes('order') ? `${baseUrl}/ucp/order` : undefined,
      webhooks: capabilities.includes('order')
    },
    payment_token_exchange: {
      supported: capabilities.includes('payment_token_exchange'),
      endpoint: capabilities.includes('payment_token_exchange')
        ? `${baseUrl}/ucp/payment-token`
        : undefined
    }
  };

  const manifest: UCPManifest = {
    ucp_version: '1.0',
    merchant: {
      id: merchantId,
      name: merchantName,
      logo: merchantLogo,
      supportUrl
    },
    capabilities: capabilityConfigs,
    payment_handlers: paymentHandlers,
    supported_currencies: supportedCurrencies,
    supported_countries: supportedCountries
  };

  // Add OAuth config if identity capability is enabled
  if (capabilities.includes('identity')) {
    manifest.oauth = {
      authorizationEndpoint: `${baseUrl}/oauth/authorize`,
      tokenEndpoint: `${baseUrl}/oauth/token`,
      revocationEndpoint: `${baseUrl}/oauth/revoke`,
      scopes: ['checkout.read', 'checkout.write', 'order.read', 'order.write']
    };
  }

  // Add MCP config if server name provided
  if (mcpServerName) {
    manifest.mcp = {
      server_name: mcpServerName,
      tools_prefix: 'ucp'
    };
  }

  return manifest;
}

// ============================================================================
// JSDoc Annotation Parsing
// ============================================================================

/**
 * Parse UCP metadata from JSDoc annotations
 *
 * Supports:
 * - @ucp - Enable UCP for class
 * - @capability checkout|identity|order|payment_token_exchange
 * - @ucp.merchant.id <id>
 * - @ucp.merchant.name <name>
 * - @ucp.operation <capability>.<operation>
 */
export function parseUCPAnnotations(jsdoc: string): UCPMetadata | null {
  // Check if @ucp is present
  if (!/@ucp\b/.test(jsdoc)) {
    return null;
  }

  const capabilities: UCPCapability[] = [];

  // Parse @capability annotations
  const capabilityMatches = jsdoc.matchAll(/@capability\s+(checkout|identity|order|payment_token_exchange)/g);
  for (const match of capabilityMatches) {
    capabilities.push(match[1] as UCPCapability);
  }

  // Parse merchant info
  const merchantIdMatch = jsdoc.match(/@ucp\.merchant\.id\s+(\S+)/);
  const merchantNameMatch = jsdoc.match(/@ucp\.merchant\.name\s+(.+?)(?:\n|$)/);

  return {
    enabled: true,
    capabilities,
    merchantId: merchantIdMatch?.[1],
    merchantName: merchantNameMatch?.[1]?.trim()
  };
}

/**
 * Parse UCP operation from method JSDoc
 */
export function parseUCPMethodAnnotation(jsdoc: string): UCPMethodMetadata | null {
  const match = jsdoc.match(/@ucp\.operation\s+(checkout|identity|order|payment_token_exchange)\.(\w+)/);
  if (!match) return null;

  return {
    capability: match[1] as UCPCapability,
    operation: match[2]
  };
}

// ============================================================================
// Manifest Extraction from Schema
// ============================================================================

export interface ExtractManifestParams {
  className: string;
  classJsdoc: string;
  methods: {
    name: string;
    jsdoc: string;
  }[];
  baseUrl?: string;
}

/**
 * Extract UCP manifest from class schema
 */
export function extractManifestFromSchema(params: ExtractManifestParams): UCPManifest | null {
  const { className, classJsdoc, methods, baseUrl } = params;

  const ucpMeta = parseUCPAnnotations(classJsdoc);
  if (!ucpMeta) return null;

  // Auto-detect capabilities from method annotations if not explicitly declared
  const detectedCapabilities = new Set(ucpMeta.capabilities);

  for (const method of methods) {
    const methodMeta = parseUCPMethodAnnotation(method.jsdoc);
    if (methodMeta) {
      detectedCapabilities.add(methodMeta.capability);
    }
  }

  // Also detect from method names
  const methodNames = methods.map(m => m.name.toLowerCase());

  if (methodNames.some(n => n.includes('checkout') || n.includes('cart'))) {
    detectedCapabilities.add('checkout');
  }
  if (methodNames.some(n => n.includes('order') || n.includes('shipment') || n.includes('return'))) {
    detectedCapabilities.add('order');
  }
  if (methodNames.some(n => n.includes('oauth') || n.includes('authorize') || n.includes('identity'))) {
    detectedCapabilities.add('identity');
  }

  return generateUCPManifest({
    merchantId: ucpMeta.merchantId || className.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    merchantName: ucpMeta.merchantName || className,
    capabilities: Array.from(detectedCapabilities),
    baseUrl,
    mcpServerName: className
  });
}

// ============================================================================
// Well-Known Response
// ============================================================================

/**
 * Generate the /.well-known/ucp response
 */
export function generateWellKnownResponse(manifest: UCPManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Validate UCP manifest
 */
export function validateManifest(manifest: UCPManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!manifest.ucp_version) {
    errors.push('Missing ucp_version');
  }

  if (!manifest.merchant?.id) {
    errors.push('Missing merchant.id');
  }

  if (!manifest.merchant?.name) {
    errors.push('Missing merchant.name');
  }

  const hasAnyCapability = Object.values(manifest.capabilities).some(c => c.supported);
  if (!hasAnyCapability) {
    errors.push('At least one capability must be supported');
  }

  if (manifest.payment_handlers.length === 0) {
    errors.push('At least one payment handler must be specified');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
