/**
 * Channel Broker Types
 *
 * Defines the interface for channel-based pub/sub messaging.
 * Implementations can use different backends (local daemon, Redis, HTTP, etc.)
 */

/**
 * Message published to a channel
 */
export interface ChannelMessage {
  /** Channel identifier (e.g., 'board:my-board', 'user:123') */
  channel: string;
  /** Event type (e.g., 'update', 'created', 'deleted') */
  event: string;
  /** Message payload */
  data?: unknown;
  /** Timestamp when message was created */
  timestamp?: number;
  /** Source identifier (photon name, instance id, etc.) */
  source?: string;
}

/**
 * Handler function for channel messages
 */
export type ChannelHandler = (message: ChannelMessage) => void;

/**
 * Subscription handle returned by subscribe()
 */
export interface Subscription {
  /** Unsubscribe from the channel */
  unsubscribe(): void;
  /** Channel name */
  channel: string;
  /** Whether subscription is active */
  active: boolean;
}

/**
 * Channel broker interface
 *
 * Implementations provide the actual pub/sub transport mechanism.
 * Examples: Unix socket daemon, Redis, HTTP webhooks, Cloudflare Durable Objects, etc.
 */
export interface ChannelBroker {
  /** Broker type identifier */
  readonly type: string;

  /**
   * Publish a message to a channel
   * @param message The message to publish
   * @returns Promise that resolves when message is sent (not necessarily delivered)
   */
  publish(message: ChannelMessage): Promise<void>;

  /**
   * Subscribe to messages on a channel
   * @param channel Channel to subscribe to (supports wildcards in some implementations)
   * @param handler Function called when messages arrive
   * @returns Subscription handle for unsubscribing
   */
  subscribe(channel: string, handler: ChannelHandler): Promise<Subscription>;

  /**
   * Check if broker is connected/ready
   */
  isConnected(): boolean;

  /**
   * Connect to the broker (if applicable)
   */
  connect?(): Promise<void>;

  /**
   * Disconnect from the broker and cleanup resources
   */
  disconnect?(): Promise<void>;
}

/**
 * Configuration for broker initialization
 */
export interface BrokerConfig {
  /** Broker type (e.g., 'daemon', 'redis', 'http', 'cloudflare') */
  type: string;
  /** Type-specific options */
  options?: Record<string, unknown>;
}

/**
 * Factory function type for creating brokers
 */
export type BrokerFactory = (config?: BrokerConfig['options']) => ChannelBroker;
