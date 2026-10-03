(() => {
  'use strict';
  const publicProduct = (raw, history = false) => {
    const result = { ...BudolCatalog.normalizeProduct(raw), discount: typeof raw.discount === 'number' && raw.discount >= 0 && raw.discount <= 100 ? raw.discount : null };
    for (const key of ['lastSeen', 'savedAt', 'observedAt']) if (typeof raw[key] === 'string' && Number.isFinite(Date.parse(raw[key]))) result[key] = new Date(raw[key]).toISOString();
    if (history) { result.history = raw.history || []; result.rangeHistory = raw.rangeHistory || []; }
    return result;
  };
  async function request(type, fields = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...fields });
    if (!response?.ok) throw new Error(response?.error || 'Budol could not complete this request.');
    return response;
  }
  async function products(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Use a valid Shopee tab ID.');
    const tabs = await chrome.tabs.query({ url: ['https://shopee.ph/*', 'https://*.shopee.ph/*'] });
    if (!tabs.some(tab => tab.id === tabId)) throw new Error('Shopee tab is closed or inaccessible. List tabs again.');
    let timer;
    try {
      const result = await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'BUDOL_GET_PRODUCTS' }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Shopee tab did not respond. Refresh it and try again.')), 5000); })]);
      if (!Array.isArray(result?.products) || result.products.length > 200) throw new Error('Unreadable product response.');
      return result.products.map(raw => ({ ...publicProduct(raw), observedAt: new Date().toISOString() }));
    } catch { throw new Error('Could not read this Shopee tab. Refresh it after reloading Budol, then list products again.'); }
    finally { clearTimeout(timer); }
  }
  async function exact(args) {
    const identity = BudolCatalog.productIdentity(args.url);
    if (!identity) throw new Error('Use a Shopee PH product URL.');
    const item = (await products(args.tab_id)).find(product => product.id === identity.id);
    if (!item) throw new Error('Product is not in the loaded listing cards. Open its listing and load it first.');
    return item;
  }
  async function execute(job, capabilities, stillActive = () => true) {
    const args = job.args;
    if (!args || typeof args !== 'object' || Array.isArray(args) || !/^[a-f0-9-]{36}$/.test(job.id || '')) throw new Error('Invalid bridge request.');
    const check = write => {
      if (!stillActive() || !Number.isFinite(job.deadline) || Date.now() >= job.deadline) throw new Error('Request expired or connector disconnected.');
      if (write && !capabilities.writes) throw new Error('Changes are disabled in the connector.');
      if (job.command === 'send_discord' && !capabilities.discord) throw new Error('Discord posting is disabled in the connector.');
    };
    check(false);
    const limit = args.limit ?? 20, offset = args.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 200) throw new Error('Invalid pagination.');
    switch (job.command) {
      case 'list_tabs': return { tabs: (await chrome.tabs.query({ url: ['https://shopee.ph/*', 'https://*.shopee.ph/*'] })).slice(0, 100).map(tab => ({ id: tab.id, title: String(tab.title || 'Shopee').slice(0, 160) })) };
      case 'get_products': {
        if (typeof (args.keywords ?? '') !== 'string' || (args.keywords || '').length > 200 || (args.min_discount != null && (typeof args.min_discount !== 'number' || args.min_discount < 0 || args.min_discount > 100))) throw new Error('Invalid product filters.');
        const filters = BudolCatalog.dealFilters({ required: args.keywords || '', budget: args.max_price_php || '' });
        const loaded = await products(args.tab_id);
        const matched = loaded.filter(product => BudolCatalog.matchesDeal(product, filters) && (args.min_discount == null || product.discount !== null && product.discount >= args.min_discount)).sort((a, b) => (b.discount ?? -1) - (a.discount ?? -1));
        return { products: matched.slice(offset, offset + limit), total: matched.length, loaded: loaded.length, offset, next_offset: offset + limit < matched.length ? offset + limit : null, scope: 'Loaded listing cards only; no current cards can also mean verification or an unsupported layout.' };
      }
      case 'list_saved': {
        if (typeof (args.query ?? '') !== 'string' || (args.query || '').length > 200 || (args.include_history != null && typeof args.include_history !== 'boolean')) throw new Error('Invalid saved product filters.');
        const board = (await request('BUDOL_BOARD_GET')).board;
        const matched = board.products.filter(product => product.title.toLowerCase().includes((args.query || '').toLowerCase()));
        return { products: matched.slice(offset, offset + limit).map(product => publicProduct(product, args.include_history === true)), total: matched.length, offset, next_offset: offset + limit < matched.length ? offset + limit : null };
      }
      case 'get_alerts': {
        const stored = await chrome.storage.local.get('budolAlerts');
        return { alerts: BudolCatalog.normalizeAlerts(stored.budolAlerts).slice(-limit).reverse().map(alert => ({ product: publicProduct(alert.product), at: alert.at, reason: alert.reason })) };
      }
      case 'save_product': {
        // Saving retains a local sharing snapshot and attempts to cache its image.
        check(true); const product = await exact(args); check(true);
        await request('BUDOL_SAVE', { product }); return { saved: product.url };
      }
      case 'remove_saved': {
        check(true); const identity = BudolCatalog.productIdentity(args.url);
        if (!identity) throw new Error('Use a Shopee PH product URL.');
        await request('BUDOL_REMOVE', { id: identity.id }); return { removed: identity.url };
      }
      case 'send_discord': {
        if (args.tab_id === undefined) {
          check(true);
          if (!BudolCatalog.productIdentity(args.url)) throw new Error('Use a Shopee PH product URL.');
          await request('BUDOL_MCP_DISCORD', { cachedUrl: args.url, requestId: job.id }); return { sent: args.url, source: 'saved snapshot' };
        }
        check(true); const product = await exact(args);
        const details = await chrome.tabs.sendMessage(args.tab_id, { type: 'BUDOL_PRODUCT_DETAILS', url: product.url });
        if (BudolCatalog.productIdentity(details?.product?.url)?.id !== product.id) throw new Error('Product is no longer loaded. Refresh the product list before sending.');
        check(true);
        await request('BUDOL_MCP_DISCORD', { product: details.product, requestId: job.id }); return { sent: product.url };
      }
      case 'list_cached': {
        const cache = (await request('BUDOL_CACHE_LIST')).cache;
        return { items: cache.items.slice(offset, offset + limit), total: cache.items.length, imageBytes: cache.imageBytes, next_offset: offset + limit < cache.items.length ? offset + limit : null };
      }
      default: throw new Error('Unknown Budol tool.');
    }
  }
  globalThis.BudolMcpActions = Object.freeze({ execute });
})();
