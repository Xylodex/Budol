const { test, expect, chromium } = require('@playwright/test');
const { resolve, basename } = require('node:path');
const { mkdtemp, rm, cp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');

test('Shopee cards show delayed external prices without navigation and discard abandoned responses', async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(tmpdir(), 'budol-shopee-hover-')), extension = resolve(profile, 'extension');
  let context;
  await cp(resolve(__dirname, '../extension'), extension, { recursive: true, filter: path => !['discord-local.json', 'mcp-local.json'].includes(basename(path)) });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://api.aiprice.com/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  const html = await readFile(resolve(__dirname, '../tests/fixtures/shopee-offers.html'), 'utf8');
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP api.aiprice.com ~NOTFOUND'] });
    await context.route('https://shopee.ph/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await worker.evaluate(() => {
      globalThis.historyCalls = 0;
      globalThis.fetch = async url => {
        if (new URL(url).hostname !== 'api.aiprice.com') throw Error('Unexpected request');
        historyCalls++;
        if (globalThis.delayHistory) await new Promise(resolve => { globalThis.finishHistory = resolve; });
        return new Response(JSON.stringify({ code: 200, success: 1, currency: 'PHP', adid: '72', price_tracking: [{ price: '69.58', time_update: Date.now() / 1000 - 60 }] }));
      };
    });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('.hover-settings > summary').click();
    await popup.locator('#hover-provider').selectOption('aiprice');
    await popup.locator('#enable-hover').click(); await expect(popup.locator('#hover-status')).toContainText('Enabled');
    await popup.close();
    const shop = await context.newPage(), errors = []; shop.on('pageerror', error => errors.push(error.message));
    await shop.goto('https://shopee.ph/search');
    const pageCount = context.pages().length;
    const product = shop.locator('#offers a'), tooltip = shop.locator('#budol-external-price');
    await product.hover(); await shop.waitForTimeout(500); await shop.mouse.move(1000, 600); await shop.waitForTimeout(3100);
    expect(await worker.evaluate(() => historyCalls)).toBe(0);
    await product.hover(); await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toContainText('₱69.58'); await expect(tooltip).toContainText('variant unknown');
    expect(shop.url()).toBe('https://shopee.ph/search'); expect(context.pages()).toHaveLength(pageCount);
    await shop.screenshot({ path: testInfo.outputPath('shopee-price-hover.png') });
    await shop.keyboard.press('Escape'); await expect(tooltip).toBeHidden();
    await shop.mouse.move(1000, 600); await product.hover();
    await expect(tooltip).toBeVisible({ timeout: 5000 }); await expect(tooltip).toContainText('Saved response');
    expect(await worker.evaluate(() => historyCalls)).toBe(1);
    await shop.keyboard.press('Escape');
    await worker.evaluate(() => { globalThis.delayHistory = true; return chrome.storage.local.set({ budolHistoryCooldowns: {} }); });
    await shop.locator('#conditional a').hover();
    await expect.poll(() => worker.evaluate(() => historyCalls)).toBe(2);
    await shop.mouse.move(1000, 600); await expect(tooltip).toBeHidden();
    await worker.evaluate(() => finishHistory()); await shop.waitForTimeout(300); await expect(tooltip).toBeHidden();
    // A dynamically inserted listing works through delegated events, and an old
    // content script fails quietly after an extension reload.
    await shop.evaluate(() => { const link = document.createElement('a'); link.href = '/New-i.123.456'; link.textContent = 'New listing'; link.id = 'new-item'; document.body.append(link); });
    await shop.locator('#new-item').hover(); await expect(tooltip).toBeVisible({ timeout: 5000 }); await expect(tooltip).toContainText('₱69.58');
    await shop.keyboard.press('Escape');
    const closed = worker.waitForEvent('close'); await worker.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); }); await closed;
    await shop.mouse.move(1000, 600); await product.hover(); await shop.waitForTimeout(3200);
    await expect(tooltip).toHaveCount(0); expect(errors).toEqual([]);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
