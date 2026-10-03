(() => {
  'use strict';
  const menuId = 'budol-send-discord';
  const sending = new Set();
  const recentlySent = new Map();
  let settingsRevision = 0;
  async function setup() {
    const revision = settingsRevision;
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: menuId, title: 'Send item to Discord', contexts: ['page', 'link', 'image', 'selection'], documentUrlPatterns: ['https://*.shopee.ph/*'] });
    // Optional private setup file exists only in the owner's unpacked installation.
    const stored = await chrome.storage.local.get(['budolDiscordWebhook', 'budolDiscordSeeded']);
    if (stored.budolDiscordWebhook || stored.budolDiscordSeeded) return;
    try {
      const response = await fetch(chrome.runtime.getURL('discord-local.json'));
      if (!response.ok) return;
      const seed = await response.json();
      const current = await chrome.storage.local.get(['budolDiscordWebhook', 'budolDiscordSeeded']);
      if (revision !== settingsRevision || current.budolDiscordWebhook || current.budolDiscordSeeded) return;
      await chrome.storage.local.set({ budolDiscordWebhook: BudolDiscord.webhook(seed.webhook), budolDiscordSeeded: true });
    } catch { /* Public packages use the settings page instead. */ }
  }
  chrome.runtime.onInstalled.addListener(() => { setup().catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { setup().catch(() => {}); });
  const trusted = sender => sender.url?.startsWith(chrome.runtime.getURL(''));
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['BUDOL_DISCORD_SETTINGS_GET', 'BUDOL_DISCORD_SETTINGS_SAVE', 'BUDOL_DISCORD_SETTINGS_CLEAR'].includes(message?.type)) return;
    (async () => {
      if (!trusted(sender)) throw new Error('Open Budol settings to change Discord sharing.');
      if (message.type === 'BUDOL_DISCORD_SETTINGS_SAVE') {
        settingsRevision++;
        await chrome.storage.local.set({ budolDiscordWebhook: BudolDiscord.webhook(message.webhook), budolDiscordSeeded: true });
      } else if (message.type === 'BUDOL_DISCORD_SETTINGS_CLEAR') {
        settingsRevision++;
        await chrome.storage.local.set({ budolDiscordWebhook: '', budolDiscordSeeded: true });
      }
      const stored = await chrome.storage.local.get('budolDiscordWebhook');
      return { ok: true, configured: Boolean(stored.budolDiscordWebhook) };
    })().then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  });
  async function status(tabId, frameId, text, error = false, busy = false) {
    const badge = busy ? '…' : error ? '!' : '✓';
    await Promise.allSettled([
      chrome.tabs.sendMessage(tabId, { type: 'BUDOL_DISCORD_STATUS', text, error }, { frameId }),
      chrome.action.setBadgeText({ tabId, text: badge }),
      chrome.action.setBadgeBackgroundColor({ tabId, color: error ? '#a33021' : '#165c9c' }),
      chrome.action.setTitle({ tabId, title: `Budol — ${text}` }),
    ]);
  }
  // Shared by explicit context-menu sends and opted-in price watches. Never retries.
  globalThis.BudolDiscordSend = async (payload, imageBlob = null) => {
    const stored = await chrome.storage.local.get(['budolDiscordWebhook', 'budolDiscordRetryAt']);
    if (!stored.budolDiscordWebhook) throw new Error('Configure Discord in Budol settings.');
    const url = BudolDiscord.webhook(stored.budolDiscordWebhook);
    if (stored.budolDiscordRetryAt > Date.now()) throw new Error('Discord is rate-limiting requests. Try again later.');
    let result;
    let body = JSON.stringify(payload), headers = { 'Content-Type': 'application/json' };
    if (imageBlob) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[imageBlob.type];
      if (!extension || imageBlob.size > 2 * 1024 * 1024) throw new Error('Cached image is invalid. Clear saved images and try again.');
      const filename = `product.${extension}`;
      payload = { ...payload, attachments: [{ id: 0, filename }], embeds: payload.embeds.map((embed, index) => index ? embed : { ...embed, image: { url: `attachment://${filename}` } }) };
      body = new FormData(); body.append('payload_json', JSON.stringify(payload)); body.append('files[0]', imageBlob, filename); headers = {};
    }
    try {
      result = await fetch(url, { method: 'POST', headers, body, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Could not confirm delivery. Check Discord before trying again to avoid a duplicate.'); }
    if (result.status === 429) {
      const data = await result.json().catch(() => ({}));
      const seconds = Math.min(86400, Math.max(1, Number(data.retry_after) || 5));
      await chrome.storage.local.set({ budolDiscordRetryAt: Date.now() + seconds * 1000 });
      throw new Error(`Discord is rate-limiting requests. Try again in ${Math.ceil(seconds)} seconds.`);
    }
    if ([401, 403, 404].includes(result.status)) throw new Error('Discord rejected the webhook. Update it in Budol’s Discord settings.');
    if (!result.ok) throw new Error('Discord could not accept this item. Check the webhook channel and try again. Forum channels need a thread_id in the webhook URL.');
    const receipt = await result.json().catch(() => null);
    if (!receipt?.id) throw new Error('Could not confirm delivery. Check Discord before trying again.');
  };
  async function send(info, tab) {
    if (info.menuItemId !== menuId || !Number.isInteger(tab?.id)) return;
    const tabId = tab.id, frameId = info.frameId || 0;
    if (sending.has(tabId)) return;
    sending.add(tabId);
    try {
      const stored = await chrome.storage.local.get(['budolDiscordWebhook', 'budolDiscordRetryAt']);
      if (!stored.budolDiscordWebhook) {
        await chrome.runtime.openOptionsPage();
        throw new Error('Add your Discord webhook in Budol settings, then right-click the item again.');
      }
      const url = BudolDiscord.webhook(stored.budolDiscordWebhook);
      if (stored.budolDiscordRetryAt > Date.now()) throw new Error(`Discord is rate-limiting requests. Try again in ${Math.ceil((stored.budolDiscordRetryAt - Date.now()) / 1000)} seconds.`);
      let response;
      try { response = await chrome.tabs.sendMessage(tabId, { type: 'BUDOL_CONTEXT_PRODUCT', linkUrl: info.linkUrl }, { frameId }); }
      catch { throw new Error('Refresh Shopee after updating Budol, then right-click the product again.'); }
      if (!response?.product) throw new Error('Right-click a product card, its image or its link on Shopee.');
      const payload = BudolDiscord.payload(response.product);
      const key = `${tabId}:${payload.embeds[0].url}`;
      if (Date.now() - (recentlySent.get(key) || 0) < 10000) throw new Error('This item was just sent. Wait a few seconds before sending it again.');
      await status(tabId, frameId, 'Sending item to Discord…', false, true);
      await globalThis.BudolShareCache?.capture(response.product).catch(() => {});
      const cached = await globalThis.BudolShareCache?.get(BudolCatalog.productIdentity(response.product.url).id).catch(() => null);
      await BudolDiscordSend(payload, cached?.image);
      recentlySent.set(key, Date.now());
      for (const [id, at] of recentlySent) if (Date.now() - at > 10000) recentlySent.delete(id);
      await status(tabId, frameId, 'Item sent to Discord.');
    } catch (error) { await status(tabId, frameId, error.message, true); }
    finally { sending.delete(tabId); }
  }
  chrome.contextMenus.onClicked.addListener((info, tab) => { send(info, tab); });
})();
