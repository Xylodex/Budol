const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { JSDOM } = require('jsdom');

function source(name) {
  return readFileSync(resolve(__dirname, '../extension', name), 'utf8');
}

function createBrowser(html = '', saved = {}, messageHandler) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://shopee.ph/test-shop' });
  const changes = [];
  const messages = [];
  const writes = [];
  const storage = { ...saved };
  const chrome = {
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...storage }; },
        async set(values) {
          writes.push({ ...values });
          const delta = {};
          for (const [key, value] of Object.entries(values)) {
            delta[key] = { oldValue: storage[key], newValue: value };
            storage[key] = value;
          }
          changes.forEach(listener => listener(delta, 'local'));
        },
      },
      onChanged: { addListener(listener) { changes.push(listener); } },
    },
    runtime: { onMessage: { addListener(listener) { messages.push(listener); } } },
    tabs: {
      async query() { return [{ id: 1 }]; },
      async sendMessage(_id, message) {
        if (messageHandler) return messageHandler(message);
        let response;
        messages.forEach(listener => listener(message, {}, value => { response = value; }));
        return response;
      },
    },
  };
  dom.window.chrome = chrome;
  dom.window.eval(source('common.js'));
  return { dom, chrome, storage, writes, changes, messages, run: name => dom.window.eval(source(name)) };
}

function product(discount, id = 'product') {
  return `<div role="group" aria-label="Product card" id="${id}">
    <a class="contents" href="/some-product-i.123.456"><div><img alt="Product">
    <div class="line-clamp-2">100% cotton shirt</div>
    <div class="price"><span aria-label="promotion price"></span><span>₱285</span></div>
    <div class="sale"><span data-testid="a11y-label" aria-label="-${discount}%"></span>-${discount}%</div>
    <div>80% cashback voucher</div></div></a></div>`;
}

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
module.exports = { source, createBrowser, product, wait };
