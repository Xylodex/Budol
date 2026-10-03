importScripts('catalog.js');
importScripts('discord.js', 'discord-background.js');
let pending = Promise.resolve();
const empty = () => ({ version: 1, products: [] });

async function handle(message, sender) {
  const extensionPage = !sender.tab?.url?.startsWith('https:') && sender.url?.startsWith(chrome.runtime.getURL(''));
  const shopPage = /^https:\/\/([a-z0-9-]+\.)*shopee\.ph\//i.test(sender.url || '');
  if (!extensionPage && !(shopPage && message.type === 'BUDOL_OBSERVE')) throw new Error('This action is not available on this page.');
  const stored = (await chrome.storage.local.get('budolBoard')).budolBoard;
  const board = stored ? BudolCatalog.validateBackup(stored) : empty();
  const before = JSON.stringify(board);
  const now = new Date().toISOString();
  const alerts = [];
  switch (message.type) {
    case 'BUDOL_BOARD_GET': return board;
    case 'BUDOL_SAVE': {
      const product = BudolCatalog.normalizeProduct(message.product);
      const index = board.products.findIndex(item => item.id === product.id);
      if (index < 0 && board.products.length >= BudolCatalog.MAX_PRODUCTS) throw new Error('Your board is full (200 products). Export a backup and remove an item first.');
      const saved = index < 0 ? { collection: 'Wishlist', notes: '', savedAt: now, history: [] } : board.products[index];
      const item = BudolCatalog.observe(saved, product, now);
      if (index < 0) board.products.push(item); else board.products[index] = item;
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
        if (trigger) {
          updated.watch = { ...saved.watch, lastAlertAt: now, lastAlertPrice: product.price };
          alerts.push({ id: `${product.id}:${now}`, product, at: now, reason: saved.watch.mode === 'target' ? 'Target price reached' : 'New observed low', discord: saved.watch.discord ? 'Delivery not confirmed; check Discord before sending manually.' : 'Off' });
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
    const inbox = (await chrome.storage.local.get('budolAlerts')).budolAlerts || [];
    // Persist the claim and receipt placeholder together before any external effect.
    await chrome.storage.local.set({ budolBoard: board, budolAlerts: [...inbox, ...alerts].slice(-100) });
    for (const alert of alerts) {
      try { await chrome.notifications.create(alert.id, { type: 'basic', iconUrl: 'icons/icon128.png', title: `Budol — ${alert.reason}`, message: `${alert.product.title}: ${BudolCatalog.format(alert.product.price)}` }); } catch { /* The local inbox remains available when OS notifications are disabled. */ }
      if (alert.discord !== 'Off') {
        try { await BudolDiscordSend(BudolDiscord.payload(alert.product)); alert.discord = 'Sent'; }
        catch (error) { alert.discord = error.message; }
      }
    }
    await chrome.storage.local.set({ budolAlerts: [...inbox, ...alerts].slice(-100) });
  } else if (JSON.stringify(board) !== before) await chrome.storage.local.set({ budolBoard: board });
  return board;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['BUDOL_BOARD_GET', 'BUDOL_SAVE', 'BUDOL_OBSERVE', 'BUDOL_EDIT', 'BUDOL_REMOVE', 'BUDOL_IMPORT', 'BUDOL_VARIANT', 'BUDOL_WATCH', 'BUDOL_ALERTS_CLEAR'].includes(message?.type)) return;
  // One writer prevents concurrent tabs from losing each other's saves.
  pending = pending.then(() => handle(message, sender));
  pending.then(board => respond({ ok: true, board }), error => respond({ ok: false, error: error.message }));
  pending = pending.catch(() => {});
  return true;
});
