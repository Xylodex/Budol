importScripts('catalog.js');
importScripts('discord.js', 'discord-background.js');
importScripts('share-cache.js');
importScripts('history-public-config.js', 'history-providers.js', 'history-background.js');
let pending = Promise.resolve();
let deliveryPending = Promise.resolve();
function serialize(task) {
  const result = pending.then(task);
  pending = result.catch(() => {});
  return result;
}
const empty = () => ({ version: 1, products: [] });
chrome.notifications?.onClicked?.addListener(id => {
  if (id.startsWith('shopee:')) chrome.tabs.create({ url: chrome.runtime.getURL('board.html#alerts-panel') });
});

function dispatchAlerts(alerts) {
  deliveryPending = deliveryPending.then(async () => {
    for (const alert of alerts) {
      let outcome = alert.discord;
      try {
        // Recheck intent at dispatch, after earlier deliveries or board edits finish.
        const eligible = await serialize(async () => {
          const stored = await chrome.storage.local.get(['budolBoard', 'budolAlerts']);
          const watch = stored.budolBoard?.products.find(p => p.id === alert.product.id)?.watch;
          const present = BudolCatalog.normalizeAlerts(stored.budolAlerts).some(row => row.id === alert.id);
          return present && watch && !watch.paused && watch.lastAlertAt === alert.at && watch.mode === alert.watch.mode && watch.target === alert.watch.target ? { discord: watch.discord && alert.watch.discord } : null;
        });
        if (!eligible) outcome = alert.discord === 'Off' ? 'Off' : 'Not sent: watch changed, paused, removed, or alert cleared.';
        else {
          try { await chrome.notifications.create(alert.id, { type: 'basic', iconUrl: 'icons/icon128.png', title: `Budol — ${alert.reason}`, message: `${alert.product.title}: ${BudolCatalog.format(alert.product.price)}` }); } catch { /* The inbox remains available if OS notifications are disabled. */ }
          if (eligible.discord) {
            await BudolDiscordSend(BudolDiscord.payload(alert.product)); outcome = 'Sent';
          } else if (alert.discord !== 'Off') outcome = 'Not sent: Discord alerts were disabled.';
        }
      } catch (error) { outcome = error.message; }
      await serialize(async () => {
        const stored = await chrome.storage.local.get('budolAlerts');
        const inbox = BudolCatalog.normalizeAlerts(stored.budolAlerts);
        const row = inbox.find(row => row.id === alert.id);
        // Clearing history during a send must not bring deleted entries back.
        if (row) { row.discord = outcome; await chrome.storage.local.set({ budolAlerts: inbox }); }
      });
    }
  }).catch(() => { /* Durable unconfirmed receipts remain; never replay a delivery. */ });
}

