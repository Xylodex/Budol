const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source, createBrowser, wait } = require('./helpers.cjs');

function saved(id, title, price) {
  return { id: `shopee:1:${id}:listing:PHP`, url: `https://shopee.ph/product/1/${id}`, title, price, currency: 'PHP', scope: 'listing', collection: 'Wishlist', notes: '', savedAt: `2026-10-02T0${id}:00:00.000Z`, lastSeen: '2026-10-02T04:00:00.000Z', history: [] };
}

async function setup(t, products = [], candidates = [], fail = '', restoredDrafts = []) {
  const browser = createBrowser(source('board.html'), {}, () => ({ products: candidates.map(p => ({ discount: 60, ...p })) }));
  t.after(() => browser.dom.window.close());
  browser.run('catalog.js');
  browser.dom.window.sessionStorage.setItem('budolNoteDrafts', JSON.stringify(restoredDrafts));
  let board = { version: 1, products };
  const messages = [];
  browser.dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  browser.chrome.runtime.sendMessage = async message => {
    messages.push(message);
    if (message.type === fail) return { ok: false, error: 'Storage unavailable. Try again.' };
    if (message.type === 'BUDOL_REMOVE') board.products = board.products.filter(p => p.id !== message.id);
    if (message.type === 'BUDOL_IMPORT') board.products.push(...message.board.products);
    if (message.type === 'BUDOL_EDIT') Object.assign(board.products.find(p => p.id === message.id), { collection: message.collection, notes: message.notes });
    if (message.type === 'BUDOL_VARIANT') board.products.find(p => p.id === message.id).variant = message.variant ? { name: message.variant.name, price: Number(message.variant.price) * 100, at: '2026-10-03T00:00:00Z' } : null;
    if (message.type === 'BUDOL_WATCH') board.products.find(p => p.id === message.id).watch = message.watch ? { ...message.watch, target: Number(message.watch.target) * 100, createdAt: '2026-10-03T00:00:00Z' } : null;
    if (message.type === 'BUDOL_SAVE') board.products.push({ ...message.product, collection: 'Wishlist', notes: '', savedAt: '2026-10-02T04:00:00Z', lastSeen: '2026-10-02T04:00:00Z', history: [] });
    return { ok: true, board: structuredClone(board) };
  };
  browser.run('board.js'); await wait();
  return { ...browser, document: browser.dom.window.document, messages };
}

test('offers are accessible in discovery, saved items and comparison without reducing prices', async t => {
  const item = { ...saved(1, 'Keyboard', 29900), offers: [{ text: 'Shop voucher 10% off Min spend ₱500' }, { text: '20% Coins cashback' }, { text: 'Flash Deal' }, { text: 'Bundle Deal: Any 3 enjoy 15% off' }] };
  const { document } = await setup(t, [item], [item]);
  for (const selector of ['#candidates', '#saved']) {
    const offers = document.querySelector(`${selector} .offers`);
    assert.equal(offers.open, false); assert.match(offers.textContent, /Offers shown · 4/);
    assert.match(offers.textContent, /one item at the shown price is below/);
    assert.match(offers.textContent, /does not reduce this payment/);
    assert.match(offers.textContent, /excludes ongoing Flash Deal/);
  }
  document.querySelector('#candidates [data-compare-id]').click();
  assert.match(document.querySelector('#comparison .offers').textContent, /Eligibility unverified/);
  assert.equal(document.querySelector('#comparison form').elements.price.value, '299.00');
});

test('board sorts unknown prices last, distinguishes no results, and clears filters', async t => {
  const { document, dom } = await setup(t, [saved(1, 'Unknown', null), saved(2, 'Expensive', 20000), saved(3, 'Affordable', 10000)]);
  const sort = document.getElementById('sort'); sort.value = 'price'; sort.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual([...document.querySelectorAll('#saved h3')].map(n => n.textContent), ['Affordable', 'Expensive', 'Unknown']);
  const search = document.getElementById('search'); search.value = 'missing'; search.dispatchEvent(new dom.window.Event('input'));
  assert.match(document.getElementById('saved').textContent, /No matching products/);
  assert.match(document.getElementById('result-count').textContent, /0 products of 3/);
  document.getElementById('clear-filters').click();
  assert.equal(document.querySelectorAll('#saved .product').length, 3);
  assert.equal(document.activeElement, search);
});

