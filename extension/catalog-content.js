(() => {
  'use strict';
  if (globalThis.__budolCatalogLoaded) return;
  globalThis.__budolCatalogLoaded = true;
  let signature = '';
  let timer;
  let stopped = false;
  function stop() {
    stopped = true;
    clearTimeout(timer);
    timer = null;
    observer.disconnect();
  }
  function connected() {
    if (stopped) return false;
    if (!chrome.runtime?.id) { stop(); return false; }
    return true;
  }
  async function scan() {
    timer = null;
    if (!connected()) return;
    const products = BudolCatalog.extractProducts(document);
    const next = JSON.stringify(products);
    if (next === signature) return;
    try {
      // Reloading an extension can make sendMessage throw before it returns a Promise.
      const result = await chrome.runtime.sendMessage({ type: 'BUDOL_OBSERVE', products });
      if (!stopped && result?.ok) signature = next;
    } catch (error) {
      if (!chrome.runtime?.id || /extension context invalidated/i.test(error?.message || '')) stop();
      // Other messaging failures can recover on the next page change.
    }
  }
  function schedule() {
    if (!connected()) return;
    if (!timer) timer = setTimeout(scan, 700);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['href', 'aria-label', 'hidden'],
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!connected()) return;
    if (message?.type === 'BUDOL_GET_PRODUCTS') respond({ products: BudolCatalog.extractProducts(document), title: document.title.slice(0, 160) });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!connected()) return;
    if (area === 'local' && changes.budolBoard) { signature = ''; schedule(); }
  });
  schedule();
})();
