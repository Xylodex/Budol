const { test, expect, chromium } = require('@playwright/test');
const { resolve, basename } = require('node:path');
const { mkdtemp, rm, cp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');

test('saved item shares its persisted image with Shopee closed and cache controls preserve the board', async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(tmpdir(), 'budol-offline-'));
  const extension = resolve(profile, 'extension');
  const photo = 'https://down-ph.img.susercontent.com/file/budol-test-image';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=', 'base64');
  let context, offline = false, imageRequests = 0, shopeeRequests = 0;
  const errors = [];
  await cp(resolve(__dirname, '../extension'), extension, { recursive: true, filter: path => !['discord-local.json', 'mcp-local.json'].includes(basename(path)) });
  const html = (await readFile(resolve(__dirname, '../tests/fixtures/shopee-offers.html'), 'utf8')).replace('<img alt="Keyboard">', `<img alt="Keyboard" src="${photo}">`);
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP discord.com ~NOTFOUND'] });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('chrome-extension://')) return route.continue();
      if (url === photo) { imageRequests++; return offline ? route.abort() : route.fulfill({ contentType: 'image/png', body: png }); }
      if (url.startsWith('https://shopee.ph/')) { shopeeRequests++; return offline ? route.abort() : route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }); }
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // Restored extension workers can bypass Playwright routing. Stub only the test
    // worker's transport and fail closed for real Discord via DNS above.
    await worker.evaluate(offline => {
      globalThis.testPosts = []; globalThis.testShopRequests = 0;
      const original = fetch;
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://discord.com/')) {
          const multipart = options.body instanceof FormData;
          const file = multipart ? options.body.get('files[0]') : null;
          globalThis.testPosts.push({ multipart, payload: JSON.parse(multipart ? options.body.get('payload_json') : options.body), bytes: file ? [...new Uint8Array(await file.arrayBuffer())] : null });
          return new Response('{"id":"mock-post"}', { status: 200 });
        }
        if (offline && /shopee\.ph|susercontent\.com/.test(String(url))) { globalThis.testShopRequests++; throw new Error('Shopee offline'); }
        return original(url, options);
      };
    }, offline);
    return worker;
  }
  try {
    let worker = await launch(); const id = new URL(worker.url()).host;
    const shop = await context.newPage(); await shop.goto('https://shopee.ph/cache-test');
    let board = await context.newPage(); await board.goto(`chrome-extension://${id}/board.html`);
    await board.getByLabel('Only matching discounts').uncheck();
    const candidate = board.locator('#candidates .candidate').filter({ has: board.getByRole('link', { name: 'Keyboard', exact: true }) });
    await candidate.getByRole('button', { name: 'Save to board', exact: true }).click();
    await expect(board.locator('#saved .product')).toHaveCount(1);
    await expect.poll(() => board.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'BUDOL_CACHE_LIST' })).cache.imageBytes)).toBe(png.length);
    await worker.evaluate(() => chrome.storage.local.set({ budolDiscordWebhook: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz' }));
    await context.close(); offline = true; worker = await launch();
    const imagesBefore = imageRequests, pagesBefore = shopeeRequests;
    board = await context.newPage(); board.on('pageerror', error => errors.push(error.message));
    await board.goto(`chrome-extension://${id}/board.html`);
    await expect(board.locator('#saved .product')).toHaveCount(1);
    await board.locator('#saved').getByRole('button', { name: 'Send to Discord', exact: true }).click();
    await expect(board.locator('#notice')).toHaveText('Saved snapshot sent to Discord.');
    const posts = await worker.evaluate(() => globalThis.testPosts);
    expect(posts.length).toBe(1); expect(posts[0].multipart).toBe(true);
    expect(Buffer.from(posts[0].bytes).equals(png)).toBe(true); expect(posts[0].payload.embeds[0].image.url).toBe('attachment://product.png');
    expect(JSON.stringify(posts[0].payload)).toContain('Saved snapshot'); expect(JSON.stringify(posts[0].payload)).toContain('Min. spend');
    expect(imageRequests).toBe(imagesBefore); expect(shopeeRequests).toBe(pagesBefore);
    await board.locator('#backup-panel > summary').click();
    await expect(board.locator('#cache-usage')).toContainText('1/200 snapshots');
    await board.getByRole('button', { name: 'Clear saved images', exact: true }).click();
    await expect(board.locator('#cache-usage')).toContainText('1/200 snapshots · 0.00 / 32 MiB');
    await expect(board.locator('#cache-items')).toContainText('Image cleared');
    await expect(board.locator('#saved .product')).toHaveCount(1);
    await board.getByRole('button', { name: 'Clear share cache', exact: true }).click();
    await expect(board.locator('#cache-usage')).toContainText('0/200 snapshots');
    await expect(board.locator('#saved .product')).toHaveCount(1);
    await worker.evaluate(async () => { const stored = await chrome.storage.local.get('budolMcpReceipts'); await chrome.storage.local.set({ budolMcpReceipts: stored.budolMcpReceipts.map(row => ({ ...row, id: 'expired-request', at: Date.now() - 61000 })) }); });
    await board.locator('#saved').getByRole('button', { name: 'Send to Discord', exact: true }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.testPosts.length)).toBe(2);
    const finalPost = await worker.evaluate(() => globalThis.testPosts[1]);
    expect(finalPost.multipart).toBe(false); expect(finalPost.payload.embeds[0].image).toBeUndefined();
    expect(await worker.evaluate(() => globalThis.testShopRequests)).toBe(0);
    expect(imageRequests).toBe(imagesBefore); expect(shopeeRequests).toBe(pagesBefore);
    await board.setViewportSize({ width: 320, height: 850 }); await expect(board.locator('body')).toHaveJSProperty('scrollWidth', 320);
    await board.screenshot({ path: testInfo.outputPath('offline-storage.png'), fullPage: true }); expect(errors).toEqual([]);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); }
});