test('discovery ranks advertised discounts, excludes unknown discounts, and recovers from no matches', async t => {
  const items = [ { ...saved(1, 'Low', 10000), discount: 20 }, { ...saved(2, 'High', 20000), discount: 80 }, { ...saved(3, 'Unknown', 30000), discount: null } ];
  const { document, dom } = await setup(t, [], items);
  assert.equal(document.querySelectorAll('.candidate').length, 1);
  assert.match(document.querySelector('.candidate').textContent, /80% offHigh/);
  const threshold = document.getElementById('deal-threshold'); threshold.value = '90'; threshold.dispatchEvent(new dom.window.Event('change')); await wait();
  assert.equal(document.querySelectorAll('.candidate').length, 0);
  assert.match(document.getElementById('candidates').textContent, /No loaded products/);
  document.querySelector('#candidates button').click();
  assert.deepEqual([...document.querySelectorAll('.candidate > a')].map(n => n.textContent), ['High', 'Low', 'Unknown']);
});

test('deal filters search beyond the first six cards and reset cleanly', async t => {
  const items = Array.from({ length: 10 }, (_, i) => saved(i + 1, i === 9 ? 'Wireless keyboard' : 'Mouse', 10000));
  const { document, dom } = await setup(t, [], items);
  const form = document.getElementById('deal-filters');
  form.elements.required.value = 'keyboard'; form.dispatchEvent(new dom.window.Event('input'));
  assert.equal(document.querySelectorAll('.candidate').length, 1);
  assert.match(document.querySelector('.candidate').textContent, /Wireless keyboard/);
  form.elements.rating.value = '4'; form.dispatchEvent(new dom.window.Event('input'));
  assert.equal(document.querySelectorAll('.candidate').length, 0);
  form.reset(); await wait();
  assert.equal(document.querySelectorAll('.candidate').length, 6);
  assert.match(document.getElementById('deal-count').textContent, /^10/);
});

test('comparison retains its shortlist across filters, caps selection and keeps shipping unknown', async t => {
  const items = Array.from({ length: 5 }, (_, i) => saved(i + 1, `Item ${i + 1}`, i ? 20000 : null));
  items[0].priceRange = { min: 10000, max: 30000 };
  const { document, dom } = await setup(t, [], items);
  const buttons = [...document.querySelectorAll('#candidates [data-compare-id]')];
  buttons[0].click(); buttons[1].click();
  const form = document.querySelector('#comparison form');
  assert.equal(form.elements.price.value, '');
  assert.equal(form.elements.shipping.value, '');
  assert.match(document.querySelector('.comparison-total').textContent, /incomplete/);
  for (const [name, value] of [['price', '250'], ['shipping', '40'], ['voucher', '25']]) { form.elements[name].value = value; form.elements[name].dispatchEvent(new dom.window.Event('input')); }
  assert.match(document.querySelector('.comparison-total').textContent, /₱265.00/);
  buttons[2].click(); buttons[3].click(); assert.equal(buttons[4].disabled, true);
  assert.equal(document.querySelector('#comparison form').elements.shipping.value, '40');
  document.getElementById('deal-filters').elements.required.value = 'missing'; document.getElementById('deal-filters').dispatchEvent(new dom.window.Event('input'));
  assert.equal(document.querySelectorAll('.candidate').length, 0); assert.equal(document.querySelectorAll('.comparison-card').length, 4);
  document.querySelector('.comparison-card button').click(); assert.equal(document.querySelectorAll('.comparison-card').length, 3);
  document.getElementById('clear-comparison').click(); assert.equal(document.querySelectorAll('.comparison-card').length, 0);
});

