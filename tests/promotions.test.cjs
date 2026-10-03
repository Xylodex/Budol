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

test('unmarked conditional prices and hidden conditions are handled separately', t => {
  const { api, document } = setup(t, product(40));
  const card = document.getElementById('product');
  card.querySelector('[aria-label="promotion price"]').remove();
  card.querySelector('.price').insertAdjacentHTML('beforeend', '<small>After voucher</small>');
  assert.equal(api.readProduct(card).price, null);
  card.querySelector('small').hidden = true;
  assert.equal(api.readProduct(card).price, 28500);
  card.insertAdjacentHTML('beforeend', '<div>Shop voucher <!-- framework placeholder --><span hidden>Min spend ₱9999</span><span>Min spend ₱500</span></div>');
  const voucher = api.readProduct(card).offers.find(o => o.kind === 'voucher');
  assert.equal(voucher.minimum, 50000); assert.ok(!voucher.text.includes('9999'));
});

test('product-page promotion rows exclude banners, recommendations, bare headings and delivery details', t => {
  const { api, document } = setup(t, `<header>Sitewide 90% cashback</header><main><section><div><h1>Keyboard</h1></div>
    <div><label>Shop Vouchers</label><span>10% off</span><small>Min spend ₱500</small><small hidden>Min spend ₱9999</small></div>
    <div><label>Bundle Deal</label><span>Any 3 enjoy 15% off</span></div>
    <div><label>Promotions</label></div>
    <div><label>Vouchers</label><span>Shipping to PRIVATE ADDRESS</span></div>
    <div aria-label="Product card"><div><label>Shop Voucher</label><span>99% off</span></div></div>
    </section></main>`);
  const offers = api.readDetailOffers(document.querySelector('h1'));
  assert.equal(offers.length, 2); assert.ok(offers.every(o => o.scope === 'product-page'));
  assert.equal(offers.find(o => o.kind === 'voucher').minimum, 50000);
  assert.ok(!/PRIVATE|90%|99%|9999/.test(JSON.stringify(offers)));
  assert.equal(api.parseOffer('Add-on deal: buy a main item, get a free gift').kind, 'addon');
  assert.equal(api.parseOffer('10.10 Super Sale').kind, 'campaign');
  assert.equal(api.parseOffer('SPayLater available'), null);
});

test('right-click detail sharing captures only promotion evidence tied to the same product', t => {
  const { dom, document, run, chrome, messages } = setup(t, `<head><meta property="og:url" content="https://shopee.ph/product/123/456"><meta property="og:title" content="Keyboard"><meta property="product:price:currency" content="PHP"><meta property="product:price:amount" content="299"></head><body><section><h1>Keyboard</h1><div><label>Shop Vouchers</label><span>10% off Min spend ₱500</span></div></section></body>`);
  dom.reconfigure({ url: 'https://shopee.ph/product/123/456' }); chrome.runtime.id = 'test';
  run('discord.js'); run('share-content.js');
  const capture = () => {
    document.querySelector('h1').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true }));
    let response; messages.forEach(fn => fn({ type: 'BUDOL_CONTEXT_PRODUCT' }, {}, result => { response = result; }));
    return response.product;
  };
  const item = capture(); assert.equal(item.price, 29900); assert.equal(item.offers.length, 1); assert.equal(item.offers[0].scope, 'product-page');
  document.querySelector('[property="og:url"]').content = 'https://shopee.ph/product/999/999';
  const mismatch = capture(); assert.equal(mismatch.price, null); assert.equal(mismatch.offers, undefined);
});

test('Discord and CSV retain conditions without changing the listing price or exceeding embed limits', t => {
  const { api, document, dom, run } = setup(t); run('discord.js');
  const item = api.readProduct(document.getElementById('offers'));
  const payload = dom.window.BudolDiscord.payload(item); const embed = payload.embeds[0];
  assert.equal(embed.fields[0].value, '₱299.00'); assert.match(JSON.stringify(embed), /Eligibility unverified/);
  assert.match(JSON.stringify(embed), /More offers/); assert.match(JSON.stringify(embed), /excluded from Bundle Deals/);
  const csv = api.dealsCsv([item]); assert.match(csv, /Min\. spend ₱500/); assert.match(csv, /eligibility unverified/);
  const maximal = dom.window.BudolDiscord.payload({ ...item, title: 'x'.repeat(240), rating: 'x'.repeat(200), sold: 'x'.repeat(200), seller: 'x'.repeat(200), location: 'x'.repeat(200), shipping: 'x'.repeat(200), priceNote: 'x'.repeat(140), offers: Array.from({ length: 12 }, (_, i) => ({ text: `Voucher ${i} ` + 'x'.repeat(380) })) }).embeds[0];
  const length = maximal.title.length + maximal.description.length + maximal.footer.text.length + maximal.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
  assert.ok(length <= 6000); assert.ok(maximal.fields.length <= 25); assert.ok(maximal.fields.every(f => f.value.length <= 1024));
});
