/**
 * Tests for Collection<T> — Rich queryable collection
 */

import { Collection } from '../src/collections/Collection.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2705 ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \u274c ${name}`);
    console.error(`     ${e}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label?: string) {
  if (actual !== expected)
    throw new Error(`${label ?? 'assert'}: expected ${expected}, got ${actual}`);
}

// ─── Construction ───

console.log('\n\ud83e\uddea Collection — Construction\n');

test('creates empty collection', () => {
  const col = new Collection<number>();
  assertEq(col.length, 0);
  assertEq(col.count(), 0);
  assert(col.isEmpty(), 'should be empty');
});

test('creates with initial items', () => {
  const col = new Collection([1, 2, 3]);
  assertEq(col.length, 3);
  assertEq(col[0], 1);
  assertEq(col[2], 3);
});

test('Collection.from() creates from array', () => {
  const col = Collection.from([10, 20]);
  assertEq(col.length, 2);
  assertEq(col[0], 10);
});

test('Collection.create() wires emitter', () => {
  const events: string[] = [];
  const col = Collection.create<number>('nums', (e) => events.push(e), [1, 2]);
  assertEq(col.length, 2);
  assertEq(events.length, 0, 'no events on init');
  col.push(3);
  assertEq(events.length, 1);
  assertEq(events[0], 'nums:added');
});

// ─── Reactivity (inherited from ReactiveArray) ───

console.log('\n\ud83e\uddea Collection — Reactivity\n');

test('push emits added event', () => {
  const events: { event: string; data: unknown }[] = [];
  const col = Collection.create<number>('items', (e, d) => events.push({ event: e, data: d }));
  col.push(42);
  assertEq(events.length, 1);
  assertEq(events[0].event, 'items:added');
  assertEq(events[0].data as number, 42);
});

test('splice emits removed+added events', () => {
  const events: { event: string; data: unknown }[] = [];
  const col = Collection.create<number>('items', (e, d) => events.push({ event: e, data: d }), [1, 2, 3]);
  col.splice(1, 1, 20);
  const removed = events.filter(e => e.event === 'items:removed');
  const added = events.filter(e => e.event === 'items:added');
  assertEq(removed.length, 1);
  assertEq(added.length, 1);
  assertEq(removed[0].data as number, 2);
  assertEq(added[0].data as number, 20);
});

test('query results do NOT emit events', () => {
  const events: string[] = [];
  const col = Collection.create<number>('items', (e) => events.push(e), [1, 2, 3]);
  const result = col.take(2);
  events.length = 0; // clear
  result.push(99); // mutate query result
  assertEq(events.length, 0, 'query result should not emit');
});

// ─── Where ───

console.log('\n\ud83e\uddea Collection — where()\n');

type Product = { name: string; price: number; stock: number; category: string };

const products = Collection.from<Product>([
  { name: 'Laptop', price: 999, stock: 5, category: 'Electronics' },
  { name: 'Mouse', price: 25, stock: 100, category: 'Electronics' },
  { name: 'Desk', price: 300, stock: 0, category: 'Furniture' },
  { name: 'Chair', price: 150, stock: 3, category: 'Furniture' },
  { name: 'Monitor', price: 450, stock: 10, category: 'Electronics' },
]);

test('where equality shorthand', () => {
  const elec = products.where('category', 'Electronics');
  assertEq(elec.count(), 3);
  assert(elec.first()!.name === 'Laptop', 'first should be Laptop');
});

test('where > operator', () => {
  const expensive = products.where('price', '>', 200);
  assertEq(expensive.count(), 3); // Laptop, Desk, Monitor
});

test('where <= operator', () => {
  const cheap = products.where('price', '<=', 150);
  assertEq(cheap.count(), 2); // Mouse, Chair
});

test('where != operator', () => {
  const notFurn = products.where('category', '!=', 'Furniture');
  assertEq(notFurn.count(), 3);
});

test('where === strict equality', () => {
  const exact = products.where('stock', '===', 0 as any);
  assertEq(exact.count(), 1);
  assertEq(exact.first()!.name, 'Desk');
});

// ─── Query / Collect / Pluck ───

console.log('\n\ud83e\uddea Collection — query/collect/pluck\n');

test('query() with predicate', () => {
  const inStock = products.query(p => p.stock > 0);
  assertEq(inStock.count(), 4);
});

test('collect() transforms items', () => {
  const names = products.collect(p => p.name);
  assertEq(names.count(), 5);
  assertEq(names[0], 'Laptop');
});

test('pluck() extracts field', () => {
  const prices = products.pluck('price');
  assertEq(prices.count(), 5);
  assertEq(prices[0], 999);
  assertEq(prices[1], 25);
});

// ─── SortBy ───

console.log('\n\ud83e\uddea Collection — sortBy()\n');

test('sortBy key ascending', () => {
  const sorted = products.sortBy('price');
  assertEq(sorted[0].name, 'Mouse');
  assertEq(sorted[sorted.length - 1].name, 'Laptop');
});

test('sortBy key descending', () => {
  const sorted = products.sortBy('price', 'desc');
  assertEq(sorted[0].name, 'Laptop');
  assertEq(sorted[sorted.length - 1].name, 'Mouse');
});

test('sortBy function', () => {
  const sorted = products.sortBy((a, b) => a.name.localeCompare(b.name));
  assertEq(sorted[0].name, 'Chair');
  assertEq(sorted[sorted.length - 1].name, 'Mouse');
});

test('sortBy does not mutate original', () => {
  const original = Collection.from([3, 1, 2]);
  original.sortBy((a, b) => a - b);
  assertEq(original[0], 3, 'original should be unchanged');
});

// ─── GroupBy ───

console.log('\n\ud83e\uddea Collection — groupBy()\n');

test('groupBy key', () => {
  const groups = products.groupBy('category');
  assertEq(Object.keys(groups).length, 2);
  assertEq(groups['Electronics'].count(), 3);
  assertEq(groups['Furniture'].count(), 2);
});

test('groupBy function', () => {
  const groups = products.groupBy(p => p.stock > 0 ? 'available' : 'out');
  assertEq(groups['available'].count(), 4);
  assertEq(groups['out'].count(), 1);
});

// ─── Unique ───

console.log('\n\ud83e\uddea Collection — unique()\n');

test('unique without key (primitives)', () => {
  const col = Collection.from([1, 2, 2, 3, 1]);
  const u = col.unique();
  assertEq(u.count(), 3);
});

test('unique by key', () => {
  const u = products.unique('category');
  assertEq(u.count(), 2);
});

// ─── Take / Skip ───

console.log('\n\ud83e\uddea Collection — take/skip\n');

test('take(n)', () => {
  const first2 = products.take(2);
  assertEq(first2.count(), 2);
  assertEq(first2[0].name, 'Laptop');
});

test('skip(n)', () => {
  const after2 = products.skip(2);
  assertEq(after2.count(), 3);
  assertEq(after2[0].name, 'Desk');
});

// ─── Terminal Methods ───

console.log('\n\ud83e\uddea Collection — Terminal Methods\n');

test('first()', () => {
  assertEq(products.first()!.name, 'Laptop');
});

test('first(fn)', () => {
  assertEq(products.first(p => p.category === 'Furniture')!.name, 'Desk');
});

test('last()', () => {
  assertEq(products.last()!.name, 'Monitor');
});

test('last(fn)', () => {
  assertEq(products.last(p => p.category === 'Electronics')!.name, 'Monitor');
});

test('count()', () => {
  assertEq(products.count(), 5);
});

test('isEmpty() on non-empty', () => {
  assert(!products.isEmpty(), 'should not be empty');
});

test('isEmpty() on empty', () => {
  assert(new Collection().isEmpty(), 'should be empty');
});

test('sum() by key', () => {
  assertEq(products.sum('stock'), 118);
});

test('sum() on primitives', () => {
  assertEq(Collection.from([1, 2, 3]).sum(), 6);
});

test('avg() by key', () => {
  const avgPrice = products.avg('price');
  assertEq(avgPrice, (999 + 25 + 300 + 150 + 450) / 5);
});

test('avg() on empty returns 0', () => {
  assertEq(new Collection<number>().avg(), 0);
});

test('min() by key', () => {
  assertEq(products.min('price')!.name, 'Mouse');
});

test('max() by key', () => {
  assertEq(products.max('price')!.name, 'Laptop');
});

test('min/max on empty returns undefined', () => {
  assert(new Collection<number>().min() === undefined, 'min empty');
  assert(new Collection<number>().max() === undefined, 'max empty');
});

test('aggregate()', () => {
  const total = products.aggregate((sum, p) => sum + p.price, 0);
  assertEq(total, 999 + 25 + 300 + 150 + 450);
});

// ─── Chaining ───

console.log('\n\ud83e\uddea Collection — Chaining\n');

test('where + sortBy + take', () => {
  const result = products
    .where('category', 'Electronics')
    .sortBy('price')
    .take(2);
  assertEq(result.count(), 2);
  assertEq(result[0].name, 'Mouse');
  assertEq(result[1].name, 'Monitor');
});

test('where + sortBy + first', () => {
  const cheapest = products
    .where('stock', '>', 0)
    .sortBy('price')
    .first();
  assertEq(cheapest!.name, 'Mouse');
});

test('query + pluck + sum', () => {
  const totalStock = products
    .query(p => p.category === 'Electronics')
    .pluck('stock')
    .sum();
  assertEq(totalStock, 5 + 100 + 10);
});

// ─── Serialization (.as() + toJSON) ───

console.log('\n\ud83e\uddea Collection — Serialization\n');

test('toJSON without .as() returns plain array', () => {
  const json = products.toJSON();
  assert(globalThis.Array.isArray(json), 'should be array');
  assertEq((json as any[]).length, 5);
});

test('toJSON with .as() returns metadata object', () => {
  const result = products.where('category', 'Electronics').as('cards');
  const json = result.toJSON() as any;
  assertEq(json._photonType, 'collection:cards');
  assertEq(json.count, 3);
  assert(globalThis.Array.isArray(json.items), 'items should be array');
  assertEq(json.items.length, 3);
});

test('.as() with options', () => {
  const result = products.as('table', { striped: true });
  const json = result.toJSON() as any;
  assertEq(json._photonType, 'collection:table');
  assertEq(json.renderOptions.striped, true);
});

test('.as() returns this for chaining', () => {
  const col = Collection.from([1, 2, 3]);
  const same = col.as('chips');
  assert(col === same, 'should return same instance');
});

test('JSON.stringify uses toJSON', () => {
  const col = Collection.from([1, 2, 3]).as('list');
  const parsed = JSON.parse(JSON.stringify(col));
  assertEq(parsed._photonType, 'collection:list');
  assertEq(parsed.count, 3);
});

test('JSON.stringify without .as() is plain array', () => {
  const col = Collection.from([1, 2, 3]);
  const parsed = JSON.parse(JSON.stringify(col));
  assert(globalThis.Array.isArray(parsed), 'should be array');
  assertEq(parsed.length, 3);
});

// ─── Summary ───

console.log('\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n');

process.exit(failed > 0 ? 1 : 0);
