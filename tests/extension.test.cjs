const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source, createBrowser, product, wait } = require('./helpers.cjs');

test('discounts require a sale marker and a percentage between 0 and 100', t => {
  const browser = createBrowser();
  t.after(() => browser.dom.window.close());
  const parse = browser.dom.window.Budol.parseDiscount;
  for (const [input, expected] of [['-40%', 40], ['− 50.5 %', 50.5], ['20% OFF', 20], ['save 12,5%', 12.5], ['100% off', 100], ['-0%', 0]]) {
    assert.equal(parse(input), expected, input);
  }
  for (const input of ['100% cotton', '80% cashback', 'up to 90% off', '50%', '-101%', '-5% extra voucher', '5K+ sold', '']) {
    assert.equal(parse(input), null, input);
  }
  assert.equal(parse('50%', true), 50);
});

test('current accessible badges, older badges, and product URL fallback work without nested duplicates', t => {
  const browser = createBrowser(`${product(54)}
    <div class="shopee-search-item-result__item"><div class="shopee-item-card" id="legacy">
      <div class="shopee-badge__promotion"><span class="percent">70%</span><span>OFF</span></div>
    </div></div>
    <a href="/product/10/20" id="fallback"><img><span>60% OFF</span></a>
    <a href="https://unrelated.example/product/10/20"><img><span>99% OFF</span></a>
    <div aria-label="Product card" role="group" id="plain"><span>100% cotton</span><span>80% cashback</span></div>`);
  t.after(() => browser.dom.window.close());
  const { findCards, getDiscount } = browser.dom.window.Budol;
  const cards = findCards(browser.dom.window.document);
  assert.equal(cards.length, 4);
  assert.equal(getDiscount(cards.find(card => card.id === 'product')).value, 54);
  assert.equal(getDiscount(cards.find(card => card.id === 'legacy')).value, 70);
  assert.equal(getDiscount(cards.find(card => card.id === 'fallback')).value, 60);
  assert.equal(getDiscount(cards.find(card => card.id === 'plain')), null);
});

test('inclusive threshold, saved settings, disabled mode, and storage removal update existing cards', async t => {
  const browser = createBrowser(product(50, 'equal') + product(50.1, 'above') + product(80, 'big'), { threshold: 50 });
  t.after(() => browser.dom.window.close());
  browser.run('content.js');
  await wait();
  const document = browser.dom.window.document;
  const ids = () => [...document.querySelectorAll('[data-budol-match]')].map(card => card.id);
  assert.deepEqual(ids(), ['equal', 'above', 'big']);
  await browser.chrome.storage.local.set({ threshold: 80 });
  assert.deepEqual(ids(), ['big']);
  await browser.chrome.storage.local.set({ threshold: 0 });
  assert.equal(ids().length, 3);
  await browser.chrome.storage.local.set({ enabled: false });
  assert.equal(ids().length, 0);
  assert.equal(document.querySelectorAll('[data-budol-badge]').length, 0);
  browser.changes.forEach(listener => listener({ enabled: {}, threshold: {} }, 'local'));
  assert.deepEqual(ids(), ['equal', 'above', 'big']);
});

test('focus mutes only non-matches, handles unknown discounts, and clears on toggle or disable', async t => {
  const browser = createBrowser(product(49, 'below') + product(50, 'equal') + product(100, 'full')
    + '<div role="group" aria-label="Product card" id="unknown"><span>No discount</span></div>');
  t.after(() => browser.dom.window.close());
  browser.run('content.js');
  await wait();
  const document = browser.dom.window.document;
  const mutedIds = () => [...document.querySelectorAll('[data-budol-muted]')].map(card => card.id);
  assert.deepEqual(mutedIds(), []);
  await browser.chrome.storage.local.set({ focus: true });
  assert.deepEqual(mutedIds(), ['below', 'unknown']);
  assert.equal(document.querySelectorAll('[data-budol-match]').length, 2);
  let status = await browser.chrome.tabs.sendMessage(1, { type: 'BUDOL_GET_STATUS' });
  assert.equal(status.muted, 2);
  await browser.chrome.storage.local.set({ threshold: 100 });
  assert.deepEqual(mutedIds(), ['below', 'equal', 'unknown']);
  assert.equal(document.querySelector('[data-budol-match]').id, 'full');
  await browser.chrome.storage.local.set({ threshold: 0 });
  assert.deepEqual(mutedIds(), ['unknown']);
  await browser.chrome.storage.local.set({ focus: false });
  assert.deepEqual(mutedIds(), []);
  assert.equal(document.querySelectorAll('[data-budol-match]').length, 3);
  await browser.chrome.storage.local.set({ focus: true, enabled: false });
  assert.deepEqual(mutedIds(), []);
  assert.equal(document.querySelectorAll('[data-budol-match], [data-budol-badge]').length, 0);
  await browser.chrome.storage.local.set({ enabled: true });
  assert.deepEqual(mutedIds(), ['unknown']);
  browser.changes.forEach(listener => listener({ focus: {} }, 'local'));
  assert.deepEqual(mutedIds(), []);
});