test('CSV downloads every filtered result including cards beyond the first page', async t => {
  const items = Array.from({ length: 10 }, (_, i) => saved(i + 1, `Keyboard ${i + 1}`, 10000));
  const { document, dom } = await setup(t, [], items);
  let downloaded;
  dom.window.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  dom.window.URL.createObjectURL = blob => { downloaded = blob.text; return 'blob:test'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  assert.equal(document.querySelectorAll('.candidate').length, 6);
  document.getElementById('export-deals').click(); await wait();
  assert.equal(downloaded.trim().split('\r\n').length, 11);
  const form = document.getElementById('deal-filters'); form.elements.excluded.value = '10'; form.dispatchEvent(new dom.window.Event('input'));
  document.getElementById('export-deals').click(); await wait();
  assert.equal(downloaded.trim().split('\r\n').length, 10); assert.equal(downloaded.includes('Keyboard 10'), false);
});

test('show all clears both keyword and discount filters', async t => {
  const { document, dom } = await setup(t, [], [{ ...saved(1, 'Keyboard', 10000), discount: 10 }]);
  const form = document.getElementById('deal-filters'); form.elements.required.value = 'missing'; form.dispatchEvent(new dom.window.Event('input'));
  document.querySelector('#candidates button').click();
  assert.equal(form.elements.required.value, ''); assert.equal(document.querySelectorAll('.candidate').length, 1);
});

test('watch and variant drafts survive filtering and remain until explicitly saved or discarded', async t => {
  const { document, dom, messages } = await setup(t, [saved(1, 'Keyboard', 10000)]);
  const update = (selector, value) => { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  update('[name="variant-name"]', 'Blue'); update('[name="variant-price"]', '250'); update('.watch-form [name="target"]', '200');
  update('#search', 'missing'); update('#search', '');
  assert.equal(document.querySelector('[name="variant-name"]').value, 'Blue'); assert.equal(document.querySelector('.watch-form [name="target"]').value, '200');
  assert.equal(JSON.parse(dom.window.sessionStorage.getItem('budolConfigDrafts')).length, 2);
  document.querySelector('.watch-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await wait();
  assert.equal(messages.filter(m => m.type === 'BUDOL_WATCH').at(-1).watch.target, '200');
  assert.equal(JSON.parse(dom.window.sessionStorage.getItem('budolConfigDrafts')).length, 1);
  const variantForm = document.querySelector('[name="variant-name"]').form;
  [...variantForm.querySelectorAll('button')].find(button => button.textContent === 'Discard unsaved changes').click();
  assert.equal(document.querySelector('[name="variant-name"]').value, '');
  assert.equal(JSON.parse(dom.window.sessionStorage.getItem('budolConfigDrafts')).length, 0);
});

test('completing an older import preserves a newer file selection', async t => {
  const { document, dom, chrome } = await setup(t);
  const first = { version: 1, products: [saved(1, 'First backup', 10000)] };
  const second = { version: 1, products: [saved(2, 'Second backup', 20000)] };
  const input = document.getElementById('import-file');
  const choose = async board => { Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 100, text: async () => JSON.stringify(board) }] }); input.dispatchEvent(new dom.window.Event('change')); await wait(); };
  await choose(first);
  let finish; const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = message => message.type === 'BUDOL_IMPORT' ? new Promise(resolve => { finish = async () => resolve(await original(message)); }) : original(message);
  document.getElementById('import').click(); await wait(); await choose(second);
  assert.equal(document.getElementById('import').disabled, true);
  await finish(); await wait(); assert.equal(document.getElementById('import').disabled, false);
  chrome.runtime.sendMessage = original; document.getElementById('import').click(); await wait();
  assert.equal(document.querySelectorAll('#saved .product').length, 2);
  assert.equal(document.getElementById('import').disabled, true);
});

test('discovery recovers from a closed source tab and can switch between connected Shopee tabs', async t => {
  const { chrome, document, dom } = await setup(t);
  chrome.tabs.query = async () => [{ id: 3 }, { id: 4 }, { id: 5 }];
  chrome.tabs.sendMessage = async id => {
    if (id === 3) throw new Error('Not a Shopee tab');
    return { title: `Shop ${id}`, products: [{ ...saved(id, `Product ${id}`, 10000), discount: 70 }] };
  };
  document.getElementById('refresh').click(); await wait();
  const picker = document.getElementById('source-tab');
  assert.equal(picker.value, '4'); assert.equal(picker.options.length, 2);
  picker.value = '5'; picker.dispatchEvent(new dom.window.Event('change')); await wait();
  assert.match(document.querySelector('.candidate').textContent, /Product 5/);
});