async function handle(message, sender) {
  const extensionPage = !sender.tab?.url?.startsWith('https:') && sender.url?.startsWith(chrome.runtime.getURL(''));
  const shopPage = /^https:\/\/([a-z0-9-]+\.)*shopee\.ph\//i.test(sender.url || '');
  if (!extensionPage && !(shopPage && message.type === 'BUDOL_OBSERVE')) throw new Error('This action is not available on this page.');
  const stored = (await chrome.storage.local.get('budolBoard')).budolBoard;
  const board = stored ? BudolCatalog.validateBackup(stored) : empty();
  const before = JSON.stringify(board);
  const now = new Date().toISOString();
  const alerts = [];
  const cacheProducts = [];
  switch (message.type) {
    case 'BUDOL_BOARD_GET': return board;
    case 'BUDOL_SAVE': {
      const product = BudolCatalog.normalizeProduct(message.product);
      const index = board.products.findIndex(item => item.id === product.id);
      if (index < 0 && board.products.length >= BudolCatalog.MAX_PRODUCTS) throw new Error('Your board is full (200 products). Export a backup and remove an item first.');
      const saved = index < 0 ? { collection: 'Wishlist', notes: '', savedAt: now, history: [] } : board.products[index];
      const item = BudolCatalog.observe(saved, product, now);
      if (index < 0) board.products.push(item); else board.products[index] = item;
      cacheProducts.push(product);
      break;
    }
    case 'BUDOL_OBSERVE': {
      if (!Array.isArray(message.products) || message.products.length > BudolCatalog.MAX_PRODUCTS) throw new Error('Invalid page observations.');
      const observations = new Map(message.products.map(raw => { const product = BudolCatalog.normalizeProduct(raw); return [product.id, product]; }));
      board.products = board.products.map(saved => {
        const product = observations.get(saved.id);
        if (!product) return saved;
        // Avoid a storage-change -> scan -> write feedback loop for unchanged cards.
        const trigger = BudolCatalog.watchMatches(saved, product, now);
        if (!trigger && JSON.stringify(BudolCatalog.normalizeProduct(saved)) === JSON.stringify(product) && saved.lastSeen.slice(0, 10) === now.slice(0, 10)) return saved;
        const updated = BudolCatalog.observe(saved, product, now);
        cacheProducts.push(product);
        if (trigger) {
          updated.watch = { ...saved.watch, lastAlertAt: now, lastAlertPrice: product.price };
          alerts.push({ id: `${product.id}:${now}`, product, at: now, reason: saved.watch.mode === 'target' ? 'Target price reached' : 'New observed low', watch: updated.watch, discord: saved.watch.discord ? 'Delivery not confirmed; check Discord before sending manually.' : 'Off' });
        }
        return updated;
      });
      break;
    }
    case 'BUDOL_EDIT': {
      const item = board.products.find(item => item.id === message.id);
      if (!item) throw new Error('This product is no longer saved. Refresh the board.');
      item.collection = String(message.collection || 'Wishlist').trim().slice(0, 60) || 'Wishlist';
      item.notes = String(message.notes || '').trim().slice(0, 1000);
      break;
    }
    case 'BUDOL_VARIANT': {
      const item = board.products.find(item => item.id === message.id);
      if (!item) throw new Error('This product is no longer saved.');
      if (message.variant === null) item.variant = null;
      else {
        const price = BudolCatalog.money(message.variant?.price);
        const name = String(message.variant?.name || '').trim().slice(0, 100);
        if (!name || price === null) throw new Error('Enter a variant name and a valid PHP price.');
        item.variant = { name, price, at: now };
      }
      break;
    }
    case 'BUDOL_WATCH': {
      const item = board.products.find(item => item.id === message.id);
      if (!item) throw new Error('This product is no longer saved.');
      if (message.watch === null) item.watch = null;
      else {
        const config = message.watch;
        if (config.discord && !(await chrome.storage.local.get('budolDiscordWebhook')).budolDiscordWebhook) throw new Error('Configure a Discord webhook in settings before enabling Discord alerts.');
        item.watch = BudolCatalog.normalizeWatch({ ...item.watch, mode: config.mode, target: config.mode === 'target' ? BudolCatalog.money(config.target) : null, paused: config.paused === true, discord: config.discord === true, createdAt: item.watch?.createdAt || now });
      }
      break;
    }
    case 'BUDOL_ALERTS_CLEAR': await chrome.storage.local.set({ budolAlerts: [] }); break;
    case 'BUDOL_REMOVE': board.products = board.products.filter(item => item.id !== message.id); break;
    case 'BUDOL_IMPORT': {
      const incoming = BudolCatalog.validateBackup(message.board);
      const ids = new Set(board.products.map(item => item.id));
      const additions = incoming.products.filter(item => !ids.has(item.id));
      if (board.products.length + additions.length > BudolCatalog.MAX_PRODUCTS) throw new Error('Import would exceed the 200-product limit.');
      board.products.push(...additions.map(item => ({ ...item, watch: item.watch ? { ...item.watch, paused: true, discord: false } : null }))); // Imports never enable automatic posting.
      break;
    }
    default: throw new Error('Unknown Budol action.');
  }
  if (alerts.length) {
    const inbox = BudolCatalog.normalizeAlerts((await chrome.storage.local.get('budolAlerts')).budolAlerts);
    // Persist the claim and receipt placeholder together before any external effect.
    await chrome.storage.local.set({ budolBoard: board, budolAlerts: [...inbox, ...alerts].slice(-100) });
    dispatchAlerts(alerts);
  } else if (JSON.stringify(board) !== before) await chrome.storage.local.set({ budolBoard: board });
  // Image I/O runs outside the board writer so slow downloads cannot block editing.
  for (const product of cacheProducts) BudolShareCache.capture(product).catch(() => {});
  return board;
}

