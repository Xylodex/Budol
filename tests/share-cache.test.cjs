const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');
const { source } = require('./helpers.cjs');
const photo = 'https://down-ph.img.susercontent.com/file/test-product';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=', 'base64');
const item = { url: 'https://shopee.ph/product/1/2', title: 'Keyboard', price: 29900, discount: 40, currency: 'PHP', scope: 'listing', image: photo, shipping: 'Free shipping voucher', offers: [{ text: 'Shop voucher 10% off Min spend ₱500' }], notes: 'PRIVATE' };
function cache(fetcher = async () => new Response(png), indexedDB = new IDBFactory()) {
  const context = vm.createContext({ URL, console, Blob, FormData, Response, AbortSignal, AbortController, crypto: webcrypto, indexedDB, fetch: fetcher });
  vm.runInContext(source('catalog.js'), context); vm.runInContext(source('share-cache.js'), context);
  return { api: context.BudolShareCache, context, indexedDB };
}

test('share snapshots and image bytes survive a restart and clear separately', async () => {
  let requests = 0;
  const first = cache(async () => { requests++; return new Response(png); });
  await first.api.capture(item);
  const restarted = cache(async () => { throw new Error('Offline'); }, first.indexedDB);
  const saved = await restarted.api.get('shopee:1:2:listing:PHP');
  assert.equal(saved.product.discount, 40); assert.equal(saved.product.notes, undefined);
  assert.equal(saved.product.offers[0].minimum, 50000); assert.equal(saved.image.type, 'image/png');
  assert.deepEqual(Buffer.from(await saved.image.arrayBuffer()), png); assert.equal(requests, 1);
  await first.api.capture(item); assert.equal(requests, 1);
  const cleared = await first.api.clear(true); assert.equal(cleared.items.length, 1); assert.equal(cleared.imageBytes, 0);
  assert.equal((await first.api.get('shopee:1:2:listing:PHP')).product.title, 'Keyboard');
  await first.api.clear(false); assert.equal((await first.api.list()).items.length, 0);
});

test('clearing during an image fetch cannot recreate images or snapshots', async () => {
  for (const imagesOnly of [true, false]) {
    let resolveFetch, started;
    const beginning = new Promise(resolve => { started = resolve; });
    const { api } = cache(async () => { started(); return new Promise(resolve => { resolveFetch = resolve; }); });
    const pending = api.capture(item); await beginning;
    await api.clear(imagesOnly); resolveFetch(new Response(png)); await pending;
    const after = await api.list(); assert.equal(after.imageBytes, 0); assert.equal(after.items.length, imagesOnly ? 1 : 0);
    if (imagesOnly) assert.equal(after.items[0].imageStatus, 'Image cleared');
  }
});

test('cache rejects oversized/unsupported images and non-CDN downloads while keeping text', async () => {
  let calls = 0;
  const { api } = cache(async () => { calls++; return new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } }); });
  await api.capture(item); assert.match((await api.list()).items[0].imageStatus, /exceeds/);
  await api.capture({ ...item, image: 'https://shopee.ph/account' }); assert.equal(calls, 1);
  const unsupported = cache(async () => new Response('<svg onload="evil()"></svg>'));
  await unsupported.api.capture(item); assert.equal((await unsupported.api.list()).imageBytes, 0);
  assert.match((await unsupported.api.list()).items[0].imageStatus, /Unsupported/);
  let cancelled = false;
  const streamed = cache(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } })));
  await streamed.api.capture(item); assert.equal(cancelled, true); assert.equal((await streamed.api.list()).imageBytes, 0);
});

test('image downloads have bounded concurrency and cleanup cancels queued downloads', async () => {
  let active = 0, peak = 0, calls = 0;
  const resolvers = [];
  const { api } = cache(async () => { calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => resolvers.push(resolve)); active--; return new Response(png); });
  const work = Array.from({ length: 9 }, (_, i) => api.capture({ ...item, url: `https://shopee.ph/product/2/${i}` }));
  while (calls < 3) await new Promise(resolve => setTimeout(resolve, 5));
  await api.clear(false); resolvers.forEach(resolve => resolve()); await Promise.all(work);
  assert.equal(peak, 3); assert.equal(calls, 3); assert.equal((await api.list()).items.length, 0);
});