test('saved focus follows new cards and recycled badges without leaving stale effects', async t => {
  const browser = createBrowser(product(40, 'recycled'), { focus: true });
  t.after(() => browser.dom.window.close());
  browser.run('content.js');
  await wait();
  const document = browser.dom.window.document;
  const card = document.getElementById('recycled');
  assert.equal(card.hasAttribute('data-budol-muted'), true);
  card.querySelector('.sale').innerHTML = '<span>50% OFF</span>';
  document.body.insertAdjacentHTML('beforeend', product(10, 'new'));
  await wait(220);
  assert.equal(card.hasAttribute('data-budol-muted'), false);
  assert.equal(card.hasAttribute('data-budol-match'), true);
  const added = document.getElementById('new');
  assert.equal(added.hasAttribute('data-budol-muted'), true);
  card.querySelector('.sale').remove();
  added.remove();
  await wait(220);
  assert.equal(card.hasAttribute('data-budol-muted'), true);
  assert.equal(card.hasAttribute('data-budol-match'), false);
  assert.equal(added.hasAttribute('data-budol-muted'), false);
  const status = await browser.chrome.tabs.sendMessage(1, { type: 'BUDOL_GET_STATUS' });
  assert.equal(status.total, 1);
  assert.equal(status.muted, 1);
});

test('scroll loading, recycled discounts, removed cards, and page replacements update counts', async t => {
  const browser = createBrowser(product(40));
  t.after(() => browser.dom.window.close());
  browser.run('content.js');
  await wait();
  const document = browser.dom.window.document;
  document.body.insertAdjacentHTML('beforeend', product(90, 'new-card'));
  await wait(220);
  assert.equal(document.querySelectorAll('[data-budol-match]').length, 1);
  const sale = document.querySelector('#product .sale');
  sale.querySelector('span').setAttribute('aria-label', '-75%');
  sale.lastChild.nodeValue = '-75%';
  await wait(220);
  assert.equal(document.querySelectorAll('[data-budol-match]').length, 2);
  document.getElementById('new-card').remove();
  sale.innerHTML = '<span>25% OFF</span>';
  await wait(220);
  assert.equal(document.querySelectorAll('[data-budol-match]').length, 0);
  const status = await browser.chrome.tabs.sendMessage(1, { type: 'BUDOL_GET_STATUS' });
  assert.equal(status.total, 1);
  assert.equal(status.matched, 0);
  document.body.innerHTML = product(95, 'next-page');
  await wait(220);
  assert.equal(document.querySelector('[data-budol-match]').id, 'next-page');
});

test('normalization handles corrupt storage and highlights do not feed the mutation observer', async t => {
  const browser = createBrowser(product(90), { threshold: 'bad', enabled: 'bad' });
  t.after(() => browser.dom.window.close());
  let callbacks = 0;
  const OriginalObserver = browser.dom.window.MutationObserver;
  browser.dom.window.MutationObserver = class extends OriginalObserver {
    constructor(callback) { super((...args) => { callbacks += 1; callback(...args); }); }
  };
  browser.run('content.js');
  await wait(400);
  assert.equal(browser.dom.window.document.querySelectorAll('[data-budol-match]').length, 1);
  assert.equal(callbacks, 0);
  const normalize = browser.dom.window.Budol.normalizeSettings;
  assert.equal(normalize({ threshold: -20 }).threshold, 0);
  assert.equal(normalize({ threshold: Infinity }).threshold, 50);
  assert.equal(normalize({ threshold: 200 }).threshold, 100);
  assert.equal(normalize({ focus: 'true' }).focus, false);
  assert.equal(normalize({ focus: true }).focus, true);
});

