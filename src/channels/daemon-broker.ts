/**
 * Daemon Channel Broker
 *
 * Uses Unix sockets (or named pipes on Windows) to communicate with
 * the local photon daemon for pub/sub messaging.
 *
 * Best for:
 * - Local development
 * - Single-server deployments
 * - Scenarios where BEAM and MCP share the same filesystem
 */

import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { ChannelBroker, ChannelMessage, ChannelHandler, Subscription } from './types.js';
import { registerBroker } from './registry.js';

export interface DaemonBrokerOptions {
  /** Photon name (for socket path) */
  photonName?: string;
  /** Custom socket directory */
  socketDir?: string;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * Get the socket path for a photon daemon
 */
function getSocketPath(photonName: string, socketDir?: string): string {
  const dir = socketDir || path.join(os.homedir(), '.photon', 'daemons');
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\photon-${photonName}`;
  }
  return path.join(dir, `${photonName}.sock`);
}

export class DaemonBroker implements ChannelBroker {
  readonly type = 'daemon';

  private photonName: string;
  private socketDir?: string;
  private timeout: number;
  private subscriptions = new Map<string, { socket: net.Socket; handlers: Set<ChannelHandler> }>();

  constructor(options: DaemonBrokerOptions = {}) {
    this.photonName = options.photonName || process.env.PHOTON_NAME || 'unknown';
    this.socketDir = options.socketDir;
    this.timeout = options.timeout || 5000;
  }

  async publish(message: ChannelMessage): Promise<void> {
    const socketPath = getSocketPath(this.photonName, this.socketDir);

    // Check if socket exists
    if (process.platform !== 'win32' && !fs.existsSync(socketPath)) {
      // Daemon not running, silently ignore
      return;
    }

    return new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath);
      const requestId = `pub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const timeout = setTimeout(() => {
        client.destroy();
        // Don't reject on timeout - publish is best-effort
        resolve();
      }, this.timeout);

      client.on('connect', () => {
        const request = {
          type: 'publish',
          id: requestId,
          channel: message.channel,
          message: {
            ...message,
            timestamp: message.timestamp || Date.now(),
            source: message.source || this.photonName,
          },
        };
        client.write(JSON.stringify(request) + '\n');
      });

      client.on('data', (chunk) => {
        try {
          const response = JSON.parse(chunk.toString().trim());
          if (response.id === requestId) {
            clearTimeout(timeout);
            client.destroy();
            resolve();
          }
        } catch {
          // Ignore parse errors
        }
      });

      client.on('error', () => {
        clearTimeout(timeout);
        client.destroy();
        // Don't reject - publish is best-effort
        resolve();
      });

      client.on('end', () => {
        clearTimeout(timeout);
      });
    });
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    const socketPath = getSocketPath(this.photonName, this.socketDir);
    const subscribeId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath);
      let subscribed = false;
      let buffer = '';

      const timeout = setTimeout(() => {
        if (!subscribed) {
          client.destroy();
          reject(new Error('Subscription timeout'));
        }
      }, this.timeout);

      client.on('connect', () => {
        const request = {
          type: 'subscribe',
          id: subscribeId,
          channel,
          clientType: 'photon',
        };
        client.write(JSON.stringify(request) + '\n');
      });

      client.on('data', (chunk) => {
        buffer += chunk.toString();

        // Process complete JSON messages (newline-delimited)
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response = JSON.parse(line);

            // Handle subscription confirmation
            if (response.id === subscribeId && response.type === 'result') {
              clearTimeout(timeout);
              subscribed = true;

              // Track subscription
              if (!this.subscriptions.has(channel)) {
                this.subscriptions.set(channel, { socket: client, handlers: new Set() });
              }
              this.subscriptions.get(channel)!.handlers.add(handler);

              // Return subscription handle
              const subscription: Subscription = {
                channel,
                active: true,
                unsubscribe: () => {
                  subscription.active = false;
                  const sub = this.subscriptions.get(channel);
                  if (sub) {
                    sub.handlers.delete(handler);
                    if (sub.handlers.size === 0) {
                      // Send unsubscribe and close
                      const unsubRequest = {
                        type: 'unsubscribe',
                        id: `unsub_${Date.now()}`,
                        channel,
                      };
                      if (!client.destroyed) {
                        client.write(JSON.stringify(unsubRequest) + '\n');
                        client.end();
                      }
                      this.subscriptions.delete(channel);
                    }
                  }
                },
              };

              resolve(subscription);
            }

            // Handle channel messages
            if (response.type === 'channel_message' && response.channel === channel) {
              const msg: ChannelMessage = {
                channel: response.channel,
                event: response.message?.event || 'message',
                data: response.message?.data || response.message,
                timestamp: response.message?.timestamp || Date.now(),
                source: response.message?.source,
              };
              handler(msg);
            }

            // Handle errors
            if (response.type === 'error' && response.id === subscribeId) {
              clearTimeout(timeout);
              reject(new Error(response.error || 'Subscription failed'));
            }
          } catch {
            // Ignore parse errors for partial messages
          }
        }
      });

      client.on('error', (error) => {
        if (!subscribed) {
          clearTimeout(timeout);
          reject(new Error(`Connection error: ${error.message}`));
        }
      });

      client.on('end', () => {
        if (!subscribed) {
          clearTimeout(timeout);
          reject(new Error('Connection closed before subscription confirmed'));
        }
      });

      client.on('close', () => {
        // Mark all subscriptions on this socket as inactive
        for (const [ch, sub] of this.subscriptions) {
          if (sub.socket === client) {
            this.subscriptions.delete(ch);
          }
        }
      });
    });
  }

  isConnected(): boolean {
    // Check if any subscriptions are active
    return this.subscriptions.size > 0;
  }

  async connect(): Promise<void> {
    // Connection happens lazily on first publish/subscribe
  }

  async disconnect(): Promise<void> {
    // Close all subscription sockets
    for (const [, sub] of this.subscriptions) {
      if (!sub.socket.destroyed) {
        sub.socket.end();
      }
    }
    this.subscriptions.clear();
  }
}

// Register the broker
registerBroker('daemon', (options) => new DaemonBroker(options as DaemonBrokerOptions));

export default DaemonBroker;
