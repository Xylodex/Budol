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

  function parseRange(text) {
    const amount = '((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)';
    const match = String(text).trim().match(new RegExp('^(?:₱|PHP)\\s*' + amount + '\\s*(?:[-–—]|to)\\s*(?:₱|PHP)?\\s*' + amount + '$', 'i'));
    if (!match) return null;
    const min = money(match[1].replaceAll(',', '')), max = money(match[2].replaceAll(',', ''));
    return min !== null && max !== null && min <= max ? { min, max } : null;
  }
  function metadata(card) {
    const pick = selector => clean([...card.querySelectorAll(selector)].find(visible)?.textContent, 160);
    const labels = [...card.querySelectorAll('[aria-label]')].filter(visible).map(n => n.getAttribute('aria-label'));
    const ratingText = pick('[data-sqe="rating"], [data-testid="rating"]') || labels.find(s => /^(?:rated?\s*)?[0-5](?:\.\d+)?\s*(?:out of 5|\/\s*5|stars?)$/i.test(s)) || '';
    const ratingMatch = ratingText.match(/^(?:rated?\s*)?([0-5](?:\.\d+)?)\s*(?:(?:out of 5|\/\s*5|stars?))?$/i);
    const ratingValue = ratingMatch && Number(ratingMatch[1]) <= 5 ? Number(ratingMatch[1]) : null;
    const texts = [...card.querySelectorAll('span, div, small')].filter(n => !n.children.length && visible(n) && !n.closest('[data-sqe="name"], [class*="line-clamp-2"]')).map(n => clean(n.textContent, 160));
    const soldText = texts.find(s => /^\d[\d,.]*\s*[km]?\+?\s+sold$/i.test(s)) || '';
    const soldMatch = soldText.match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([km])?(\+)?\s+sold$/i);
    const count = soldMatch && (!soldMatch[1].includes('.') || soldMatch[2]) ? Number(soldMatch[1].replaceAll(',', '')) * ({ k: 1000, m: 1000000 }[soldMatch[2]?.toLowerCase()] || 1) : null;
    const soldValue = Number.isSafeInteger(count) && count >= 0 && count <= 1000000000 ? count : null;
    return { ratingValue, soldValue, soldText, seller: pick('[data-sqe="shop-name"], [data-testid="shop-name"]'), location: pick('[data-sqe="location"], [data-testid="location"]') };
  }

  const OFFER_NAMES = Object.freeze({ voucher: 'Voucher', shipping: 'Shipping offer', cashback: 'Cashback / Coins', bundle: 'Bundle deal', addon: 'Add-on deal', flash: 'Flash deal', payment: 'Payment offer', channel: 'Live / Video offer', campaign: 'Campaign offer' });
  function parseOffer(raw, scope = 'item-card') {
    if (typeof raw !== 'string' || raw.length > 400) return null;
    const text = raw.replace(/\s+/g, ' ').trim();
    let kind = null;
    if (/cashback|\bcoins?\s*(?:reward|back|cashback)|\b(?:earn|get)\s+(?:up to\s+)?\d+\s*coins?/i.test(text)) kind = 'cashback';
    else if (/free shipping|shipping (?:voucher|discount|offer)|(?:voucher|discount) (?:on|for) shipping/i.test(text)) kind = 'shipping';
    else if (/\b(?:spaylater|shopeepay|bank|credit card|payment)\b.*(?:voucher|off|discount|deal|promo)|(?:voucher|off|discount|deal|promo).*\b(?:spaylater|shopeepay|bank|credit card|payment)\b/i.test(text)) kind = 'payment';
    else if (/\b(?:live|video)\b.*(?:voucher|off|discount|only)|(?:voucher|off|discount).*\b(?:live|video)\b/i.test(text)) kind = 'channel';
    else if (/\badd[- ]on (?:deal|discount|offer)|buy.*(?:free gift|gift with purchase)/i.test(text)) kind = 'addon';
    else if (/bundle deal|\b(?:buy|any)\s+\d+.*(?:off|save|discount|get)|buy (?:one|\d+) get (?:one|\d+)/i.test(text)) kind = 'bundle';
    else if (/flash (?:deal|sale)/i.test(text)) kind = 'flash';
    else if (/voucher|coupon/i.test(text)) kind = 'voucher';
    else if (/^(?:up to\s+\d+(?:\.\d+)?%\s*off|\d{1,2}\.\d{1,2}\s+.*sale)/i.test(text)) kind = 'campaign';
    if (!kind) return null;
    const amount = '((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)(?![\\d.,])';
    const readAmount = prefix => {
      const match = text.match(new RegExp(prefix + '\\s*[:.]?\\s*(?:₱|PHP)\\s*' + amount, 'i'));
      return match ? money(match[1].replaceAll(',', '')) : null;
    };
    const minimum = readAmount('(?:min(?:imum)?\\.?\\s*(?:spend|purchase))');
    const cap = readAmount('(?:capped at|cap(?:ped)?|max(?:imum)?\\.?\\s*(?:discount|cashback))');
    const restrictions = [];
    for (const [pattern, label] of [[/new user|first (?:order|purchase)/i, 'New users / first order'], [/\bapp[- ]only|on (?:the )?app/i, 'App only'], [/\bclaimed|claim (?:this|now|voucher)/i, 'Claim required'], [/selected (?:items|products|shops|sellers)/i, 'Selected items or shops'], [/limited redemption|while stocks last|limited stock/i, 'Limited availability']]) if (pattern.test(text)) restrictions.push(label);
    const unavailable = /\bexpired|fully redeemed|not applicable|not eligible|unavailable|starts? (?:in|on|at)\b/i.test(text);
    return { kind, text, scope: scope === 'product-page' ? scope : 'item-card', minimum, cap, restrictions, status: unavailable ? 'Check availability' : 'Eligibility unverified' };
  }
  function normalizeOffers(raw) {
    if (!Array.isArray(raw)) return [];
    const offers = raw.slice(0, 24).map(value => parseOffer(value?.text, value?.scope)).filter(Boolean);
    return [...new Map(offers.map(offer => [`${offer.kind}:${offer.text.toLowerCase()}`, offer])).values()].slice(0, 12);
  }
  function visibleText(node, cache = new WeakMap()) {
    if (!cache.has(node)) cache.set(node, [...node.childNodes].map(child => child.nodeType === 3 ? child.textContent : child.nodeType === 1 && visible(child) && !child.matches('script, style, template, [data-sqe="name"], [class*="line-clamp-2"], h1') ? visibleText(child, cache) : '').join(' ').replace(/\s+/g, ' ').trim());
    return cache.get(node);
  }
  function readOffers(root, scope = 'item-card') {
    const texts = [];
    const excluded = '[data-sqe="name"], [class*="line-clamp-2"], h1, script, style, template, [data-budol-ignore]';
    const cache = new WeakMap();
    const textOf = node => visibleText(node, cache);
    const combinedOffers = node => [...node.children].filter(child => parseOffer(textOf(child), scope)).length > 1;
    for (const node of root.querySelectorAll('span, div, small, p, li, [aria-label]')) {
      if (!visible(node) || node.closest(excluded) || combinedOffers(node) || node.querySelector('h1, [data-sqe="name"], [class*="line-clamp-2"], input, [aria-label="Product card"]')) continue;
      if (scope === 'product-page' && node.closest('[aria-label="Product card"], [data-sqe="item"], .shopee-item-card')) continue;
      let text = node.getAttribute('aria-label') || textOf(node);
      if (!parseOffer(text, scope)) continue;
      for (let parent = node.parentElement, depth = 0; parent && parent !== root && depth < 2; parent = parent.parentElement, depth++) {
        if (parent.querySelector('img, h1, input, [data-sqe="name"], [class*="line-clamp-2"], [aria-label="promotion price"], [aria-label="Product card"]')) break;
        const combined = textOf(parent);
        if (combined.length > 280 || combinedOffers(parent) || !parseOffer(combined, scope)) break;
        // Keep terms adjacent to one offer, not a container containing unrelated offers.
        if (parseOffer(combined, scope).kind !== parseOffer(text, scope).kind) break;
        text = combined;
      }
      texts.push({ text, scope });
    }
    const unique = [...new Map(texts.map(offer => [offer.text.toLowerCase(), parseOffer(offer.text, scope)])).values()].filter(Boolean);
    return unique.filter(offer => !unique.some(other => other !== offer && other.kind === offer.kind && other.text.length > offer.text.length && other.text.toLowerCase().includes(offer.text.toLowerCase()))).slice(0, 12);
  }
  function conditionalPrice(root) {
    const cache = new WeakMap();
    return [...root.querySelectorAll('span, div, small, p')].some(node => visible(node) &&
      !node.closest('[data-sqe="name"], [class*="line-clamp-2"], h1') && node.textContent.length < 180 &&
      /after (?:voucher|coupon)|(?:^\s*|price\s*|₱\s*[\d,.]+\s*)with (?:voucher|coupon|spaylater|shopeepay)|(?:live|video)[- ]only price/i.test(visibleText(node, cache)));
  }
  function readDetailOffers(title) {
    if (!title || !visible(title)) return [];
    const offers = [];
    // Inspect explicitly labelled public promotion rows near this product's title.
    // Never scan the whole document, delivery addresses, or recommendation cards.
    for (let panel = title.parentElement, depth = 0; panel && !panel.matches('body, main, html') && depth < 4; panel = panel.parentElement, depth++) {
      for (const label of panel.querySelectorAll('label, span, div, h2, h3')) {
        if (label.children.length || !visible(label) || label.closest('[aria-label="Product card"], [data-sqe="item"], .shopee-item-card, header, nav, footer') || !/^(?:shop vouchers?|vouchers?|promotions?|bundle deals?|add[- ]on deals?|flash deals?|coins cashback)$/i.test(label.textContent.trim())) continue;
        const row = label.parentElement;
        if (row.contains(title) || row.textContent.length > 400 || row.querySelector('input, h1, [aria-label="Product card"], [data-sqe="item"], .shopee-item-card') || /(?:deliver to|shipping to|address)/i.test(row.textContent)) continue;
        const found = readOffers(row, 'product-page');
        // A heading alone is not evidence of an offer.
        const meaningful = found.filter(offer => offer.text.toLowerCase() !== label.textContent.trim().toLowerCase());
        const combined = visibleText(row);
        const fallback = combined !== label.textContent.trim() ? parseOffer(combined, 'product-page') : null;
        offers.push(...(meaningful.length ? meaningful : fallback ? [fallback] : []));
      }
      if (offers.length) break;
    }
    return normalizeOffers(offers);
  }
  function offerExplanation(offer, product) {
    const effect = { voucher: 'Checkout discount if eligible.', shipping: 'Shipping benefit; does not reduce the item price.', cashback: 'Reward for later use; does not reduce this payment.', bundle: 'Requires the qualifying item combination or quantity.', addon: 'Requires a qualifying main item or spend.', flash: 'Limited-time listing offer; check the active slot and stock.', payment: 'Requires the stated payment method.', channel: 'Requires the stated Live or Video purchase route.', campaign: 'Campaign claim; item participation and terms need checking.' }[offer.kind];
    const maximum = product?.priceRange?.max ?? product?.price;
    const minimum = offer.minimum !== null ? `Minimum spend ${format(offer.minimum)}${maximum != null && maximum < offer.minimum ? '; one item at the shown price is below this' : ''}.` : '';
    return [effect, minimum, offer.cap !== null ? `Benefit capped at ${format(offer.cap)}.` : '', ...offer.restrictions, offer.status + '.'].filter(Boolean).join(' ');
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
    let price = null, priceRange = null, priceNote = '';
    if (marker) {
      const parent = marker.parentElement.cloneNode(true);
      parent.querySelectorAll('del, s, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
      price = parsePrice(parent.textContent);
      priceRange = parseRange(parent.textContent);
    } else {
      const prices = [...card.querySelectorAll('span, div')]
        .filter(node => visible(node) && /₱|PHP/i.test(node.textContent) &&
          ![...node.children].some(child => /₱|PHP/i.test(child.textContent)))
        .map(node => parseOffer(node.textContent) ? null : parsePrice(node.textContent));
      const unique = [...new Set(prices)];
      if (unique.length === 1) price = unique[0];
      const ranges = [...card.querySelectorAll('span, div')].filter(node => visible(node) && ![...node.children].some(child => /₱|PHP/i.test(child.textContent))).map(node => parseRange(node.textContent)).filter(Boolean);
      if (price === null && new Set(ranges.map(r => JSON.stringify(r))).size === 1 && prices.every(p => p === null)) priceRange = ranges[0];
    }
    if (conditionalPrice(card)) { price = null; priceRange = null; priceNote = 'Shown price requires an offer; confirm eligibility on Shopee.'; }
    if (priceRange?.min === priceRange?.max && priceRange) { price = priceRange.min; priceRange = null; }
    return { ...identity, title, price, priceRange, priceNote, offers: readOffers(card), ...metadata(card), discount: globalThis.Budol.getDiscount(card)?.value ?? null, currency: 'PHP', scope: 'listing' };
  }

  function extractProducts(root) {
    const products = new Map();
    for (const card of globalThis.Budol.findCards(root)) {
      if (!visible(card)) continue;
      const product = readProduct(card);
      if (!product) continue;
      // Conflicting prices for one item on the same page are not a single observation.
      const previous = products.get(product.id);
      if (previous && (previous.price !== product.price || JSON.stringify(previous.priceRange) !== JSON.stringify(product.priceRange))) { product.price = null; product.priceRange = null; }
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
    const range = value.priceRange;
    if (range != null && (![range.min, range.max].every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY) || range.min >= range.max || value.price !== null)) throw new Error('Invalid listing price range.');
    return { ...identity, title: clean(value.title, 240) || 'Shopee product', price: value.price, priceRange: range ? { min: range.min, max: range.max } : null, priceNote: clean(value.priceNote, 140), offers: normalizeOffers(value.offers), currency: 'PHP', scope: 'listing',
      ratingValue: typeof value.ratingValue === 'number' && value.ratingValue >= 0 && value.ratingValue <= 5 ? value.ratingValue : null,
      soldValue: Number.isSafeInteger(value.soldValue) && value.soldValue >= 0 && value.soldValue <= 1000000000 ? value.soldValue : null,
      soldText: clean(value.soldText, 80), seller: clean(value.seller, 160), location: clean(value.location, 160) };
  }

  function observe(saved, product, now) {
    const history = [...saved.history];
    if (product.price !== null) {
      const last = history.at(-1);
      if (!last || last.price !== product.price || last.at.slice(0, 10) !== now.slice(0, 10)) {
        history.push({ price: product.price, at: now });
      }
    }
    const rangeHistory = [...(saved.rangeHistory || [])];
    if (product.priceRange) {
      const last = rangeHistory.at(-1), range = product.priceRange;
      if (!last || last.min !== range.min || last.max !== range.max || last.at.slice(0, 10) !== now.slice(0, 10)) rangeHistory.push({ ...range, at: now });
    }
    return { ...saved, ...product, lastSeen: now, history: history.slice(-MAX_HISTORY), rangeHistory: rangeHistory.slice(-MAX_HISTORY) };
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
      if (raw.rangeHistory !== undefined && (!Array.isArray(raw.rangeHistory) || raw.rangeHistory.length > MAX_HISTORY)) throw new Error('Invalid range history.');
      const rangeHistory = (raw.rangeHistory || []).map(point => {
        if (![point.min, point.max].every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY) || point.min >= point.max) throw new Error('Invalid historical range.');
        return { min: point.min, max: point.max, at: date(point.at) };
      }).sort((a, b) => a.at.localeCompare(b.at));
      let variant = null;
      if (raw.variant != null) {
        if (!clean(raw.variant.name, 100) || !Number.isSafeInteger(raw.variant.price) || raw.variant.price < 0 || raw.variant.price > MAX_MONEY) throw new Error('Invalid confirmed variant.');
        variant = { name: clean(raw.variant.name, 100), price: raw.variant.price, at: date(raw.variant.at) };
      }
      const watch = raw.watch == null ? null : normalizeWatch(raw.watch);
      return { ...product, collection: clean(raw.collection, 60) || 'Wishlist', notes: clean(raw.notes, 1000), savedAt: date(raw.savedAt), lastSeen: date(raw.lastSeen), history, rangeHistory, variant, watch };
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

  const format = cents => cents == null ? 'Price unavailable' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  const priceLabel = product => product.priceRange ? `${format(product.priceRange.min)}–${format(product.priceRange.max)} · varies by variant` : format(product.price);
  function dealsCsv(products) {
    const cell = value => {
      let text = value == null ? '' : String(value);
      text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
      if (/^\s*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const amount = value => value == null ? '' : (value / 100).toFixed(2);
    const rows = [['Title', 'URL', 'Currency', 'Listing price', 'Range minimum', 'Range maximum', 'Advertised discount percent', 'Rating', 'Sold count', 'Sold label', 'Seller', 'Ships from', 'Observed at (UTC)', 'Price conditions', 'Offers shown (eligibility unverified)']];
    for (const raw of products) {
      const p = normalizeProduct(raw);
      const at = raw.observedAt || raw.lastSeen;
      rows.push([p.title, p.url, 'PHP', amount(p.price), amount(p.priceRange?.min), amount(p.priceRange?.max), typeof raw.discount === 'number' && raw.discount >= 0 && raw.discount <= 100 ? raw.discount : '', p.ratingValue, p.soldValue, p.soldText, p.seller, p.location, typeof at === 'string' && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : '', p.priceNote, p.offers.map(offer => `${OFFER_NAMES[offer.kind]}: ${offer.text} (${offer.status}; ${offer.scope})`).join(' | ')]);
    }
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function normalizeWatch(raw) {
    if (!['target', 'low'].includes(raw?.mode) || (raw.mode === 'target' && (!Number.isSafeInteger(raw.target) || raw.target < 0 || raw.target > MAX_MONEY))) throw new Error('Enter a valid watch target.');
    const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    if (!timestamp(raw.createdAt)) throw new Error('Invalid watch date.');
    return { mode: raw.mode, target: raw.mode === 'target' ? raw.target : null, paused: raw.paused !== false, discord: raw.discord === true, createdAt: timestamp(raw.createdAt), lastAlertAt: timestamp(raw.lastAlertAt), lastAlertPrice: Number.isSafeInteger(raw.lastAlertPrice) && raw.lastAlertPrice >= 0 ? raw.lastAlertPrice : null };
  }
  function normalizeAlerts(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(-100).flatMap(entry => {
      try {
        const product = normalizeProduct(entry?.product);
        if (product.price === null || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at))) return [];
        const at = new Date(entry.at).toISOString();
        return [{ id: `${product.id}:${at}`, product, at, reason: clean(entry.reason, 100) || 'Price watch matched', discord: clean(entry.discord, 500) || 'Delivery not confirmed', watch: entry.watch ? normalizeWatch(entry.watch) : null }];
      } catch { return []; }
    });
  }
  function watchMatches(saved, product, now) {
    const watch = saved.watch;
    if (!watch || watch.paused || product.price == null || now <= watch.createdAt || (watch.lastAlertAt && Date.parse(now) - Date.parse(watch.lastAlertAt) < 86400000) || watch.lastAlertPrice === product.price) return false;
    if (watch.mode === 'target') return product.price <= watch.target;
    return saved.history.length > 0 && product.price < Math.min(...saved.history.map(point => point.price));
  }
  function dealFilters(values = {}) {
    const terms = value => {
      const items = [...new Set(String(value || '').toLocaleLowerCase().split(',').map(s => s.trim()).filter(Boolean))];
      if (items.length > 30) throw new Error('Use at most 30 keywords per field.');
      return items;
    };
    const numeric = (value, max, integer = false) => {
      if (value === '' || value == null) return null;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > max || (integer && !Number.isInteger(n))) throw new Error('Check the filter amounts.');
      return n;
    };
    const budget = values.budget === '' || values.budget == null ? null : money(values.budget);
    if (budget === null && values.budget != null && values.budget !== '') throw new Error('Enter a budget from 0 to 1,000,000 with up to two decimals.');
    return { required: terms(values.required), excluded: terms(values.excluded), budget, range: values.range === 'all' ? 'all' : 'any', rating: numeric(values.rating, 5), sold: numeric(values.sold, 1000000000, true) };
  }
  function matchesDeal(product, filters) {
    const title = product.title.toLocaleLowerCase();
    if (!filters.required.every(term => title.includes(term)) || filters.excluded.some(term => title.includes(term))) return false;
    const price = product.priceRange ? product.priceRange[filters.range === 'all' ? 'max' : 'min'] : product.price;
    return (filters.budget === null || (price != null && price <= filters.budget)) &&
      (filters.rating === null || (product.ratingValue != null && product.ratingValue >= filters.rating)) &&
      (filters.sold === null || (product.soldValue != null && product.soldValue >= filters.sold));
  }
  globalThis.BudolCatalog = Object.freeze({ MAX_PRODUCTS, MAX_HISTORY, productIdentity, money, parsePrice, parseRange, readProduct, visible, extractProducts, normalizeProduct, observe, validateBackup, calculate, format, priceLabel, dealFilters, matchesDeal, normalizeWatch, normalizeAlerts, watchMatches, dealsCsv, OFFER_NAMES, parseOffer, readOffers, readDetailOffers, conditionalPrice, normalizeOffers, offerExplanation });
})();
