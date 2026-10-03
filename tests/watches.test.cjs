const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, createBrowser } = require('./helpers.cjs');
test('watches require later single-price evidence, respect pause and persistent cooldown', t => {
  const b = createBrowser(''); t.after(() => b.dom.window.close()); b.run('catalog.js'); const api = b.dom.window.BudolCatalog;
  const watch = { mode: 'target', target: 20000, paused: false, discord: false, createdAt: '2026-10-01T00:00:00Z' };
  const saved = { watch, history: [{ price: 30000 }] }; const now = '2026-10-03T00:00:00Z';
  assert.equal(api.watchMatches(saved, { price: 20000 }, now), true);
  assert.equal(api.watchMatches(saved, { price: null, priceRange: { min: 10000, max: 20000 } }, now), false);
  assert.equal(api.watchMatches({ ...saved, watch: { ...watch, paused: true } }, { price: 10000 }, now), false);
  assert.equal(api.watchMatches({ ...saved, watch: { ...watch, lastAlertAt: '2026-10-02T23:00:00Z' } }, { price: 10000 }, now), false);
  assert.equal(api.watchMatches({ ...saved, watch: { ...watch, lastAlertPrice: 10000 } }, { price: 10000 }, now), false);
  assert.equal(api.watchMatches({ ...saved, watch: { ...watch, mode: 'low' } }, { price: 29999 }, now), true);
  assert.equal(api.watchMatches({ ...saved, history: [], watch: { ...watch, mode: 'low' } }, { price: 10000 }, now), false);
});
test('worker claims alerts before delivery, survives restart, rejects page configuration and pauses imported watches', async () => {
  const storage = {}; let posts = 0; let notices = 0;
  function worker() {
    let listener;
    const context = vm.createContext({ URL, console, AbortSignal, chrome: {
      runtime: { getURL: p => `chrome-extension://budol/${p}`, onMessage: { addListener: f => { listener = f; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      contextMenus: { onClicked: { addListener() {} } }, notifications: { create: async () => { notices++; } },
      storage: { local: { get: async () => structuredClone(storage), set: async v => Object.assign(storage, structuredClone(v)) } },
    }, fetch: async () => { posts++; assert.equal(storage.budolAlerts.length, 1); assert.ok(storage.budolBoard.products[0].watch.lastAlertAt); throw new Error('Timeout'); } });
    context.importScripts = (...files) => files.forEach(f => vm.runInContext(source(f), context)); vm.runInContext(source('background.js'), context);
    return (message, sender = { url: 'chrome-extension://budol/board.html' }) => new Promise(resolve => listener(message, sender, resolve));
  }
  let send = worker(); const product = { url: 'https://shopee.ph/product/1/2', title: 'Item', price: 20000, currency: 'PHP', scope: 'listing' };
  await send({ type: 'BUDOL_SAVE', product }); const id = storage.budolBoard.products[0].id;
  storage.budolDiscordWebhook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz';
  assert.equal((await send({ type: 'BUDOL_WATCH', id, watch: { mode: 'target', target: '100', discord: true } })).ok, true);
  storage.budolBoard.products[0].watch.createdAt = '2026-01-01T00:00:00Z';
  const page = { url: 'https://shopee.ph/test' };
  assert.equal((await send({ type: 'BUDOL_WATCH', id, watch: null }, page)).ok, false);
  assert.equal((await send({ type: 'BUDOL_OBSERVE', products: [{ ...product, price: 9000 }] }, page)).ok, true);
  assert.equal(posts, 1); assert.equal(notices, 1); assert.match(storage.budolAlerts[0].discord, /not confirm delivery/);
  send = worker(); await send({ type: 'BUDOL_OBSERVE', products: [{ ...product, price: 8000 }] }, page); assert.equal(posts, 1);
  const backup = structuredClone(storage.budolBoard); backup.products[0].url = 'https://shopee.ph/product/1/3';
  await send({ type: 'BUDOL_IMPORT', board: backup }); const imported = storage.budolBoard.products[1];
  assert.equal(imported.watch.paused, true); assert.equal(imported.watch.discord, false);
});
