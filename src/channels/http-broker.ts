/**
 * HTTP Channel Broker
 *
 * Uses HTTP webhooks for publishing and Server-Sent Events (SSE) for subscribing.
 * Works with any HTTP-based pub/sub system.
 *
 * Best for:
 * - Serverless environments (AWS Lambda, Vercel, etc.)
 * - Cloud functions that can't maintain long-lived connections
 * - Integration with existing webhook infrastructure
 *
 * Publishing: POST to publishUrl with JSON body
 * Subscribing: SSE connection to subscribeUrl
 */

import type { ChannelBroker, ChannelMessage, ChannelHandler, Subscription } from './types.js';
import { registerBroker } from './registry.js';

export interface HttpBrokerOptions {
  /** URL for publishing messages (POST requests) */
  publishUrl?: string;
  /** URL for SSE subscriptions */
  subscribeUrl?: string;
  /** Authentication token (sent as Bearer token) */
  authToken?: string;
  /** Custom headers for requests */
  headers?: Record<string, string>;
  /** Request timeout in ms */
  timeout?: number;
}

export class HttpBroker implements ChannelBroker {
  readonly type = 'http';

  private publishUrl?: string;
  private subscribeUrl?: string;
  private authToken?: string;
  private headers: Record<string, string>;
  private timeout: number;
  private subscriptions = new Map<string, { controller: AbortController; handlers: Set<ChannelHandler> }>();

  constructor(options: HttpBrokerOptions = {}) {
    this.publishUrl = options.publishUrl || process.env.PHOTON_CHANNEL_HTTP_URL;
    this.subscribeUrl = options.subscribeUrl || process.env.PHOTON_CHANNEL_SSE_URL || this.publishUrl;
    this.authToken = options.authToken || process.env.PHOTON_CHANNEL_AUTH_TOKEN;
    this.headers = options.headers || {};
    this.timeout = options.timeout || 30000;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  async publish(message: ChannelMessage): Promise<void> {
    if (!this.publishUrl) {
      throw new Error('HTTP broker: publishUrl not configured');
    }

    const payload: ChannelMessage = {
      ...message,
      timestamp: message.timestamp || Date.now(),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.publishUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP publish failed: ${response.status} ${response.statusText} - ${text}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    if (!this.subscribeUrl) {
      throw new Error('HTTP broker: subscribeUrl not configured');
    }

    // Build SSE URL with channel
    const url = new URL(this.subscribeUrl);
    url.searchParams.set('channel', channel);

    const controller = new AbortController();

    // Start SSE connection
    const connectSSE = async () => {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            ...this.getHeaders(),
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('SSE response has no body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          let eventType = 'message';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              eventData += line.slice(5).trim();
            } else if (line === '' && eventData) {
              // End of event, process it
              if (eventType === 'message' || eventType === 'channel') {
                try {
                  const message: ChannelMessage = JSON.parse(eventData);
                  if (message.channel === channel || channel === '*') {
                    handler(message);
                  }
                } catch (err) {
                  console.error('Error parsing SSE message:', err);
                }
              }
              eventData = '';
              eventType = 'message';
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('SSE connection error:', err);
          // Reconnect after delay (unless aborted)
          if (!controller.signal.aborted) {
            setTimeout(connectSSE, 5000);
          }
        }
      }
    };

    // Track subscription
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, { controller, handlers: new Set() });
      // Start SSE connection
      connectSSE();
    }
    this.subscriptions.get(channel)!.handlers.add(handler);

    const subscription: Subscription = {
      channel,
      active: true,
      unsubscribe: () => {
        subscription.active = false;
        const sub = this.subscriptions.get(channel);
        if (sub) {
          sub.handlers.delete(handler);
          if (sub.handlers.size === 0) {
            sub.controller.abort();
            this.subscriptions.delete(channel);
          }
        }
      },
    };

    return subscription;
  }

  isConnected(): boolean {
    return this.subscriptions.size > 0;
  }

  async connect(): Promise<void> {
    // Connection happens lazily on first subscribe
  }

  async disconnect(): Promise<void> {
    // Abort all SSE connections
    for (const [, sub] of this.subscriptions) {
      sub.controller.abort();
    }
    this.subscriptions.clear();
  }
}

// Register the broker
registerBroker('http', (options) => new HttpBroker(options as HttpBrokerOptions));

export default HttpBroker;
