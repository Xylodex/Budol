const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { createBrowser, product, wait } = require('./helpers.cjs');
const origin = 'chrome-extension://' + 'a'.repeat(32);
async function broker(t, options = {}) {
  const { startBroker } = await import('../mcp/broker.mjs');
  const config = { version: 1, port: 0, clientToken: '1'.repeat(64), extensionToken: '2'.repeat(64) };
  const instance = await startBroker(config, { idle: 60000, ...options });
  config.port = instance.server.address().port; t.after(() => instance.close());
  const call = async (path, body = {}, extension = false, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${extension ? config.extensionToken : config.clientToken}`, 'Content-Type': 'application/json', ...(extension ? { Origin: origin } : {}), ...extra }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { config, call };
}
test('local broker separates credentials, blocks web origins/host rebinding, and enforces capabilities', async t => {
  const { call, config } = await broker(t);
  assert.equal((await call('/health', {}, false, { Origin: 'https://shopee.ph' })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    const req = require('node:http').request({ hostname: '127.0.0.1', port: config.port, path: '/health', method: 'POST', headers: { Host: 'evil.test', Authorization: `Bearer ${config.clientToken}`, 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(rebound, 403);
  assert.equal((await call('/health', {}, true)).status, 403);
  assert.equal((await call('/connect', {}, true, { Authorization: 'Bearer ' + '1'.repeat(64) })).status, 401);
  assert.equal((await call('/health', {}, false, { Authorization: '' })).status, 401);
  assert.equal((await call('/call', { command: 'list_tabs', args: {} })).body.ok, false);
  const session = (await call('/connect', {}, true)).body.session;
  assert.equal((await call('/connect', {}, true)).status, 409);
  assert.equal((await call('/poll', { session: randomUUID() }, true)).status, 409);
  assert.equal((await call('/call', { command: 'send_discord', args: {} })).body.ok, false);
  assert.equal((await call('/call', { command: 'eval', args: {} })).status, 400);
  assert.equal((await call('/health')).body.connected, true);
  await call('/disconnect', { session }, true); assert.equal((await call('/health')).body.connected, false);
});
test('broker delivers each request once, expires it without retry, and clears jobs on disconnect', async t => {
  const { call } = await broker(t, { timeout: 150 });
  const session = (await call('/connect', { writes: true, discord: true }, true)).body.session;
  const pending = call('/call', { command: 'list_tabs', args: {} }); await wait(20);
  const job = (await call('/poll', { session }, true)).body.job;
  assert.equal(job.command, 'list_tabs'); assert.equal((await call('/poll', { session }, true)).body.job, null);
  await call('/result', { session, id: job.id, result: { ok: true, data: { tabs: [] } } }, true);
  assert.deepEqual((await pending).body.data, { tabs: [] });
  assert.equal((await call('/result', { session, id: job.id, result: { ok: true } }, true)).status, 410);
  const expired = await call('/call', { command: 'send_discord', args: {} }); assert.match(expired.body.error, /No automatic retry/);
  assert.equal((await call('/poll', { session }, true)).body.job, null);
  const cancelled = call('/call', { command: 'list_tabs', args: {} }); await wait(20);
  await call('/disconnect', { session }, true); assert.match((await cancelled).body.error, /disconnected/);
});
test('multiple real MCP stdio clients negotiate tools, validate inputs, calculate and share the broker', async t => {
  const { config, call } = await broker(t);
  const dir = await mkdtemp(resolve(tmpdir(), 'budol-mcp-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = resolve(dir, 'config.json'); await writeFile(file, JSON.stringify(config));
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const client = new Client({ name: 'budol-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(__dirname, '../mcp/server.mjs')], env: { ...process.env, BUDOL_MCP_CONFIG: file }, stderr: 'pipe' });
    await client.connect(transport); clients.push(client); t.after(() => client.close());
  }
  const list = await clients[0].listTools(); assert.equal(list.tools.length, 9);
  assert.equal(list.tools.find(tool => tool.name === 'budol_send_discord').annotations.readOnlyHint, false);
  assert.equal(list.tools.find(tool => tool.name === 'budol_remove_saved').annotations.destructiveHint, true);
  const status = await clients[1].callTool({ name: 'budol_status', arguments: {} }); assert.equal(status.structuredContent.connected, false);
  const invalid = await clients[0].callTool({ name: 'budol_get_products', arguments: { tab_id: -1 } }); assert.equal(invalid.isError, true);
  const result = await clients[0].callTool({ name: 'budol_calculate', arguments: { price: 29900, shipping: 4000, percent: 10, minimum: 50000, cashback: 5000 } });
  assert.equal(result.structuredContent.total, 33900); assert.equal(result.structuredContent.cashback, 5000);
  const session = (await call('/connect', {}, true)).body.session;
  const pending = clients[1].callTool({ name: 'budol_list_tabs', arguments: {} }); await wait(30);
  const job = (await call('/poll', { session }, true)).body.job;
  await call('/result', { session, id: job.id, result: { ok: true, data: { tabs: [{ id: 9, title: 'Shopee' }] } } }, true);
  assert.equal((await pending).structuredContent.tabs[0].id, 9);
});
test('extension tools filter loaded evidence, omit private saved data and recheck access before writes', async t => {
  const b = createBrowser(product(60)); t.after(() => b.dom.window.close()); b.run('catalog.js'); b.run('mcp-actions.js');
  const raw = b.dom.window.BudolCatalog.extractProducts(b.dom.window.document)[0];
  let writes = 0; b.chrome.tabs.query = async () => [{ id: 7, title: 'Shopee' }];
  b.chrome.tabs.sendMessage = async () => ({ products: [raw] });
  b.chrome.runtime.sendMessage = async message => {
    if (message.type !== 'BUDOL_BOARD_GET') writes++;
    return { ok: true, board: { products: [{ ...raw, notes: 'PRIVATE', collection: 'PRIVATE', webhook: 'SECRET', history: [{ price: 1, at: '2026-01-01' }] }] } };
  };
  const execute = (command, args = {}, capabilities = {}, active) => b.dom.window.BudolMcpActions.execute({ command, args, id: randomUUID(), deadline: Date.now() + 10000 }, capabilities, active);
  assert.equal((await execute('get_products', { tab_id: 7, min_discount: 70 })).total, 0);
  assert.equal((await execute('get_products', { tab_id: 7, min_discount: 50 })).total, 1);
  const saved = await execute('list_saved'); assert.ok(!/PRIVATE|SECRET|history/.test(JSON.stringify(saved)));
  assert.equal((await execute('list_saved', { include_history: true })).products[0].history.length, 1);
  await assert.rejects(execute('save_product', { tab_id: 7, url: raw.url }), /disabled/);
  await assert.rejects(execute('send_discord', { tab_id: 7, url: raw.url }, { writes: true }), /disabled/);
  await assert.rejects(execute('save_product', { tab_id: 7, url: 'https://shopee.ph/product/1/2' }, { writes: true }), /not in the loaded/);
  let active = true; b.chrome.tabs.sendMessage = async () => { active = false; return { products: [raw] }; };
  await assert.rejects(execute('save_product', { tab_id: 7, url: raw.url }, { writes: true }, () => active), /disconnected/);
  assert.equal(writes, 0);
});
