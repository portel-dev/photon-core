# Clean Classes Pattern

Write Photon classes **without requiring inheritance** from the Photon base class.

## Overview

Instead of:
```typescript
import { Photon } from '@portel/photon-core';

export default class Calculator extends Photon {
  async add(a: number, b: number) {
    this.emit({ result: a + b });
    return a + b;
  }
}
```

You can now write:
```typescript
// Just a plain class - no inheritance needed!
export default class Calculator {
  async add(a: number, b: number) {
    this.emit({ result: a + b });
    return a + b;
  }
}
```

## How It Works

### Photon Runtime (photon)
The Photon CLI loader automatically:
1. Detects plain classes that don't extend Photon
2. Analyzes the source code for capability usage (emit, memory, call, mcp)
3. Injects those capabilities at runtime
4. No code changes needed!

### Other Runtimes (NCP, Lumina)
Import and use the `withPhotonCapabilities` mixin directly:

```typescript
import { withPhotonCapabilities } from '@portel/photon-core';

class Calculator {
  async add(a: number, b: number) {
    return a + b;
  }
}

// Wrap the class to get Photon capabilities
const Enhanced = withPhotonCapabilities(Calculator);
const instance = new Enhanced();

instance.emit({ result: 42 });  // ✅ Works!
```

## Supported Capabilities

When using clean classes, you get automatic access to:

### emit() - Event Emission
```typescript
export default class Processor {
  async process() {
    this.emit({ status: 'working', progress: 50 });
    // ... do work ...
    this.emit({ status: 'complete', result: 'done' });
  }
}
```

### memory - Scoped Storage
```typescript
export default class Cache {
  async getData(key: string) {
    // Store and retrieve photon-scoped data
    const cached = this.memory.get(`data:${key}`);
    if (cached) return cached;

    const data = await fetch(key);
    this.memory.set(`data:${key}`, data);
    return data;
  }
}
```

### call() - Cross-Photon Calls
```typescript
export default class Orchestrator {
  async coordinate() {
    // Call methods on other photons
    const result = await this.call('database.query', {
      sql: 'SELECT * FROM users'
    });
    return result;
  }
}
```

### mcp() - External MCP Servers
```typescript
export default class DataFetcher {
  async fetchGitHub(user: string) {
    // Access external MCP servers
    const github = this.mcp('github');
    const repos = await github.list_repositories({ user });
    return repos;
  }
}
```

## Inheritance Patterns

The clean classes pattern works with all inheritance scenarios:

### 1. Plain Class (No Parent)
```typescript
export default class SimpleWorker {
  async work() {
    this.emit({ status: 'working' });
    return 'done';
  }
}
```

### 2. Class with Custom Parent
```typescript
class BaseService {
  protected log(msg: string) {
    console.log(`[${this.constructor.name}] ${msg}`);
  }
}

export default class MyService extends BaseService {
  async execute() {
    this.log('Starting...');
    this.emit({ status: 'executing' });
    return 'complete';
  }
}
```

### 3. Class Extending Imported Library
```typescript
import { TypeORMBase } from 'typeorm-photon';

export default class UserRepository extends TypeORMBase {
  async getUser(id: string) {
    const user = await this.db.query('SELECT * FROM users WHERE id = ?', [id]);
    this.emit({ action: 'user_fetched', userId: id });
    return user;
  }
}
```

### 4. Already Extending Photon (Still Works!)
```typescript
import { Photon } from '@portel/photon-core';

export default class LegacyPhoton extends Photon {
  async legacy() {
    return 'still works';
  }
}
```

## When to Use withPhotonCapabilities Mixin

Use the explicit mixin in these scenarios:

**Alternative Runtimes**: Building a custom runtime (NCP, Lumina, etc.)
```typescript
import { withPhotonCapabilities } from '@portel/photon-core';

const WrappedClass = withPhotonCapabilities(MyClass);
const instance = new WrappedClass();
```

**Manual Control**: Need explicit control over when capabilities are injected
```typescript
const Enhanced = withPhotonCapabilities(MyClass);
// Now has capabilities injected
```

**Testing**: Wrap classes in tests without modifying source
```typescript
const TestClass = class {
  async test() { return 'ok'; }
};

const TestPhoton = withPhotonCapabilities(TestClass);
const inst = new TestPhoton();
// Full Photon capabilities available for testing
```

## Migration Guide

### From Old (Inheritance Required)
```typescript
import { Photon } from '@portel/photon-core';

export default class OldStyle extends Photon {
  async method() {
    this.emit({ data: 'something' });
  }
}
```

### To New (Clean Classes)
```typescript
// No import needed, no inheritance!
export default class NewStyle {
  async method() {
    this.emit({ data: 'something' });  // ✅ Works!
  }
}
```

**No other changes needed!** The Photon loader handles everything automatically.

## Benefits

✅ **Simpler Code** - No unnecessary inheritance boilerplate
✅ **More Flexible** - Extend other classes freely
✅ **Library Compatible** - Use with TypeORM, database ORMs, etc.
✅ **Cleaner Interfaces** - Focus on business logic
✅ **Better Composition** - Mix capabilities without hierarchy conflicts

## Examples

### E-Commerce Product Service
```typescript
import { Stripe } from 'stripe';

export default class ProductService {
  private stripe = new Stripe(process.env.STRIPE_KEY);

  async createProduct(name: string, price: number) {
    // Emit progress
    this.emit({ status: 'creating_product', name });

    // Create in Stripe
    const product = await this.stripe.products.create({ name });

    // Store in local cache
    this.memory.set(`product:${product.id}`, product);

    // Call other photon
    await this.call('database.save_product', { id: product.id, name });

    this.emit({ status: 'product_created', product });
    return product;
  }
}
```

### Data Pipeline
```typescript
export default class DataPipeline {
  async process(dataSource: string) {
    this.emit({ stage: 'starting', source: dataSource });

    // Fetch from external API
    const api = this.mcp('http-api');
    const data = await api.get({ url: dataSource });

    // Process
    const processed = data.map(item => ({
      ...item,
      processed_at: new Date(),
    }));

    // Store in memory
    this.memory.set('last_result', processed);

    // Emit updates
    this.emit({ stage: 'complete', count: processed.length });

    return processed;
  }
}
```

### Task Scheduler
```typescript
export default class TaskScheduler {
  private tasks = [];

  async schedule(task: any) {
    this.emit({ event: 'task_scheduled', task: task.name });
    this.tasks.push(task);

    // Call notification service
    await this.call('notifications.send', {
      message: `Task "${task.name}" scheduled`,
    });

    return task;
  }

  async run() {
    for (const task of this.tasks) {
      this.emit({ event: 'task_running', task: task.name });
      const result = await task.execute();
      this.memory.set(`result:${task.id}`, result);
      this.emit({ event: 'task_complete', task: task.name, result });
    }
  }
}
```

## FAQ

**Q: Do I have to use the clean class pattern?**
A: No! Classes extending Photon still work fine. This is just an option for cleaner code.

**Q: Will old code stop working?**
A: Absolutely not. Existing code extending Photon is fully supported.

**Q: Can I mix patterns in the same project?**
A: Yes! Some classes can extend Photon, others can be plain. Both work.

**Q: What if I need to extend a specific base class?**
A: Perfect use case for clean classes! You can extend your base class and still get Photon capabilities.

**Q: Does this work in NCP and Lumina?**
A: Yes, through the `withPhotonCapabilities` mixin. The Photon runtime auto-detects; others use the mixin explicitly.
