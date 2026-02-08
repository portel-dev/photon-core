/**
 * Execution Audit Trail Tests
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuditTrail, generateExecutionId } from '../src/audit.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

// Use temp directory for tests
const testDir = path.join(os.tmpdir(), `photon-audit-test-${Date.now()}`);
process.env.PHOTON_LOG_DIR = testDir;

async function testGenerateId() {
  console.log('\nGenerateId:');

  await test('creates unique IDs', () => {
    const id1 = generateExecutionId();
    const id2 = generateExecutionId();
    assert.ok(id1.startsWith('exec_'));
    assert.ok(id2.startsWith('exec_'));
    assert.notEqual(id1, id2);
  });
}

async function testRecord() {
  console.log('\nRecord:');

  await test('writes JSONL entry', () => {
    const audit = new AuditTrail();
    audit.record({
      id: 'exec_test1',
      photon: 'test-photon',
      method: 'add',
      input: { text: 'Hello' },
      output: { id: '1', text: 'Hello' },
      duration_ms: 45,
      timestamp: '2026-02-08T10:00:00.000Z',
      parent_id: null,
      error: null,
    });

    const logPath = path.join(testDir, 'test-photon', 'executions.jsonl');
    assert.ok(fs.existsSync(logPath));

    const content = fs.readFileSync(logPath, 'utf-8');
    const record = JSON.parse(content.trim());
    assert.equal(record.id, 'exec_test1');
    assert.equal(record.method, 'add');
    assert.equal(record.duration_ms, 45);
  });
}

async function testStartFinish() {
  console.log('\nStart/Finish:');

  await test('records execution with timing', async () => {
    const audit = new AuditTrail();
    const { id, finish } = audit.start('test-photon', 'process', { orderId: '123' });

    await new Promise(r => setTimeout(r, 10));

    const entry = finish({ status: 'done' });
    assert.ok(id.startsWith('exec_'));
    assert.ok(entry.duration_ms >= 10);
    assert.equal(entry.error, null);
    assert.deepEqual(entry.output, { status: 'done' });
  });

  await test('records errors', () => {
    const audit = new AuditTrail();
    const { finish } = audit.start('test-photon', 'fail', { bad: true });

    const entry = finish(null, new Error('Something went wrong'));
    assert.equal(entry.error, 'Something went wrong');
    assert.equal(entry.output, null);
  });

  await test('sanitizes sensitive input fields', () => {
    const audit = new AuditTrail();
    const { finish } = audit.start('test-photon', 'login', {
      username: 'admin',
      password: 'secret123',
      apiKey: 'key-abc',
    });

    const entry = finish('ok');
    assert.equal(entry.input.username, 'admin');
    assert.equal(entry.input.password, '[REDACTED]');
    assert.equal(entry.input.apiKey, '[REDACTED]');
  });
}

async function testQuery() {
  console.log('\nQuery:');

  await test('returns most recent first', async () => {
    const audit = new AuditTrail();

    for (let i = 0; i < 5; i++) {
      audit.record({
        id: `exec_q${i}`,
        photon: 'query-test',
        method: 'work',
        input: { i },
        output: i,
        duration_ms: i * 10,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        parent_id: null,
        error: null,
      });
    }

    const results = await audit.query('query-test');
    assert.equal(results.length, 5);
    assert.equal(results[0].id, 'exec_q4');
    assert.equal(results[4].id, 'exec_q0');
  });

  await test('filters by method', async () => {
    const audit = new AuditTrail();

    audit.record({
      id: 'exec_m1', photon: 'filter-test', method: 'add',
      input: {}, output: 'ok', duration_ms: 1,
      timestamp: new Date().toISOString(), parent_id: null, error: null,
    });
    audit.record({
      id: 'exec_m2', photon: 'filter-test', method: 'remove',
      input: {}, output: 'ok', duration_ms: 1,
      timestamp: new Date().toISOString(), parent_id: null, error: null,
    });

    const adds = await audit.query('filter-test', { method: 'add' });
    assert.equal(adds.length, 1);
    assert.equal(adds[0].method, 'add');
  });

  await test('filters errors only', async () => {
    const audit = new AuditTrail();

    audit.record({
      id: 'exec_e1', photon: 'error-test', method: 'ok',
      input: {}, output: 'ok', duration_ms: 1,
      timestamp: new Date().toISOString(), parent_id: null, error: null,
    });
    audit.record({
      id: 'exec_e2', photon: 'error-test', method: 'fail',
      input: {}, output: null, duration_ms: 1,
      timestamp: new Date().toISOString(), parent_id: null, error: 'boom',
    });

    const errors = await audit.query('error-test', { errorsOnly: true });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].error, 'boom');
  });

  await test('respects limit', async () => {
    const audit = new AuditTrail();

    for (let i = 0; i < 10; i++) {
      audit.record({
        id: `exec_l${i}`, photon: 'limit-test', method: 'work',
        input: {}, output: i, duration_ms: 1,
        timestamp: new Date().toISOString(), parent_id: null, error: null,
      });
    }

    const results = await audit.query('limit-test', { limit: 3 });
    assert.equal(results.length, 3);
  });

  await test('returns empty for nonexistent photon', async () => {
    const audit = new AuditTrail();
    const results = await audit.query('nonexistent-photon');
    assert.deepEqual(results, []);
  });
}

async function testGet() {
  console.log('\nGet:');

  await test('finds record by ID', async () => {
    const audit = new AuditTrail();

    audit.record({
      id: 'exec_find_me', photon: 'get-test', method: 'target',
      input: {}, output: 'found', duration_ms: 1,
      timestamp: new Date().toISOString(), parent_id: null, error: null,
    });

    const found = await audit.get('exec_find_me', 'get-test');
    assert.ok(found);
    assert.equal(found.method, 'target');

    const foundGlobal = await audit.get('exec_find_me');
    assert.ok(foundGlobal);
    assert.equal(foundGlobal.id, 'exec_find_me');

    const notFound = await audit.get('exec_nonexistent');
    assert.equal(notFound, null);
  });
}

async function testTrace() {
  console.log('\nTrace:');

  await test('finds parent and children', async () => {
    const audit = new AuditTrail();
    const ts = new Date().toISOString();

    audit.record({
      id: 'exec_parent', photon: 'trace-test', method: 'orchestrate',
      input: {}, output: 'done', duration_ms: 100,
      timestamp: ts, parent_id: null, error: null,
    });
    audit.record({
      id: 'exec_child1', photon: 'trace-test-a', method: 'step1',
      input: {}, output: 'ok', duration_ms: 30,
      timestamp: ts, parent_id: 'exec_parent', error: null,
    });
    audit.record({
      id: 'exec_child2', photon: 'trace-test-b', method: 'step2',
      input: {}, output: 'ok', duration_ms: 40,
      timestamp: ts, parent_id: 'exec_parent', error: null,
    });

    const trace = await audit.trace('exec_parent');
    assert.equal(trace.length, 3);
    assert.equal(trace[0].id, 'exec_parent');
  });
}

async function testClear() {
  console.log('\nClear:');

  await test('removes logs for a photon', async () => {
    const audit = new AuditTrail();

    audit.record({
      id: 'exec_clear', photon: 'clear-test', method: 'temp',
      input: {}, output: null, duration_ms: 1,
      timestamp: new Date().toISOString(), parent_id: null, error: null,
    });

    assert.ok(audit.listPhotons().includes('clear-test'));
    audit.clear('clear-test');

    const results = await audit.query('clear-test');
    assert.equal(results.length, 0);
  });

  await test('listPhotons returns photons with logs', () => {
    const audit = new AuditTrail();
    const photons = audit.listPhotons();
    assert.ok(photons.length > 0);
    assert.ok(photons.includes('test-photon'));
  });
}

async function testPrune() {
  console.log('\nPrune:');

  await test('removes records older than retention period', async () => {
    const audit = new AuditTrail();
    const now = Date.now();

    // Old record (40 days ago)
    audit.record({
      id: 'exec_old', photon: 'prune-test', method: 'old',
      input: {}, output: 'ok', duration_ms: 1,
      timestamp: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
      parent_id: null, error: null,
    });

    // Recent record (1 day ago)
    audit.record({
      id: 'exec_recent', photon: 'prune-test', method: 'recent',
      input: {}, output: 'ok', duration_ms: 1,
      timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
      parent_id: null, error: null,
    });

    // Prune with 30-day retention
    const removed = audit.prune(30 * 24 * 60 * 60 * 1000, 'prune-test');
    assert.equal(removed, 1);

    const results = await audit.query('prune-test');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'exec_recent');
  });

  await test('removes empty log files after prune', async () => {
    const audit = new AuditTrail();
    const now = Date.now();

    // Only old records
    audit.record({
      id: 'exec_all_old', photon: 'prune-empty-test', method: 'old',
      input: {}, output: 'ok', duration_ms: 1,
      timestamp: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
      parent_id: null, error: null,
    });

    audit.prune(30 * 24 * 60 * 60 * 1000, 'prune-empty-test');
    assert.ok(!audit.listPhotons().includes('prune-empty-test'));
  });
}

(async () => {
  console.log('Execution Audit Trail Tests\n' + '='.repeat(50));

  await testGenerateId();
  await testRecord();
  await testStartFinish();
  await testQuery();
  await testGet();
  await testTrace();
  await testPrune();
  await testClear();

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.PHOTON_LOG_DIR;

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nAll audit trail tests passed!');
})();
