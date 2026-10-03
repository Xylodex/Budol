const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createBrowser, product } = require('./helpers.cjs');
const fixture = readFileSync(resolve(__dirname, 'fixtures/shopee-offers.html'), 'utf8');
function setup(t, html = fixture) { const b = createBrowser(html); t.after(() => b.dom.window.close()); b.run('catalog.js'); return { ...b, api: b.dom.window.BudolCatalog, document: b.dom.window.document }; }

test('item offers retain separate benefit types and adjacent minimum/cap terms', t => {
  const { api, document } = setup(t); const item = api.readProduct(document.getElementById('offers'));
  assert.equal(item.price, 29900); assert.equal(item.discount, 40);
  assert.deepEqual([...new Set(item.offers.map(o => o.kind))].sort(), ['bundle', 'cashback', 'channel', 'flash', 'payment', 'shipping', 'voucher']);
  const voucher = item.offers.find(o => o.kind === 'voucher'); assert.equal(voucher.minimum, 50000); assert.equal(voucher.cap, 10000);
  assert.match(api.offerExplanation(voucher, item), /one item.*below/);
  assert.match(api.offerExplanation(item.offers.find(o => o.kind === 'cashback'), item), /does not reduce this payment/);
  assert.ok(!JSON.stringify(item.offers).includes('99%')); assert.ok(!JSON.stringify(item.offers).includes('90%'));
  assert.ok(item.offers.every(o => o.status === 'Eligibility unverified'));
});

test('voucher badge percentages and after-voucher prices never become unconditional listing evidence', t => {
  const { api, document } = setup(t); const item = api.readProduct(document.getElementById('conditional'));
  assert.equal(item.price, null); assert.equal(item.discount, null); assert.match(item.priceNote, /requires an offer/);
  assert.equal(api.matchesDeal(item, api.dealFilters({ budget: '500' })), false);
  assert.equal(api.watchMatches({ watch: { mode: 'target', target: 50000, paused: false, createdAt: '2026-01-01' }, history: [] }, item, '2026-10-03'), false);
});

test('hidden and title percentages are not listing discounts', t => {
  const { dom, document } = setup(t, product(40)); const api = dom.window.Budol;
  document.querySelector('.sale').remove(); document.querySelector('.line-clamp-2').textContent = '90% off voucher holder';
  document.querySelector('#product').insertAdjacentHTML('beforeend', '<div style="display:none"><span aria-label="-99%"></span></div><div>Voucher <span aria-label="-80%">80% off</span></div>');
  assert.equal(api.getDiscount(document.getElementById('product')), null);
});

test('offer backups rederive terms from bounded evidence and discard invented eligibility', t => {
  const { api, document } = setup(t); const item = api.readProduct(document.getElementById('offers'));
  const at = '2026-10-03T00:00:00.000Z';
  const saved = api.observe({ savedAt: at, history: [] }, api.normalizeProduct(item), at);
  saved.offers[0].status = 'Guaranteed'; saved.offers[0].minimum = 1;
  const restored = api.validateBackup({ version: 1, products: [saved] }).products[0];
  assert.equal(restored.offers[0].status, 'Eligibility unverified'); assert.equal(restored.offers.find(o => o.kind === 'voucher').minimum, 50000);
  assert.equal(api.normalizeOffers([{ text: 'x'.repeat(1000) }]).length, 0);
  assert.equal(api.parseOffer('Cashback voucher fully redeemed').status, 'Check availability');
});