test('cache evicts old image bytes and snapshots at independent bounded limits', async () => {
  const large = new Uint8Array(2 * 1024 * 1024); large.set(png.slice(0, 12));
  const { api } = cache(async () => new Response(large));
  for (let i = 1; i <= 17; i++) await api.capture({ ...item, url: `https://shopee.ph/product/1/${i}` });
  const full = await api.list(); assert.equal(full.items.length, 17); assert.equal(full.imageBytes, api.MAX_BYTES);
  assert.equal(full.items.filter(row => row.imageBytes > 0).length, 16);
  for (let i = 18; i <= 202; i++) await api.capture({ ...item, image: null, url: `https://shopee.ph/product/1/${i}` });
  assert.equal((await api.list()).items.length, 200); assert.equal(await api.get('shopee:1:1:listing:PHP'), null);
});

test('saved sends upload cached bytes without Shopee access; clearing does not delete board/settings', async () => {
  const storage = { budolDiscordWebhook: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz', threshold: 50 };
  const posts = []; const indexedDB = new IDBFactory(); let online = true, photoReads = 0;
  function worker() {
    let listener;
    const context = vm.createContext({ URL, console, Blob, FormData, Response, AbortSignal, AbortController, crypto: webcrypto, indexedDB,
      chrome: {
        runtime: { getURL: path => `chrome-extension://budol/${path}`, onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
        contextMenus: { onClicked: { addListener() {} } },
        storage: { local: { get: async () => structuredClone(storage), set: async value => Object.assign(storage, structuredClone(value)) } },
      }, fetch: async (url, options) => {
        if (String(url).startsWith('https://discord.com/')) { posts.push(options); return new Response('{"id":"mock-message"}', { status: 200 }); }
        photoReads++; if (!online) throw new Error('Shopee offline'); return new Response(png);
      } });
    context.importScripts = (...files) => files.forEach(file => vm.runInContext(source(file), context)); vm.runInContext(source('background.js'), context);
    return { context, send: (message, url = 'chrome-extension://budol/board.html') => new Promise(resolve => listener(message, { url }, resolve)) };
  }
  let current = worker(); await current.send({ type: 'BUDOL_SAVE', product: item });
  await current.context.BudolShareCache.capture(item); // Await a complete image capture before closing Shopee.
  online = false; current = worker();
  const before = photoReads;
  assert.equal((await current.send({ type: 'BUDOL_CACHE_CLEAR', scope: 'all' }, 'https://shopee.ph/')).ok, false);
  assert.equal((await current.send({ type: 'BUDOL_SEND_SAVED', url: item.url, requestId: webcrypto.randomUUID() })).ok, true);
  assert.equal(photoReads, before); assert.ok(posts[0].body instanceof FormData);
  const payload = JSON.parse(posts[0].body.get('payload_json'));
  assert.equal(payload.embeds[0].image.url, 'attachment://product.png'); assert.match(payload.embeds[0].footer.text, /Saved snapshot/);
  assert.equal(payload.allowed_mentions.parse.length, 0); assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
  assert.deepEqual(Buffer.from(await posts[0].body.get('files[0]').arrayBuffer()), png);
  await current.send({ type: 'BUDOL_CACHE_CLEAR', scope: 'all' });
  assert.equal(storage.budolBoard.products.length, 1); assert.equal(storage.threshold, 50); assert.ok(storage.budolDiscordWebhook);
  storage.budolMcpReceipts = []; // Simulate waiting past duplicate-send retention for a separate text-only assertion.
  assert.equal((await current.send({ type: 'BUDOL_SEND_SAVED', url: item.url, requestId: webcrypto.randomUUID() })).ok, true);
  const textOnly = JSON.parse(posts[1].body); assert.equal(textOnly.embeds[0].image, undefined);
  assert.ok(textOnly.embeds[0].fields.some(field => field.name === 'Image')); assert.equal(photoReads, before);
});
