/**
 * Tests for central data path resolver
 */

import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import {
  getDataRoot,
  getPhotonDataDir,
  getPhotonStatePath,
  getPhotonStateLogPath,
  getPhotonMemoryDir,
  getPhotonEnvPath,
  getPhotonContextPath,
  getPhotonRunsDir,
  getPhotonLogsDir,
  getPhotonSchedulesDir,
  getPhotonConfigPath,
  getGlobalMemoryDir,
  getSessionMemoryDir,
  getCacheDir,
  getTasksDir,
  getAuditPath,
  getMetadataPath,
  getDaemonSocketPath,
  getDaemonPidPath,
  getDaemonLogPath,
  getLegacyStatePath,
  getLegacyContextPath,
  getLegacyEnvPath,
  getLegacyMemoryDir,
} from '../src/data-paths.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

const home = os.homedir();
const defaultBase = path.join(home, '.photon');

console.log('data-paths: root');

test('getDataRoot uses ~/.photon/.data by default', () => {
  assert.equal(getDataRoot(), path.join(defaultBase, '.data'));
});

test('getDataRoot respects explicit baseDir', () => {
  assert.equal(getDataRoot('/my/repo'), '/my/repo/.data');
});

test('getDataRoot respects PHOTON_DIR env var', () => {
  process.env.PHOTON_DIR = '/env/override';
  try {
    assert.equal(getDataRoot(), '/env/override/.data');
  } finally {
    delete process.env.PHOTON_DIR;
  }
});

test('explicit baseDir takes precedence over PHOTON_DIR', () => {
  process.env.PHOTON_DIR = '/env/override';
  try {
    assert.equal(getDataRoot('/explicit'), '/explicit/.data');
  } finally {
    delete process.env.PHOTON_DIR;
  }
});

console.log('\ndata-paths: per-photon');

test('getPhotonDataDir with namespace', () => {
  assert.equal(
    getPhotonDataDir('portel-dev', 'todo'),
    path.join(defaultBase, '.data', 'portel-dev', 'todo')
  );
});

test('getPhotonDataDir defaults empty namespace to local', () => {
  assert.equal(
    getPhotonDataDir('', 'todo'),
    path.join(defaultBase, '.data', 'local', 'todo')
  );
});

test('getPhotonStatePath', () => {
  assert.equal(
    getPhotonStatePath('portel-dev', 'todo', 'work'),
    path.join(defaultBase, '.data', 'portel-dev', 'todo', 'state', 'work', 'state.json')
  );
});

test('getPhotonStatePath defaults instance to default', () => {
  assert.equal(
    getPhotonStatePath('local', 'todo', ''),
    path.join(defaultBase, '.data', 'local', 'todo', 'state', 'default', 'state.json')
  );
});

test('getPhotonStateLogPath', () => {
  assert.equal(
    getPhotonStateLogPath('local', 'todo', 'work'),
    path.join(defaultBase, '.data', 'local', 'todo', 'state', 'work', 'state.log')
  );
});

test('getPhotonMemoryDir', () => {
  assert.equal(
    getPhotonMemoryDir('portel-dev', 'whatsapp'),
    path.join(defaultBase, '.data', 'portel-dev', 'whatsapp', 'memory')
  );
});

test('getPhotonEnvPath', () => {
  assert.equal(
    getPhotonEnvPath('local', 'todo'),
    path.join(defaultBase, '.data', 'local', 'todo', 'env.json')
  );
});

test('getPhotonContextPath', () => {
  assert.equal(
    getPhotonContextPath('local', 'todo'),
    path.join(defaultBase, '.data', 'local', 'todo', 'context.json')
  );
});

test('getPhotonRunsDir', () => {
  assert.equal(
    getPhotonRunsDir('portel-dev', 'claw'),
    path.join(defaultBase, '.data', 'portel-dev', 'claw', 'runs')
  );
});

test('getPhotonLogsDir', () => {
  assert.equal(
    getPhotonLogsDir('local', 'todo'),
    path.join(defaultBase, '.data', 'local', 'todo', 'logs')
  );
});

test('getPhotonSchedulesDir', () => {
  assert.equal(
    getPhotonSchedulesDir('local', 'rss-feed'),
    path.join(defaultBase, '.data', 'local', 'rss-feed', 'schedules')
  );
});

test('getPhotonConfigPath', () => {
  assert.equal(
    getPhotonConfigPath('local', 'todo'),
    path.join(defaultBase, '.data', 'local', 'todo', 'config.json')
  );
});

console.log('\ndata-paths: global');

test('getGlobalMemoryDir', () => {
  assert.equal(getGlobalMemoryDir(), path.join(defaultBase, '.data', '_global'));
});

test('getSessionMemoryDir', () => {
  assert.equal(
    getSessionMemoryDir('sess-123', 'portel-dev', 'chat'),
    path.join(defaultBase, '.data', '_sessions', 'sess-123', 'portel-dev', 'chat')
  );
});

test('getSessionMemoryDir sanitizes session ID', () => {
  const result = getSessionMemoryDir('ses/../../bad', 'local', 'x');
  assert.ok(!result.includes('..'), 'should not contain path traversal');
  assert.ok(result.includes('_sessions'), 'should be under _sessions');
});

test('getCacheDir', () => {
  assert.equal(getCacheDir(), path.join(defaultBase, '.data', '.cache'));
});

test('getTasksDir', () => {
  assert.equal(getTasksDir(), path.join(defaultBase, '.data', 'tasks'));
});

test('getAuditPath', () => {
  assert.equal(getAuditPath(), path.join(defaultBase, '.data', 'audit.jsonl'));
});

test('getMetadataPath', () => {
  assert.equal(getMetadataPath(), path.join(defaultBase, '.data', '.metadata.json'));
});

console.log('\ndata-paths: daemon (always global)');

test('getDaemonSocketPath is always under ~/.photon/.data/', () => {
  process.env.PHOTON_DIR = '/override';
  try {
    const sp = getDaemonSocketPath();
    assert.ok(sp.includes(path.join(defaultBase, '.data')), `socket path should be under ~/.photon/.data/, got: ${sp}`);
  } finally {
    delete process.env.PHOTON_DIR;
  }
});

test('getDaemonPidPath is always under ~/.photon/.data/', () => {
  assert.equal(getDaemonPidPath(), path.join(defaultBase, '.data', 'daemon.pid'));
});

test('getDaemonLogPath is always under ~/.photon/.data/', () => {
  assert.equal(getDaemonLogPath(), path.join(defaultBase, '.data', 'daemon.log'));
});

console.log('\ndata-paths: legacy paths');

test('getLegacyStatePath matches old layout', () => {
  assert.equal(
    getLegacyStatePath('todo', 'work'),
    path.join(defaultBase, 'state', 'todo', 'work.json')
  );
});

test('getLegacyContextPath matches old layout', () => {
  assert.equal(
    getLegacyContextPath('todo'),
    path.join(defaultBase, 'context', 'todo.json')
  );
});

test('getLegacyEnvPath matches old layout', () => {
  assert.equal(
    getLegacyEnvPath('todo'),
    path.join(defaultBase, 'env', 'todo.json')
  );
});

test('getLegacyMemoryDir matches old layout', () => {
  assert.equal(
    getLegacyMemoryDir('todo'),
    path.join(defaultBase, 'data', 'todo')
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
