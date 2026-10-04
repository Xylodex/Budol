(() => {
  'use strict';
  if (globalThis.__budolHistoryHoverLoaded) return;
  globalThis.__budolHistoryHoverLoaded = true;
  let target, url, timer, leaveTimer, revision = 0, stopped = false, host, panel;
  const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
  function hide() {
    clearTimeout(timer); clearTimeout(leaveTimer); revision++; target = null; url = null;
    if (host) host.style.display = 'none';
  }
  function stop() { stopped = true; hide(); host?.remove(); }
  function connected() { if (stopped) return false; if (!chrome.runtime?.id) { stop(); return false; } return true; }
  function identity(element) {
    const card = element.closest('[role="group"][aria-label="Product card"], [data-sqe="item"], .shopee-search-item-result__item, .shopee-item-card');
    const product = card && BudolCatalog.readProduct(card);
    if (product) return { target: card, url: product.url };
    const anchor = element.closest('a[href]');
    const direct = BudolCatalog.productIdentity(anchor?.href || '');
    return direct ? { target: anchor, url: direct.url } : null;
  }
  function createPanel() {
    if (host) return;
    host = document.createElement('div'); host.dataset.budolIgnore = ''; host.id = 'budol-external-price';
    host.style.cssText = 'all:initial;position:fixed!important;z-index:2147483647!important;display:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = node('style', ':host{color-scheme:light}*{box-sizing:border-box}section{width:min(330px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:16px;border:1px solid #7aaccb;border-radius:12px;background:#e8f4fc;color:#163e65;box-shadow:0 8px 28px #061e4166;font:13px/1.5 "Segoe UI",sans-serif;overflow-wrap:anywhere}strong{font-size:23px}p{margin:8px 0 0}.brand{font-size:12px;font-weight:600;margin:0 0 6px}');
    panel = document.createElement('section'); panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    shadow.append(style, panel); document.documentElement.append(host);
    host.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
    host.addEventListener('pointerleave', () => { leaveTimer = setTimeout(hide, 180); });
  }
  function position(element) {
    const rect = element.getBoundingClientRect();
    host.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
    host.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - panel.offsetHeight - 8))}px`;
  }
  function current(element, itemUrl, epoch) {
    return connected() && epoch === revision && element.isConnected && identity(element)?.url === itemUrl;
  }
  async function show(element, itemUrl, epoch) {
    if (!current(element, itemUrl, epoch)) return;
    createPanel(); host.style.display = 'block'; panel.replaceChildren(node('p', 'Budol · External price'), node('p', 'Loading history…')); position(element);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'BUDOL_HISTORY_PREVIEW', url: itemUrl });
      if (!current(element, itemUrl, epoch)) { if (epoch === revision) hide(); return; }
      if (!response?.ok) throw new Error(response?.error || 'History unavailable.');
      const data = response.history, point = data.points.at(-1), variant = data.variants.find(v => v.id === data.variantId);
      const brand = node('p', `Budol · ${data.providerName}`); brand.className = 'brand';
      panel.replaceChildren(brand, node('strong', point ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(point.price / 100) : 'No recorded price'));
      panel.append(node('p', data.scope === 'listing' ? 'Listing-level history; variant unknown.' : variant ? `Recorded variant: ${variant.name}` : 'Multiple variants or no records. Choose a variant in Budol → External prices.'));
      if (point) panel.append(node('p', `Last observed ${new Date(point.at).toLocaleString()}. Not a current checkout price.`));
      panel.append(node('p', `${data.cached ? 'Saved response' : 'Provider response'}${data.stale ? ' · stale' : ''} · fetched ${new Date(data.fetchedAt).toLocaleString()}`));
    } catch (error) {
      if (!connected() || /extension context invalidated/i.test(error.message)) { stop(); return; }
      if (epoch !== revision) return;
      panel.replaceChildren(node('p', 'Budol · External price'), node('p', error.message), node('p', 'Choose and enable a provider in the Budol popup.'));
    }
    position(element);
  }
  function enter(event) {
    if (!connected() || event.pointerType === 'touch' || !(event.target instanceof Element) || event.target.closest('[data-budol-ignore]')) return;
    const item = identity(event.target); if (!item) return;
    if (target === item.target && url === item.url) { clearTimeout(leaveTimer); return; }
    hide(); target = item.target; url = item.url;
    const epoch = revision; timer = setTimeout(() => show(item.target, item.url, epoch), 3000);
  }
  document.addEventListener('pointerover', enter, true);
  document.addEventListener('focusin', enter, true);
  document.addEventListener('pointerout', event => {
    if (!target || !target.contains(event.target) || target.contains(event.relatedTarget)) return;
    if (!host || host.style.display === 'none') { hide(); return; }
    clearTimeout(timer); leaveTimer = setTimeout(hide, 180);
  }, true);
  document.addEventListener('focusout', event => { if (target?.contains(event.target) && !target.contains(event.relatedTarget)) hide(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, true);
  document.addEventListener('click', hide, true);
  document.addEventListener('scroll', () => { if (host?.style.display === 'block') hide(); }, true);
  window.addEventListener('blur', hide); window.addEventListener('resize', hide); window.addEventListener('pagehide', stop);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!connected()) return;
    if (area === 'local' && (changes.budolHistoryProvider || changes.budolExternalHistory?.newValue?.length === 0)) hide();
  });
})();
