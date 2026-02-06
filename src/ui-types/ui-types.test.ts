/**
 * Tests for Purpose-Driven UI Types
 */

import { Table, Chart, Cards, Stats, Progress, Form, isPhotonUIType } from './index.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`❌ ${name}`);
    console.log(`   ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

console.log('═'.repeat(60));
console.log('Purpose-Driven UI Types Test Suite');
console.log('═'.repeat(60));

// ═══════════════════════════════════════════════════════════════
// Table Tests
// ═══════════════════════════════════════════════════════════════

console.log('\n📦 Table\n');

test('Table with explicit columns', () => {
  const table = new Table()
    .column('name', 'Name', 'string')
    .column('age', 'Age', 'number')
    .rows([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);

  const json = table.toJSON();
  assert(json._photonType === 'table', 'Should have _photonType');
  assert(json.columns.length === 2, 'Should have 2 columns');
  assert(json.rows.length === 2, 'Should have 2 rows');
});

test('Table with auto-inferred columns', () => {
  const table = new Table([
    { name: 'Alice', email: 'alice@example.com', active: true },
  ]);

  const json = table.toJSON();
  assert(json.columns.length === 3, 'Should infer 3 columns');
  assert(json.columns[0].label === 'Name', 'Should format label');
});

test('Table with options', () => {
  const table = new Table()
    .title('Users')
    .searchable()
    .paginated(20)
    .striped()
    .rows([]);

  const json = table.toJSON();
  assert(json.options.title === 'Users', 'Should set title');
  assert(json.options.searchable === true, 'Should be searchable');
  assert(json.options.pageSize === 20, 'Should set page size');
});

test('Table is PhotonUIType', () => {
  const table = new Table();
  assert(isPhotonUIType(table), 'Should be detected as PhotonUIType');
});

// ═══════════════════════════════════════════════════════════════
// Chart Tests
// ═══════════════════════════════════════════════════════════════

console.log('\n📦 Chart\n');

test('Line chart with series', () => {
  const chart = new Chart('line')
    .title('Revenue')
    .labels(['Jan', 'Feb', 'Mar'])
    .series('Revenue', [100, 200, 300])
    .series('Costs', [80, 90, 100]);

  const json = chart.toJSON();
  assert(json.chartType === 'line', 'Should be line chart');
  assert(json.series.length === 2, 'Should have 2 series');
  assert(json.labels.length === 3, 'Should have 3 labels');
});

test('Pie chart with data', () => {
  const chart = new Chart('pie')
    .data([
      { label: 'A', value: 30 },
      { label: 'B', value: 70 },
    ]);

  const json = chart.toJSON();
  assert(json.chartType === 'pie', 'Should be pie chart');
  assert(json.data.length === 2, 'Should have 2 data points');
});

test('Chart with options', () => {
  const chart = new Chart('bar')
    .stacked()
    .legend('bottom')
    .height(400)
    .xAxis('Month')
    .yAxis('Amount');

  const json = chart.toJSON();
  assert(json.options.stacked === true, 'Should be stacked');
  assert(json.options.legend === 'bottom', 'Legend at bottom');
  assert(json.options.height === 400, 'Height set');
});

// ═══════════════════════════════════════════════════════════════
// Cards Tests
// ═══════════════════════════════════════════════════════════════

console.log('\n📦 Cards\n');

test('Cards with field mapping', () => {
  const cards = new Cards()
    .heading('title')
    .description('summary')
    .image('imageUrl')
    .badge('status')
    .items([
      { title: 'Item 1', summary: 'Desc 1', imageUrl: '/img/1.jpg', status: 'New' },
    ]);

  const json = cards.toJSON();
  assert(json.fields.heading === 'title', 'Heading mapped');
  assert(json.fields.image === 'imageUrl', 'Image mapped');
  assert(json.items.length === 1, 'Has items');
});

test('Cards with auto-inferred fields', () => {
  const cards = new Cards([
    { name: 'Product', description: 'A product', image: '/img.jpg' },
  ]);

  const json = cards.toJSON();
  assert(json.fields.heading === 'name', 'Should infer name as heading');
  assert(json.fields.description === 'description', 'Should infer description');
});

test('Cards with layout options', () => {
  const cards = new Cards()
    .columns(4)
    .compact()
    .hoverable(false)
    .items([]);

  const json = cards.toJSON();
  assert(json.options.columns === 4, '4 columns');
  assert(json.options.compact === true, 'Compact');
  assert(json.options.hoverable === false, 'Not hoverable');
});

// ═══════════════════════════════════════════════════════════════
// Stats Tests
// ═══════════════════════════════════════════════════════════════

console.log('\n📦 Stats\n');

test('Stats with various formats', () => {
  const stats = new Stats()
    .stat('Users', 1234)
    .currency('Revenue', 50000)
    .percent('Conversion', 3.5)
    .count('Orders', 1500000);

  const json = stats.toJSON();
  assert(json.stats.length === 4, 'Should have 4 stats');
  assert(json.stats[1].format === 'currency', 'Currency format');
  assert(json.stats[2].format === 'percent', 'Percent format');
  assert(json.stats[3].format === 'compact', 'Compact format');
});

test('Stats with trends', () => {
  const stats = new Stats()
    .stat('Users', 1234, { trend: '+12%', trendUp: true });

  const json = stats.toJSON();
  assert(json.stats[0].trend === '+12%', 'Has trend');
  assert(json.stats[0].trendUp === true, 'Trend is up');
});

// ═══════════════════════════════════════════════════════════════
// Progress Tests
// ═══════════════════════════════════════════════════════════════

console.log('\n📦 Progress\n');

test('Simple progress bar', () => {
  const progress = new Progress(75)
    .label('Uploading...')
    .color('blue');

  const json = progress.toJSON();
  assert(json.value === 75, 'Value is 75');
  assert(json.options.title === 'Uploading...', 'Has label');
  assert(json.options.color === 'blue', 'Blue color');
});

test('Multi-bar progress', () => {
  const progress = new Progress()
    .bar('Design', 100)
    .bar('Dev', 50)
    .bar('Test', 10);

  const json = progress.toJSON();
  assert(json.bars.length === 3, 'Has 3 bars');
  assert(json.bars[0].value === 100, 'First bar at 100%');
});

test('Step progress', () => {
  const progress = new Progress('steps')
    .step('Cart', 'completed')
    .step('Shipping', 'current')
    .step('Payment', 'pending');

  const json = progress.toJSON();
  assert(json.options.style === 'steps', 'Steps style');
  assert(json.steps.length === 3, 'Has 3 steps');
  assert(json.steps[1].status === 'current', 'Second step is current');
});

// ═══════════════════════════════════════════════════════════════
// Form Tests
// ═══════════════════════════════════════════════════════════════

console.log('\n📦 Form\n');

test('Form with various fields', () => {
  const form = new Form()
    .title('Settings')
    .text('name', 'Name', { required: true })
    .email('email', 'Email')
    .select('theme', 'Theme', ['light', 'dark'])
    .toggle('notifications', 'Notifications')
    .submit('Save', 'saveSettings');

  const json = form.toJSON();
  assert(json.options.title === 'Settings', 'Has title');
  assert(json.fields.length === 4, 'Has 4 fields');
  assert(json.fields[0].required === true, 'Name required');
  assert(json.fields[2].type === 'select', 'Theme is select');
  assert(json.options.submitMethod === 'saveSettings', 'Submit method set');
});

test('Form with layout options', () => {
  const form = new Form()
    .layout('horizontal')
    .columns(2)
    .showReset()
    .confirmSubmit('Are you sure?');

  const json = form.toJSON();
  assert(json.options.layout === 'horizontal', 'Horizontal layout');
  assert(json.options.columns === 2, '2 columns');
  assert(json.options.showReset === true, 'Show reset');
  assert(json.options.confirmSubmit === 'Are you sure?', 'Confirm message');
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

if (failed > 0) {
  process.exit(1);
}
