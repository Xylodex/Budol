const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers.cjs');
test('CSV retains UTF-8, quoted newlines, range evidence and neutralizes spreadsheet formulas', t => {
  const b = createBrowser(''); t.after(() => b.dom.window.close()); b.run('catalog.js'); const api = b.dom.window.BudolCatalog;
  const product = { title: 'Desk "blue",\n₱', url: 'https://shopee.ph/item-i.1.2?tracking=private', price: null, priceRange: { min: 10000, max: 30000 }, currency: 'PHP', scope: 'listing', seller: '=HYPERLINK("evil")', location: ' @SUM(1)', observedAt: '2026-10-03T00:00:00Z', notes: 'PRIVATE', discount: 50 };
  const csv = api.dealsCsv([product]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('"Desk ""blue"",\n₱"'));
  assert.ok(csv.includes('"PHP","","100.00","300.00","50"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"')); assert.ok(csv.includes('"\'@SUM(1)"'));
  assert.ok(csv.includes('https://shopee.ph/product/1/2')); assert.ok(csv.includes('2026-10-03T00:00:00.000Z'));
  assert.equal(csv.includes('PRIVATE'), false); assert.equal(csv.includes('tracking'), false);
  for (const title of ['+SUM(1)', '-SUM(1)', '@SUM(1)', '\t=1+1']) assert.ok(api.dealsCsv([{ ...product, title }]).includes('"\''));
});
