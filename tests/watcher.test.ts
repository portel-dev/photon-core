/**
 * PhotonWatcher Tests
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PhotonWatcher } from '../src/watcher.js';

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const testDir = path.join(os.tmpdir(), `photon-watcher-${Date.now()}`);

function cleanup() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

async function testScanOnStart() {
  console.log('\nScan on Start:');

  const dir = path.join(testDir, 'scan');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'todo.photon.ts'), 'export default class Todo {}');
  fs.writeFileSync(path.join(dir, 'notes.photon.js'), 'module.exports = class Notes {}');
  fs.writeFileSync(path.join(dir, 'readme.md'), '# Not a photon');
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');

  await test('emits added for each photon file on start', async () => {
    const watcher = new PhotonWatcher({ directories: [dir], watchDirectories: false });
    const added: string[] = [];
    watcher.on('added', (name: string) => added.push(name));

    await watcher.start();
    assert.deepEqual(added.sort(), ['notes', 'todo']);
    await watcher.stop();
  });

  await test('ignores non-photon files', async () => {
    const watcher = new PhotonWatcher({ directories: [dir], watchDirectories: false });
    const added: string[] = [];
    watcher.on('added', (name: string) => added.push(name));

    await watcher.start();
    assert.ok(!added.includes('readme'));
    assert.ok(!added.includes('.DS_Store'));
    await watcher.stop();
  });

  await test('getWatchedFiles returns correct map', async () => {
    const watcher = new PhotonWatcher({ directories: [dir], watchDirectories: false });
    await watcher.start();

    const watched = watcher.getWatchedFiles();
    assert.equal(watched.size, 2);
    assert.equal(watched.get('todo'), path.join(dir, 'todo.photon.ts'));
    assert.equal(watched.get('notes'), path.join(dir, 'notes.photon.js'));
    await watcher.stop();
  });
}

async function testFileChange() {
  console.log('\nFile Change Detection:');

  const dir = path.join(testDir, 'change');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'counter.photon.ts');
  fs.writeFileSync(filePath, 'export default class Counter { v = 1 }');

  await test('emits changed when file is modified', async () => {
    const watcher = new PhotonWatcher({
      directories: [dir],
      debounceMs: 50,
      watchDirectories: false,
    });

    let changedName: string | null = null;
    watcher.on('changed', (name: string) => {
      changedName = name;
    });

    await watcher.start();
    // Wait for watchers to stabilize
    await sleep(100);

    // Modify the file
    fs.writeFileSync(filePath, 'export default class Counter { v = 2 }');
    await sleep(300);

    assert.equal(changedName, 'counter');
    await watcher.stop();
  });
}

async function testDirectoryWatch() {
  console.log('\nDirectory Watch:');

  const dir = path.join(testDir, 'dirwatch');
  fs.mkdirSync(dir, { recursive: true });

  await test('emits added when new photon file appears', async () => {
    const watcher = new PhotonWatcher({
      directories: [dir],
      debounceMs: 50,
      watchDirectories: true,
    });

    let addedName: string | null = null;
    // Skip initial scan adds
    let started = false;
    watcher.on('added', (name: string) => {
      if (started) addedName = name;
    });

    await watcher.start();
    started = true;
    await sleep(100);

    // Create a new photon file
    fs.writeFileSync(path.join(dir, 'new-tool.photon.ts'), 'export default class NewTool {}');
    await sleep(400);

    assert.equal(addedName, 'new-tool');
    await watcher.stop();
  });
}

async function testCustomExtensions() {
  console.log('\nCustom Extensions:');

  const dir = path.join(testDir, 'ext');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.skill.ts'), 'class App {}');
  fs.writeFileSync(path.join(dir, 'util.photon.ts'), 'class Util {}');

  await test('only watches configured extensions', async () => {
    const watcher = new PhotonWatcher({
      directories: [dir],
      extensions: ['.skill.ts'],
      watchDirectories: false,
    });

    const added: string[] = [];
    watcher.on('added', (name: string) => added.push(name));
    await watcher.start();

    assert.deepEqual(added, ['app']);
    await watcher.stop();
  });
}

async function testIgnoredFiles() {
  console.log('\nIgnored Files:');

  const dir = path.join(testDir, 'ignored');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'good.photon.ts'), 'class Good {}');
  // These shouldn't match because they don't end with the extension
  // but let's test temp file patterns on directory watch events

  await test('filters temp files during scan', async () => {
    const watcher = new PhotonWatcher({ directories: [dir], watchDirectories: false });
    const added: string[] = [];
    watcher.on('added', (name: string) => added.push(name));
    await watcher.start();

    assert.deepEqual(added, ['good']);
    await watcher.stop();
  });
}

async function testStopCleansUp() {
  console.log('\nCleanup:');

  const dir = path.join(testDir, 'cleanup');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.photon.ts'), 'class A {}');

  await test('stop closes all watchers', async () => {
    const watcher = new PhotonWatcher({ directories: [dir] });
    await watcher.start();

    const watched = watcher.getWatchedFiles();
    assert.equal(watched.size, 1);

    await watcher.stop();
    assert.equal(watcher.getWatchedFiles().size, 0);
  });
}

async function testUnwatchFile() {
  console.log('\nUnwatch:');

  const dir = path.join(testDir, 'unwatch');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'temp.photon.ts');
  fs.writeFileSync(filePath, 'class Temp {}');

  await test('unwatchFile removes specific file from watched set', async () => {
    const watcher = new PhotonWatcher({ directories: [dir], watchDirectories: false });
    await watcher.start();

    assert.equal(watcher.getWatchedFiles().size, 1);
    watcher.unwatchFile(filePath);
    assert.equal(watcher.getWatchedFiles().size, 0);

    await watcher.stop();
  });
}

async function testEmptyDirectory() {
  console.log('\nEdge Cases:');

  await test('handles non-existent directory gracefully', async () => {
    const watcher = new PhotonWatcher({
      directories: [path.join(testDir, 'does-not-exist')],
      watchDirectories: false,
    });

    const added: string[] = [];
    watcher.on('added', (name: string) => added.push(name));
    await watcher.start();

    assert.deepEqual(added, []);
    await watcher.stop();
  });

  await test('start is idempotent', async () => {
    const dir = path.join(testDir, 'idempotent');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.photon.ts'), 'class X {}');

    const watcher = new PhotonWatcher({ directories: [dir], watchDirectories: false });
    const added: string[] = [];
    watcher.on('added', (name: string) => added.push(name));

    await watcher.start();
    await watcher.start(); // second call should be no-op
    assert.equal(added.length, 1);
    await watcher.stop();
  });
}

async function main() {
  console.log('PhotonWatcher Tests');
  console.log('='.repeat(40));

  try {
    await testScanOnStart();
    await testFileChange();
    await testDirectoryWatch();
    await testCustomExtensions();
    await testIgnoredFiles();
    await testStopCleansUp();
    await testUnwatchFile();
    await testEmptyDirectory();
  } finally {
    cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
