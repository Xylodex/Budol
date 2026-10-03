const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { source, createBrowser, product, wait } = require('./helpers.cjs');

function catalog(t) {
  const browser = createBrowser(); t.after(() => browser.dom.window.close()); browser.run('catalog.js');
  return browser.dom.window.BudolCatalog;
}
const sample = { url: 'https://shopee.ph/Shirt-i.123.456?tracking=ignored', title: 'Cotton shirt', price: 28500, scope: 'listing', currency: 'PHP' };
const now = '2026-10-02T05:00:00.000Z';

test('live-inspected Shopee split currency markup yields the displayed price', t => {
  const browser = createBrowser(readFileSync(resolve(__dirname, 'fixtures/shopee-listing.html'), 'utf8'));
  t.after(() => browser.dom.window.close()); browser.run('catalog.js');
  const [item] = browser.dom.window.BudolCatalog.extractProducts(browser.dom.window.document);
  assert.equal(item.price, 258400); assert.equal(item.url, 'https://shopee.ph/product/196214868/56118466298');
});

test('money and canonical identities reject ambiguous prices and unrelated destinations', t => {
  const api = catalog(t);
  assert.equal(api.money('1234.56'), 123456);
  for (const text of ['', '-1', '1.234', 'Infinity', '1e4', '1000001']) assert.equal(api.money(text), null);
  assert.equal(api.parsePrice('₱1,234.56'), 123456);
  for (const text of ['₱100 - ₱200', '₱100–200', '50% off', '₱12.345', '₱20 ₱30']) assert.equal(api.parsePrice(text), null, text);
  assert.equal(api.productIdentity(sample.url).url, 'https://shopee.ph/product/123/456');
  assert.equal(api.productIdentity(sample.url).id, api.productIdentity('/product/123/456').id);
  for (const url of ['https://evil.test/product/123/456', 'javascript:alert(1)', 'http://shopee.ph/product/123/456', 'https://shopee.ph.evil.test/product/123/456']) assert.equal(api.productIdentity(url), null);
});

test('listing extraction uses accessible prices, canonical URLs, and rejects ranges and duplicate conflicts', t => {
  const browser = createBrowser(product(50)); t.after(() => browser.dom.window.close()); browser.run('catalog.js');
  const api = browser.dom.window.BudolCatalog, document = browser.dom.window.document;
  let found = api.extractProducts(document);
  assert.equal(found.length, 1); assert.equal(found[0].price, 28500); assert.equal(found[0].title, '100% cotton shirt');
  assert.equal(found[0].discount, 50);
  assert.equal(api.normalizeProduct(found[0]).discount, 50);
  document.querySelector('.price').innerHTML = '<span aria-label="promotion price"></span>₱200 - ₱300';
  assert.equal(api.extractProducts(document)[0].price, null);
  document.querySelector('.price').innerHTML = '<span aria-label="promotion price"></span><s>₱400</s><span>₱250</span>';
  assert.equal(api.extractProducts(document)[0].price, 25000);
  document.body.insertAdjacentHTML('beforeend', product(60, 'duplicate'));
  assert.equal(api.extractProducts(document)[0].price, null);
  assert.equal(api.extractProducts(document)[0].discount, null);
});

test('history only records observed readable prices, deduplicates same-day values, and retains 90', t => {
  const api = catalog(t); const normalized = api.normalizeProduct(sample);
  let saved = api.observe({ history: [], notes: 'Keep', collection: 'Clothes', savedAt: now }, normalized, now);
  saved = api.observe(saved, normalized, '2026-10-02T06:00:00Z'); assert.equal(saved.history.length, 1);
  saved = api.observe(saved, { ...normalized, price: null }, '2026-10-02T07:00:00Z'); assert.equal(saved.price, null); assert.equal(saved.history.length, 1);
  for (let i = 0; i < 100; i++) saved = api.observe(saved, { ...normalized, price: 10000 + i }, new Date(Date.parse(now) + i * 1000).toISOString());
  assert.equal(saved.history.length, 90); assert.equal(saved.notes, 'Keep'); assert.equal(saved.history.at(-1).price, 10099);
});

