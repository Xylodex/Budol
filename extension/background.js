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
        if (JSON.stringify(BudolCatalog.normalizeProduct(saved)) === JSON.stringify(product) && saved.lastSeen.slice(0, 10) === now.slice(0, 10)) return saved;
        return BudolCatalog.observe(saved, product, now);
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
    case 'BUDOL_REMOVE': board.products = board.products.filter(item => item.id !== message.id); break;
    case 'BUDOL_IMPORT': {
      const incoming = BudolCatalog.validateBackup(message.board);
      const ids = new Set(board.products.map(item => item.id));
      const additions = incoming.products.filter(item => !ids.has(item.id));
      if (board.products.length + additions.length > BudolCatalog.MAX_PRODUCTS) throw new Error('Import would exceed the 200-product limit.');
      board.products.push(...additions); // Preserve current notes/history for existing items.
      break;
    }
    default: throw new Error('Unknown Budol action.');
  }
  if (JSON.stringify(board) !== before) await chrome.storage.local.set({ budolBoard: board });
  return board;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['BUDOL_BOARD_GET', 'BUDOL_SAVE', 'BUDOL_OBSERVE', 'BUDOL_EDIT', 'BUDOL_REMOVE', 'BUDOL_IMPORT', 'BUDOL_VARIANT'].includes(message?.type)) return;
  // One writer prevents concurrent tabs from losing each other's saves.
  pending = pending.then(() => handle(message, sender));
  pending.then(board => respond({ ok: true, board }), error => respond({ ok: false, error: error.message }));
  pending = pending.catch(() => {});
  return true;
});