test('a setting change during startup wins over a stale storage read', async t => {
  const browser = createBrowser(product(60));
  t.after(() => browser.dom.window.close());
  let resolveRead;
  browser.chrome.storage.local.get = () => new Promise(resolve => { resolveRead = resolve; });
  browser.run('content.js');
  await browser.chrome.storage.local.set({ threshold: 70 });
  resolveRead({ threshold: 10, enabled: true });
  await wait();
  assert.equal(browser.dom.window.document.querySelectorAll('[data-budol-match]').length, 0);
});

test('popup restores settings and saves number, slider, and switch changes', async t => {
  const browser = createBrowser(source('popup.html'), { threshold: 25, enabled: true, focus: true }, () => ({ ready: true, total: 72, matched: 6, muted: 66 }));
  t.after(() => browser.dom.window.close());
  browser.run('popup.js');
  await wait();
  const { document, Event } = browser.dom.window;
  const input = document.getElementById('threshold');
  assert.equal(input.value, '25');
  const focus = document.getElementById('focus');
  assert.equal(focus.checked, true);
  assert.equal(focus.disabled, false);
  assert.equal(document.getElementById('status-title').textContent, '6 products highlighted');
  assert.equal(document.getElementById('status-detail').textContent, '72 loaded products checked. 66 faded.');
  focus.click();
  await wait();
  assert.equal(browser.storage.focus, false);
  input.value = '50.5';
  input.dispatchEvent(new Event('input'));
  await wait();
  assert.equal(browser.storage.threshold, 50.5);
  document.getElementById('threshold').value = '75';
  document.getElementById('threshold').dispatchEvent(new browser.dom.window.Event('input'));
  await wait();
  assert.equal(browser.storage.threshold, 75);
  const range = document.getElementById('threshold-range');
  for (const value of [10, 20, 30]) { range.value = value; range.dispatchEvent(new Event('input')); }
  await wait();
  assert.equal(browser.storage.threshold, 30);
  document.getElementById('enabled').click();
  await wait();
  assert.equal(browser.storage.enabled, false);
  assert.equal(document.getElementById('status-title').textContent, 'Filter is paused');
  assert.equal(focus.disabled, true);
  document.getElementById('enabled').click();
  await wait();
  assert.equal(focus.disabled, false);
  assert.equal(document.getElementById('save-status').textContent, 'Saved automatically');
});

test('invalid popup values are not saved and unsupported tabs show guidance', async t => {
  const browser = createBrowser(source('popup.html'));
  t.after(() => browser.dom.window.close());
  browser.run('popup.js');
  await wait();
  const { document, Event } = browser.dom.window;
  const input = document.getElementById('threshold');
  for (const invalid of ['101', '-1', '', '2.55']) {
    input.value = invalid;
    input.dispatchEvent(new Event('input'));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
  }
  await wait();
  assert.equal(browser.writes.length, 0);
  input.dispatchEvent(new Event('blur'));
  assert.equal(input.value, '50');
  assert.equal(document.getElementById('status-title').textContent, 'Open a Shopee product listing');
});

test('popup reports a failed save and can save again', async t => {
  const browser = createBrowser(source('popup.html'));
  t.after(() => browser.dom.window.close());
  browser.run('popup.js');
  await wait();
  const write = browser.chrome.storage.local.set;
  browser.chrome.storage.local.set = async () => { throw new Error('Storage unavailable'); };
  const document = browser.dom.window.document;
  document.getElementById('threshold').value = '75';
  document.getElementById('threshold').dispatchEvent(new browser.dom.window.Event('input'));
  await wait();
  assert.equal(document.getElementById('save-status').textContent, 'Not saved');
  browser.chrome.storage.local.set = write;
  document.getElementById('threshold').value = '25';
  document.getElementById('threshold').dispatchEvent(new browser.dom.window.Event('input'));
  await wait();
  assert.equal(browser.storage.threshold, 25);
  assert.equal(document.getElementById('error').hidden, true);
});
