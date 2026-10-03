const { test, expect, chromium } = require('@playwright/test');
const { resolve, basename } = require('node:path');
const { mkdtemp, rm, cp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');

test('installed Budol connects, exposes real tools, requires write opt-in and disconnects', async ({}, testInfo) => {
  const { startBroker } = await import('../mcp/broker.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const profile = await mkdtemp(resolve(tmpdir(), 'budol-mcp-browser-'));
  const extension = resolve(profile, 'extension');
  let context, broker, client;
  try {
    const config = { version: 1, port: 0, clientToken: randomBytes(32).toString('hex'), extensionToken: randomBytes(32).toString('hex') };
    broker = await startBroker(config); config.port = broker.server.address().port;
    const configFile = resolve(profile, 'config.json'); await writeFile(configFile, JSON.stringify(config));
    await cp(resolve(__dirname, '../extension'), extension, { recursive: true, filter: path => !['discord-local.json', 'mcp-local.json'].includes(basename(path)) });
    const manifestPath = resolve(extension, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // Pregrant optional hosts in this disposable test profile. Production requests them on Connect.
    manifest.host_permissions.push(...manifest.optional_host_permissions); await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(resolve(extension, 'mcp-local.json'), JSON.stringify({ port: config.port, extensionToken: config.extensionToken }));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const html = await readFile(resolve(__dirname, '../tests/fixtures/shopee-offers.html'), 'utf8');
    const discordPosts = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('chrome-extension://') || url.startsWith(`http://127.0.0.1:${config.port}/`)) return route.continue();
      if (url.startsWith('https://shopee.ph/')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      if (url.startsWith('https://discord.com/api/v10/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')) { discordPosts.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{"id":"mock-receipt"}' }); }
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const shop = await context.newPage(); await shop.goto('https://shopee.ph/mcp-test');
    const connector = await context.newPage(); const errors = []; connector.on('pageerror', error => errors.push(error.message));
    await connector.goto(`chrome-extension://${extensionId}/mcp.html`);
    await expect(connector.locator('#mcp-token')).toHaveValue(config.extensionToken);
    await connector.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(connector.locator('#mcp-status')).toHaveText('Connected · read only');
    client = new Client({ name: 'installed-budol-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(__dirname, '../mcp/server.mjs')], env: { ...process.env, BUDOL_MCP_CONFIG: configFile }, stderr: 'pipe' }));
    const call = (name, args = {}) => client.callTool({ name: `budol_${name}`, arguments: args });
    const tabs = (await call('list_tabs')).structuredContent.tabs; expect(tabs.length).toBe(1);
    const tab_id = tabs[0].id;
    const products = await call('get_products', { tab_id }); expect(products.isError).not.toBe(true);
    const keyboard = products.structuredContent.products.find(item => item.title === 'Keyboard');
    expect(keyboard.price).toBe(29900); expect(keyboard.offers.some(offer => offer.kind === 'cashback')).toBe(true);
    expect((await call('save_product', { tab_id, url: keyboard.url })).isError).toBe(true);
    await connector.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await connector.getByLabel('Allow saving and removing products').check();
    await connector.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(connector.locator('#mcp-status')).toHaveText('Connected · changes enabled');
    expect((await call('save_product', { tab_id, url: keyboard.url })).structuredContent.saved).toBe(keyboard.url);
    const saved = (await call('list_saved', { include_history: true })).structuredContent.products;
    expect(saved.length).toBe(1); expect(saved[0].history[0].price).toBe(29900);
    expect((await call('send_discord', { tab_id, url: keyboard.url })).isError).toBe(true);
    expect(discordPosts.length).toBe(0);
    await connector.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await connector.getByLabel('Also allow explicit Discord sends').check();
    await connector.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(connector.locator('#mcp-status')).toHaveText('Connected · changes enabled · Discord enabled');
    await worker.evaluate(() => chrome.storage.local.set({ budolDiscordWebhook: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz' }));
    expect((await call('send_discord', { tab_id, url: keyboard.url })).structuredContent.sent).toBe(keyboard.url);
    expect(discordPosts.length).toBe(1); expect(discordPosts[0].embeds[0].fields.some(field => field.name.includes('Cashback'))).toBe(true);
    expect((await call('send_discord', { tab_id, url: keyboard.url })).isError).toBe(true); expect(discordPosts.length).toBe(1);
    await shop.close();
    const cache = (await call('list_cached')).structuredContent;
    expect(cache.items.some(item => item.product.url === keyboard.url)).toBe(true);
    await worker.evaluate(async () => { const stored = await chrome.storage.local.get('budolMcpReceipts'); await chrome.storage.local.set({ budolMcpReceipts: stored.budolMcpReceipts.map(row => ({ ...row, at: Date.now() - 61000 })) }); });
    expect((await call('send_discord', { url: keyboard.url })).structuredContent.source).toBe('saved snapshot');
    expect(discordPosts.length).toBe(2); expect(discordPosts[1].embeds[0].footer.text).toContain('Saved snapshot');
    expect((await call('remove_saved', { url: keyboard.url })).structuredContent.removed).toBe(keyboard.url);
    expect((await call('list_saved')).structuredContent.total).toBe(0);
    await connector.setViewportSize({ width: 320, height: 850 });
    await expect(connector.locator('body')).toHaveJSProperty('scrollWidth', 320);
    // Clear the key before screenshots; credentials are never saved as artifacts.
    await connector.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await connector.locator('#mcp-token').fill('');
    await connector.screenshot({ path: testInfo.outputPath('mcp-connector.png'), fullPage: true });
    expect((await call('status')).structuredContent.connected).toBe(false);
    expect((await call('get_products', { tab_id })).isError).toBe(true);
    await connector.reload(); await expect(connector.locator('#mcp-writes')).not.toBeChecked(); await expect(connector.locator('#mcp-discord')).not.toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await client?.close(); await context?.close(); broker?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
});
