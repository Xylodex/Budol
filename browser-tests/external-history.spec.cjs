const { test, expect, chromium } = require('@playwright/test');
const { resolve, basename } = require('node:path');
const { mkdtemp, rm, cp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');

test('direct provider history supports variants, listing scope, MCP, caching and cleanup without shopping tabs', async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(tmpdir(), 'budol-history-')), extension = resolve(profile, 'extension');
  let context;
  await cp(resolve(__dirname, '../extension'), extension, { recursive: true, filter: path => !['discord-local.json', 'mcp-local.json'].includes(basename(path)) });
  // Pregrant provider hosts only in this test copy. The production UI requests
  // optional host permissions from a user gesture; browser permission UI is not mocked here.
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://api.aiprice.com/*', 'https://sgitojuhoaxxnujdikbd.supabase.co/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP api.aiprice.com ~NOTFOUND, MAP sgitojuhoaxxnujdikbd.supabase.co ~NOTFOUND'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await worker.evaluate(() => {
      globalThis.providerRequests = []; globalThis.providerFail = false;
      globalThis.fetch = async (url, options) => {
        const u = new URL(url); globalThis.providerRequests.push(u.href);
        if (globalThis.providerFail) throw Error('offline');
        let data;
        if (u.hostname === 'api.aiprice.com') data = { code: 200, success: 1, currency: 'PHP', adid: '26', price_tracking: [{ price: '69.58', time_update: Date.now() / 1000 - 3600, adid: 26 }] };
        else if (u.pathname.endsWith('/products')) data = [{ id: 1, name: '<img src=x onerror=alert(1)> Keyboard', platform: 'shopee', external_shop_id: '123', external_product_id: '456' }];
        else if (u.pathname.endsWith('/product_variations')) data = [{ id: 2, product_id: 1, external_variation_id: '22', name: 'Blue', is_active: true }, { id: 3, product_id: 1, external_variation_id: '33', name: 'Red', is_active: true }];
        else if (u.pathname.endsWith('/price_observations')) data = [{ variation_id: 2, observed_at: new Date(Date.now() - 60000).toISOString(), price: '123.45', is_in_stock: true }];
        else throw Error('Unexpected network request');
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      };
    });
    const board = await context.newPage(); const errors = []; board.on('pageerror', e => errors.push(e.message));
    await board.goto(`chrome-extension://${id}/board.html`);
    await board.locator('#external-history-panel > summary').click();
    await board.locator('#history-url').fill('https://shopee.ph/product/123/456?tracking=private');
    await board.locator('#history-lookup').click();
    await expect(board.locator('#history-variant')).toBeVisible();
    await expect(board.locator('#history-result')).toContainText('Select a variant to load');
    await expect(board.locator('#history-result img')).toHaveCount(0);
    await board.locator('#history-variant').selectOption('2');
    await worker.evaluate(() => chrome.storage.local.set({ budolHistoryCooldowns: { pricetrack: Date.now() + 60000 } }));
    await board.getByRole('button', { name: 'Load variant history' }).click();
    await expect(board.locator('#history-status')).toContainText('Wait a few seconds');
    await worker.evaluate(() => chrome.storage.local.set({ budolHistoryCooldowns: {} }));
    await board.getByRole('button', { name: 'Try this lookup again' }).click();
    await expect(board.locator('#history-result tbody')).toContainText('₱123.45');
    const count = await worker.evaluate(() => providerRequests.length);
    const mcp = await context.newPage(); await mcp.goto(`chrome-extension://${id}/mcp.html`);
    const result = await mcp.evaluate(() => BudolMcpActions.execute({ command: 'get_external_history', id: crypto.randomUUID(), deadline: Date.now() + 20000, args: { provider: 'pricetrack', url: 'https://shopee.ph/product/123/456', variant_id: '2' } }, { writes: false, discord: false }));
    expect(result.cached).toBe(true); expect(result.points[0].price).toBe(12345);
    expect(await worker.evaluate(() => providerRequests.length)).toBe(count);
    await board.locator('#history-provider').selectOption('aiprice');
    await board.locator('#history-url').fill('https://www.lazada.com.ph/products/keyboard-i987-s654.html');
    await board.locator('#history-lookup').click();
    await expect(board.locator('#history-result')).toContainText('Listing-level history');
    await expect(board.locator('#history-result tbody')).toContainText('₱69.58');
    await board.locator('#external-history-panel').scrollIntoViewIfNeeded();
    await board.screenshot({ path: testInfo.outputPath('external-history-loaded.png') });
    expect(await worker.evaluate(() => providerRequests.every(url => !url.includes('tracking=') && !url.includes('shopee.ph/')))).toBe(true);
    await worker.evaluate(async () => { const { budolExternalHistory } = await chrome.storage.local.get('budolExternalHistory'); for (const row of budolExternalHistory) row.at = 1; await chrome.storage.local.set({ budolExternalHistory, budolHistoryCooldowns: {} }); globalThis.providerFail = true; });
    await board.locator('#history-lookup').click();
    await expect(board.locator('#history-status')).toContainText('Showing cached history');
    await board.locator('#backup-panel > summary').click();
    await board.locator('#clear-external-history').click();
    await expect(board.locator('#history-clear-status')).toContainText('cleared');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('budolExternalHistory')).budolExternalHistory)).toEqual([]);
    await expect(board.locator('#history-result')).toBeEmpty();
    expect(errors).toEqual([]);
    await board.setViewportSize({ width: 360, height: 800 });
    await board.locator('#external-history-panel').scrollIntoViewIfNeeded();
    expect(await board.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await board.screenshot({ path: testInfo.outputPath('external-history.png') });
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
