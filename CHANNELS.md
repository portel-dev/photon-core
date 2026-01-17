# Channel-Based Pub/Sub System

Cross-process messaging system for real-time updates between Photon instances, BEAM UI, and external systems.

## Problem Statement

When Claude moves a Kanban task via MCP, the BEAM UI doesn't update because:
- MCP and BEAM are separate processes with separate photon instances
- `emit()` only sends to the current caller's `outputHandler`
- No cross-process notification mechanism existed

## Solution: Pluggable Channel Brokers

A broker-agnostic pub/sub system that:
- Works locally via Unix sockets (daemon)
- Scales to cloud via Redis, HTTP, or custom brokers
- Auto-detects the appropriate broker from environment
- Allows custom broker implementations for any provider

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        emit() in PhotonMCP                       │
│  this.emit({ channel: 'board:x', event: 'update', data: {...} })│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Channel Broker                             │
│           (auto-detected or explicitly configured)               │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│DaemonBroker │      │ RedisBroker │      │ HttpBroker  │
│             │      │             │      │             │
│ Unix socket │      │ Redis pub/  │      │ Webhook +   │
│ ~/.photon/  │      │ sub cluster │      │ SSE stream  │
│ daemons/    │      │             │      │             │
└─────────────┘      └─────────────┘      └─────────────┘
      │                     │                     │
      ▼                     ▼                     ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Local Dev  │      │Multi-Server │      │ Serverless  │
│  Single box │      │   Cloud     │      │  Functions  │
└─────────────┘      └─────────────┘      └─────────────┘
```

## Quick Start

### Publishing (in a Photon method)

```typescript
export default class KanbanMCP extends PhotonMCP {
  async moveTask(params: { taskId: string; column: string }) {
    // ... move task logic ...

    // Emit with channel = broadcasts to all subscribers
    this.emit({
      channel: `board:${this.boardName}`,
      event: 'task-moved',
      data: { taskId: params.taskId, newColumn: params.column }
    });

    return { success: true };
  }
}
```

### Subscribing (in BEAM or other clients)

```typescript
import { getBroker } from '@portel/photon-core';

const broker = getBroker();
const subscription = await broker.subscribe('board:my-board', (message) => {
  console.log('Received:', message.event, message.data);
  // Update UI, trigger refresh, etc.
});

// Later: cleanup
subscription.unsubscribe();
```

## Broker Types

### 1. DaemonBroker (Default for Local Development)

Uses Unix sockets via the photon daemon process.

**When to use:**
- Local development
- Single-server deployments
- BEAM and MCP on same machine

**How it works:**
```
┌─────────────┐     Unix Socket      ┌─────────────┐
│ MCP Client  │◄────────────────────►│   Daemon    │
│ (Claude)    │  ~/.photon/daemons/  │  Process    │
└─────────────┘       kanban.sock    └─────────────┘
                                            │
                                            │ broadcast
                                            ▼
                                     ┌─────────────┐
                                     │  BEAM UI    │
                                     └─────────────┘
```

**Configuration:** None needed (auto-detected when daemon is running)

### 2. RedisBroker (Cloud/Multi-Server)

Uses Redis pub/sub for distributed messaging.

**When to use:**
- Multi-server deployments
- Kubernetes/container orchestration
- High-throughput scenarios

**Configuration:**
```bash
# Environment variables
PHOTON_REDIS_URL=redis://localhost:6379
PHOTON_REDIS_PREFIX=photon:channel:  # Optional, default shown
```

**Requirements:**
```bash
npm install ioredis  # Optional peer dependency
```

**Features:**
- Pattern subscriptions (wildcards)
- Automatic reconnection
- Separate pub/sub connections (Redis requirement)

### 3. HttpBroker (Serverless/Webhooks)

Uses HTTP POST for publishing and Server-Sent Events (SSE) for subscribing.

**When to use:**
- Serverless functions (AWS Lambda, Vercel, etc.)
- Integration with existing webhook infrastructure
- When you can't maintain persistent connections

**Configuration:**
```bash
PHOTON_CHANNEL_HTTP_URL=https://your-pubsub-service.com/publish
PHOTON_CHANNEL_SSE_URL=https://your-pubsub-service.com/subscribe  # Optional
PHOTON_CHANNEL_AUTH_TOKEN=your-bearer-token  # Optional
```

**Protocol:**

Publishing (POST):
```http
POST /publish HTTP/1.1
Content-Type: application/json
Authorization: Bearer <token>

{
  "channel": "board:my-board",
  "event": "task-moved",
  "data": { "taskId": "123" },
  "timestamp": 1705500000000,
  "source": "KanbanMCP"
}
```

Subscribing (SSE):
```http
GET /subscribe?channel=board:my-board HTTP/1.1
Accept: text/event-stream
Authorization: Bearer <token>
```

### 4. NoOpBroker (Silent Fallback)

Does nothing - used when no broker is configured or available.

**When to use:**
- Testing in isolation
- Development without channel infrastructure
- Graceful degradation

## Configuration

### Auto-Detection Order

The broker is auto-detected in this order:

1. `PHOTON_CHANNEL_BROKER` - Explicit override
2. `PHOTON_REDIS_URL` or `REDIS_URL` - Redis broker
3. `PHOTON_CHANNEL_HTTP_URL` - HTTP broker
4. `PHOTON_CLOUDFLARE_*` - Cloudflare broker (reserved)
5. Daemon socket exists - Daemon broker
6. Fallback - NoOp broker

### Explicit Selection

```bash
# Force specific broker
PHOTON_CHANNEL_BROKER=redis
PHOTON_CHANNEL_BROKER=http
PHOTON_CHANNEL_BROKER=daemon
PHOTON_CHANNEL_BROKER=noop
```

### All Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PHOTON_CHANNEL_BROKER` | Explicit broker type | (auto-detect) |
| `PHOTON_REDIS_URL` | Redis connection URL | - |
| `PHOTON_REDIS_PREFIX` | Channel key prefix | `photon:channel:` |
| `PHOTON_CHANNEL_HTTP_URL` | HTTP publish endpoint | - |
| `PHOTON_CHANNEL_SSE_URL` | SSE subscribe endpoint | (same as HTTP) |
| `PHOTON_CHANNEL_AUTH_TOKEN` | Bearer token for HTTP | - |
| `PHOTON_DEBUG` | Enable debug logging | - |

