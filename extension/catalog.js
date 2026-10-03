(() => {
  'use strict';
  const MAX_PRODUCTS = 200;
  const MAX_HISTORY = 90;
  const MAX_MONEY = 100000000; // PHP 1 million, stored in centavos.
  const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

  function productIdentity(raw) {
    try {
      const url = new URL(raw, 'https://shopee.ph');
      if (url.protocol !== 'https:' || !/(^|\.)shopee\.ph$/i.test(url.hostname) || url.username || url.password) return null;
      const match = url.pathname.match(/(?:-i\.(\d+)\.(\d+)|^\/product\/(\d+)\/(\d+))\/?$/);
      if (!match) return null;
      const shop = match[1] || match[3], item = match[2] || match[4];
      return { id: `shopee:${shop}:${item}:listing:PHP`, url: `https://shopee.ph/product/${shop}/${item}` };
    } catch { return null; }
  }

  function money(raw) {
    const text = String(raw).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(amount) && amount <= MAX_MONEY ? amount : null;
  }

  function parsePrice(text) {
    const matches = [...text.matchAll(/(?:₱|PHP\s*)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])/gi)];
    if (matches.length !== 1 || /(?:[-–—]|\bto\b)\s*(?:₱|PHP)?\s*\d/i.test(text)) return null;
    return money(matches[0][1].replaceAll(',', ''));
  }

  function visible(element) {
    if (element.closest('script, style, template, [hidden], [aria-hidden="true"], [data-budol-ignore], del, s')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = element.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.textDecorationLine.includes('line-through')) return false;
    }
    return true;
  }

  function readProduct(card) {
    const links = [card.closest('a[href]'), ...card.querySelectorAll('a[href]')].filter(Boolean);
    const identity = links.map(link => productIdentity(link.getAttribute('href'))).find(Boolean);
    if (!identity) return null;
    const titleNode = [...card.querySelectorAll('[data-sqe="name"], .line-clamp-2, [class*="line-clamp-2"]')].find(visible);
    const title = clean(titleNode?.textContent || card.querySelector('img[alt]')?.getAttribute('alt'), 240) || 'Shopee product';
    // Prefer Shopee's explicit accessible price label; never use discount/cashback numbers.
    const marker = [...card.querySelectorAll('[aria-label="promotion price"], [aria-label="price"]')].find(visible);
    let price = null;
    if (marker) {
      const parent = marker.parentElement.cloneNode(true);
      parent.querySelectorAll('del, s, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
      price = parsePrice(parent.textContent);
    } else {
      const prices = [...card.querySelectorAll('span, div')]
        .filter(node => visible(node) && /₱|PHP/i.test(node.textContent) &&
          ![...node.children].some(child => /₱|PHP/i.test(child.textContent)))
        .map(node => parsePrice(node.textContent));
      const unique = [...new Set(prices)];
      if (unique.length === 1) price = unique[0];
    }
    return { ...identity, title, price, discount: globalThis.Budol.getDiscount(card)?.value ?? null, currency: 'PHP', scope: 'listing' };
  }

  function extractProducts(root) {
    const products = new Map();
    for (const card of globalThis.Budol.findCards(root)) {
      if (!visible(card)) continue;
      const product = readProduct(card);
      if (!product) continue;
      // Conflicting prices for one item on the same page are not a single observation.
      const previous = products.get(product.id);
      if (previous && previous.price !== product.price) product.price = null;
      if (previous && previous.discount !== product.discount) product.discount = null;
      products.set(product.id, product);
      if (products.size >= MAX_PRODUCTS) break;
    }
    return [...products.values()];
  }

  function normalizeProduct(value) {
    const identity = productIdentity(value?.url);
    if (!identity || value.currency !== 'PHP' || value.scope !== 'listing') throw new Error('Unsupported product. Use a Shopee PH listing.');
    if (value.price !== null && (!Number.isSafeInteger(value.price) || value.price < 0 || value.price > MAX_MONEY)) throw new Error('Invalid product price.');
    return { ...identity, title: clean(value.title, 240) || 'Shopee product', price: value.price, currency: 'PHP', scope: 'listing' };
  }

  function observe(saved, product, now) {
    const history = [...saved.history];
    if (product.price !== null) {
      const last = history.at(-1);
      if (!last || last.price !== product.price || last.at.slice(0, 10) !== now.slice(0, 10)) {
        history.push({ price: product.price, at: now });
      }
    }
    return { ...saved, ...product, lastSeen: now, history: history.slice(-MAX_HISTORY) };
  }

  function validateBackup(value) {
    if (value?.version !== 1 || !Array.isArray(value.products) || value.products.length > MAX_PRODUCTS) throw new Error('Expected a Budol v1 backup with at most 200 products.');
    const ids = new Set();
    const date = raw => {
      if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw))) throw new Error('Invalid observation date.');
      return new Date(raw).toISOString();
    };
    const products = value.products.map(raw => {
      const product = normalizeProduct(raw);
      if (ids.has(product.id)) throw new Error('Backup contains duplicate products.');
      ids.add(product.id);
      if (!Array.isArray(raw.history) || raw.history.length > MAX_HISTORY) throw new Error('Invalid price history.');
      const history = raw.history.map(point => {
        if (!Number.isSafeInteger(point.price) || point.price < 0 || point.price > MAX_MONEY) throw new Error('Invalid historical price.');
        return { price: point.price, at: date(point.at) };
      }).sort((a, b) => a.at.localeCompare(b.at));
      return { ...product, collection: clean(raw.collection, 60) || 'Wishlist', notes: clean(raw.notes, 1000), savedAt: date(raw.savedAt), lastSeen: date(raw.lastSeen), history };
    });
    return { version: 1, products };
  }

  function calculate({ price, quantity, shipping, discount, percent, cap, minimum, cashback }) {
    for (const value of [price, shipping, discount, minimum, cashback]) {
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) throw new Error('Enter valid amounts from 0 to 1,000,000 with up to two decimals.');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('Quantity must be a whole number from 1 to 999.');
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || Math.abs(Math.round(percent * 100) - percent * 100) > 1e-8) throw new Error('Voucher percentage must be from 0 to 100 with up to two decimals.');
    if (cap !== null && (!Number.isSafeInteger(cap) || cap < 0 || cap > MAX_MONEY)) throw new Error('Enter a valid voucher cap.');
    const subtotal = price * quantity;
    const eligible = subtotal >= minimum;
    const voucher = eligible ? Math.min(subtotal, discount + Math.min(Math.round(subtotal * percent / 100), cap ?? subtotal)) : 0;
    return { subtotal, voucher, shipping, eligible, total: subtotal - voucher + shipping, cashback };
  }

  globalThis.BudolCatalog = Object.freeze({ MAX_PRODUCTS, MAX_HISTORY, productIdentity, money, parsePrice, readProduct, visible, extractProducts, normalizeProduct, observe, validateBackup, calculate });
})();
