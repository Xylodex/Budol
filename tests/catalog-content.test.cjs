const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, product, wait } = require('./helpers.cjs');

function setup(t, sendMessage) {
  const browser = createBrowser(product(50));
  t.after(() => browser.dom.window.close());
  browser.chrome.runtime.id = 'budol-test';
  browser.chrome.runtime.sendMessage = sendMessage;
  browser.run('catalog.js');
  const errors = [];
  browser.dom.window.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
  browser.run('catalog-content.js');
  return { ...browser, errors };
}

for (const mode of ['throw', 'reject']) {
  test(`catalog stops after an invalidated context ${mode}s without uncaught errors or repeat work`, async t => {
    let calls = 0;
    const browser = setup(t, () => {
      calls++;
      const error = new Error('Extension context invalidated.');
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    });
    await wait(750);
    assert.equal(calls, 1);
    browser.dom.window.document.querySelector('.price').textContent = '₱200';
    browser.changes.forEach(listener => listener({ budolBoard: { newValue: {} } }, 'local'));
    await wait(750);
    assert.equal(calls, 1);
    assert.deepEqual(browser.errors, []);
    let responded = false;
    browser.messages.forEach(listener => listener({ type: 'BUDOL_GET_PRODUCTS' }, {}, () => { responded = true; }));
    assert.equal(responded, false);
  });
}

test('catalog cancels a queued scan when the extension runtime disappears', async t => {
  let calls = 0;
  const browser = setup(t, async () => { calls++; return { ok: true }; });
  delete browser.chrome.runtime.id;
  await wait(750);
  browser.dom.window.document.querySelector('.price').textContent = '₱200';
  await wait(750);
  assert.equal(calls, 0);
  assert.deepEqual(browser.errors, []);
});

test('catalog retries temporary messaging failures and deduplicates successful observations', async t => {
  let calls = 0;
  const browser = setup(t, async () => {
    calls++;
    if (calls === 1) throw new Error('Could not establish connection.');
    return { ok: true };
  });
  await wait(750);
  browser.dom.window.document.body.append('Page updated');
  await wait(750);
  assert.equal(calls, 2);
  browser.dom.window.document.body.append('Unrelated update');
  await wait(750);
  assert.equal(calls, 2);
  assert.deepEqual(browser.errors, []);
});
