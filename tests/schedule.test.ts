/**
 * Runtime Scheduling System Tests
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduleProvider } from '../src/schedule.js';

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
const testDir = path.join(os.tmpdir(), `photon-schedules-${Date.now()}`);
process.env.PHOTON_SCHEDULES_DIR = testDir;

async function cleanup() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

async function run() {
  console.log('\n📅 Schedule Provider Tests\n');

  const provider = new ScheduleProvider('test-photon');

  // ── Create ───────────────────────────────────────────────────────

  await test('create: basic cron schedule', async () => {
    const task = await provider.create({
      name: 'daily-cleanup',
      schedule: '0 0 * * *',
      method: 'cleanup',
      params: { days: 30 },
    });

    assert.ok(task.id, 'should have an id');
    assert.equal(task.name, 'daily-cleanup');
    assert.equal(task.cron, '0 0 * * *');
    assert.equal(task.method, 'cleanup');
    assert.deepEqual(task.params, { days: 30 });
    assert.equal(task.status, 'active');
    assert.equal(task.fireOnce, false);
    assert.equal(task.executionCount, 0);
    assert.equal(task.photonId, 'test-photon');
  });

  await test('create: with shorthand @daily', async () => {
    const task = await provider.create({
      name: 'shorthand-test',
      schedule: '@daily',
      method: 'run',
    });
    assert.equal(task.cron, '0 0 * * *');
  });

  await test('create: with shorthand @hourly', async () => {
    const task = await provider.create({
      name: 'hourly-test',
      schedule: '@hourly',
      method: 'check',
    });
    assert.equal(task.cron, '0 * * * *');
  });

  await test('create: fire-once task', async () => {
    const task = await provider.create({
      name: 'one-shot',
      schedule: '0 9 * * *',
      method: 'notify',
      fireOnce: true,
    });
    assert.equal(task.fireOnce, true);
  });

  await test('create: with maxExecutions', async () => {
    const task = await provider.create({
      name: 'limited-task',
      schedule: '@weekly',
      method: 'report',
      maxExecutions: 4,
    });
    assert.equal(task.maxExecutions, 4);
    assert.equal(task.cron, '0 0 * * 0');
  });

  await test('create: rejects duplicate name', async () => {
    await assert.rejects(
      () => provider.create({ name: 'daily-cleanup', schedule: '@daily', method: 'x' }),
      /already exists/
    );
  });

  await test('create: rejects invalid cron', async () => {
    await assert.rejects(
      () => provider.create({ name: 'bad-cron', schedule: 'not a cron', method: 'x' }),
      /Invalid cron expression/
    );
  });

  await test('create: rejects 6-field cron', async () => {
    await assert.rejects(
      () => provider.create({ name: 'six-field', schedule: '0 0 0 * * *', method: 'x' }),
      /Expected 5 fields/
    );
  });

  // ── Get ──────────────────────────────────────────────────────────

  await test('get: by ID', async () => {
    const tasks = await provider.list();
    const task = await provider.get(tasks[0].id);
    assert.ok(task);
    assert.equal(task.name, 'daily-cleanup');
  });

  await test('get: returns null for missing ID', async () => {
    const task = await provider.get('nonexistent-id');
    assert.equal(task, null);
  });

  await test('getByName: finds by name', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    assert.equal(task.method, 'cleanup');
  });

  await test('getByName: returns null for missing name', async () => {
    const task = await provider.getByName('nonexistent');
    assert.equal(task, null);
  });

  // ── List ─────────────────────────────────────────────────────────

  await test('list: returns all tasks', async () => {
    const tasks = await provider.list();
    assert.ok(tasks.length >= 5, `expected at least 5 tasks, got ${tasks.length}`);
  });

  await test('list: filter by status', async () => {
    const active = await provider.list('active');
    assert.ok(active.every(t => t.status === 'active'));
  });

  await test('list: sorted by createdAt', async () => {
    const tasks = await provider.list();
    for (let i = 1; i < tasks.length; i++) {
      assert.ok(tasks[i].createdAt >= tasks[i - 1].createdAt);
    }
  });

  // ── Has ──────────────────────────────────────────────────────────

  await test('has: returns true for existing', async () => {
    assert.equal(await provider.has('daily-cleanup'), true);
  });

  await test('has: returns false for missing', async () => {
    assert.equal(await provider.has('nonexistent'), false);
  });

  // ── Update ───────────────────────────────────────────────────────

  await test('update: change schedule', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    const updated = await provider.update(task.id, { schedule: '0 6 * * *' });
    assert.equal(updated.cron, '0 6 * * *');
    assert.equal(updated.name, 'daily-cleanup'); // unchanged
  });

  await test('update: change method and params', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    const updated = await provider.update(task.id, {
      method: 'purge',
      params: { olderThan: 7 },
    });
    assert.equal(updated.method, 'purge');
    assert.deepEqual(updated.params, { olderThan: 7 });
  });

  await test('update: rejects missing task', async () => {
    await assert.rejects(
      () => provider.update('nonexistent', { schedule: '@daily' }),
      /not found/
    );
  });

  // ── Pause / Resume ──────────────────────────────────────────────

  await test('pause: pauses active task', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    const paused = await provider.pause(task.id);
    assert.equal(paused.status, 'paused');
  });

  await test('pause: rejects non-active task', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    await assert.rejects(
      () => provider.pause(task.id),
      /Only active tasks/
    );
  });

  await test('resume: resumes paused task', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    const resumed = await provider.resume(task.id);
    assert.equal(resumed.status, 'active');
  });

  await test('resume: rejects non-paused task', async () => {
    const task = await provider.getByName('daily-cleanup');
    assert.ok(task);
    await assert.rejects(
      () => provider.resume(task.id),
      /Only paused tasks/
    );
  });

  // ── Cancel ───────────────────────────────────────────────────────

  await test('cancel: removes task by ID', async () => {
    const task = await provider.getByName('one-shot');
    assert.ok(task);
    const removed = await provider.cancel(task.id);
    assert.equal(removed, true);
    assert.equal(await provider.get(task.id), null);
  });

  await test('cancel: returns false for missing', async () => {
    assert.equal(await provider.cancel('nonexistent'), false);
  });

  await test('cancelByName: removes by name', async () => {
    const removed = await provider.cancelByName('shorthand-test');
    assert.equal(removed, true);
    assert.equal(await provider.has('shorthand-test'), false);
  });

  await test('cancelByName: returns false for missing', async () => {
    assert.equal(await provider.cancelByName('nonexistent'), false);
  });

  // ── Cancel All ──────────────────────────────────────────────────

  await test('cancelAll: removes all tasks', async () => {
    const before = await provider.list();
    assert.ok(before.length > 0);
    const count = await provider.cancelAll();
    assert.equal(count, before.length);
    const after = await provider.list();
    assert.equal(after.length, 0);
  });

  // ── Isolation ───────────────────────────────────────────────────

  await test('isolation: different photons have separate schedules', async () => {
    const p1 = new ScheduleProvider('photon-a');
    const p2 = new ScheduleProvider('photon-b');

    await p1.create({ name: 'task-a', schedule: '@daily', method: 'run' });
    await p2.create({ name: 'task-b', schedule: '@hourly', method: 'check' });

    const list1 = await p1.list();
    const list2 = await p2.list();

    assert.equal(list1.length, 1);
    assert.equal(list2.length, 1);
    assert.equal(list1[0].name, 'task-a');
    assert.equal(list2[0].name, 'task-b');

    await p1.cancelAll();
    await p2.cancelAll();
  });

  // ── Cron Shorthands ─────────────────────────────────────────────

  await test('shorthands: @monthly resolves correctly', async () => {
    const p = new ScheduleProvider('shorthand-test');
    const task = await p.create({ name: 'monthly', schedule: '@monthly', method: 'run' });
    assert.equal(task.cron, '0 0 1 * *');
    await p.cancelAll();
  });

  await test('shorthands: @yearly resolves correctly', async () => {
    const p = new ScheduleProvider('shorthand-test');
    const task = await p.create({ name: 'yearly', schedule: '@yearly', method: 'run' });
    assert.equal(task.cron, '0 0 1 1 *');
    await p.cancelAll();
  });

  // ── Summary ──────────────────────────────────────────────────────

  await cleanup();

  console.log(`\n  ${passed} passing, ${failed} failing\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
