/**
 * Channel Broker Registry
 *
 * Manages registration and selection of channel brokers.
 * Auto-detects the appropriate broker based on environment configuration.
 */

import type { ChannelBroker, BrokerConfig, BrokerFactory } from './types.js';

/**
 * Registry of available broker factories
 */
const brokerFactories = new Map<string, BrokerFactory>();

/**
 * Current active broker instance
 */
let activeBroker: ChannelBroker | null = null;

/**
 * Register a broker factory
 * @param type Broker type identifier (e.g., 'redis', 'daemon', 'http')
 * @param factory Factory function that creates the broker
 */
export function registerBroker(type: string, factory: BrokerFactory): void {
  brokerFactories.set(type, factory);
}

/**
 * Get a list of registered broker types
 */
export function getRegisteredBrokers(): string[] {
  return Array.from(brokerFactories.keys());
}

/**
 * Create a broker instance by type
 * @param type Broker type
 * @param options Type-specific options
 */
export function createBroker(type: string, options?: Record<string, unknown>): ChannelBroker {
  const factory = brokerFactories.get(type);
  if (!factory) {
    throw new Error(
      `Unknown broker type: ${type}. Available types: ${getRegisteredBrokers().join(', ')}`
    );
  }
  return factory(options);
}

/**
 * Auto-detect and create the appropriate broker based on environment
 *
 * Detection order:
 * 1. PHOTON_CHANNEL_BROKER env var (explicit override)
 * 2. PHOTON_REDIS_URL → Redis broker
 * 3. PHOTON_CHANNEL_HTTP_URL → HTTP broker
 * 4. PHOTON_CLOUDFLARE_* → Cloudflare broker
 * 5. Default → NoOp broker (silent, no-op)
 */
export function detectBroker(): ChannelBroker {
  // Explicit broker type override
  const explicitType = process.env.PHOTON_CHANNEL_BROKER;
  if (explicitType) {
    return createBrokerFromEnv(explicitType);
  }

  // Redis detection
  if (process.env.PHOTON_REDIS_URL || process.env.REDIS_URL) {
    try {
      return createBrokerFromEnv('redis');
    } catch {
      // Redis broker not available, continue
    }
  }

  // HTTP webhook detection
  if (process.env.PHOTON_CHANNEL_HTTP_URL) {
    try {
      return createBrokerFromEnv('http');
    } catch {
      // HTTP broker not available, continue
    }
  }

  // Cloudflare detection
  if (process.env.PHOTON_CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID) {
    try {
      return createBrokerFromEnv('cloudflare');
    } catch {
      // Cloudflare broker not available, continue
    }
  }

  // Local daemon detection (for local development)
  if (process.env.PHOTON_DAEMON_ENABLED !== 'false') {
    try {
      return createBrokerFromEnv('daemon');
    } catch {
      // Daemon broker not available, continue
    }
  }

  // Fallback to NoOp
  return createBrokerFromEnv('noop');
}

/**
 * Create a broker with configuration from environment variables
 */
function createBrokerFromEnv(type: string): ChannelBroker {
  const options: Record<string, unknown> = {};

  switch (type) {
    case 'redis':
      options.url = process.env.PHOTON_REDIS_URL || process.env.REDIS_URL;
      options.prefix = process.env.PHOTON_REDIS_PREFIX || 'photon:channel:';
      break;

    case 'http':
      options.publishUrl = process.env.PHOTON_CHANNEL_HTTP_URL;
      options.subscribeUrl = process.env.PHOTON_CHANNEL_SSE_URL;
      options.authToken = process.env.PHOTON_CHANNEL_AUTH_TOKEN;
      break;

    case 'cloudflare':
      options.accountId = process.env.PHOTON_CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
      options.namespaceId = process.env.PHOTON_CLOUDFLARE_DO_NAMESPACE;
      options.apiToken = process.env.PHOTON_CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
      break;

    case 'daemon':
      options.photonName = process.env.PHOTON_NAME;
      options.socketDir = process.env.PHOTON_SOCKET_DIR;
      break;

    case 'noop':
    default:
      // No configuration needed
      break;
  }

  return createBroker(type, options);
}

/**
 * Get or create the active broker
 * Uses auto-detection on first call, then caches the instance
 */
export function getBroker(): ChannelBroker {
  if (!activeBroker) {
    activeBroker = detectBroker();
  }
  return activeBroker;
}

/**
 * Set the active broker explicitly
 * @param broker Broker instance to use
 */
export function setBroker(broker: ChannelBroker): void {
  activeBroker = broker;
}

/**
 * Clear the active broker (for testing)
 */
export function clearBroker(): void {
  activeBroker = null;
}
