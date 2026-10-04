(() => {
  'use strict';
  const PROVIDERS = Object.freeze({
    pricetrack: { name: 'PriceTrack PH', origin: 'https://sgitojuhoaxxnujdikbd.supabase.co/*' },
    aiprice: { name: 'AiPrice', origin: 'https://api.aiprice.com/*' },
  });
  const DAYS = 90, LIMIT = 200;
  function identity(raw) {
    if (typeof raw !== 'string' || raw.length > 2000) throw new Error('Enter a full Shopee PH or Lazada PH product link.');
    let u; try { u = new URL(raw); } catch { throw new Error('Enter a full product link.'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Use an HTTPS product link without credentials.');
    let match;
    if (/^(?:www\.)?shopee\.ph$/.test(u.hostname)) {
      match = u.pathname.match(/(?:-i\.|\/product\/)(\d{1,20})[./](\d{1,20})\/?$/);
      if (match) return { platform: 'shopee', shop: match[1], item: match[2], url: `https://shopee.ph/product/${match[1]}/${match[2]}`, adid: '72' };
    }
    if (/^(?:www\.)?lazada\.com\.ph$/.test(u.hostname)) {
      match = u.pathname.match(/^\/products\/[^/]*-i(\d{1,20})(?:-s\d{1,20})?\.html$/);
      if (match) return { platform: 'lazada', item: match[1], url: `https://www.lazada.com.ph/products/item-i${match[1]}.html`, adid: '26' };
    }
    throw new Error('Use a full Shopee PH or Lazada PH item URL. Short links are not supported here.');
  }
  const id = value => /^(?:[1-9]\d{0,19})$/.test(String(value)) ? String(value) : null;
  function amount(value) {
    if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
    const cents = Math.round(Number(value) * 100);
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? cents : null;
  }
  const clean = (value, max = 240) => typeof value === 'string' ? value.slice(0, max) : '';
  function observations(rows, provider, variant, adid, now) {
    if (!Array.isArray(rows)) throw new Error('The provider changed its history format.');
    const unique = new Map();
    if (rows.length > 5000) throw new Error('Provider returned too many observations.');
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (provider === 'pricetrack' && String(row.variation_id) !== variant) continue;
      if (provider === 'aiprice' && row.adid != null && String(row.adid) !== adid) continue;
      const at = provider === 'aiprice' ? Number(row.time_update) * 1000 : Date.parse(row.observed_at);
      const price = amount(row.price);
      if (price === null || !Number.isFinite(at) || at < now - DAYS * 86400000 || at > now + 300000) continue;
      const point = { at: new Date(at).toISOString(), price };
      if (provider === 'pricetrack') { point.originalPrice = amount(row.original_price); point.inStock = typeof row.is_in_stock === 'boolean' ? row.is_in_stock : null; }
      unique.set(`${point.at}:${price}`, point);
    }
    return [...unique.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-LIMIT);
  }
  async function json(url, headers, signal) {
    const response = await fetch(url, { headers, signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (response.status === 429) {
      const error = new Error('Provider rate limit reached. Try again later.');
      const retry = response.headers.get('retry-after');
      error.retryMs = Math.min(3600000, Math.max(60000, /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now() || 60000)); throw error;
    }
    if (!response.ok) throw new Error(`Provider unavailable (HTTP ${response.status}).`);
    if (!response.body) throw new Error('Empty provider response.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1048576) { await reader.cancel(); throw new Error('Provider response is too large.'); }
      chunks.push(value);
    }
    try { return JSON.parse(await new Blob(chunks).text()); } catch { throw new Error('Provider returned an unreadable response.'); }
  }
  async function lookup(provider, rawUrl, variantId = '', signal = AbortSignal.timeout(12000)) {
    const item = identity(rawUrl), now = Date.now();
    if (!PROVIDERS[provider]) throw new Error('Choose a supported history provider.');
    if (typeof variantId !== 'string' || variantId && !id(variantId)) throw new Error('Invalid provider variant ID.');
    if (provider === 'pricetrack' && item.platform !== 'shopee') throw new Error('PriceTrack PH supports Shopee only. Choose AiPrice for Lazada.');
    if (provider === 'aiprice' && variantId) throw new Error('AiPrice history does not identify the selected variant.');
    const result = { provider, providerName: PROVIDERS[provider].name, url: item.url, platform: item.platform, currency: 'PHP', fetchedAt: new Date(now).toISOString(), days: DAYS, scope: provider === 'pricetrack' ? 'variant' : 'listing', variants: [], variantId: '', points: [], truncated: false };
    if (provider === 'aiprice') {
      const u = new URL('https://api.aiprice.com/index.php/chrome/items/priceTracking');
      u.search = new URLSearchParams({ sku_id: item.item, adid: item.adid, day: String(DAYS), currency: 'PHP' });
      const data = await json(u.href, { Accept: 'application/json' }, signal);
      if (!data || data.code !== 200 || data.success !== 1 || data.currency !== 'PHP' || String(data.adid) !== item.adid) throw new Error('AiPrice did not return usable PHP history. Verification or a provider update may be required.');
      result.points = observations(data.price_tracking, provider, '', item.adid, now);
      result.truncated = data.price_tracking.length > LIMIT;
      return result;
    }
    // This is the website's public browser key, not an account/session credential.
    const query = async (table, params) => {
      const u = new URL(`https://sgitojuhoaxxnujdikbd.supabase.co/rest/v1/${table}`); u.search = new URLSearchParams(params);
      const data = await json(u.href, { apikey: BudolHistoryPublicKey, Accept: 'application/json' }, signal);
      if (!Array.isArray(data)) throw new Error('PriceTrack PH returned an unexpected response.'); return data;
    };
    result.reportUrl = `https://pricetrackph.com/product/shopee/${item.shop}/${item.item}`;
    const products = await query('products', { select: 'id,name,platform,external_shop_id,external_product_id', platform: 'eq.shopee', external_shop_id: `eq.${item.shop}`, external_product_id: `eq.${item.item}`, limit: '2' });
    if (!products.length) return result;
    const product = products[0];
    if (products.length !== 1 || !id(product.id) || product.platform !== 'shopee' || product.external_shop_id !== item.shop || product.external_product_id !== item.item) throw new Error('Provider product identity did not match.');
    result.title = clean(product.name);
    const variants = await query('product_variations', { select: 'id,product_id,external_variation_id,name,is_active', product_id: `eq.${product.id}`, order: 'id.asc', limit: '101' });
    result.truncated = variants.length > 100;
    result.variants = variants.slice(0, 100).filter(v => id(v.id) && String(v.product_id) === String(product.id)).map(v => ({ id: String(v.id), modelId: id(v.external_variation_id), name: clean(v.name, 160) || 'Unnamed variant', active: v.is_active === true }));
    const selected = variantId ? result.variants.find(v => v.id === variantId) : result.variants.length === 1 && !result.truncated ? result.variants[0] : null;
    if (variantId && !selected) throw new Error('This variant is no longer in the provider response. Look up the product again.');
    if (!selected) return result;
    result.variantId = selected.id;
    const rows = await query('price_observations', { select: 'variation_id,observed_at,price,original_price,is_in_stock', variation_id: `eq.${selected.id}`, observed_at: `gte.${new Date(now - DAYS * 86400000).toISOString()}`, order: 'observed_at.desc,id.desc', limit: String(LIMIT + 1) });
    result.points = observations(rows, provider, selected.id, '', now);
    result.truncated ||= rows.length > LIMIT;
    return result;
  }
  globalThis.BudolHistory = Object.freeze({ PROVIDERS, identity, lookup });
})();
