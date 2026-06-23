/**
 * Structured data provider tests.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Photon } from '../src/base.js';
import {
  DataProvider,
  DurableObjectDataBackend,
  FileDataBackend,
  getDefaultDataBackend,
  setDefaultDataBackend,
  type DurableObjectStorageLike,
} from '../src/data.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

class ConcretePhoton extends Photon {}

class FakeDurableObjectStorage implements DurableObjectStorageLike {
  private values = new Map<string, unknown>();
  sql = {
    exec: (query: string, ...params: unknown[]) => ({
      toArray: () => [{ query, params }],
    }),
  };

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) {
      let deleted = 0;
      for (const item of key) {
        if (this.values.delete(item)) deleted++;
      }
      return deleted;
    }
    return this.values.delete(key);
  }

  async list<T = unknown>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options.prefix || key.startsWith(options.prefix)) {
        out.set(key, value as T);
      }
    }
    return out;
  }
}

async function testTables(): Promise<void> {
  console.log('\nTables:');

  await test('puts, gets, lists, and deletes records', async () => {
    const data = new DataProvider('records-test');
    const sessions = data.table<{ status: string }>('sessions');

    await sessions.put('session/one', { status: 'running' });
    await sessions.put('session/two', { status: 'complete' });

    assert.deepEqual(await sessions.get('session/one'), { status: 'running' });
    assert.ok(await sessions.has('session/two'));

    const listed = await sessions.list({ prefix: 'session/' });
    assert.equal(listed.total, 2);
    assert.deepEqual(
      listed.items.map(item => item.id).sort(),
      ['session/one', 'session/two']
    );

    assert.ok(await sessions.delete('session/one'));
    assert.equal(await sessions.get('session/one'), null);
    assert.ok(!(await sessions.delete('session/one')));
  });

  await test('paginates table listings', async () => {
    const data = new DataProvider('paged-table-test');
    const table = data.table<number>('items');
    await table.clear();

    await table.put('a', 1);
    await table.put('b', 2);
    await table.put('c', 3);

    const first = await table.list({ limit: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(first.next_cursor, '2');

    const second = await table.list({ limit: 2, cursor: first.next_cursor });
    assert.deepEqual(second.items.map(item => item.id), ['c']);
    assert.equal(second.next_cursor, null);
  });
}

async function testLogs(): Promise<void> {
  console.log('\nLogs:');

  await test('appends and reads ordered log entries', async () => {
    const data = new DataProvider('log-test');
    const transcript = data.log<{ role: string; content: string }>('transcript');
    await transcript.clear();

    const first = await transcript.append({ role: 'user', content: 'hello' });
    const second = await transcript.append({ role: 'assistant', content: 'hi' });

    assert.equal(first.index, 0);
    assert.equal(second.index, 1);

    const read = await transcript.read();
    assert.equal(read.total, 2);
    assert.deepEqual(read.entries.map(entry => entry.value.role), ['user', 'assistant']);
  });

  await test('continues log reads with after cursor', async () => {
    const data = new DataProvider('log-page-test');
    const events = data.log<string>('events');
    await events.clear();

    await events.append('one');
    await events.append('two');
    await events.append('three');

    const first = await events.read({ limit: 2 });
    assert.equal(first.next_cursor, '1');

    const second = await events.read({ after: first.next_cursor, limit: 2 });
    assert.deepEqual(second.entries.map(entry => entry.value), ['three']);
    assert.equal(second.next_cursor, null);
  });
}

async function testScopesAndBaseDir(): Promise<void> {
  console.log('\nScopes and baseDir:');

  await test('session data requires a session id', async () => {
    const data = new DataProvider('session-required-test');
    await assert.rejects(
      async () => data.table('sessions', 'session').get('x'),
      /Session ID required/
    );
  });

  await test('global data is shared across photons', async () => {
    const left = new DataProvider('left-photon');
    const right = new DataProvider('right-photon');
    const leftTable = left.table<string>('shared', 'global');
    const rightTable = right.table<string>('shared', 'global');

    await leftTable.clear();
    await leftTable.put('key', 'value');
    assert.equal(await rightTable.get('key'), 'value');
  });

  await test('Photon.data resolves under _baseDir even when PHOTON_DIR differs', async () => {
    const pinnedBase = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-data-pinned-'));
    const envBase = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-data-env-'));
    const savedEnv = process.env.PHOTON_DIR;

    try {
      process.env.PHOTON_DIR = envBase;

      const photon = new ConcretePhoton();
      photon._baseDir = pinnedBase;
      photon._photonName = 'demo-data';
      photon._photonNamespace = 'local';

      await photon.data.table('sessions').put('one', { ok: true });

      const expected = path.join(
        pinnedBase,
        '.data',
        'demo-data',
        'data',
        'tables'
      );
      const wrong = path.join(
        envBase,
        '.data',
        'demo-data',
        'data',
        'tables'
      );
      assert.ok(fs.existsSync(expected), `expected data under ${expected}`);
      assert.ok(!fs.existsSync(wrong), `data drifted to env base ${wrong}`);
    } finally {
      if (savedEnv === undefined) delete process.env.PHOTON_DIR;
      else process.env.PHOTON_DIR = savedEnv;
      fs.rmSync(pinnedBase, { recursive: true, force: true });
      fs.rmSync(envBase, { recursive: true, force: true });
    }
  });
}

async function testSql(): Promise<void> {
  console.log('\nSQL:');

  await test('default backend reports SQL as unavailable', async () => {
    const data = new DataProvider('sql-test');
    assert.throws(
      () => data.sql,
      /Data SQL is not available/
    );
  });
}

async function testRuntimeBackends(): Promise<void> {
  console.log('\nRuntime backends:');

  await test('uses an injected Durable Object backend for tables, logs, and SQL', async () => {
    const backend = new DurableObjectDataBackend(new FakeDurableObjectStorage());
    const data = new DataProvider('do-test', undefined, 'local', undefined, backend);

    const table = data.table<{ ok: boolean }>('records');
    await table.put('one', { ok: true });
    assert.deepEqual(await table.get('one'), { ok: true });

    const log = data.log<string>('events');
    await log.append('created');
    assert.deepEqual((await log.read()).entries.map(entry => entry.value), ['created']);

    const result = await data.sql.exec<{ query: string; params: unknown[] }>(
      'select ? as value',
      ['hello']
    );
    assert.deepEqual(result.rows, [{ query: 'select ? as value', params: ['hello'] }]);
  });

  await test('honors default backend replacement for runtime adapters', async () => {
    const previous = getDefaultDataBackend();
    const backend = new DurableObjectDataBackend(new FakeDurableObjectStorage());
    try {
      setDefaultDataBackend(backend);
      const data = new DataProvider('default-backend-test');
      await data.table('records').put('one', { source: 'adapter' });
      assert.deepEqual(await data.table('records').get('one'), { source: 'adapter' });
    } finally {
      setDefaultDataBackend(previous ?? new FileDataBackend());
    }
  });
}

async function main(): Promise<void> {
  const testBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-data-test-'));
  const savedEnv = process.env.PHOTON_DIR;
  process.env.PHOTON_DIR = testBaseDir;

  try {
    console.log('Structured data provider:');
    await testTables();
    await testLogs();
    await testScopesAndBaseDir();
    await testSql();
    await testRuntimeBackends();
  } finally {
    if (savedEnv === undefined) delete process.env.PHOTON_DIR;
    else process.env.PHOTON_DIR = savedEnv;
    fs.rmSync(testBaseDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
