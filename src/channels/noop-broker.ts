/**
 * NoOp Channel Broker
 *
 * Silent fallback broker that does nothing.
 * Used when no external channel broker is configured.
 * Useful for:
 * - Development without channel infrastructure
 * - Testing in isolation
 * - Graceful degradation when broker is unavailable
 */

import type { ChannelBroker, ChannelMessage, ChannelHandler, Subscription } from './types.js';
import { registerBroker } from './registry.js';

export class NoOpBroker implements ChannelBroker {
  readonly type = 'noop';

  async publish(_message: ChannelMessage): Promise<void> {
    // Silent no-op - message is discarded
  }

  async subscribe(channel: string, _handler: ChannelHandler): Promise<Subscription> {
    // Return a dummy subscription that does nothing
    return {
      channel,
      active: false, // Indicate this is not a real subscription
      unsubscribe: () => {},
    };
  }

  isConnected(): boolean {
    return true; // Always "connected" since there's nothing to connect to
  }

  async connect(): Promise<void> {
    // No-op
  }

  async disconnect(): Promise<void> {
    // No-op
  }
}

// Register the broker
registerBroker('noop', () => new NoOpBroker());

export default NoOpBroker;