test('an unresponsive Shopee tab does not block products from another tab', async t => {
  const { document, dom, chrome } = await setup(t);
  const originalTimeout = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback, delay) => originalTimeout(callback, delay === 5000 ? 0 : delay);
  chrome.tabs.query = async () => [{ id: 1 }, { id: 2 }];
  chrome.tabs.sendMessage = id => id === 1 ? new Promise(() => {}) : Promise.resolve({ products: [{ ...saved(2, 'Responsive tab', 10000), discount: 80 }] });
  document.getElementById('refresh').click(); await wait(20);
  assert.match(document.querySelector('.candidate').textContent, /Responsive tab/);
  assert.equal(document.getElementById('refresh').disabled, false);
});

test('an older source refresh cannot overwrite the latest board or leave a working label', async t => {
  const { document, dom, chrome } = await setup(t);
  chrome.tabs.query = async () => [{ id: 1 }, { id: 2 }];
  chrome.tabs.sendMessage = async id => ({ products: [{ ...saved(id, `Tab ${id}`, 10000), discount: 80 }] });
  let finish; let calls = 0;
  chrome.runtime.sendMessage = async () => {
    if (++calls === 1) return new Promise(resolve => { finish = () => resolve({ ok: true, board: { version: 1, products: [saved(1, 'Older board', 10000)] } }); });
    return { ok: true, board: { version: 1, products: [saved(2, 'Latest board', 20000)] } };
  };
  document.getElementById('refresh').click(); await wait();
  const source = document.getElementById('source-tab'); source.value = '2'; source.dispatchEvent(new dom.window.Event('change')); await wait();
  finish(); await wait();
  assert.match(document.getElementById('saved').textContent, /Latest board/); assert.doesNotMatch(document.getElementById('saved').textContent, /Older board/);
  assert.equal(document.getElementById('refresh').textContent, 'Refresh products'); assert.equal(document.getElementById('refresh').disabled, false);
});

test('switching products clears product-specific shipping, quantity and voucher values', async t => {
  const { document, dom } = await setup(t, [saved(1, 'First', 10000), saved(2, 'Second', 20000)]);
  const buttons = [...document.querySelectorAll('#saved .primary')];
  buttons[0].click(); const form = document.getElementById('calculator');
  form.elements.shipping.value = '40'; form.elements.quantity.value = '3'; form.elements.discount.value = '20';
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.ok(document.querySelector('#estimate strong'));
  buttons[1].click();
  assert.equal(form.elements.shipping.value, ''); assert.equal(form.elements.quantity.value, '1'); assert.equal(form.elements.discount.value, '0');
  assert.equal(document.querySelector('#estimate strong'), null);
  document.getElementById('reset-calculator').click();
  assert.equal(form.elements.price.value, ''); assert.equal(document.querySelectorAll('.price-selected').length, 0);
});

