(() => {
  'use strict';
  function webhook(raw) {
    let url;
    try { url = new URL(String(raw).trim()); } catch { throw new Error('Enter a Discord webhook URL.'); }
    if (url.origin !== 'https://discord.com' || url.username || url.password || url.hash || !/^\/api(?:\/v\d+)?\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname)) throw new Error('Use an https://discord.com/api/webhooks/… URL.');
    const thread = url.searchParams.get('thread_id');
    if (thread !== null && !/^\d{10,25}$/.test(thread)) throw new Error('The Discord thread ID is invalid.');
    url.search = '';
    url.pathname = url.pathname.replace(/^\/api(?:\/v\d+)?\//, '/api/v10/');
    if (thread) url.searchParams.set('thread_id', thread);
    url.searchParams.set('wait', 'true');
    return url.href;
  }
  function image(raw) {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && !url.username && !url.password && /(^|\.)(susercontent\.com|shopee\.ph|shopeemobile\.com)$/.test(url.hostname) ? url.href : null;
    } catch { return null; }
  }
  const clean = (value, limit = 200) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').replace(/([\\*_`~|<>\[\]])/g, '\\$1').trim().slice(0, limit) : '';
  const php = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  function payload(raw, now = new Date()) {
    const product = BudolCatalog.normalizeProduct(raw);
    const fields = [{ name: 'Listing price', value: product.priceRange ? BudolCatalog.priceLabel(product) : product.price === null ? 'Check price and variant on Shopee' : php(product.price), inline: true }];
    if (typeof raw.discount === 'number' && Number.isFinite(raw.discount) && raw.discount >= 0 && raw.discount <= 100) fields.push({ name: 'Advertised discount', value: `${raw.discount}% off`, inline: true });
    if (Number.isSafeInteger(raw.originalPrice) && raw.originalPrice > 0 && raw.originalPrice <= 100000000 && (product.price === null || raw.originalPrice > product.price)) fields.push({ name: 'Crossed-out listing price', value: php(raw.originalPrice), inline: true });
    for (const [key, name] of [['rating', 'Rating'], ['sold', 'Sold'], ['seller', 'Seller'], ['location', 'Ships from'], ['shipping', 'Shipping / offer shown']]) {
      const value = clean(raw[key]);
      if (value) fields.push({ name, value, inline: key !== 'shipping' });
    }
    const embed = {
      title: clean(product.title, 240), url: product.url, color: 0x165c9c,
      description: 'Confirm your variant, availability, shipping and voucher terms on Shopee. Advertised discounts are not verified savings.',
      fields, footer: { text: 'Budol • Shopee PH • Snapshot at sharing time' }, timestamp: now.toISOString(),
    };
    const photo = image(raw.image);
    if (photo) embed.image = { url: photo };
    return { username: 'Budol', allowed_mentions: { parse: [] }, embeds: [embed] };
  }
  globalThis.BudolDiscord = Object.freeze({ webhook, image, payload });
})();
