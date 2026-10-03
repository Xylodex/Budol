const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, createBrowser, product } = require('./helpers.cjs');

test('malformed sold counts remain unknown and excess keywords are not silently dropped', t => {
  const b = createBrowser(product(50)); t.after(() => b.dom.window.close()); b.run('catalog.js');
  const api = b.dom.window.BudolCatalog; const node = b.dom.window.document.createElement('small'); b.dom.window.document.getElementById('product').append(node);
  for (const text of ['1,2 sold', '12,,000 sold', '1.5 sold', '1.2345k sold', '1000000001 sold']) { node.textContent = text; assert.equal(api.readProduct(b.dom.window.document.getElementById('product')).soldValue, null, text); }
  for (const [text, expected] of [['1,200 sold', 1200], ['2.5k+ sold', 2500], ['0 sold', 0]]) { node.textContent = text; assert.equal(api.readProduct(b.dom.window.document.getElementById('product')).soldValue, expected); }
  assert.throws(() => api.dealFilters({ excluded: Array.from({ length: 31 }, (_, i) => `word${i}`).join(',') }), /30 keywords/);
});

test('damaged alert entries cannot break the inbox or create arbitrary links', t => {
  const b = createBrowser(''); t.after(() => b.dom.window.close()); b.run('catalog.js'); const api = b.dom.window.BudolCatalog;
  const entry = { product: { url: 'https://shopee.ph/product/1/2', title: 'Item', price: 100, currency: 'PHP', scope: 'listing' }, at: '2026-10-03T00:00:00Z', discord: 'Sent' };
  assert.equal(api.normalizeAlerts({ bad: true }).length, 0);
  assert.equal(api.normalizeAlerts([null, entry, { ...entry, at: 'invalid' }, { ...entry, product: { ...entry.product, url: 'javascript:alert(1)' } }]).length, 1);
  assert.equal(api.normalizeAlerts(Array(150).fill(entry)).length, 100);
});

test('slow alert sends leave board actions responsive, honor queued pauses and never resurrect cleared history', async () => {
  const now = '2026-01-01T00:00:00.000Z';
  const base = { title: 'Item', price: 20000, currency: 'PHP', scope: 'listing', savedAt: now, lastSeen: now, history: [{ price: 20000, at: now }], watch: { mode: 'target', target: 10000, paused: false, discord: true, createdAt: now } };
  const products = [1, 2].map(n => ({ ...base, id: `shopee:1:${n}:listing:PHP`, url: `https://shopee.ph/product/1/${n}` }));
  const storage = { budolBoard: { version: 1, products }, budolDiscordWebhook: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz' };
  let listener, release, started; let posts = 0;
  const start = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({ URL, AbortSignal, console, chrome: {
    runtime: { getURL: p => `chrome-extension://budol/${p}`, onMessage: { addListener: f => { listener = f; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    contextMenus: { onClicked: { addListener() {} } }, notifications: { create: async () => {} },
    storage: { local: { get: async () => structuredClone(storage), set: async v => Object.assign(storage, structuredClone(v)) } },
  }, fetch: async () => { posts++; started(); await blocked; return { ok: true, json: async () => ({ id: 'message' }) }; } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(source(file), context)); vm.runInContext(source('background.js'), context);
  const send = message => new Promise(resolve => listener(message, { url: 'chrome-extension://budol/board.html' }, resolve));
  await send({ type: 'BUDOL_OBSERVE', products: products.map(p => ({ ...p, price: 9000 })) });
  await start;
  const responsive = await Promise.race([send({ type: 'BUDOL_BOARD_GET' }), new Promise(resolve => setTimeout(() => resolve(null), 300))]);
  assert.ok(responsive?.ok, 'Board must not wait for webhook HTTP response');
  assert.equal((await send({ type: 'BUDOL_WATCH', id: products[1].id, watch: { mode: 'target', target: '100', paused: true, discord: true } })).ok, true);
  release(); await vm.runInContext('deliveryPending', context);
  assert.equal(posts, 1); assert.match(storage.budolAlerts[1].discord, /Not sent/);

  // A later independent alert completes after the user clears history.
  storage.budolBoard.products[0].watch.lastAlertAt = null; storage.budolBoard.products[0].watch.lastAlertPrice = null;
  let finish; const held = new Promise(resolve => { finish = resolve; }); let nextStarted;
  const nextStart = new Promise(resolve => { nextStarted = resolve; });
  context.fetch = async () => { nextStarted(); await held; return { ok: true, json: async () => ({ id: 'second' }) }; };
  await send({ type: 'BUDOL_OBSERVE', products: [{ ...products[0], price: 8000 }] }); await nextStart;
  await send({ type: 'BUDOL_ALERTS_CLEAR' }); finish(); await vm.runInContext('deliveryPending', context);
  assert.deepEqual(storage.budolAlerts, []);
});
