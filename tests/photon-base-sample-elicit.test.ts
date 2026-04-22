/**
 * Unit tests for the new imperative methods on the Photon base class:
 *   - this.sample()  — MCP sampling/createMessage passthrough
 *   - this.confirm() — yes/no elicitation sugar
 *   - this.elicit()  — arbitrary elicitation request
 *
 * These test the base class directly (not through the loader) using the
 * same AsyncLocalStorage the runtime uses to attach providers. They
 * prove the *contract* the base class is built against; the loader-side
 * injection for plain classes is tested separately in photon/tests.
 */

import assert from 'node:assert/strict';
import { executionContext } from '@portel/cli';
import { Photon } from '../src/base.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  \u2717 ${name}\n    ${err.message}`);
  }
}

class ConcretePhoton extends Photon {}

async function main(): Promise<void> {
  console.log('Photon base class — sample / confirm / elicit:');

  await test('this.sample wraps `prompt` as a single user-role text message', async () => {
    const p = new ConcretePhoton();
    let received: any;
    await executionContext.run(
      {
        samplingProvider: async (params: any) => {
          received = params;
          return {
            role: 'assistant' as const,
            content: { type: 'text' as const, text: 'ok' },
            model: 'mock',
          };
        },
      } as any,
      async () => {
        const out = await p.sample({ prompt: 'hello', maxTokens: 50 });
        assert.equal(out, 'ok');
      }
    );
    assert.equal(received.messages.length, 1);
    assert.equal(received.messages[0].role, 'user');
    assert.equal(received.messages[0].content.type, 'text');
    assert.equal(received.messages[0].content.text, 'hello');
    assert.equal(received.maxTokens, 50);
  });

  await test('this.sample defaults maxTokens to 1024 when omitted', async () => {
    const p = new ConcretePhoton();
    let max: number | undefined;
    await executionContext.run(
      {
        samplingProvider: async (params: any) => {
          max = params.maxTokens;
          return {
            role: 'assistant' as const,
            content: { type: 'text' as const, text: '' },
            model: 'mock',
          };
        },
      } as any,
      async () => {
        await p.sample({ prompt: 'x' });
      }
    );
    assert.equal(max, 1024);
  });

  await test('this.sample passes explicit `messages` through untouched', async () => {
    const p = new ConcretePhoton();
    let received: any;
    const msgs = [
      { role: 'user' as const, content: { type: 'text' as const, text: 'first' } },
      { role: 'assistant' as const, content: { type: 'text' as const, text: 'second' } },
      { role: 'user' as const, content: { type: 'text' as const, text: 'third' } },
    ];
    await executionContext.run(
      {
        samplingProvider: async (params: any) => {
          received = params.messages;
          return {
            role: 'assistant' as const,
            content: { type: 'text' as const, text: 'r' },
            model: 'mock',
          };
        },
      } as any,
      async () => {
        await p.sample({ messages: msgs, systemPrompt: 'be brief' });
      }
    );
    assert.deepEqual(received, msgs);
  });

  await test('this.sample returns empty string for non-text content', async () => {
    const p = new ConcretePhoton();
    let out: string | undefined;
    await executionContext.run(
      {
        samplingProvider: async () => ({
          role: 'assistant' as const,
          content: { type: 'image' as const, data: 'b64', mimeType: 'image/png' },
          model: 'mock',
        }),
      } as any,
      async () => {
        out = await p.sample({ prompt: 'draw' });
      }
    );
    assert.equal(out, '');
  });

  await test('this.sample throws without a provider in context', async () => {
    const p = new ConcretePhoton();
    await assert.rejects(
      () => p.sample({ prompt: 'x' }),
      /sampling/i,
      'error should mention the sampling capability'
    );
  });

  await test('this.sample throws if neither prompt nor messages provided', async () => {
    const p = new ConcretePhoton();
    await executionContext.run(
      {
        samplingProvider: async () => ({
          role: 'assistant' as const,
          content: { type: 'text' as const, text: '' },
          model: 'mock',
        }),
      } as any,
      async () => {
        await assert.rejects(() => p.sample({}), /prompt.*messages/);
      }
    );
  });

  await test('this.confirm delegates to the input provider with an ask:confirm shape', async () => {
    const p = new ConcretePhoton();
    let shape: any;
    await executionContext.run(
      {
        inputProvider: async (ask: any) => {
          shape = ask;
          return true;
        },
      } as any,
      async () => {
        const ok = await p.confirm('Delete?');
        assert.equal(ok, true);
      }
    );
    assert.equal(shape.ask, 'confirm');
    assert.equal(shape.question, 'Delete?');
  });

  await test('this.confirm coerces truthy/falsy provider results to booleans', async () => {
    const p = new ConcretePhoton();
    await executionContext.run(
      { inputProvider: async () => 1 } as any,
      async () => assert.equal(await p.confirm('?'), true)
    );
    await executionContext.run(
      { inputProvider: async () => 0 } as any,
      async () => assert.equal(await p.confirm('?'), false)
    );
    await executionContext.run(
      { inputProvider: async () => null } as any,
      async () => assert.equal(await p.confirm('?'), false)
    );
  });

  await test('this.elicit forwards an arbitrary AskYield and returns the provider result', async () => {
    const p = new ConcretePhoton();
    let received: any;
    await executionContext.run(
      {
        inputProvider: async (ask: any) => {
          received = ask;
          return 'green';
        },
      } as any,
      async () => {
        const choice = await p.elicit({
          ask: 'select',
          message: 'Color?',
          options: ['red', 'green', 'blue'],
        } as any);
        assert.equal(choice, 'green');
      }
    );
    assert.equal(received.ask, 'select');
    assert.deepEqual(received.options, ['red', 'green', 'blue']);
  });

  await test('this.confirm / this.elicit throw without provider (clear error)', async () => {
    const p = new ConcretePhoton();
    await assert.rejects(() => p.confirm('?'), /elicit/i);
    await assert.rejects(() => p.elicit({ ask: 'text', message: '?' } as any), /elicit/i);
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
