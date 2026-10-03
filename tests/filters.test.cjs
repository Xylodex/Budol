const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers.cjs');
test('deal filters combine terms, range policy and known numeric evidence', t => {
  const b = createBrowser(''); t.after(() => b.dom.window.close()); b.run('catalog.js');
  const api = b.dom.window.BudolCatalog;
  const product = { title: 'Wireless Keyboard', price: null, priceRange: { min: 10000, max: 30000 }, ratingValue: 4.8, soldValue: 1200 };
  const options = { required: 'keyboard, WIRELESS', excluded: 'case', budget: '200', rating: '4.5', sold: '1000' };
  assert.equal(api.matchesDeal(product, api.dealFilters(options)), true);
  assert.equal(api.matchesDeal(product, api.dealFilters({ ...options, range: 'all' })), false);
  assert.equal(api.matchesDeal({ ...product, ratingValue: null }, api.dealFilters(options)), false);
  assert.equal(api.matchesDeal({ ...product, title: 'Wireless keyboard case' }, api.dealFilters(options)), false);
  assert.equal(api.matchesDeal({ ...product, priceRange: null }, api.dealFilters(options)), false);
  assert.throws(() => api.dealFilters({ budget: '1.001' }));
  assert.throws(() => api.dealFilters({ sold: '-1' }));
  assert.throws(() => api.dealFilters({ rating: '6' }));
});
