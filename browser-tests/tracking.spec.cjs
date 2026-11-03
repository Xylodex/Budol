const { test, expect, chromium } = require('@playwright/test');
const { resolve, basename } = require('node:path');
const { mkdtemp, rm, cp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');

test('options parcel tracking saves, refreshes, handles verification and keeps scans offline', async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(tmpdir(), 'budol-parcels-')), extension = resolve(profile, 'extension');
  let context;
  await cp(resolve(__dirname, '../extension'), extension, { recursive: true, filter: path => !['discord-local.json', 'mcp-local.json'].includes(basename(path)) });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Only the test copy pregrants hosts. Real installs request access from Refresh.
  manifest.host_permissions.push('https://spx.ph/*', 'https://ylofficialjw.jtexpress.ph/*', 'https://www.lbcexpress.com/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP spx.ph ~NOTFOUND, MAP ylofficialjw.jtexpress.ph ~NOTFOUND, MAP www.lbcexpress.com ~NOTFOUND'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    await worker.evaluate(() => {
      globalThis.trackingCalls = []; globalThis.trackingOffline = false;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async url => {
        if (new URL(url).protocol === 'chrome-extension:') return originalFetch(url);
        trackingCalls.push(url);
        if (trackingOffline) throw Error('offline');
        const u = new URL(url);
        if (u.host === 'ylofficialjw.jtexpress.ph') return Response.json({ code: 1, data: true });
        if (u.host === 'spx.ph') return Response.json({ retcode: 0, data: { order_info: { sls_tn: u.searchParams.get('spx_tn'), tracking_code_subgroup_name: 'In transit' }, sls_tracking_info: { records: [
          { description: 'Parcel arrived at the delivery hub', actual_time: 1793617200 },
          { description: '<img src=x onerror=alert(1)> Parcel picked up', actual_time: 1793530800 },
        ] } } });
        throw Error('Unexpected request');
      };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`chrome-extension://${id}/options.html`);
    await expect(page.getByText('No saved parcels.')).toBeVisible();
    const add = async (carrier, number, label) => {
      await page.locator('#parcel-carrier').selectOption(carrier); await page.locator('#parcel-number').fill(number); await page.locator('#parcel-label').fill(label);
      await page.getByRole('button', { name: 'Save parcel', exact: true }).click();
      await expect(page.locator('#parcel-status')).toContainText('Parcel saved');
    };
    await add('spx', 'SPXPH123456789', 'Display cabinet');
    expect(await worker.evaluate(() => trackingCalls.length)).toBe(0);
    const cabinet = page.getByRole('article', { name: 'Display cabinet' });
    await cabinet.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(cabinet.locator('.parcel-state')).toHaveText('In transit');
    await cabinet.getByText('Scan history (2)', { exact: true }).click();
    await expect(cabinet).toContainText('Parcel arrived at the delivery hub');
    await expect(cabinet.locator('img')).toHaveCount(0);
    await expect(cabinet).toContainText('<img src=x onerror=alert(1)>');
    await expect(cabinet.getByRole('link', { name: 'Open official tracker' })).toHaveAttribute('href', 'https://spx.ph/track?SPXPH123456789');
    const beforeReload = await worker.evaluate(() => trackingCalls.length);
    await page.reload(); await expect(cabinet.locator('.parcel-state')).toHaveText('In transit');
    expect(await worker.evaluate(() => trackingCalls.length)).toBe(beforeReload);
    await worker.evaluate(() => { globalThis.trackingOffline = true; return chrome.storage.local.set({ budolTrackingCooldowns: {} }); });
    await cabinet.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(cabinet).toContainText('refresh failed'); await expect(cabinet).toContainText('cached scans are still available');
    await worker.evaluate(() => { globalThis.trackingOffline = false; });
    await add('jt', '123456789012', 'Bookshelf');
    const jt = page.getByRole('article', { name: 'Bookshelf' });
    await jt.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(jt).toContainText('CAPTCHA verification');
    expect(await worker.evaluate(() => trackingCalls.filter(url => url.includes('jtexpress')).length)).toBe(1);
    await add('ninja', 'NINJAPH12345', 'Monitor arm');
    const ninja = page.getByRole('article', { name: 'Monitor arm' });
    await expect(ninja.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
    await expect(ninja.getByRole('link', { name: 'Open official tracker' })).toHaveAttribute('href', 'https://www.ninjavan.co/en-ph/tracking?id=NINJAPH12345');
    // Permission refusal remains actionable and never calls a provider.
    await page.evaluate(() => { chrome.permissions.request = async () => false; });
    const beforeDenial = await worker.evaluate(() => trackingCalls.length);
    await cabinet.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('#parcel-error')).toContainText('access was not granted');
    expect(await worker.evaluate(() => trackingCalls.length)).toBe(beforeDenial);
    await page.reload();
    await cabinet.getByText('Scan history (2)', { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('parcels-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('parcels-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Clear cached scans', exact: true }).click();
    await expect(page.locator('#parcel-status')).toContainText('Tracking numbers kept');
    await expect(page.locator('.parcel-card')).toHaveCount(3);
    await expect(page.locator('.parcel-card details')).toHaveCount(0);
    await expect(page.locator('.parcel-warning')).toHaveCount(0);
    await ninja.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.parcel-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear saved parcels', exact: true }).click();
    await expect(page.locator('.parcel-card')).toHaveCount(0);
    await page.reload(); await expect(page.locator('#parcel-list')).toContainText('No saved parcels');
    await worker.evaluate(() => chrome.storage.local.set({ budolParcels: { broken: true } }));
    await expect(page.locator('#parcel-error')).toContainText('storage is unreadable');
    await page.getByRole('button', { name: 'Clear saved parcels', exact: true }).click();
    await expect(page.locator('#parcel-status')).toContainText('Saved parcels and scans cleared');
    expect(errors).toEqual([]);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