async function mcpDiscord(message, sender) {
  if (sender.url !== chrome.runtime.getURL('mcp.html') || !/^[a-f0-9-]{36}$/.test(message.requestId || '')) throw new Error('Open the Budol MCP connector to use this action.');
  const cached = message.cachedUrl ? await savedSnapshot(message.cachedUrl) : null;
  const product = BudolCatalog.normalizeProduct(cached ? cached.product : message.product);
  await serialize(async () => {
    const stored = await chrome.storage.local.get('budolMcpReceipts');
    const receipts = Array.isArray(stored.budolMcpReceipts) ? stored.budolMcpReceipts.filter(row => row && typeof row.at === 'number').slice(-99) : [];
    if (receipts.some(row => row.id === message.requestId || row.url === product.url && Date.now() - row.at < 60000)) throw new Error('This item was recently submitted through MCP. Check Discord before retrying.');
    // Persist before posting, including uncertain outcomes. Restarts never replay sends.
    receipts.push({ id: message.requestId, url: product.url, at: Date.now() });
    await chrome.storage.local.set({ budolMcpReceipts: receipts });
  });
  if (cached) await sendSnapshot(cached);
  else {
    await BudolShareCache.capture(product).catch(() => {});
    await BudolDiscordSend(BudolDiscord.payload(product));
  }
  return { ok: true };
}
async function savedSnapshot(url) {
  const identity = BudolCatalog.productIdentity(url);
  if (!identity) throw new Error('Use a Shopee PH product URL.');
  const cached = await BudolShareCache.get(identity.id).catch(() => null);
  if (cached) return cached;
  const stored = (await chrome.storage.local.get('budolBoard')).budolBoard;
  const product = stored && BudolCatalog.validateBackup(stored).products.find(item => item.id === identity.id);
  if (!product) throw new Error('No saved or cached snapshot. Save this product while it is visible on Shopee first.');
  return { product, at: product.lastSeen, image: null };
}
async function sendSnapshot(snapshot) {
  const payload = BudolDiscord.payload(snapshot.product);
  // Cached sends never ask Discord or the browser to fetch a Shopee image URL.
  delete payload.embeds[0].image;
  payload.embeds[0].footer.text = `Budol • Saved snapshot from ${new Date(snapshot.at).toISOString()} • Prices/offers may have changed`;
  if (!snapshot.image) payload.embeds[0].fields.push({ name: 'Image', value: 'No local image saved. Shared as text.' });
  await BudolDiscordSend(payload, snapshot.image);
}
const savedSends = new Set();
async function cacheAction(message, sender) {
  if (![chrome.runtime.getURL('board.html'), chrome.runtime.getURL('mcp.html')].includes((sender.url || '').split(/[?#]/)[0])) throw new Error('Open Budol to manage saved shares.');
  if (message.type === 'BUDOL_CACHE_LIST') return { ok: true, cache: await BudolShareCache.list() };
  if (message.type === 'BUDOL_CACHE_CLEAR') {
    if (sender.url.split(/[?#]/)[0] !== chrome.runtime.getURL('board.html') || !['images', 'all'].includes(message.scope)) throw new Error('Open Backups & storage to clear the cache.');
    return { ok: true, cache: await BudolShareCache.clear(message.scope === 'images') };
  }
  const identity = BudolCatalog.productIdentity(message.url);
  if (!identity) throw new Error('Use a Shopee PH product URL.');
  if (savedSends.has(identity.id)) throw new Error('This item is already being sent.');
  savedSends.add(identity.id);
  try {
    // Use the same persistent claim path as MCP; preserve the actual trusted caller check above.
    await mcpDiscord({ cachedUrl: identity.url, requestId: message.requestId }, { url: chrome.runtime.getURL('mcp.html') });
    return { ok: true };
  } finally { savedSends.delete(identity.id); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['BUDOL_CACHE_LIST', 'BUDOL_CACHE_CLEAR', 'BUDOL_SEND_SAVED'].includes(message?.type)) {
    cacheAction(message, sender).then(respond, error => respond({ ok: false, error: error.message })); return true;
  }
  if (message?.type === 'BUDOL_MCP_DISCORD') {
    mcpDiscord(message, sender).then(respond, error => respond({ ok: false, error: error.message })); return true;
  }
  if (!['BUDOL_BOARD_GET', 'BUDOL_SAVE', 'BUDOL_OBSERVE', 'BUDOL_EDIT', 'BUDOL_REMOVE', 'BUDOL_IMPORT', 'BUDOL_VARIANT', 'BUDOL_WATCH', 'BUDOL_ALERTS_CLEAR'].includes(message?.type)) return;
  // One writer prevents concurrent tabs from losing each other's saves.
  serialize(() => handle(message, sender)).then(board => respond({ ok: true, board }), error => respond({ ok: false, error: error.message }));
  return true;
});
