/**
 * Tests for Managed Collections (ReactiveArray, ReactiveMap, ReactiveSet)
 */

import { ReactiveArray, ReactiveMap, ReactiveSet } from '../src/collections/index.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.error(`   ${e}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

console.log('\n🧪 ReactiveArray Tests\n');

test('creates empty array', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }));
  assert(arr.length === 0, 'should be empty');
  assert(events.length === 0, 'should not emit on creation');
});

test('creates with initial items', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  assert(arr.length === 3, 'should have 3 items');
  assert(events.length === 0, 'should not emit on creation');
});

test('push emits added event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }));
  arr.push(42);
  assert(arr.length === 1, 'should have 1 item');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'items:added', `event should be items:added, got ${events[0].event}`);
  assert(events[0].data === 42, 'data should be 42');
});

test('push multiple items emits multiple events', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }));
  arr.push(1, 2, 3);
  assert(arr.length === 3, 'should have 3 items');
  assert(events.length === 3, 'should emit 3 events');
  assert(events.every(e => e.event === 'items:added'), 'all should be added events');
});

test('pop emits removed event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  const popped = arr.pop();
  assert(popped === 3, 'should pop 3');
  assert(arr.length === 2, 'should have 2 items');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'items:removed', 'event should be items:removed');
  assert(events[0].data === 3, 'data should be 3');
});

test('shift emits removed event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  const shifted = arr.shift();
  assert(shifted === 1, 'should shift 1');
  assert(arr.length === 2, 'should have 2 items');
  assert(events[0].event === 'items:removed', 'event should be items:removed');
});

test('unshift emits added event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [2, 3]);
  arr.unshift(1);
  assert(arr.length === 3, 'should have 3 items');
  assert(arr[0] === 1, 'first item should be 1');
  assert(events[0].event === 'items:added', 'event should be items:added');
});

test('splice emits removed and added events', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3, 4]);
  arr.splice(1, 2, 10, 20, 30);
  assert(arr.length === 5, 'should have 5 items');
  assert(arr[1] === 10, 'index 1 should be 10');
  assert(events.filter(e => e.event === 'items:removed').length === 2, 'should have 2 removed events');
  assert(events.filter(e => e.event === 'items:added').length === 3, 'should have 3 added events');
});

test('set emits updated event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  arr.set(1, 42);
  assert(arr[1] === 42, 'index 1 should be 42');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'items:updated', 'event should be items:updated');
  const data = events[0].data as { index: number; value: number; previous: number };
  assert(data.index === 1, 'index should be 1');
  assert(data.value === 42, 'value should be 42');
  assert(data.previous === 2, 'previous should be 2');
});

test('replaceAll emits changed event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  arr.replaceAll([10, 20]);
  assert(arr.length === 2, 'should have 2 items');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'items:changed', 'event should be items:changed');
});

test('clear emits changed event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  arr.clear();
  assert(arr.length === 0, 'should be empty');
  assert(events[0].event === 'items:changed', 'event should be items:changed');
});

test('sort emits changed event', () => {
  const events: { event: string; data: unknown }[] = [];
  const arr = ReactiveArray.create<number>('items', (e, d) => events.push({ event: e, data: d }), [3, 1, 2]);
  arr.sort((a, b) => a - b);
  assert(arr[0] === 1, 'first should be 1');
  assert(events[0].event === 'items:changed', 'event should be items:changed');
});

console.log('\n🧪 ReactiveMap Tests\n');

test('creates empty map', () => {
  const events: { event: string; data: unknown }[] = [];
  const map = ReactiveMap.create<string, number>('data', (e, d) => events.push({ event: e, data: d }));
  assert(map.size === 0, 'should be empty');
});

test('set emits set event', () => {
  const events: { event: string; data: unknown }[] = [];
  const map = ReactiveMap.create<string, number>('data', (e, d) => events.push({ event: e, data: d }));
  map.set('a', 1);
  assert(map.get('a') === 1, 'should get 1');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'data:set', 'event should be data:set');
  const data = events[0].data as { key: string; value: number; isNew: boolean };
  assert(data.key === 'a', 'key should be a');
  assert(data.value === 1, 'value should be 1');
  assert(data.isNew === true, 'isNew should be true');
});

test('set on existing key has isNew false', () => {
  const events: { event: string; data: unknown }[] = [];
  const map = ReactiveMap.create<string, number>('data', (e, d) => events.push({ event: e, data: d }));
  map.set('a', 1);
  map.set('a', 2);
  const data = events[1].data as { isNew: boolean; previous: number };
  assert(data.isNew === false, 'isNew should be false');
  assert(data.previous === 1, 'previous should be 1');
});

test('delete emits deleted event', () => {
  const events: { event: string; data: unknown }[] = [];
  const map = ReactiveMap.create<string, number>('data', (e, d) => events.push({ event: e, data: d }));
  map.set('a', 1);
  events.length = 0; // Clear set event
  map.delete('a');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'data:deleted', 'event should be data:deleted');
});

test('clear emits cleared event', () => {
  const events: { event: string; data: unknown }[] = [];
  const map = ReactiveMap.create<string, number>('data', (e, d) => events.push({ event: e, data: d }));
  map.set('a', 1);
  map.set('b', 2);
  events.length = 0;
  map.clear();
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'data:cleared', 'event should be data:cleared');
});

console.log('\n🧪 ReactiveSet Tests\n');

test('creates empty set', () => {
  const events: { event: string; data: unknown }[] = [];
  const set = ReactiveSet.create<string>('tags', (e, d) => events.push({ event: e, data: d }));
  assert(set.size === 0, 'should be empty');
});

test('add emits added event', () => {
  const events: { event: string; data: unknown }[] = [];
  const set = ReactiveSet.create<string>('tags', (e, d) => events.push({ event: e, data: d }));
  set.add('foo');
  assert(set.has('foo'), 'should have foo');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'tags:added', 'event should be tags:added');
  assert(events[0].data === 'foo', 'data should be foo');
});

test('add existing value does not emit', () => {
  const events: { event: string; data: unknown }[] = [];
  const set = ReactiveSet.create<string>('tags', (e, d) => events.push({ event: e, data: d }));
  set.add('foo');
  events.length = 0;
  set.add('foo');
  assert(events.length === 0, 'should not emit for duplicate');
});

test('delete emits deleted event', () => {
  const events: { event: string; data: unknown }[] = [];
  const set = ReactiveSet.create<string>('tags', (e, d) => events.push({ event: e, data: d }));
  set.add('foo');
  events.length = 0;
  set.delete('foo');
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'tags:deleted', 'event should be tags:deleted');
});

test('clear emits cleared event', () => {
  const events: { event: string; data: unknown }[] = [];
  const set = ReactiveSet.create<string>('tags', (e, d) => events.push({ event: e, data: d }));
  set.add('foo');
  set.add('bar');
  events.length = 0;
  set.clear();
  assert(events.length === 1, 'should emit 1 event');
  assert(events[0].event === 'tags:cleared', 'event should be tags:cleared');
});

// Summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(failed > 0 ? 1 : 0);
