const { test, expect, chromium } = require('@playwright/test');
const { resolve, dirname, basename } = require('node:path');
const { mkdtemp, rm, cp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Shopee test listing</title><style>
  body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
  h1 { font-size: 22px; } main { display: flex; gap: 20px; margin-top: 28px; }
  [aria-label="Product card"] { width: 180px; background: white; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
  .image { height: 150px; display: grid; place-items: center; background: #e5e8e3; color: #607060; }
  .details { padding: 14px; } .discount { font-size: 12px; color: #ee4d2d; background: #fff0eb; padding: 3px; }
  .price { color: #ee4d2d; margin-top: 15px; }
  </style></head><body><h1>Shopee product card test</h1><p>Threshold is at least 50%.</p><main>
  ${[40, 50, 51, 80].map((discount, index) => `<div role="group" aria-label="Product card" id="card-${discount}">
    <a href="/Example-product-i.123.${index + 1}"><div class="image"><img alt="Product ${index + 1}"></div><div class="details"><div class="line-clamp-2">Example product ${index + 1}</div>
    <div class="price"><span aria-label="promotion price"></span><span class="amount">₱299</span></div><span class="discount"><span data-testid="a11y-label" aria-label="-${discount}%"></span>-${discount}%</span><div>Shop voucher 10% off Min spend ₱500</div><div>20% Coins cashback</div></div></a></div>`).join('')}
  </main></body></html>`;

test('installed extension highlights listings and saves popup controls', async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(tmpdir(), 'budol-test-'));
  const extension = resolve(profile, 'extension');
  await cp(resolve(__dirname, '../extension'), extension, { recursive: true, filter: path => basename(path) !== 'discord-local.json' });
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    // Serve a local fixture at the permitted host. No requests are sent to Shopee.
    await context.route('**/*', route => {
      if (route.request().url().startsWith('chrome-extension://')) return route.continue();
      if (route.request().url().startsWith('https://shopee.ph/')) {
        return route.fulfill({ contentType: 'text/html', body: fixture });
      }
      return route.abort();
    });

    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    const item = manager.locator('extensions-item').filter({ hasText: 'Budol' });
    await expect(item).toHaveCount(1);
    const extensionId = await item.getAttribute('id');

    const shop = await context.newPage();
    await shop.goto('https://shopee.ph/test-shop');
    await expect(shop.locator('[data-budol-match]')).toHaveCount(3);
    await expect(shop.locator('#card-50')).toHaveAttribute('data-budol-match');
    await expect(shop.locator('[data-budol-muted]')).toHaveCount(0);
    await expect(shop.locator('#card-51')).toHaveCSS('outline-color', 'rgb(22, 92, 156)');
    await shop.screenshot({ path: testInfo.outputPath('highlighted-listing.png') });

    const popup = await context.newPage();
    const errors = [];
    popup.on('pageerror', error => errors.push(error.message));
    await popup.setViewportSize({ width: 356, height: 590 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#threshold')).toBeEnabled();
    expect(await popup.locator('body').evaluate(body => body.scrollHeight)).toBeLessThanOrEqual(600);
    // Keep the shop as the active tab, as it would be when using the toolbar popup.
    await shop.bringToFront();
    await expect(popup.locator('#status-title')).toHaveText('3 products highlighted');
    await popup.locator('#focus').check();
    await expect(shop.locator('[data-budol-muted]')).toHaveCount(1);
    await expect(shop.locator('#card-40')).toHaveCSS('filter', 'none');
    await expect(shop.locator('#card-40')).toHaveCSS('opacity', '0.55');
    await expect(shop.locator('#card-50')).toHaveCSS('filter', 'none');
    await expect(shop.locator('#card-50')).toHaveCSS('opacity', '1');
    await shop.screenshot({ path: testInfo.outputPath('focused-listing.png') });
    await popup.screenshot({ path: testInfo.outputPath('popup.png'), fullPage: true });

    await popup.locator('#threshold').fill('75');
    await expect(shop.locator('[data-budol-match]')).toHaveCount(1);
    await expect(shop.locator('[data-budol-muted]')).toHaveCount(3);
    await expect(popup.locator('#save-status')).toHaveText('Saved automatically');
    await popup.locator('#threshold').fill('80');
    await expect(shop.locator('[data-budol-match]')).toHaveCount(1);
    await popup.locator('#threshold').fill('50.5');
    await expect(shop.locator('[data-budol-match]')).toHaveCount(2);

    await popup.locator('#enabled').uncheck();
    await expect(shop.locator('[data-budol-match]')).toHaveCount(0);
    await expect(shop.locator('[data-budol-muted]')).toHaveCount(0);
    await expect(shop.locator('#card-40')).toHaveCSS('filter', 'none');
    await expect(shop.locator('#card-40')).toHaveCSS('opacity', '1');
    await popup.reload();
    await expect(popup.locator('#threshold')).toHaveValue('50.5');
    await expect(popup.locator('#enabled')).not.toBeChecked();
    await expect(popup.locator('#focus')).toBeChecked();
    await expect(popup.locator('#focus')).toBeDisabled();
    await popup.locator('#enabled').check();
    await expect(shop.locator('[data-budol-match]')).toHaveCount(2);
    await expect(shop.locator('[data-budol-muted]')).toHaveCount(2);
    await expect(popup.locator('#focus')).toBeEnabled();

    await shop.locator('main').evaluate(main => {
      main.insertAdjacentHTML('beforeend', '<div role="group" aria-label="Product card" id="loaded"><span>-99%</span></div><div role="group" aria-label="Product card" id="no-sale"><span>No discount</span></div>');
    });
    await expect(shop.locator('[data-budol-match]')).toHaveCount(3);
    await expect(shop.locator('#no-sale')).toHaveCSS('filter', 'none');
    await popup.locator('#focus').uncheck();
    await expect(shop.locator('[data-budol-muted]')).toHaveCount(0);
    await expect(shop.locator('[data-budol-match]')).toHaveCount(3);
    await expect(popup.locator('body')).toHaveJSProperty('scrollWidth', 356);

    // Exercise the real popup -> board -> worker -> local-storage flow.
    await shop.bringToFront();
    const boardOpened = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'View discounted products' }).click();
    const board = await boardOpened;
    await board.setViewportSize({ width: 1200, height: 900 });
    board.on('pageerror', error => errors.push(error.message));
    await expect(board.locator('#candidates .candidate')).toHaveCount(2);
    await expect(board.locator('#candidates .candidate').first()).toContainText('80% off');
    const offers = board.locator('#candidates .candidate').first().locator('.offers');
    await offers.locator('summary').focus(); await board.keyboard.press('Enter');
    await expect(offers).toHaveAttribute('open', '');
    await expect(offers).toContainText('one item at the shown price is below');
    await expect(offers).toContainText('does not reduce this payment');
    await board.setViewportSize({ width: 320, height: 800 });
    await expect(board.locator('body')).toHaveJSProperty('scrollWidth', 320);
    await board.screenshot({ path: testInfo.outputPath('offers-mobile.png'), fullPage: true });
    await board.setViewportSize({ width: 1200, height: 900 });
    await offers.locator('summary').click();
    await board.locator('.deal-filter-panel > summary').click();
    await board.getByLabel('Include every keyword', { exact: true }).fill('product 4');
    await expect(board.locator('#candidates .candidate')).toHaveCount(1);
    const csvEvent = board.waitForEvent('download');
    await board.getByRole('button', { name: 'Export filtered deals (CSV)', exact: true }).click();
    const csvDownload = await csvEvent; const csvPath = testInfo.outputPath('deals.csv'); await csvDownload.saveAs(csvPath);
    const csv = await readFile(csvPath, 'utf8');
    expect(csv).toContain('Example product 4'); expect(csv).not.toContain('Example product 3'); expect(csv).toContain('https://shopee.ph/product/123/4');
    expect(csv).toContain('Shop voucher 10% off Min spend ₱500'); expect(csv).toContain('Eligibility unverified');
    await board.getByRole('button', { name: 'Clear product filters', exact: true }).click();
    await expect(board.locator('#candidates .candidate')).toHaveCount(2);
    await board.locator('.deal-filter-panel > summary').click();
    await board.locator('#deal-threshold').fill('80');
    await board.locator('#deal-threshold').press('Tab');
    await expect(board.locator('#candidates .candidate')).toHaveCount(1);
    await expect(popup.locator('#threshold')).toHaveValue('80');
    await expect(shop.locator('[data-budol-match]')).toHaveCount(2);
    await board.locator('#deal-threshold').fill('50.5');
    await board.locator('#deal-threshold').press('Tab');
    await expect(board.locator('#candidates .candidate')).toHaveCount(2);
    await board.getByLabel('Only matching discounts').uncheck();
    await expect(board.locator('#candidates .candidate')).toHaveCount(4);
    await board.getByLabel('Only matching discounts').check();
    await board.locator('#candidates .candidate').first().getByRole('button', { name: 'Save to board' }).click();
    await expect(board.locator('#saved .product')).toHaveCount(1);
    await expect(board.locator('#saved')).toContainText('₱299.00');
    await board.getByText('Collection & notes', { exact: true }).click();
    await board.locator('#saved').getByLabel('Collection', { exact: true }).fill('Desk setup');
    await board.getByLabel('Notes', { exact: true }).fill('Compare before buying <script>');
    await board.getByRole('button', { name: 'Save details' }).click();
    await expect(board.locator('#saved')).toContainText('Desk setup');
    await board.getByRole('button', { name: 'Use price' }).click();
    await expect(board.getByLabel('Shipping (PHP)', { exact: true })).toBeFocused();
    await expect(board.locator('#saved .product')).toHaveClass(/price-selected/);
    await expect(board.locator('.section-nav a[href="#calculator-panel"]')).toHaveAttribute('aria-current', 'location');
    await board.getByLabel('Item price (PHP)', { exact: true }).fill('300');
    await expect(board.locator('#saved .price-selected')).toHaveCount(0);
    await board.getByRole('button', { name: 'Use price' }).click();
    await board.getByRole('button', { name: 'Calculate estimate' }).click();
    await expect(board.getByLabel('Shipping (PHP)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(board.locator('#calc-shipping-error')).toContainText('use 0 for free shipping');
    await board.getByLabel('Shipping (PHP)', { exact: true }).fill('50');
    await board.locator('#voucher-options > summary').click();
    await board.getByLabel('Type', { exact: true }).selectOption('percent');
    await board.getByLabel('Percent off', { exact: true }).fill('10');
    await board.getByLabel('Maximum discount (PHP, optional)', { exact: true }).fill('20');
    await board.getByRole('button', { name: 'Calculate estimate' }).click();
    await expect(board.locator('#estimate strong')).toHaveText('₱329.00');
    await board.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(board.locator('#estimate strong')).toHaveText('₱628.00');
    await board.getByRole('button', { name: 'Decrease quantity' }).click();
    await expect(board.locator('#estimate strong')).toHaveText('₱329.00');
    await board.getByLabel('Shipping (PHP)', { exact: true }).fill('');
    await expect(board.locator('#estimate strong')).toHaveCount(0);
    await board.getByLabel('Shipping (PHP)', { exact: true }).fill('50');
    await expect(board.locator('#estimate strong')).toHaveText('₱329.00');

    // Filtering and page refresh must not erase an unsaved note.
    await board.getByLabel('Notes', { exact: true }).fill('Draft survives filters');
    await board.getByRole('searchbox', { name: 'Search products' }).fill('nothing matches this');
    await expect(board.locator('#saved')).toContainText('No matching products');
    await board.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(board.getByLabel('Notes', { exact: true })).toHaveValue('Draft survives filters');
    board.once('dialog', dialog => dialog.accept());
    await board.reload();
    await expect(board.getByLabel('Notes', { exact: true })).toBeVisible();
    await expect(board.getByLabel('Notes', { exact: true })).toHaveValue('Draft survives filters');
    await board.getByLabel('Notes', { exact: true }).fill('Compare before buying <script>');
    await board.getByRole('button', { name: 'Save details' }).click();

    await board.getByText('Set a price watch', { exact: true }).click();
    await board.getByLabel('Target price (PHP)', { exact: true }).fill('250');
    await board.getByRole('searchbox', { name: 'Search products' }).fill('no match');
    await board.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(board.getByLabel('Target price (PHP)', { exact: true })).toHaveValue('250');
    board.once('dialog', dialog => dialog.accept());
    await board.reload();
    await expect(board.getByLabel('Target price (PHP)', { exact: true })).toHaveValue('250');
    await board.getByRole('button', { name: 'Save watch', exact: true }).click();
    await expect(board.locator('#saved')).toContainText('Price watch · active');
    await shop.locator('#card-80 .amount').evaluate(node => { node.textContent = '₱249'; });
    await expect.poll(async () => board.evaluate(async () => (await chrome.storage.local.get('budolBoard')).budolBoard.products[0].price)).toBe(24900);
    await board.reload();
    await board.locator('#alerts-panel > summary').click();
    await expect(board.locator('#alerts')).toContainText('Target price reached');
    await expect(board.locator('#alerts')).toContainText('Discord: Off');
    await expect(board.locator('#saved')).toContainText('₱249.00');
    await expect(board.locator('#saved')).toContainText('Compare before buying <script>');
    await board.getByText('Price observations (2)', { exact: true }).click();
    await expect(board.locator('#saved tbody tr')).toHaveCount(2);
    await board.getByRole('button', { name: 'Use price' }).click();
    await board.getByLabel('Shipping (PHP)', { exact: true }).fill('50');
    await board.getByRole('button', { name: 'Calculate estimate' }).click();
    await expect(board.locator('#estimate strong')).toHaveText('₱299.00');
    await board.getByRole('button', { name: 'Clear calculator' }).click();
    await expect(board.getByLabel('Item price (PHP)', { exact: true })).toHaveValue('');
    await expect(board.locator('#estimate strong')).toHaveCount(0);
    await expect(board.locator('#saved .price-selected')).toHaveCount(0);
    await board.locator('#candidates [data-compare-id]').nth(0).click();
    await board.locator('#candidates [data-compare-id]').nth(1).click();
    await expect(board.locator('.comparison-card')).toHaveCount(2);
    const comparison = board.locator('.comparison-card').first();
    await expect(comparison.locator('.comparison-total')).toContainText('incomplete');
    await comparison.getByLabel('Shipping (PHP)', { exact: true }).fill('40');
    await comparison.getByLabel('Eligible voucher amount (PHP)', { exact: true }).fill('20');
    await expect(comparison.locator('.comparison-total')).toContainText('₱269.00');
    await board.getByRole('link', { name: 'Deals', exact: true }).click();
    await board.evaluate(() => window.scrollTo(0, 0));
    await board.screenshot({ path: testInfo.outputPath('budol-board.png'), fullPage: true });
    await board.screenshot({ path: testInfo.outputPath('budol-board-preview.png') });
    await board.setViewportSize({ width: 320, height: 844 });
    expect(await board.locator('body').evaluate(body => body.scrollWidth)).toBe(320);
    const tinyControls = await board.locator('button, input, select, textarea, summary').evaluateAll(nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24);
    }).map(node => node.outerHTML));
    expect(tinyControls).toEqual([]);
    await board.screenshot({ path: testInfo.outputPath('budol-board-mobile.png'), fullPage: true });

    await board.getByText('Backups & storage', { exact: true }).click();
    await expect(board.locator('.section-nav a[href="#backup-panel"]')).toHaveAttribute('aria-current', 'location');
    const downloadEvent = board.waitForEvent('download');
    await board.getByRole('button', { name: 'Export backup' }).click();
    const download = await downloadEvent;
    const backupPath = testInfo.outputPath('backup.json'); await download.saveAs(backupPath);
    await board.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(board.locator('#saved .product')).toHaveCount(0);
    await board.getByRole('button', { name: 'Undo removal', exact: true }).click();
    await expect(board.locator('#saved .product')).toHaveCount(1);
    await board.getByRole('button', { name: 'Remove', exact: true }).click();
    await board.getByLabel('Budol JSON backup').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
    await expect(board.getByRole('alert')).toContainText('not valid JSON');
    await expect(board.getByRole('button', { name: 'Import new products' })).toBeDisabled();
    await board.getByLabel('Budol JSON backup').setInputFiles(backupPath);
    await expect(board.locator('#import-preview')).toContainText('1 new products');
    await board.getByRole('button', { name: 'Import new products' }).click();
    await expect(board.locator('#saved')).toContainText('Desk setup');
    await expect(board.locator('#saved')).toContainText('Compare before buying <script>');
    const replacementShop = await context.newPage();
    replacementShop.on('pageerror', error => errors.push(error.message));
    await replacementShop.goto('https://shopee.ph/replacement-shop');
    await expect(replacementShop.locator('[data-budol-match]')).toHaveCount(2);
    await shop.close();
    await board.getByRole('button', { name: 'Refresh products' }).click();
    await expect(board.locator('#source-tab option')).toHaveCount(1);
    await expect(board.locator('#candidates .candidate')).toHaveCount(2);
    // Keyboard entry reaches the skip link and moves into the main workspace.
    await board.reload();
    await board.keyboard.press('Tab');
    await expect(board.getByRole('link', { name: 'Skip to your board' })).toBeFocused();
    await board.keyboard.press('Enter');
    await expect(board.locator('main')).toBeFocused();
    await replacementShop.locator('#card-80 .amount').click({ button: 'right' });
    await replacementShop.keyboard.press('Escape');
    const shareWorker = context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${extensionId}/`));
    const captured = await shareWorker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({ currentWindow: true })) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'BUDOL_CONTEXT_PRODUCT' });
          if (result?.product) return { tabId: tab.id, product: result.product };
        } catch { /* This tab has no Shopee content script. */ }
      }
    });
    expect(captured.product.url).toBe('https://shopee.ph/product/123/4');
    expect(captured.product.discount).toBe(80);
    await shareWorker.evaluate(async tabId => chrome.tabs.sendMessage(tabId, { type: 'BUDOL_DISCORD_STATUS', text: 'Item sent to Discord.' }), captured.tabId);
    await expect(replacementShop.locator('[data-budol-ignore]')).toHaveCount(1);
    const options = await context.newPage();
    options.on('pageerror', error => errors.push(error.message));
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#connection')).toHaveText('No webhook configured.');
    await options.getByLabel('Discord webhook URL').fill('https://example.com/not-a-webhook');
    await options.getByRole('button', { name: 'Save webhook' }).click();
    await expect(options.getByRole('alert')).toContainText('discord.com');
    await options.getByLabel('Discord webhook URL').fill('https://discord.com/api/webhooks/123456789012345678/test_token_that_is_not_a_real_webhook');
    await options.getByRole('button', { name: 'Save webhook' }).click();
    await expect(options.locator('#connection')).toContainText('Webhook configured');
    await expect(options.getByLabel('Discord webhook URL')).toHaveValue('');
    await options.screenshot({ path: testInfo.outputPath('discord-settings.png'), fullPage: true });
    await options.setViewportSize({ width: 320, height: 844 });
    expect(await options.locator('body').evaluate(body => body.scrollWidth)).toBe(320);
    await options.reload();
    await expect(options.locator('#connection')).toContainText('Webhook configured');
    await options.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(options.locator('#connection')).toHaveText('No webhook configured.');
    // Reload Budol while Shopee stays open, then mutate the orphaned page.
    // Its old collector must stop without an uncaught context-invalidated error.
    const worker = context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${extensionId}/`));
    const unloaded = worker.waitForEvent('close', { timeout: 10000 });
    await worker.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); });
    await unloaded;
    await replacementShop.locator('.amount').first().evaluate(node => { node.textContent = '₱199'; });
    await replacementShop.waitForTimeout(1000);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    if (dirname(profile) !== resolve(tmpdir()) || !basename(profile).startsWith('budol-test-')) {
      throw new Error('Refusing to remove a browser profile outside the test temp directory.');
    }
    await rm(profile, { recursive: true, force: true });
  }
});