## Creating Custom Brokers

For Cloudflare Durable Objects, AWS SNS, or other providers:

```typescript
import {
  registerBroker,
  ChannelBroker,
  ChannelMessage,
  ChannelHandler,
  Subscription
} from '@portel/photon-core';

export interface CloudflareBrokerOptions {
  accountId: string;
  namespaceId: string;
  apiToken: string;
}

export class CloudflareBroker implements ChannelBroker {
  readonly type = 'cloudflare';

  private accountId: string;
  private namespaceId: string;
  private apiToken: string;

  constructor(options: CloudflareBrokerOptions) {
    this.accountId = options.accountId;
    this.namespaceId = options.namespaceId;
    this.apiToken = options.apiToken;
  }

  async publish(message: ChannelMessage): Promise<void> {
    // Call Cloudflare Durable Objects API
    await fetch(`https://api.cloudflare.com/...`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    // Set up WebSocket to Durable Object
    const ws = new WebSocket(`wss://...`);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handler(message);
    };

    return {
      channel,
      active: true,
      unsubscribe: () => ws.close(),
    };
  }

  isConnected(): boolean {
    return true;
  }
}

// Register the broker
registerBroker('cloudflare', (options) =>
  new CloudflareBroker(options as CloudflareBrokerOptions)
);
```

Then configure via environment:
```bash
PHOTON_CHANNEL_BROKER=cloudflare
PHOTON_CLOUDFLARE_ACCOUNT_ID=...
PHOTON_CLOUDFLARE_DO_NAMESPACE=...
PHOTON_CLOUDFLARE_API_TOKEN=...
```

## API Reference

### ChannelMessage

```typescript
interface ChannelMessage {
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
```

### ChannelBroker Interface

```typescript
interface ChannelBroker {
  /** Broker type identifier */
  readonly type: string;

  /** Publish a message to a channel */
  publish(message: ChannelMessage): Promise<void>;

  /** Subscribe to messages on a channel */
  subscribe(channel: string, handler: ChannelHandler): Promise<Subscription>;

  /** Check if broker is connected/ready */
  isConnected(): boolean;

  /** Connect to the broker (optional) */
  connect?(): Promise<void>;

  /** Disconnect and cleanup (optional) */
  disconnect?(): Promise<void>;
}
```

### Subscription

```typescript
interface Subscription {
  /** Channel name */
  channel: string;

  /** Whether subscription is active */
  active: boolean;

  /** Unsubscribe from the channel */
  unsubscribe(): void;
}
```

### Registry Functions

```typescript
// Get auto-detected broker (cached)
const broker = getBroker();

// Create specific broker
const redis = createBroker('redis', { url: 'redis://...' });

// Register custom broker
registerBroker('my-broker', (options) => new MyBroker(options));

// List registered types
const types = getRegisteredBrokers(); // ['daemon', 'redis', 'http', 'noop', ...]

// Override active broker
setBroker(myCustomBroker);

// Clear cached broker (for testing)
clearBroker();
```

## Best Practices

### 1. Channel Naming Convention

Use hierarchical names with colons:
```
board:my-board
user:123:notifications
org:acme:events
```

### 2. Event Naming

Use past tense for completed actions:
```
task-moved
user-created
order-completed
```

### 3. Keep Payloads Small

Only include essential data:
```typescript
// Good - minimal payload
this.emit({
  channel: 'board:x',
  event: 'task-moved',
  data: { taskId: '123', column: 'Done' }
});

// Avoid - sending entire objects
this.emit({
  channel: 'board:x',
  event: 'task-moved',
  data: { ...entireTask, ...entireBoard } // Too much data
});
```

### 4. Handle Subscription Cleanup

Always unsubscribe when done:
```typescript
const sub = await broker.subscribe('board:x', handler);

// When component unmounts / connection closes
sub.unsubscribe();
```

### 5. Graceful Degradation

Publishing is best-effort and won't throw:
```typescript
// This won't throw even if broker is unavailable
this.emit({
  channel: 'board:x',
  event: 'update',
  data: { ... }
});
```

## Troubleshooting

### Messages Not Received

1. **Check broker type**: `console.log(getBroker().type)`
2. **Verify channel names match** exactly (case-sensitive)
3. **Check subscription is active**: `console.log(subscription.active)`
4. **Enable debug mode**: `PHOTON_DEBUG=1`

### Redis Connection Issues

```bash
# Test Redis connectivity
redis-cli -u $PHOTON_REDIS_URL ping

# Check if ioredis is installed
npm ls ioredis
```

### Daemon Not Broadcasting

1. Ensure daemon is running: `ls ~/.photon/daemons/*.sock`
2. Check daemon logs for errors
3. Verify BEAM is subscribed to correct channel

## Migration from Direct Daemon

If you were using the daemon protocol directly:

**Before:**
```typescript
// In photon (main package)
import { publishToChannel } from './daemon/client.js';
await publishToChannel('kanban', 'board:x', data);
```

**After:**
```typescript
// In photon-core (works everywhere)
this.emit({
  channel: 'board:x',
  event: 'update',
  data: data
});
```

The new approach is transport-agnostic and works in cloud environments.
