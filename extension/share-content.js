(() => {
  'use strict';
  if (globalThis.__budolShareLoaded) return;
  globalThis.__budolShareLoaded = true;
  let selected = null;
  let selectedAt = 0;
  let notice;
  let noticeText;
  let noticeTimer;
  const text = node => node?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) || '';
  function details(card, product) {
    const leafText = [...card.querySelectorAll('span, div, small')].filter(node => !node.children.length && !node.closest('[data-sqe="name"], [class*="line-clamp-2"]') && BudolCatalog.visible(node)).map(text);
    const labels = [...card.querySelectorAll('[aria-label]')].filter(BudolCatalog.visible).map(node => node.getAttribute('aria-label'));
    const pick = selector => text([...card.querySelectorAll(selector)].find(BudolCatalog.visible));
    const img = [...card.querySelectorAll('img')].find(node => BudolCatalog.visible(node) && BudolDiscord.image(node.currentSrc || node.src));
    const crossed = [...card.querySelectorAll('s, del')].map(node => BudolCatalog.parsePrice(node.textContent)).filter(value => value !== null);
    return { ...product, image: img ? BudolDiscord.image(img.currentSrc || img.src) : null,
      originalPrice: new Set(crossed).size === 1 ? crossed[0] : null,
      rating: pick('[data-sqe="rating"], [data-testid="rating"]') || labels.find(value => /^(?:rated?\s*)?\d(?:\.\d+)?\s*(?:out of 5|\/\s*5|stars?)\b/i.test(value)) || '',
      sold: leafText.find(value => /^\d[\d.,]*\s*[kKmM]?\+?\s+sold$/i.test(value)) || '',
      seller: pick('[data-sqe="shop-name"], [data-testid="shop-name"]'),
      location: pick('[data-sqe="location"], [data-testid="location"]'),
      shipping: leafText.find(value => /^(?:free shipping|shipping (?:fee|from)|ships? (?:in|within))\b/i.test(value)) || '',
    };
  }
  function detailPage() {
    const identity = BudolCatalog.productIdentity(location.href);
    if (!identity) return null;
    const meta = key => document.querySelector(`meta[property="${key}"]`)?.content || '';
    // Only use page metadata when it identifies this exact product, not a recommendation.
    if (BudolCatalog.productIdentity(meta('og:url'))?.id !== identity.id) return { ...identity, title: 'Shopee product', price: null, scope: 'listing', currency: 'PHP' };
    const currency = meta('product:price:currency') || meta('og:price:currency');
    const title = [...document.querySelectorAll('h1')].find(BudolCatalog.visible);
    const offers = BudolCatalog.readDetailOffers(title);
    return { ...identity, title: meta('og:title') || 'Shopee product', image: BudolDiscord.image(meta('og:image')), price: currency === 'PHP' ? BudolCatalog.money(meta('product:price:amount') || meta('og:price:amount')) : null, offers, currency: 'PHP', scope: 'listing' };
  }
  function capture(event) {
    if (!chrome.runtime?.id) { document.removeEventListener('contextmenu', capture, true); return; }
    selected = null; selectedAt = Date.now();
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const card = Budol.findCards(document).find(card => card.contains(target));
    if (card) {
      const product = BudolCatalog.readProduct(card);
      if (product) selected = details(card, product);
    } else {
      const identity = BudolCatalog.productIdentity(target.closest('a[href]')?.href || '');
      if (identity) selected = { ...identity, title: text(target.closest('a')) || 'Shopee product', price: null, currency: 'PHP', scope: 'listing' };
      else selected = detailPage();
    }
  }
  document.addEventListener('contextmenu', capture, true);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!chrome.runtime?.id) return;
    if (message?.type === 'BUDOL_PRODUCT_DETAILS') {
      const identity = BudolCatalog.productIdentity(message.url);
      const card = identity && Budol.findCards(document).find(card => BudolCatalog.readProduct(card)?.id === identity.id);
      respond({ product: card ? details(card, BudolCatalog.readProduct(card)) : null });
    }
    if (message?.type === 'BUDOL_CONTEXT_PRODUCT') {
      const expected = BudolCatalog.productIdentity(message.linkUrl || '');
      const valid = selected && Date.now() - selectedAt < 120000 && (!expected || expected.id === selected.id);
      respond({ product: valid ? selected : null });
    }
    if (message?.type === 'BUDOL_DISCORD_STATUS') {
      if (!notice?.isConnected) {
        notice = document.createElement('div'); notice.dataset.budolIgnore = '';
        const root = notice.attachShadow({ mode: 'closed' });
        const box = document.createElement('div'); box.setAttribute('role', 'status');
        box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:min(400px,calc(100vw - 40px));padding:16px 20px;background:#103b73;color:#f0fbff;border:1px solid #8ed5ee;border-radius:8px;font:15px/1.5 system-ui;box-shadow:0 4px 20px #0005;';
        // Keep the reference private to this isolated script, away from page styles.
        noticeText = box;
        document.documentElement.append(notice);
        // Closed roots are intentionally inaccessible from the page.
        root.append(box);
      }
      noticeText.textContent = String(message.text || '').slice(0, 400);
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => notice.remove(), message.error ? 15000 : 7000);
      respond({ ok: true });
    }
  });
})();
