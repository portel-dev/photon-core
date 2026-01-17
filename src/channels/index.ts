/**
 * Channel-Based Pub/Sub Module
 *
 * Provides a pluggable architecture for cross-process messaging.
 * Supports multiple backends: local daemon, Redis, HTTP, and more.
 *
 * Usage:
 * ```typescript
 * import { getBroker, ChannelMessage } from '@portel/photon-core/channels';
 *
 * // Publishing
 * const broker = getBroker();
 * await broker.publish({
 *   channel: 'board:my-board',
 *   event: 'update',
 *   data: { taskId: '123', status: 'done' }
 * });
 *
 * // Subscribing
 * const sub = await broker.subscribe('board:my-board', (msg) => {
 *   console.log('Received:', msg);
 * });
 *
 * // Later: unsubscribe
 * sub.unsubscribe();
 * ```
 *
 * Configuration (via environment variables):
 * - PHOTON_CHANNEL_BROKER: Explicit broker type (daemon, redis, http, noop)
 * - PHOTON_REDIS_URL: Redis connection URL (enables redis broker)
 * - PHOTON_CHANNEL_HTTP_URL: HTTP webhook URL (enables http broker)
 */

// Export types
export type {
  ChannelBroker,
  ChannelMessage,
  ChannelHandler,
  Subscription,
  BrokerConfig,
  BrokerFactory,
} from './types.js';

// Export registry functions
export {
  registerBroker,
  getRegisteredBrokers,
  createBroker,
  detectBroker,
  getBroker,
  setBroker,
  clearBroker,
} from './registry.js';

// Import broker implementations to register them
// This has side effects (registers each broker type)
import './noop-broker.js';
import './daemon-broker.js';
import './redis-broker.js';
import './http-broker.js';

// Export broker classes for direct use/extension
export { NoOpBroker } from './noop-broker.js';
export { DaemonBroker, type DaemonBrokerOptions } from './daemon-broker.js';
export { RedisBroker, type RedisBrokerOptions } from './redis-broker.js';
export { HttpBroker, type HttpBrokerOptions } from './http-broker.js';

// Convenience function for simple publishing
import { getBroker } from './registry.js';
import type { ChannelMessage } from './types.js';

/**
 * Publish a message to a channel
 * Convenience function that uses the auto-detected broker
 */
export async function publish(message: ChannelMessage): Promise<void> {
  return getBroker().publish(message);
}

/**
 * Publish a message with simplified parameters
 */
export async function publishEvent(
  channel: string,
  event: string,
  data?: unknown,
  source?: string
): Promise<void> {
  return publish({
    channel,
    event,
    data,
    source,
    timestamp: Date.now(),
  });
}
