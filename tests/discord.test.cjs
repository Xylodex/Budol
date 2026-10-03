const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, createBrowser, product, wait } = require('./helpers.cjs');
const endpoint = 'https://discord.com/api/webhooks/123456789012345678/test_token_that_is_not_a_real_webhook';
const item = { url: 'https://shopee.ph/product/123/456', title: 'Cotton shirt', price: 28500, currency: 'PHP', scope: 'listing', discount: 50 };
function api(t) {
  const browser = createBrowser(); t.after(() => browser.dom.window.close());
  browser.run('catalog.js'); browser.run('discord.js'); return browser.dom.window.BudolDiscord;
}
test('Discord endpoint accepts only tokenized HTTPS Discord webhooks and preserves a thread', t => {
  const discord = api(t);
  assert.equal(discord.webhook(endpoint), endpoint.replace('/api/', '/api/v10/') + '?wait=true');
  assert.match(discord.webhook(endpoint + '?thread_id=123456789012345678'), /thread_id=123456789012345678&wait=true$/);
  for (const url of ['http://discord.com/api/webhooks/1/token', endpoint.replace('discord.com', 'discord.com.evil.test'), endpoint.replace('discord.com', 'evil@discord.com'), endpoint + '/messages/1', endpoint + '?thread_id=oops', 'javascript:alert(1)']) assert.throws(() => discord.webhook(url));
});
test('Discord embed contains bounded listing evidence and no private data or mentions', t => {
  const discord = api(t);
  const payload = discord.payload({ ...item, title: '@everyone **sale**', originalPrice: 57000, image: 'https://down-ph.img.susercontent.com/file/example', rating: '4.8 / 5', sold: '2k sold', notes: 'PRIVATE', collection: 'PRIVATE', webhook: endpoint, history: [{ price: 1 }] });
  assert.equal(payload.embeds[0].fields[0].value, '₱285.00');
  assert.equal(payload.embeds[0].fields[1].value, '50% off');
  assert.equal(payload.embeds[0].fields[2].value, '₱570.00');
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.embeds[0].image.url, 'https://down-ph.img.susercontent.com/file/example');
  assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
  assert.ok(!JSON.stringify(payload).includes('webhook'));
  assert.equal(discord.payload({ ...item, price: null, discount: null, image: 'https://evil.test/tracker' }).embeds[0].image, undefined);
  assert.match(discord.payload({ ...item, price: null }).embeds[0].fields[0].value, /Check price/);
});
test('right-click capture selects the exact card and clears selection on unrelated page clicks', t => {
  const browser = createBrowser(product(50) + product(80, 'second').replace('123.456', '123.789'));
  t.after(() => browser.dom.window.close()); browser.chrome.runtime.id = 'test';
  browser.run('catalog.js'); browser.run('discord.js'); browser.run('share-content.js');
  const document = browser.dom.window.document;
  document.querySelector('#second img').src = 'https://down-ph.img.susercontent.com/file/example';
  document.querySelector('#second .price').insertAdjacentHTML('beforeend', '<s>₱570</s><span>2k sold</span><span aria-label="4.8 out of 5"></span>');
  document.querySelector('#second img').dispatchEvent(new browser.dom.window.MouseEvent('contextmenu', { bubbles: true }));
  const get = linkUrl => { let result; browser.messages.forEach(fn => fn({ type: 'BUDOL_CONTEXT_PRODUCT', linkUrl }, {}, value => { result = value; })); return result.product; };
  assert.equal(get().url, 'https://shopee.ph/product/123/789');
  assert.equal(get().discount, 80); assert.equal(get().originalPrice, 57000); assert.equal(get().sold, '2k sold');
  assert.equal(get('https://shopee.ph/product/123/456'), null);
  document.body.dispatchEvent(new browser.dom.window.MouseEvent('contextmenu', { bubbles: true }));
  assert.equal(get(), null);
  assert.doesNotThrow(() => browser.messages.forEach(fn => fn({ type: 'BUDOL_DISCORD_STATUS', text: 'Sent' }, {}, () => {})));
  assert.equal(document.querySelectorAll('[data-budol-ignore]').length, 1);
});
function worker(fetchResult = async () => ({ ok: true, status: 200, json: async () => ({ id: 'message-1' }) })) {
  const listeners = []; const storage = { budolDiscordWebhook: endpoint }; const sent = []; const statuses = [];
  let click, install; let currentItem = item;
  const context = vm.createContext({ URL, Intl, Date, AbortSignal, console, fetch: async (url, options) => { sent.push({ url, options }); return fetchResult(url, options); }, chrome: {
    runtime: { getURL: path => 'chrome-extension://test/' + path, openOptionsPage: async () => {}, onMessage: { addListener: fn => listeners.push(fn) }, onInstalled: { addListener: fn => { install = fn; } }, onStartup: { addListener() {} } },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener: fn => { click = fn; } } },
    storage: { local: { get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, storage[k]])), set: async values => Object.assign(storage, values) } },
    tabs: { sendMessage: async (_tab, message) => { if (message.type === 'BUDOL_CONTEXT_PRODUCT') return { product: currentItem }; statuses.push(message); return { ok: true }; } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  } });
  for (const name of ['catalog.js', 'discord.js', 'discord-background.js']) vm.runInContext(source(name), context);
  const settings = (type, sender = { url: 'chrome-extension://test/options.html' }, extra = {}) => new Promise(resolve => listeners.forEach(fn => fn({ type, ...extra }, sender, resolve)));
  return { storage, sent, statuses, settings, install: () => install(), select: value => { currentItem = value; }, click: () => click({ menuItemId: 'budol-send-discord', frameId: 0 }, { id: 5 }) };
}
test('menu posts one confirmed embed and suppresses concurrent or repeated clicks', async () => {
  const w = worker(); w.click(); w.click(); await wait(30);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].url, /wait=true$/);
  assert.equal(w.sent[0].options.method, 'POST');
  assert.equal(w.sent[0].options.credentials, 'omit');
  assert.equal(JSON.parse(w.sent[0].options.body).embeds[0].url, item.url);
  assert.equal(w.statuses.at(-1).text, 'Item sent to Discord.');
  w.click(); await wait(30); assert.equal(w.sent.length, 1);
});
test('Discord 429 persists cooldown; unknown delivery is reported without automatic retry', async () => {
  const limited = worker(async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 10 }) }));
  limited.click(); await wait(30); limited.click(); await wait(30);
  assert.equal(limited.sent.length, 1); assert.ok(limited.storage.budolDiscordRetryAt > Date.now());
  assert.match(limited.statuses.at(-1).text, /rate-limiting/);
  const broken = worker(async () => { throw new Error('Network failure ' + endpoint); });
  broken.click(); await wait(30); assert.equal(broken.sent.length, 1);
  assert.match(broken.statuses.at(-1).text, /Check Discord/);
  assert.ok(!broken.statuses.at(-1).text.includes(endpoint));
});
test('no selected product never posts; rejected webhooks show a useful error', async () => {
  const w = worker(); w.select(null); w.click(); await wait(30); assert.equal(w.sent.length, 0);
  assert.match(w.statuses.at(-1).text, /Right-click a product/);
  const rejected = worker(async () => ({ ok: false, status: 404 })); rejected.click(); await wait(30);
  assert.match(rejected.statuses.at(-1).text, /Update it/);
});
test('webhook settings stay on trusted pages and disconnect is not undone by local setup', async () => {
  const w = worker();
  const blocked = await w.settings('BUDOL_DISCORD_SETTINGS_GET', { url: 'https://shopee.ph/' });
  assert.equal(blocked.ok, false);
  const result = await w.settings('BUDOL_DISCORD_SETTINGS_GET');
  assert.equal(result.configured, true); assert.ok(!JSON.stringify(result).includes(endpoint));
  await w.settings('BUDOL_DISCORD_SETTINGS_CLEAR');
  w.install(); await wait(30);
  assert.equal(w.storage.budolDiscordWebhook, ''); assert.equal(w.sent.length, 0);
});

test('private local setup imports a webhook once without making a Discord request', async () => {
  const w = worker(async url => {
    assert.equal(url, 'chrome-extension://test/discord-local.json');
    return { ok: true, json: async () => ({ webhook: endpoint }) };
  });
  delete w.storage.budolDiscordWebhook;
  w.install(); await wait(30);
  assert.match(w.storage.budolDiscordWebhook, /wait=true$/);
  assert.equal(w.storage.budolDiscordSeeded, true);
  assert.equal(w.sent.length, 1);
  w.install(); await wait(30);
  assert.equal(w.sent.length, 1);
});
