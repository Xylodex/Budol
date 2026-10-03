const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, product } = require('./helpers.cjs');
function setup(t) { const b = createBrowser(product(50)); t.after(() => b.dom.window.close()); b.run('catalog.js'); return { ...b, api: b.dom.window.BudolCatalog }; }
test('explicit PHP ranges preserve bounds and reject ambiguous text', t => {
  const { api } = setup(t);
  for (const text of ['₱199–₱699', 'PHP 199 - 699', '₱199 to PHP 699']) assert.deepEqual(JSON.parse(JSON.stringify(api.parseRange(text))), { min: 19900, max: 69900 });
  for (const text of ['₱699–₱199', '₱1.234–₱5', '₱199 and ₱699', '₱199–₱699 shipping ₱20', '₱1,99–₱699']) assert.equal(api.parseRange(text), null);
});
test('range capture, numeric evidence and conflicting duplicates stay conservative', t => {
  const { api, dom } = setup(t); const doc = dom.window.document;
  doc.querySelector('.price').innerHTML = '<span aria-label="promotion price"></span>₱199–₱699';
  doc.querySelector('#product').insertAdjacentHTML('beforeend', '<span aria-label="4.8 out of 5"></span><span>2.5k+ sold</span><span data-sqe="shop-name">Shop</span>');
  const item = api.extractProducts(doc)[0];
  assert.equal(item.price, null); assert.equal(item.priceRange.min, 19900); assert.equal(item.ratingValue, 4.8); assert.equal(item.soldValue, 2500); assert.equal(item.seller, 'Shop');
  doc.body.insertAdjacentHTML('beforeend', product(50, 'duplicate'));
  const conflict = api.extractProducts(doc)[0]; assert.equal(conflict.price, null); assert.equal(conflict.priceRange, null);
});
test('legacy backups load and range history never contaminates single-price history', t => {
  const { api } = setup(t); const now = '2026-10-03T00:00:00Z';
  const base = { url: 'https://shopee.ph/product/1/2', title: 'Item', price: 20000, currency: 'PHP', scope: 'listing' };
  const old = { ...base, savedAt: now, lastSeen: now, history: [{ price: 20000, at: now }], notes: 'keep' };
  let saved = api.validateBackup({ version: 1, products: [old] }).products[0];
  assert.equal(saved.notes, 'keep'); assert.equal(saved.rangeHistory.length, 0);
  saved = api.observe(saved, api.normalizeProduct({ ...base, price: null, priceRange: { min: 10000, max: 30000 } }), now);
  assert.equal(saved.history.length, 1); assert.equal(saved.rangeHistory.length, 1);
  saved.variant = { name: 'Blue / 128GB', price: 25000, at: now };
  const restored = api.validateBackup({ version: 1, products: [saved] }).products[0];
  assert.equal(restored.variant.price, 25000); assert.equal(restored.history[0].price, 20000);
  assert.throws(() => api.normalizeProduct({ ...base, priceRange: { min: 10000, max: 30000 } }));
});