test('restored drafts open automatically and removal undo restores the unsaved note', async t => {
  const item = saved(1, 'First', 10000);
  const { document, dom } = await setup(t, [item], [], '', [[item.id, { collection: 'Wishlist', notes: 'Recovered note' }]]);
  assert.equal(document.querySelector('#saved textarea').value, 'Recovered note');
  assert.equal(document.querySelector('#saved textarea').closest('details').open, true);
  [...document.querySelectorAll('#saved button')].find(b => b.textContent === 'Remove').click(); await wait();
  assert.equal(dom.window.sessionStorage.getItem('budolNoteDrafts'), '[]');
  document.getElementById('undo').click(); await wait();
  assert.equal(document.querySelector('#saved textarea').value, 'Recovered note');
  document.querySelector('#saved .notes-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await wait();
  assert.equal(dom.window.sessionStorage.getItem('budolNoteDrafts'), '[]');
});

test('a single price observation uses a readable entry rather than a one-point chart', async t => {
  const item = saved(1, 'First', 10000); item.history = [{ price: 10000, at: item.lastSeen }];
  const { document } = await setup(t, [item]);
  assert.equal(document.querySelector('#saved .chart'), null);
  assert.match([...document.querySelectorAll('#saved details')].find(node => node.querySelector('summary').textContent.startsWith('Price observations')).textContent, /Visit a listing/);
});

test('a listing range requires an explicit variant price for estimates', async t => {
  const item = { ...saved(1, 'Range item', null), priceRange: { min: 19900, max: 69900 } };
  const { document, dom } = await setup(t, [item]);
  assert.match(document.querySelector('.product-price').textContent, /varies by variant/);
  assert.equal(document.querySelector('#saved .primary').disabled, true);
  const name = document.querySelector('[name="variant-name"]'), price = document.querySelector('[name="variant-price"]');
  name.value = 'Blue 128GB'; price.value = '499';
  name.closest('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await wait();
  document.querySelector('#saved .primary').click();
  assert.equal(document.querySelector('#calc-price').value, '499.00');
  assert.match(document.querySelector('#price-source').textContent, /Blue 128GB.*manually confirmed/);
});

test('discovery reveals products in batches without a nested scroll list', async t => {
  const candidates = Array.from({ length: 14 }, (_, i) => saved(i + 1, `Find ${i + 1}`, 10000));
  const { document } = await setup(t, [], candidates);
  assert.equal(document.querySelectorAll('.candidate').length, 6);
  document.getElementById('more-candidates').click();
  assert.equal(document.querySelectorAll('.candidate').length, 12);
  assert.equal(document.activeElement.textContent, 'Find 7');
  document.getElementById('more-candidates').click();
  assert.equal(document.querySelectorAll('.candidate').length, 14);
  assert.equal(document.getElementById('more-candidates').hidden, true);
});

test('failed saves preserve draft input and expose an actionable error', async t => {
  const { document, dom } = await setup(t, [saved(1, 'Keyboard', 10000)], [], 'BUDOL_EDIT');
  const input = document.querySelector('#saved textarea'); input.value = 'Still drafting'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  document.querySelector('#saved .notes-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait();
  assert.equal(document.querySelector('#saved textarea').value, 'Still drafting');
  assert.equal(document.getElementById('failure').hidden, false);
  assert.match(document.getElementById('failure').textContent, /Try again/);
  assert.equal(document.querySelector('#saved button[type="submit"]').disabled, false);
});

test('undo remains available after an unrelated successful save', async t => {
  const { document, dom } = await setup(t, [saved(1, 'Keyboard', 10000), saved(2, 'Mouse', 20000)]);
  [...document.querySelectorAll('#saved button')].find(n => n.textContent === 'Remove').click(); await wait();
  document.querySelector('#saved .notes-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait();
  assert.equal(document.getElementById('undo-notice').hidden, false);
  document.getElementById('undo').click(); await wait();
  assert.equal(document.querySelectorAll('#saved .product').length, 2);
  assert.equal(document.getElementById('undo-notice').hidden, true);
});

test('empty shipping stays unknown and hidden invalid voucher fields are revealed', async t => {
  const { document, dom } = await setup(t);
  const form = document.getElementById('calculator');
  form.elements.price.value = '100';
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(document.activeElement, form.elements.shipping);
  assert.equal(document.querySelector('#estimate strong'), null);
  form.elements.shipping.value = '0'; form.elements.minimum.value = '-1';
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(document.getElementById('voucher-options').open, true);
  assert.equal(document.activeElement, form.elements.minimum);
  form.elements.minimum.value = '0';
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(document.querySelector('#estimate strong').textContent, '₱100.00');
});

test('core visual tokens meet text and control contrast thresholds', () => {
  function luminance(hex) {
    const rgb = hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const [foreground, background] of [['203b32','ffffff'], ['52665c','f5f5ee'], ['52665c','eef3e9'], ['ffffff','076b56'], ['dce8dd','203b32'], ['a33021','ffffff'], ['617168','ffffff'], ['163c61','e8f4fb'], ['486581','d9edf9'], ['f0fbff','2069a3'], ['f4fcff','165c9c'], ['ddf3ff','0b2d59']]) {
    assert.ok(ratio(foreground, background) >= 4.5, `${foreground}/${background}: ${ratio(foreground, background)}`);
  }
  assert.ok(ratio('7b9184', 'ffffff') >= 3);
  assert.ok(ratio('1267bc', 'f5f5ee') >= 3);
  assert.ok(ratio('547d9c', 'f0f9ff') >= 3);
  assert.ok(ratio('166aab', 'e8f4fb') >= 3);
  assert.ok(ratio('a8e9ff', '165c9c') >= 3);
});
