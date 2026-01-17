/**
 * Redis Channel Broker
 *
 * Uses Redis pub/sub for cross-process and cross-server messaging.
 *
 * Best for:
 * - Multi-server deployments
 * - Cloud environments (AWS, GCP, etc.)
 * - High-throughput scenarios
 *
 * Requires: ioredis package (optional dependency)
 */

import type { ChannelBroker, ChannelMessage, ChannelHandler, Subscription } from './types.js';
import { registerBroker } from './registry.js';

export interface RedisBrokerOptions {
  /** Redis connection URL (redis://host:port) */
  url?: string;
  /** Channel prefix for namespacing */
  prefix?: string;
  /** Redis client options (passed to ioredis) */
  clientOptions?: Record<string, unknown>;
}

// Lazy-load Redis to make it optional
let Redis: any = null;

async function getRedis(): Promise<any> {
  if (!Redis) {
    try {
      // Dynamic import to avoid bundling redis if not used
      // @ts-ignore - ioredis is an optional peer dependency
      const module = await import('ioredis');
      Redis = module.default || module;
    } catch {
      throw new Error(
        'Redis broker requires ioredis package. Install it with: npm install ioredis'
      );
    }
  }
  return Redis;
}

export class RedisBroker implements ChannelBroker {
  readonly type = 'redis';

  private url: string;
  private prefix: string;
  private clientOptions: Record<string, unknown>;
  private pubClient: any = null;
  private subClient: any = null;
  private connected = false;
  private subscriptions = new Map<string, Set<ChannelHandler>>();

  constructor(options: RedisBrokerOptions = {}) {
    this.url = options.url || process.env.PHOTON_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';
    this.prefix = options.prefix || process.env.PHOTON_REDIS_PREFIX || 'photon:channel:';
    this.clientOptions = options.clientOptions || {};
  }

  private getChannelKey(channel: string): string {
    return `${this.prefix}${channel}`;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const RedisClient = await getRedis();

    // Create publish client
    this.pubClient = new RedisClient(this.url, {
      ...this.clientOptions,
      lazyConnect: true,
    });

    // Create subscribe client (Redis requires separate connections for pub/sub)
    this.subClient = new RedisClient(this.url, {
      ...this.clientOptions,
      lazyConnect: true,
    });

    // Connect both clients
    await Promise.all([
      this.pubClient.connect(),
      this.subClient.connect(),
    ]);

    // Handle incoming messages
    this.subClient.on('message', (redisChannel: string, messageStr: string) => {
      // Strip prefix to get original channel
      const channel = redisChannel.startsWith(this.prefix)
        ? redisChannel.slice(this.prefix.length)
        : redisChannel;

      const handlers = this.subscriptions.get(channel);
      if (!handlers || handlers.size === 0) return;

      try {
        const message: ChannelMessage = JSON.parse(messageStr);
        handlers.forEach((handler) => {
          try {
            handler(message);
          } catch (err) {
            console.error('Error in channel handler:', err);
          }
        });
      } catch (err) {
        console.error('Error parsing channel message:', err);
      }
    });

    // Handle pattern messages (for wildcard subscriptions)
    this.subClient.on('pmessage', (pattern: string, redisChannel: string, messageStr: string) => {
      const channel = redisChannel.startsWith(this.prefix)
        ? redisChannel.slice(this.prefix.length)
        : redisChannel;

      // Find matching pattern handlers
      for (const [subPattern, handlers] of this.subscriptions) {
        if (this.matchPattern(subPattern, channel)) {
          try {
            const message: ChannelMessage = JSON.parse(messageStr);
            handlers.forEach((handler) => {
              try {
                handler(message);
              } catch (err) {
                console.error('Error in channel handler:', err);
              }
            });
          } catch (err) {
            console.error('Error parsing channel message:', err);
          }
        }
      }
    });

    this.connected = true;
  }

  /**
   * Simple wildcard pattern matching
   * Supports * for single-segment wildcard
   */
  private matchPattern(pattern: string, channel: string): boolean {
    if (!pattern.includes('*')) {
      return pattern === channel;
    }

    const patternParts = pattern.split(':');
    const channelParts = channel.split(':');

    if (patternParts.length !== channelParts.length) {
      return false;
    }

    return patternParts.every((part, i) => part === '*' || part === channelParts[i]);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Unsubscribe from all channels
    for (const channel of this.subscriptions.keys()) {
      const redisChannel = this.getChannelKey(channel);
      if (channel.includes('*')) {
        await this.subClient.punsubscribe(redisChannel);
      } else {
        await this.subClient.unsubscribe(redisChannel);
      }
    }
    this.subscriptions.clear();

    // Disconnect clients
    await Promise.all([
      this.pubClient?.quit(),
      this.subClient?.quit(),
    ]);

    this.pubClient = null;
    this.subClient = null;
    this.connected = false;
  }

  async publish(message: ChannelMessage): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const redisChannel = this.getChannelKey(message.channel);
    const payload: ChannelMessage = {
      ...message,
      timestamp: message.timestamp || Date.now(),
    };

    await this.pubClient.publish(redisChannel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    if (!this.connected) {
      await this.connect();
    }

    const redisChannel = this.getChannelKey(channel);
    const isPattern = channel.includes('*');

    // Track handler
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      // Subscribe to Redis channel
      if (isPattern) {
        await this.subClient.psubscribe(redisChannel);
      } else {
        await this.subClient.subscribe(redisChannel);
      }
    }
    this.subscriptions.get(channel)!.add(handler);

    const subscription: Subscription = {
      channel,
      active: true,
      unsubscribe: async () => {
        subscription.active = false;
        const handlers = this.subscriptions.get(channel);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            this.subscriptions.delete(channel);
            // Unsubscribe from Redis
            if (isPattern) {
              await this.subClient.punsubscribe(redisChannel);
            } else {
              await this.subClient.unsubscribe(redisChannel);
            }
          }
        }
      },
    };

    return subscription;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Register the broker
registerBroker('redis', (options) => new RedisBroker(options as RedisBrokerOptions));

export default RedisBroker;
