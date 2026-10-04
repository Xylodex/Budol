const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source } = require('./helpers.cjs');
const shop = 'https://shopee.ph/product/123/456';
const lazada = 'https://www.lazada.com.ph/products/test-i987-s654.html?skuId=654';
const at = new Date(Date.now() - 60000).toISOString();
const product = { id: 7, name: '<script>untrusted</script>', platform: 'shopee', external_shop_id: '123', external_product_id: '456' };
const variants = [{ id: 8, product_id: 7, external_variation_id: '88', name: 'Blue', is_active: true }, { id: 9, product_id: 7, external_variation_id: '99', name: 'Red', is_active: false }];
function setup(fetcher, stored = {}, allowed = true) {
  const calls = [], listeners = [];
  const chrome = { permissions: { contains: async () => allowed }, storage: { local: { get: async () => structuredClone(stored), set: async values => Object.assign(stored, structuredClone(values)) } }, runtime: { getURL: path => `chrome-extension://budol/${path}`, onMessage: { addListener: fn => listeners.push(fn) } } };
  const context = vm.createContext({ chrome, URL, URLSearchParams, Blob, AbortController, AbortSignal, Date, Map, console, BudolHistoryPublicKey: 'public-test-key', fetch: async (url, options) => { calls.push({ url: String(url), options }); return fetcher(new URL(url), options); } });
  vm.runInContext(source('history-providers.js'), context); vm.runInContext(source('history-background.js'), context);
  const message = (data, sender = chrome.runtime.getURL('board.html')) => new Promise(resolve => listeners[0](data, { url: sender }, resolve));
  return { api: context.BudolHistory, calls, message, stored };
}
const reply = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function pt(url) {
  if (url.pathname.endsWith('/products')) return reply([product]);
  if (url.pathname.endsWith('/product_variations')) return reply(variants);
  return reply([{ variation_id: 8, observed_at: at, price: '12.34', original_price: 20, is_in_stock: true }, { variation_id: 9, observed_at: at, price: 1 }, { variation_id: 8, observed_at: at, price: 0 }, { variation_id: 8, observed_at: 'invalid', price: 50 }]);
}
test('provider identities reject off-site/credential URLs and strip tracking and variant queries', () => {
  const { api } = setup(pt);
  assert.equal(api.identity(lazada).url, 'https://www.lazada.com.ph/products/item-i987.html');
  assert.equal(api.identity('https://shopee.ph/title-i.123.456?secret=no').url, shop);
  for (const url of ['https://shopee.ph.evil.test/product/123/456', 'https://user:pass@shopee.ph/product/123/456', 'http://shopee.ph/product/123/456', 'https://shopee.ph:123/product/123/456', 'https://s.shopee.ph/abc']) assert.throws(() => api.identity(url));
});
test('PriceTrack requires exact identity and variant selection; only bounded matching observations are retained', async () => {
  const { api, calls } = setup(pt);
  const choices = await api.lookup('pricetrack', shop);
  assert.equal(choices.variants.length, 2); assert.equal(choices.points.length, 0); assert.equal(calls.length, 2);
  const result = await api.lookup('pricetrack', shop, '8');
  assert.equal(result.points.length, 1); assert.equal(result.points[0].price, 1234); assert.equal(result.points[0].originalPrice, 2000); assert.equal(result.scope, 'variant');
  assert.ok(calls.every(c => c.options.credentials === 'omit' && c.options.redirect === 'error'));
  assert.ok(calls.every(c => !c.url.includes('secret')));
  await assert.rejects(api.lookup('pricetrack', shop, '999'), /no longer/);
  await assert.rejects(setup(() => reply([{ ...product, external_shop_id: '999' }])).api.lookup('pricetrack', shop), /identity/);
});
test('AiPrice uses listing IDs and regional codes, treats empty history as unknown, and checks currency/verification', async () => {
  const data = { success: 1, code: 200, adid: '26', currency: 'PHP', price_tracking: [{ price: '69.58', time_update: Date.now() / 1000 - 3600, adid: 26 }, { price: '1.00', time_update: Date.now() / 1000, adid: 72 }] };
  const { api, calls } = setup(() => reply(data));
  const result = await api.lookup('aiprice', lazada);
  assert.equal(result.points[0].price, 6958); assert.equal(result.points.length, 1); assert.equal(result.scope, 'listing');
  assert.equal(new URL(calls[0].url).searchParams.get('sku_id'), '987'); assert.equal(new URL(calls[0].url).searchParams.get('adid'), '26');
  data.price_tracking = []; assert.equal((await api.lookup('aiprice', lazada)).points.length, 0);
  data.currency = 'USD'; await assert.rejects(api.lookup('aiprice', lazada), /usable PHP/);
  data.currency = 'PHP'; data.code = 3050; await assert.rejects(api.lookup('aiprice', lazada), /Verification/);
});
test('history drops future/old/invalid records, keeps most recent 200 and bounds response bytes', async () => {
  const rows = Array.from({ length: 210 }, (_, i) => ({ price: i + 1, time_update: Date.now() / 1000 - 210 + i }));
  rows.push({ price: 2, time_update: Date.now() / 1000 + 86400 }, { price: null, time_update: 1 });
  const { api } = setup(() => reply({ code: 200, success: 1, currency: 'PHP', adid: '72', price_tracking: rows }));
  const result = await api.lookup('aiprice', shop); assert.equal(result.points.length, 200); assert.equal(result.points[0].price, 1100); assert.equal(result.truncated, true);
  await assert.rejects(setup(() => new Response('x'.repeat(1048577))).api.lookup('aiprice', shop), /too large/);
  await assert.rejects(setup(() => new Response('<html>login</html>')).api.lookup('aiprice', shop), /unreadable/);
});
test('worker rejects page callers and missing host grants, caches reads and preserves board on clear', async () => {
  const message = { type: 'BUDOL_HISTORY_LOOKUP', provider: 'pricetrack', url: shop, variantId: '8' };
  const denied = setup(pt, {}, false); assert.equal((await denied.message(message)).ok, false); assert.equal(denied.calls.length, 0);
  const state = setup(pt, { budolBoard: { products: ['untouched'] } });
  assert.equal((await state.message(message, 'https://shopee.ph/')).ok, false);
  assert.equal((await state.message(message)).history.cached, false);
  assert.equal((await state.message(message)).history.cached, true); assert.equal(state.calls.length, 3);
  assert.equal((await state.message({ type: 'BUDOL_HISTORY_CLEAR' }, 'chrome-extension://budol/mcp.html')).ok, false);
  await state.message({ type: 'BUDOL_HISTORY_CLEAR' }); assert.equal(state.stored.budolExternalHistory.length, 0); assert.deepEqual(state.stored.budolBoard.products, ['untouched']);
});
test('cleanup aborts active lookups without repopulating the cache; 429 cooldown survives restart', async () => {
  let started; const ready = new Promise(resolve => { started = resolve; });
  const state = setup((_url, options) => new Promise((_, reject) => { started(); options.signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))); }));
  const args = { type: 'BUDOL_HISTORY_LOOKUP', provider: 'aiprice', url: shop };
  const pending = state.message(args); await ready;
  await state.message({ type: 'BUDOL_HISTORY_CLEAR' }); assert.equal((await pending).ok, false); assert.equal(state.stored.budolExternalHistory.length, 0);
  const limited = setup(() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  assert.equal((await limited.message(args)).ok, false);
  const restarted = setup(pt, limited.stored); assert.equal((await restarted.message(args)).ok, false); assert.equal(restarted.calls.length, 0);
});
test('stale cache is explicitly labelled on failure and cache retention is bounded', async () => {
  const stored = { budolExternalHistory: Array.from({ length: 20 }, (_, i) => ({ key: 'other'+i, at: 1, data: {} })) };
  const state = setup(pt, stored); const args = { type: 'BUDOL_HISTORY_LOOKUP', provider: 'pricetrack', url: shop, variantId: '8' };
  await state.message(args); assert.equal(stored.budolExternalHistory.length, 20); assert.equal(stored.budolExternalHistory[0].key, 'other1');
  stored.budolExternalHistory.at(-1).at = 1; stored.budolHistoryCooldowns = {};
  const offline = setup(() => { throw Error('offline'); }, stored);
  const response = await offline.message(args); assert.equal(response.history.stale, true); assert.equal(response.history.points[0].price, 1234);
});