test('voucher minimums, caps, cents rounding, and cashback produce an honest payment estimate', t => {
  const api = catalog(t); const input = { price: 19999, quantity: 2, shipping: 5000, discount: 0, percent: 10, cap: 3000, minimum: 30000, cashback: 1000 };
  let result = api.calculate(input); assert.equal(result.total, 41998); assert.equal(result.voucher, 3000); assert.equal(result.cashback, 1000);
  result = api.calculate({ ...input, minimum: 50000 }); assert.equal(result.voucher, 0); assert.equal(result.total, 44998); assert.equal(result.eligible, false);
  result = api.calculate({ ...input, discount: 99999, percent: 0 }); assert.equal(result.total, 5000);
  assert.equal(api.calculate({ ...input, percent: 0.29, cap: null }).voucher, 116);
  for (const bad of [{ price: null }, { shipping: null }, { quantity: 1.5 }, { percent: 101 }, { discount: -1 }, { cap: -1 }]) assert.throws(() => api.calculate({ ...input, ...bad }));
});

test('backup validates schema, identities, history, bounds, and strips unexpected fields', t => {
  const api = catalog(t); const saved = api.observe({ notes: '<script>not executable</script>', collection: 'Wishlist', savedAt: now, history: [] }, api.normalizeProduct(sample), now);
  const backup = api.validateBackup({ version: 1, products: [saved] }); assert.equal(backup.products[0].notes, saved.notes);
  assert.throws(() => api.validateBackup({ version: 2, products: [] }));
  assert.throws(() => api.validateBackup({ version: 1, products: [saved, saved] }));
  assert.throws(() => api.validateBackup({ version: 1, products: [{ ...saved, lastSeen: 'bad' }] }));
  assert.throws(() => api.validateBackup({ version: 1, products: [{ ...saved, price: -1 }] }));
});

test('worker serializes concurrent saves, persists across restart, and refuses page mutations', async () => {
  const storage = {}; let writes = 0;
  function worker() {
    let listener;
    const context = vm.createContext({ URL, console, chrome: {
      runtime: { getURL: path => `chrome-extension://budol/${path}`, onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      contextMenus: { onClicked: { addListener() {} } },
      storage: { local: {
        get: async key => { await wait(2); return structuredClone({ [key]: storage[key] }); },
        set: async values => { writes++; Object.assign(storage, structuredClone(values)); },
      } },
    } });
    context.importScripts = (...files) => files.forEach(file => vm.runInContext(source(file), context));
    vm.runInContext(source('background.js'), context);
    return (message, sender = { url: 'chrome-extension://budol/board.html', tab: { url: 'chrome-extension://budol/board.html' } }) => new Promise(resolve => listener(message, sender, resolve));
  }
  let send = worker();
  const results = await Promise.all([send({ type: 'BUDOL_SAVE', product: sample }), send({ type: 'BUDOL_SAVE', product: { ...sample, url: 'https://shopee.ph/product/123/789' } })]);
  assert.ok(results.every(r => r.ok)); assert.equal(storage.budolBoard.products.length, 2);
  send = worker(); assert.equal((await send({ type: 'BUDOL_BOARD_GET' })).board.products.length, 2);
  const page = { url: 'https://shopee.ph/test', tab: { url: 'https://shopee.ph/test' } };
  assert.equal((await send({ type: 'BUDOL_REMOVE', id: storage.budolBoard.products[0].id }, page)).ok, false);
  const oldWrites = writes;
  await send({ type: 'BUDOL_OBSERVE', products: [sample] }, page); assert.equal(writes, oldWrites);
  await send({ type: 'BUDOL_OBSERVE', products: [{ ...sample, price: 20000 }] }, page);
  assert.equal(storage.budolBoard.products[0].history.length, 2);
  assert.equal(storage.budolBoard.products[0].price, 20000);
});
