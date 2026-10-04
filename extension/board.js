(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const format = cents => cents === null ? 'Price unavailable' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  const date = at => new Date(at).toLocaleString();
  let board = { version: 1, products: [] };
  let candidates = [];
  const comparison = new Map();
  let imported = null;
  let candidateLimit = 6;
  let cacheLimit = 20;
  let removedProduct = null;
  let hasEstimate = false;
  let estimateTimer;
  let importRevision = 0;
  let priceProductId = null;
  let discountThreshold = 50;
  let pageRevision = 0;
  const drafts = new Map();
  const configDrafts = new Map();
  try {
    const restored = JSON.parse(sessionStorage.getItem('budolConfigDrafts') || '[]');
    if (Array.isArray(restored)) for (const entry of restored.slice(0, 400)) {
      if (!Array.isArray(entry)) continue;
      const [key, values] = entry;
      if (typeof key === 'string' && /^shopee:\d+:\d+:listing:PHP:(watch|variant)$/.test(key) && values && typeof values === 'object') configDrafts.set(key, values);
    }
  } catch { /* In-memory drafts still protect rerenders. */ }
  try {
    const restored = JSON.parse(sessionStorage.getItem('budolNoteDrafts') || '[]');
    if (Array.isArray(restored)) for (const [id, draft] of restored.slice(0, 200)) {
      if (typeof id === 'string' && typeof draft?.notes === 'string' && typeof draft?.collection === 'string') drafts.set(id, { notes: draft.notes.slice(0, 1000), collection: draft.collection.slice(0, 60) });
    }
  } catch { /* Storage can be unavailable; keep in-memory draft protection. */ }
  function storeDrafts() {
    try { sessionStorage.setItem('budolNoteDrafts', JSON.stringify([...drafts])); } catch { /* The unload warning remains available. */ }
    try { sessionStorage.setItem('budolConfigDrafts', JSON.stringify([...configDrafts])); } catch { /* Keep in-memory drafts. */ }
  }
  function protectForm(form, key, details, restored = () => {}) {
    const controls = [...form.querySelectorAll('input[name], select[name]')];
    const values = () => Object.fromEntries(controls.map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value]));
    const baseline = values();
    const apply = value => {
      for (const input of controls) {
        if (input.type === 'checkbox') input.checked = value[input.name] === true;
        else if (typeof value[input.name] === 'string') input.value = value[input.name].slice(0, 100);
      }
      restored();
    };
    if (configDrafts.has(key)) { apply(configDrafts.get(key)); details.open = true; }
    const status = element('p', configDrafts.has(key) ? 'Unsaved changes · kept in this tab' : '', 'hint'); status.setAttribute('role', 'status');
    const discard = element('button', 'Discard unsaved changes', 'quiet'); discard.type = 'button'; discard.hidden = !configDrafts.has(key);
    const remember = () => {
      const current = values();
      if (JSON.stringify(current) === JSON.stringify(baseline)) configDrafts.delete(key); else configDrafts.set(key, current);
      storeDrafts(); status.textContent = configDrafts.has(key) ? 'Unsaved changes · kept in this tab' : ''; discard.hidden = !configDrafts.has(key);
    };
    form.addEventListener('input', remember); form.addEventListener('change', remember);
    discard.addEventListener('click', () => { apply(baseline); remember(); controls[0]?.focus(); });
    form.append(status, discard);
    return { values, saved(submitted) {
      if (!configDrafts.has(key) || JSON.stringify(configDrafts.get(key)) === JSON.stringify(submitted)) configDrafts.delete(key);
      storeDrafts();
    } };
  }
  const openedDetails = new Set();
  const selected = new URLSearchParams(location.search).get('tab');
  let sourceTab = selected && /^\d+$/.test(selected) ? Number(selected) : null;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function notify(text, error = false) {
    $('failure').hidden = !error;
    $('failure').textContent = error ? text : '';
    $('notice').textContent = error ? '' : text;
  }
  async function request(type, data = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...data });
    if (!result?.ok) throw new Error(result?.error || 'Budol is unavailable. Reload the extension and try again.');
    return result.board;
  }
  const activeActions = new Map();
  async function action(button, task) {
    if (button.id === 'import' && activeActions.has(button)) return;
    const state = activeActions.get(button) || { label: button.textContent, count: 0 };
    state.count++; activeActions.set(button, state);
    button.disabled = true;
    button.textContent = 'Working…';
    button.setAttribute('aria-busy', 'true');
    try { await task(); } catch (error) { notify(error.message, true); }
    finally {
      state.count--;
      if (!state.count) activeActions.delete(button);
      if (!state.count && button.isConnected) {
        button.textContent = state.label; button.removeAttribute('aria-busy'); button.disabled = false;
        if (button.id === 'import') button.disabled = !imported || !imported.products.some(p => !board.products.some(saved => saved.id === p.id));
        if (button.id === 'clear-alerts') button.disabled = $('alerts-count').textContent === '(0)';
        if (button.id === 'export-deals') { try { button.disabled = filteredCandidates().length === 0; } catch { button.disabled = true; } }
      }
    }
  }
  function link(product) {
    const anchor = element('a', product.title);
    anchor.href = product.url; anchor.target = '_blank'; anchor.rel = 'noreferrer';
    return anchor;
  }
  function sendSavedButton(product) {
    const button = element('button', 'Send to Discord'); button.type = 'button';
    button.addEventListener('click', () => action(button, async () => {
      const result = await chrome.runtime.sendMessage({ type: 'BUDOL_SEND_SAVED', url: product.url, requestId: crypto.randomUUID() });
      if (!result?.ok) throw new Error(result?.error || 'Could not confirm delivery. Check Discord before retrying.');
      notify('Saved snapshot sent to Discord.');
    }));
    return button;
  }
  function externalHistoryButton(product) {
    const button = element('button', 'Price history'); button.type = 'button';
    button.addEventListener('click', () => {
      $('history-url').value = product.url; $('history-url').dispatchEvent(new Event('input'));
      $('external-history-panel').open = true; $('external-history-panel').scrollIntoView({ block: 'start' }); $('history-lookup').focus();
    });
    return button;
  }
  async function refreshCache() {
    const result = await chrome.runtime.sendMessage({ type: 'BUDOL_CACHE_LIST' });
    if (!result?.ok || !result.cache) throw new Error(result?.error || 'Share cache unavailable. Reload Budol and try again.');
    const cache = result.cache;
    $('cache-usage').textContent = `${cache.items.length}/200 snapshots · ${(cache.imageBytes / 1048576).toFixed(2)} / 32 MiB of images`;
    $('cache-items').replaceChildren();
    for (const item of cache.items.slice(0, cacheLimit)) {
      const row = element('article', undefined, 'cached-share');
      row.append(link(item.product), element('p', `Captured ${date(item.capturedAt)} · ${item.imageStatus}`, 'hint'), sendSavedButton(item.product));
      $('cache-items').append(row);
    }
    if (cache.items.length > cacheLimit) {
      const more = element('button', 'Show more cached items'); more.type = 'button';
      more.addEventListener('click', () => action(more, async () => { cacheLimit += 20; await refreshCache(); })); $('cache-items').append(more);
    }
  }
  $('backup-panel').addEventListener('toggle', () => { if ($('backup-panel').open) refreshCache().catch(error => { $('cache-usage').textContent = error.message; }); });
  $('refresh-cache').addEventListener('click', () => action($('refresh-cache'), refreshCache));
  for (const [id, scope] of [['clear-images', 'images'], ['clear-cache', 'all']]) $(id).addEventListener('click', () => action($(id), async () => {
    const result = await chrome.runtime.sendMessage({ type: 'BUDOL_CACHE_CLEAR', scope });
    if (!result?.ok) throw new Error(result?.error || 'Cache could not be cleared.');
    cacheLimit = 20;
    await refreshCache(); notify(scope === 'images' ? 'Downloaded images cleared. Saved product details remain.' : 'Share cache cleared. Saved products and settings remain.');
  }));
  function offersView(product) {
    const offers = BudolCatalog.normalizeOffers(product.offers);
    const details = element('details', undefined, 'offers');
    details.append(element('summary', offers.length ? `Offers shown · ${offers.length}` : 'Offers shown · not captured'));
    if (product.priceNote) details.append(element('p', product.priceNote, 'hint'));
    if (!offers.length) details.append(element('p', 'No readable item offers captured. Check the product page for current promotions.', 'hint'));
    for (const offer of offers) {
      const row = element('div', undefined, 'offer');
      row.append(element('strong', BudolCatalog.OFFER_NAMES[offer.kind]), element('p', offer.text), element('p', BudolCatalog.offerExplanation(offer, product), 'hint'), element('small', `Source: ${offer.scope === 'product-page' ? 'product page' : 'item card'}`, 'hint'));
      details.append(row);
    }
    if (offers.length) {
      const observed = product.observedAt || product.lastSeen;
      details.append(element('p', `${observed ? `Captured ${date(observed)}. ` : ''}Offers can expire or depend on your account, variant and checkout. Benefits are not added together or deducted from the listing price.`, 'hint'));
      if (offers.some(o => o.kind === 'flash') && offers.some(o => o.kind === 'bundle')) details.append(element('p', 'Shopee excludes ongoing Flash Deal items from Bundle Deals. Check which offer applies at checkout.', 'hint'));
    }
    return details;
  }
  function compareButton(product) {
    const button = element('button', 'Compare'); button.type = 'button'; button.dataset.compareId = product.id;
    button.addEventListener('click', () => {
      if (comparison.has(product.id)) comparison.delete(product.id);
      else {
        if (comparison.size >= 4) { notify('Remove an item from comparison before adding another.', true); return; }
        const evidence = { ...board.products.find(p => p.id === product.id), ...product };
        const price = evidence.variant?.price ?? evidence.price;
        comparison.set(product.id, { product: evidence, inputs: { price: price == null ? '' : (price / 100).toFixed(2), shipping: '', voucher: '0' } });
        $('compare-panel').open = true;
      }
      renderComparison();
    });
    return button;
  }
  function syncCompareButtons() {
    for (const button of document.querySelectorAll('[data-compare-id]')) {
      const selected = comparison.has(button.dataset.compareId);
      button.textContent = selected ? 'Remove from comparison' : 'Compare';
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !selected && comparison.size >= 4;
    }
  }
  function renderComparison() {
    $('compare-count').textContent = `(${comparison.size}/4)`;
    $('clear-comparison').disabled = comparison.size === 0;
    $('comparison').replaceChildren();
    if (comparison.size < 2) $('comparison').append(element('p', comparison.size ? 'Add one more product to compare.' : 'No products selected. Use Compare on a product.'));
    for (const [id, entry] of comparison) {
      const { product, inputs } = entry;
      const card = element('article', undefined, 'comparison-card');
      const title = element('h3'); title.append(link(product)); card.append(title);
      const facts = element('dl');
      const fact = (name, value) => facts.append(element('dt', name), element('dd', value));
      fact('Listing price', BudolCatalog.priceLabel(product));
      fact('Manual variant', product.variant ? `${product.variant.name} · ${format(product.variant.price)} · ${date(product.variant.at)}` : 'None confirmed');
      fact('Lowest retained single price', product.history?.length ? format(Math.min(...product.history.map(p => p.price))) : 'Not observed');
      fact('Rating', product.ratingValue == null ? 'Unknown' : `${product.ratingValue}/5`);
      fact('Sold', product.soldText || (product.soldValue == null ? 'Unknown' : String(product.soldValue)));
      fact('Seller', product.seller || 'Unknown'); fact('Ships from', product.location || 'Unknown');
      fact('Observed', product.observedAt || product.lastSeen ? date(product.observedAt || product.lastSeen) : 'Time unavailable');
      card.append(facts, offersView(product));
      const form = element('form'); form.setAttribute('aria-label', `Estimate for ${product.title}`);
      const output = element('p', undefined, 'comparison-total'); output.setAttribute('role', 'status');
      const update = () => {
        const price = BudolCatalog.money(inputs.price), shipping = BudolCatalog.money(inputs.shipping), voucher = BudolCatalog.money(inputs.voucher);
        if ([price, shipping, voucher].includes(null)) { output.textContent = 'Estimate incomplete — enter a price, shipping (0 if free), and voucher amount.'; return; }
        const result = BudolCatalog.calculate({ price, shipping, discount: voucher, quantity: 1, percent: 0, cap: null, minimum: 0, cashback: 0 });
        output.textContent = `Estimated payment: ${format(result.total)} · voucher applied ${format(result.voucher)}`;
      };
      for (const [name, label] of [['price', 'Item price (PHP)'], ['shipping', 'Shipping (PHP)'], ['voucher', 'Eligible voucher amount (PHP)']]) {
        const control = element('input'); control.type = 'number'; control.name = name; control.min = '0'; control.max = '1000000'; control.step = '0.01'; control.required = true; control.value = inputs[name];
        const field = element('label', label); field.append(control); form.append(field);
        control.addEventListener('input', () => { inputs[name] = control.value; update(); });
      }
      form.addEventListener('submit', event => event.preventDefault()); update();
      const remove = element('button', 'Remove from comparison'); remove.type = 'button';
      remove.addEventListener('click', () => { comparison.delete(id); renderComparison(); $('compare-panel').querySelector('summary').focus(); });
      card.append(form, output, element('p', 'Confirm variant, shipping and voucher eligibility on Shopee. Other fees are not included.', 'hint'), remove);
      $('comparison').append(card);
    }
    syncCompareButtons();
  }
  $('clear-comparison').addEventListener('click', () => { comparison.clear(); renderComparison(); $('compare-panel').querySelector('summary').focus(); });
  renderComparison();
  function filteredCandidates() {
    const filters = BudolCatalog.dealFilters(Object.fromEntries(new FormData($('deal-filters'))));
    $('deal-filter-count').textContent = `(${[filters.required.length > 0, filters.excluded.length > 0, filters.budget !== null, filters.rating !== null, filters.sold !== null].filter(Boolean).length} active)`;
    return candidates.filter(p => BudolCatalog.matchesDeal(p, filters) && (!$('matching-only').checked || (p.discount !== null && p.discount >= discountThreshold))).sort((a, b) => (b.discount ?? -1) - (a.discount ?? -1));
  }
  function renderCandidates() {
    let shown = [];
    try { shown = filteredCandidates(); $('deal-filter-error').textContent = ''; $('deal-filter-error').hidden = true; }
    catch (error) { $('deal-filter-error').textContent = error.message; $('deal-filter-error').hidden = false; }
    $('candidates').replaceChildren();
    $('export-deals').disabled = shown.length === 0;
    $('deal-count').textContent = `${shown.length} ${$('matching-only').checked ? `matching ${discountThreshold}%+` : 'loaded'} products`;
    for (const product of shown.slice(0, candidateLimit)) {
      const card = element('article', undefined, 'candidate');
      card.dataset.productId = product.id;
      card.tabIndex = -1;
      card.append(element('span', product.discount === null ? 'No discount shown' : `${product.discount}% off`, 'discount-tag'), link(product), element('p', `${BudolCatalog.priceLabel(product)} · listing price`));
      card.append(offersView(product));
      const saved = board.products.some(item => item.id === product.id);
      const button = element('button', saved ? 'Saved to board' : 'Save to board');
      button.disabled = saved;
      button.addEventListener('click', () => action(button, async () => {
        board = await request('BUDOL_SAVE', { product });
        $('search').value = ''; $('collection').value = ''; render();
        [...$('candidates').children].find(node => node.dataset.productId === product.id)?.focus();
        notify(`Saved “${product.title}”.`);
      }));
      card.append(button, compareButton(product), externalHistoryButton(product)); $('candidates').append(card);
    }
    if (candidates.length && !shown.length) {
      const empty = element('p', 'No loaded products match. Adjust the product filters or discount threshold, or scroll on Shopee and refresh.', 'hint');
      const all = element('button', 'Show all loaded products');
      all.addEventListener('click', () => { $('matching-only').checked = false; $('deal-filters').reset(); candidateLimit = 6; renderCandidates(); $('matching-only').focus(); });
      $('candidates').append(empty, all);
    }
    $('more-candidates').hidden = shown.length <= candidateLimit;
    $('more-candidates').textContent = `Show ${Math.min(6, shown.length - candidateLimit)} more products`;
    syncCompareButtons();
  }
  $('deal-filters').addEventListener('input', () => { candidateLimit = 6; renderCandidates(); });
  $('deal-filters').addEventListener('submit', event => event.preventDefault());
  $('deal-filters').addEventListener('reset', () => { setTimeout(() => { candidateLimit = 6; renderCandidates(); }, 0); });
  function historyView(product) {
    const details = element('details');
    rememberDisclosure(details, `${product.id}:history`);
    details.append(element('summary', `Price observations (${product.history.length})`));
    details.append(element('p', 'Advertised listing prices; variants, stock, and offer conditions may differ. The latest 90 observations are retained.', 'hint'));
    if (!product.history.length) { details.append(element('p', 'No readable price observed yet.')); return details; }
    const points = product.history;
    if (points.length === 1) {
      details.append(element('p', `${format(points[0].price)} observed ${date(points[0].at)}.`));
      details.append(element('p', 'Visit a listing containing this product again to build its history.', 'hint'));
      return details;
    }
    const min = Math.min(...points.map(p => p.price)), max = Math.max(...points.map(p => p.price));
    details.append(element('p', `Lowest retained observation: ${format(min)}`, 'hint'));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 400 90'); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Listing price observations in chronological order; exact values are in the table below.');
    const start = Date.parse(points[0].at), end = Date.parse(points.at(-1).at);
    const coordinates = points.map(p => [start === end ? 200 : 10 + (Date.parse(p.at) - start) * 380 / (end - start), max === min ? 45 : 75 - (p.price - min) * 60 / (max - min)]);
    const line = document.createElementNS(ns, 'polyline'); line.setAttribute('points', coordinates.map(p => p.join(',')).join(' ')); svg.append(line);
    for (const [x, y] of coordinates) { const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', '2.5'); svg.append(dot); }
    details.append(svg);
    details.append(element('p', `${new Date(start).toLocaleDateString()} → ${new Date(end).toLocaleDateString()} · ${format(min)}–${format(max)}`, 'hint'));
    const table = element('table'); const head = element('thead'); const row = element('tr'); row.append(element('th', 'Observed'), element('th', 'Listing price')); head.append(row); table.append(head);
    const body = element('tbody');
    for (const point of [...points].reverse()) { const row = element('tr'); row.append(element('td', date(point.at)), element('td', format(point.price))); body.append(row); }
    table.append(body); const wrapper = element('div', undefined, 'history-table'); wrapper.append(table); details.append(wrapper); return details;
  }
  let alertsRevision = 0;
  async function renderAlerts() {
    const revision = ++alertsRevision;
    const alerts = BudolCatalog.normalizeAlerts((await chrome.storage.local.get('budolAlerts')).budolAlerts);
    if (revision !== alertsRevision) return;
    $('alerts-count').textContent = `(${alerts.length})`;
    $('alerts').replaceChildren();
    for (const alert of [...alerts].reverse()) {
      const row = element('article', undefined, 'candidate');
      row.append(link(alert.product), element('p', `${alert.reason} · ${format(alert.product.price)} · ${date(alert.at)}`), element('p', `Discord: ${alert.discord}`, 'hint'));
      $('alerts').append(row);
    }
    if (!alerts.length) $('alerts').append(element('p', 'No price alerts yet. Set a watch on a saved product.'));
    $('clear-alerts').disabled = alerts.length === 0;
  }
  $('clear-alerts').addEventListener('click', () => action($('clear-alerts'), async () => { await request('BUDOL_ALERTS_CLEAR'); await renderAlerts(); }));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.budolAlerts) renderAlerts().catch(error => notify(error.message, true)); });
  function watchView(product) {
    const details = element('details'); rememberDisclosure(details, `${product.id}:watch`);
    const watch = product.watch;
    details.append(element('summary', watch ? `Price watch · ${watch.paused ? 'paused' : 'active'}` : 'Set a price watch'));
    const form = element('form', undefined, 'watch-form');
    const modeLabel = element('label', 'Notify when'); const mode = element('select'); mode.name = 'mode'; mode.add(new Option('Target price reached', 'target')); mode.add(new Option('New observed low', 'low')); mode.value = watch?.mode || 'target'; modeLabel.append(mode);
    const targetLabel = element('label', 'Target price (PHP)'); const target = element('input'); target.name = 'target'; target.type = 'number'; target.min = '0'; target.max = '1000000'; target.step = '0.01'; target.value = watch?.target == null ? '' : watch.target / 100; targetLabel.append(target);
    const update = () => { targetLabel.hidden = mode.value !== 'target'; target.required = mode.value === 'target'; target.disabled = mode.value !== 'target'; }; mode.addEventListener('change', update); update();
    const pausedLabel = element('label', 'Pause watch', 'inline-check'); const paused = element('input'); paused.type = 'checkbox'; paused.name = 'paused'; paused.checked = watch?.paused || false; pausedLabel.prepend(paused);
    const discordLabel = element('label', 'Also send matching prices to my Discord webhook', 'inline-check'); const discord = element('input'); discord.type = 'checkbox'; discord.name = 'discord'; discord.checked = watch?.discord || false; discordLabel.prepend(discord);
    const save = element('button', 'Save watch'); save.type = 'submit'; const remove = element('button', 'Remove watch', 'quiet'); remove.type = 'button'; remove.disabled = !watch;
    form.append(modeLabel, targetLabel, pausedLabel, discordLabel, element('p', 'At most one alert per product per 24 hours. The same price is not sent again. Ranges and manual variant prices do not trigger watches.', 'hint'), save, remove);
    const draft = protectForm(form, `${product.id}:watch`, details, update);
    form.addEventListener('submit', event => { event.preventDefault(); action(save, async () => { const submitted = draft.values(); board = await request('BUDOL_WATCH', { id: product.id, watch: submitted }); draft.saved(submitted); render(); notify('Price watch saved.'); }); });
    remove.addEventListener('click', () => action(remove, async () => { const submitted = draft.values(); board = await request('BUDOL_WATCH', { id: product.id, watch: null }); draft.saved(submitted); render(); notify('Price watch removed.'); }));
    details.append(form); return details;
  }
  function productView(product) {
    const card = element('article', undefined, 'product');
    const title = element('h3'); title.append(link(product));
    card.dataset.productId = product.id;
    card.classList.toggle('price-selected', product.id === priceProductId);
    card.append(title, element('p', product.collection, 'collection-badge'), element('div', BudolCatalog.priceLabel(product), 'product-price'), element('p', `Listing last observed ${date(product.lastSeen)}`, 'hint'));
    card.append(offersView(product));
    if (product.price !== null && product.history.length >= 2) {
      const first = product.history[0].price;
      const change = product.price - first;
      card.append(element('p', change === 0 ? 'Unchanged from first recorded price' : `${format(Math.abs(change))} ${change < 0 ? 'lower' : 'higher'} than first recorded price`, 'price-change'));
    }
    if (product.notes) card.append(element('p', product.notes));
    const estimatePrice = product.variant?.price ?? product.price;
    const actions = element('div', undefined, 'actions'); const use = element('button', 'Use price', 'primary'); use.disabled = estimatePrice === null;
    if (product.variant) card.append(element('p', `${product.variant.name}: ${format(product.variant.price)} · manually confirmed ${date(product.variant.at)}`, 'hint'));
    if (product.price === null) card.append(element('p', 'No single readable price. Enter your variant’s price in the calculator.', 'hint'));
    use.addEventListener('click', () => {
      if (priceProductId !== product.id) resetCalculator();
      priceProductId = product.id;
      for (const item of $('saved').children) item.classList.toggle('price-selected', item.dataset.productId === priceProductId);
      $('calculator').elements.price.value = (estimatePrice / 100).toFixed(2);
      $('price-source').textContent = product.variant ? `${product.title} · ${product.variant.name} · manually confirmed ${date(product.variant.at)}; recheck before buying.` : `${product.title} · observed ${date(product.lastSeen)} · listing price; confirm your variant.`;
      hasEstimate = false;
      clearTimeout(estimateTimer);
      validate(false);
      $('estimate').textContent = 'Price selected. Check shipping and any voucher before calculating.';
      $('calculator-panel').scrollIntoView({ block: 'start' });
      $('calculator').elements.shipping.focus();
      markSection('calculator-panel');
    });
    const remove = element('button', 'Remove', 'quiet');
    remove.addEventListener('click', () => action(remove, async () => {
      board = await request('BUDOL_REMOVE', { id: product.id });
      removedProduct = { product, draft: drafts.get(product.id), config: [...configDrafts].filter(([key]) => key.startsWith(`${product.id}:`)) };
      drafts.delete(product.id); for (const [key] of removedProduct.config) configDrafts.delete(key); storeDrafts();
      if (priceProductId === product.id) resetCalculator();
      render();
      $('undo-message').textContent = `Removed “${product.title}”.`;
      $('undo-notice').hidden = false; $('undo').focus(); notify('Product removed.');
    }));
    actions.append(use, compareButton(product), externalHistoryButton(product), sendSavedButton(product), remove); card.append(actions, watchView(product), historyView(product));
    if (product.rangeHistory?.length) {
      const ranges = element('details'); rememberDisclosure(ranges, `${product.id}:ranges`);
      ranges.append(element('summary', `Listing ranges (${product.rangeHistory.length})`));
      const entries = element('div', undefined, 'history-table');
      for (const point of [...product.rangeHistory].reverse()) entries.append(element('p', `${format(point.min)}–${format(point.max)} · ${date(point.at)}`));
      ranges.append(element('p', 'Ranges are separate from single-price observations; variants can change.', 'hint'), entries); card.append(ranges);
    }
    const variantDetails = element('details'); rememberDisclosure(variantDetails, `${product.id}:variant`);
    variantDetails.append(element('summary', 'Variant for estimates'), element('p', 'Enter the option and price you checked on Shopee. This is a manual estimate reference, not live variant tracking.', 'hint'));
    const variantForm = element('form');
    const variantName = element('input'); variantName.name = 'variant-name'; variantName.maxLength = 100; variantName.required = true; variantName.value = product.variant?.name || '';
    const variantPrice = element('input'); variantPrice.name = 'variant-price'; variantPrice.type = 'number'; variantPrice.min = '0'; variantPrice.max = '1000000'; variantPrice.step = '0.01'; variantPrice.required = true; variantPrice.value = product.variant ? product.variant.price / 100 : '';
    const nameLabel = element('label', 'Variant name'); nameLabel.append(variantName);
    const priceLabel = element('label', 'Confirmed variant price (PHP)'); priceLabel.append(variantPrice);
    const saveVariant = element('button', 'Save variant'); saveVariant.type = 'submit';
    const clearVariant = element('button', 'Clear variant', 'quiet'); clearVariant.type = 'button'; clearVariant.disabled = !product.variant;
    variantForm.append(nameLabel, priceLabel, saveVariant, clearVariant);
    const variantDraft = protectForm(variantForm, `${product.id}:variant`, variantDetails);
    variantForm.addEventListener('submit', event => { event.preventDefault(); action(saveVariant, async () => {
      const submitted = variantDraft.values();
      board = await request('BUDOL_VARIANT', { id: product.id, variant: { name: submitted['variant-name'], price: submitted['variant-price'] } });
      variantDraft.saved(submitted);
      if (priceProductId === product.id) resetCalculator(); render(); notify('Variant saved for estimates.');
    }); });
    clearVariant.addEventListener('click', () => action(clearVariant, async () => { const submitted = variantDraft.values(); board = await request('BUDOL_VARIANT', { id: product.id, variant: null }); variantDraft.saved(submitted); if (priceProductId === product.id) resetCalculator(); render(); notify('Variant cleared.'); }));
    variantDetails.append(variantForm); card.append(variantDetails);
    const details = element('details'); rememberDisclosure(details, `${product.id}:notes`);
    if (drafts.has(product.id)) details.open = true;
    details.append(element('summary', 'Collection & notes')); const form = element('form', undefined, 'notes-form');
    const draft = drafts.get(product.id) || product;
    const collectionLabel = element('label', 'Collection'); const collection = element('input'); collection.maxLength = 60; collection.value = draft.collection; collection.name = 'collection'; collectionLabel.append(collection);
    collection.setAttribute('list', 'collection-names');
    const notesLabel = element('label', 'Notes'); const notes = element('textarea'); notes.maxLength = 1000; notes.value = draft.notes; notes.name = 'notes'; notesLabel.append(notes);
    const draftStatus = element('p', drafts.has(product.id) ? 'Unsaved changes' : '', 'hint'); draftStatus.setAttribute('role', 'status');
    form.addEventListener('input', () => {
      if (collection.value === product.collection && notes.value === product.notes) drafts.delete(product.id);
      else drafts.set(product.id, { collection: collection.value, notes: notes.value });
      storeDrafts(); draftStatus.textContent = drafts.has(product.id) ? 'Unsaved changes · kept in this tab' : '';
    });
    const save = element('button', 'Save details'); save.type = 'submit'; save.name = 'save-details'; form.append(collectionLabel, notesLabel, draftStatus, save);
    form.addEventListener('submit', event => { event.preventDefault(); action(save, async () => {
      const submitted = { collection: collection.value, notes: notes.value };
      board = await request('BUDOL_EDIT', { id: product.id, ...submitted });
      if (collection.value === submitted.collection && notes.value === submitted.notes) drafts.delete(product.id);
      storeDrafts();
      render(); notify('Details saved.');
    }); });
    details.append(form); card.append(details); return card;
  }
  function render() {
    const active = document.activeElement;
    const focusProduct = active?.closest('.product')?.dataset.productId;
    const focusName = active?.name;
    const selection = active?.tagName === 'TEXTAREA' || active?.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
    const chosen = $('collection').value;
    $('collection').replaceChildren(new Option('All collections', ''));
    for (const name of [...new Set(board.products.map(p => p.collection))].sort()) $('collection').add(new Option(name, name));
    $('collection-names').replaceChildren(...[...new Set(board.products.map(p => p.collection))].sort().map(name => new Option(name, name)));
    $('collection-filter').hidden = $('collection').options.length < 3;
    $('saved-filters').hidden = board.products.length === 0;
    $('export').disabled = board.products.length === 0;
    $('collection').value = [...$('collection').options].some(o => o.value === chosen) ? chosen : '';
    $('count').textContent = `${board.products.length}/200`;
    $('nav-count').textContent = board.products.length;
    const query = $('search').value.trim().toLowerCase();
    const filtered = board.products.filter(p => (!$('collection').value || p.collection === $('collection').value) && `${p.title} ${p.notes} ${p.collection}`.toLowerCase().includes(query));
    const sort = $('sort').value;
    filtered.sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : sort === 'title' ? a.title.localeCompare(b.title) : b.savedAt.localeCompare(a.savedAt));
    $('result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'product' : 'products'}${query || $('collection').value ? ` of ${board.products.length}` : ' saved'}`;
    $('clear-filters').hidden = !query && !$('collection').value;
    $('saved').replaceChildren(...filtered.map(productView));
    if (!filtered.length) {
      const empty = element('div', undefined, 'empty-state');
      empty.append(element('h3', board.products.length ? 'No matching products' : 'No saved products'), element('p', board.products.length ? 'Try another search or clear the filters.' : 'Add products from a Shopee listing to save prices and notes.'));
      const button = element('button', board.products.length ? 'Show all products' : 'Add products', 'primary');
      button.addEventListener('click', board.products.length ? clearFilters : openSource);
      empty.append(button); $('saved').append(empty);
    }
    $('saved').setAttribute('aria-busy', 'false');
    renderCandidates();
    if (focusProduct && focusName) {
      const card = [...$('saved').children].find(node => node.dataset.productId === focusProduct);
      const control = card && [...card.querySelectorAll('[name]')].find(node => node.name === focusName);
      if (control) { control.focus({ preventScroll: true }); if (selection) control.setSelectionRange(...selection); }
    }
  }
  function rememberDisclosure(details, key) {
    details.open = openedDetails.has(key);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (details.open) openedDetails.add(key); else openedDetails.delete(key);
    });
  }
  function markSection(id) {
    for (const link of document.querySelectorAll('.section-nav a')) {
      if (link.hash === `#${id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  for (const link of document.querySelectorAll('.section-nav a')) link.addEventListener('click', () => markSection(link.hash.slice(1)));
  for (const id of ['source-panel', 'saved-panel', 'calculator-panel', 'backup-panel']) {
    $(id).addEventListener('focusin', event => { event.stopPropagation(); markSection(id); });
  }
  function openSource() { $('source-panel').open = true; $('source-panel').scrollIntoView({ block: 'start' }); $('source-panel').querySelector('summary').focus(); markSection('source-panel'); }
  function clearFilters() { $('search').value = ''; $('collection').value = ''; render(); $('search').focus(); }
  $('find-products').addEventListener('click', event => { event.preventDefault(); openSource(); });
  document.querySelector('a[href="#backup-panel"]').addEventListener('click', () => { $('backup-panel').open = true; });
  $('clear-filters').addEventListener('click', clearFilters);
  $('more-candidates').addEventListener('click', () => {
    const previous = candidateLimit; candidateLimit += 6; renderCandidates();
    $('candidates').children[previous]?.querySelector('a').focus();
  });
  $('undo').addEventListener('click', () => action($('undo'), async () => {
    if (!removedProduct) return;
    board = await request('BUDOL_IMPORT', { board: { version: 1, products: [removedProduct.product] } });
    if (removedProduct.draft) { drafts.set(removedProduct.product.id, removedProduct.draft); storeDrafts(); }
    for (const [key, value] of removedProduct.config || []) configDrafts.set(key, value); storeDrafts();
    removedProduct = null; $('undo-notice').hidden = true; render(); $('saved-heading').focus(); notify('Product restored.');
  }));
  async function readPage() {
    const revision = ++pageRevision;
    $('candidates').setAttribute('aria-busy', 'true');
    $('page-state').textContent = 'Reading products from your Shopee tab…';
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const results = await Promise.allSettled(tabs.map(async tab => {
        let timer;
        let result;
        try {
          result = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'BUDOL_GET_PRODUCTS' }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Shopee tab did not respond.')), 5000); }),
          ]);
        } finally { clearTimeout(timer); }
        if (!Array.isArray(result?.products)) throw new Error('Not a Shopee listing');
        return { id: tab.id, title: result.title || `Shopee tab ${tab.id}`, products: result.products.map(raw => ({ ...BudolCatalog.normalizeProduct(raw), observedAt: new Date().toISOString(), discount: typeof raw.discount === 'number' && Number.isFinite(raw.discount) && raw.discount >= 0 && raw.discount <= 100 ? raw.discount : null })) };
      }));
      if (revision !== pageRevision) return;
      const sources = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const current = sources.find(tab => tab.id === sourceTab) || sources.find(tab => tab.products.length) || sources[0];
      sourceTab = current?.id ?? null;
      $('source-tab').replaceChildren(...sources.map(tab => new Option(`${tab.title} (${tab.products.length})`, tab.id)));
      if (!sources.length) $('source-tab').add(new Option('No connected Shopee tabs', ''));
      $('source-tab').disabled = !sources.length;
      $('source-tab').value = sourceTab === null ? '' : String(sourceTab);
      candidates = current?.products || [];
      $('page-state').textContent = candidates.length ? `${candidates.length} products loaded. Scroll in that Shopee tab, then refresh this list.` : 'Open a Shopee shop or search listing, finish any verification, then refresh this list. If the tab is missing, reload Shopee once.';
    } catch {
      if (revision !== pageRevision) return;
      candidates = [];
      sourceTab = null;
      $('source-tab').replaceChildren(new Option('No connected Shopee tabs', ''));
      $('source-tab').disabled = true;
      $('page-state').textContent = 'Could not read a Shopee listing. Refresh Shopee after installing, then open Budol from that tab.';
    }
    candidateLimit = 6;
    $('candidates').setAttribute('aria-busy', 'false');
    try { const latest = await request('BUDOL_BOARD_GET'); if (revision !== pageRevision) return; board = latest; }
    catch (error) { notify(error.message, true); }
    if (revision !== pageRevision) return;
    render();
  }
  $('refresh').addEventListener('click', () => action($('refresh'), readPage));
  $('source-tab').addEventListener('change', () => { sourceTab = Number($('source-tab').value); action($('refresh'), readPage); });
  $('matching-only').addEventListener('change', () => { candidateLimit = 6; renderCandidates(); });
  $('deal-threshold').addEventListener('change', async () => {
    const input = $('deal-threshold');
    if (!input.validity.valid || input.value === '') { input.setAttribute('aria-invalid', 'true'); notify('Enter a discount from 0 to 100, with up to one decimal place.', true); return; }
    input.removeAttribute('aria-invalid');
    const next = Number(input.value);
    try { await chrome.storage.local.set({ threshold: next }); discountThreshold = next; candidateLimit = 6; renderCandidates(); notify('Discount threshold saved.'); }
    catch { notify('Could not save the discount threshold. Try again.', true); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const value = changes.threshold?.newValue;
    if (area === 'local' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
      discountThreshold = value; $('deal-threshold').value = value; renderCandidates();
    }
  });
  $('search').addEventListener('input', render); $('collection').addEventListener('change', render); $('sort').addEventListener('change', render);
  function downloadFile(text, type, name) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = element('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export-deals').addEventListener('click', () => action($('export-deals'), async () => {
    const products = filteredCandidates();
    if (!products.length) throw new Error('No matching deals to export.');
    downloadFile(BudolCatalog.dealsCsv(products), 'text/csv;charset=utf-8', `budol-deals-${new Date().toISOString().slice(0, 10)}.csv`);
    notify(`CSV download started: ${products.length} filtered products, including matches beyond the visible cards.`);
  }));
  $('export').addEventListener('click', () => action($('export'), async () => {
    const latest = await request('BUDOL_BOARD_GET');
    downloadFile(JSON.stringify(latest, null, 2), 'application/json', `budol-backup-${new Date().toISOString().slice(0, 10)}.json`);
    notify('Backup download started. Keep it to restore your local board.');
  }));
  $('import-file').addEventListener('change', async event => {
    const revision = ++importRevision;
    imported = null; $('import').disabled = true; $('import-preview').textContent = '';
    notify('');
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Backup must be smaller than 4 MB.');
      const text = await file.text();
      if (revision !== importRevision) return;
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose a backup exported by Budol.'); }
      imported = BudolCatalog.validateBackup(parsed);
      const added = imported.products.filter(p => !board.products.some(saved => saved.id === p.id)).length;
      $('import-preview').textContent = `${added} new products; ${imported.products.length - added} already saved and will be skipped.`;
      $('import').disabled = added === 0 || activeActions.has($('import'));
    } catch (error) { if (revision === importRevision) notify(error.message, true); }
  });
  $('import').addEventListener('click', () => action($('import'), async () => {
    const revision = importRevision;
    board = await request('BUDOL_IMPORT', { board: imported });
    if (revision === importRevision) { imported = null; $('import-file').value = ''; $('import-preview').textContent = 'Import complete. Imported watches are paused with Discord off.'; }
    else if (imported) {
      const added = imported.products.filter(p => !board.products.some(saved => saved.id === p.id)).length;
      $('import-preview').textContent = `${added} new products; ${imported.products.length - added} already saved and will be skipped.`;
    }
    render(); notify('New products imported.');
  }));
  const form = $('calculator');
  const labels = { price: 'Item price', quantity: 'Quantity', shipping: 'Shipping', discount: 'Amount off', percent: 'Percent off', cap: 'Maximum discount', minimum: 'Minimum item subtotal' };
  const accessibleLabels = { price: 'Item price (PHP)', quantity: 'Quantity', shipping: 'Shipping (PHP)', discount: 'Amount off (PHP)', percent: 'Percent off', cap: 'Maximum discount (PHP, optional)', minimum: 'Minimum item subtotal (PHP)' };
  for (const [name, label] of Object.entries(labels)) {
    const input = form.elements[name];
    input.id ||= 'calc-' + name;
    // Keep field names stable when an inline error is added to the wrapping label.
    input.setAttribute('aria-label', accessibleLabels[name]);
    let error = $(input.id + '-error');
    if (!error) { error = element('span', '', 'field-error'); error.id = input.id + '-error'; input.after(error); }
    const description = input.getAttribute('aria-describedby') || '';
    if (!description.includes(error.id)) input.setAttribute('aria-describedby', (description + ' ' + error.id).trim());
  }
  function updateVoucher() {
    const percentage = form.elements.voucherType.value === 'percent';
    $('percentage-fields').hidden = !percentage; $('discount-label').hidden = percentage;
    form.elements.discount.disabled = percentage; form.elements.percent.disabled = !percentage; form.elements.cap.disabled = !percentage;
    const amount = percentage ? Number(form.elements.percent.value) : Number(form.elements.discount.value);
    $('voucher-summary').textContent = amount ? 'Included in estimate' : 'Optional';
  }
  function validate(showErrors) {
    let firstInvalid = null;
    for (const name of Object.keys(labels)) {
      const input = form.elements[name];
      let message = '';
      if (!input.disabled) {
        if (input.value === '' && name !== 'cap') message = 'Enter ' + labels[name].toLowerCase() + (name === 'shipping' ? '; use 0 for free shipping.' : '.');
        else if (!input.validity.valid) message = name === 'quantity' ? 'Use a whole number from 1 to 999.' : 'Use 0 to ' + input.max + ', with up to two decimals.';
        else if (name !== 'quantity' && input.value !== '' && BudolCatalog.money(input.value) === null) message = 'Use a plain amount with up to two decimals.';
      }
      if (message && !firstInvalid) firstInvalid = input;
      const error = $(input.id + '-error');
      if (!message || showErrors || input.getAttribute('aria-invalid') === 'true') {
        error.textContent = message;
        if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      }
    }
    return firstInvalid;
  }
  function calculateEstimate(explicit = false) {
    clearTimeout(estimateTimer);
    const invalid = validate(explicit);
    if (invalid) {
      $('estimate').dataset.state = 'incomplete';
      $('estimate').textContent = explicit ? 'Check the highlighted fields to calculate your estimate.' : 'Estimate incomplete. Finish the fields to update your total.';
      if (explicit) {
        if (invalid.closest('#voucher-options')) $('voucher-options').open = true;
        invalid.focus();
      }
      return;
    }
    try {
      const values = Object.fromEntries(new FormData(form)); const percentage = values.voucherType === 'percent';
      const calculation = { price: BudolCatalog.money(values.price), quantity: Number(values.quantity), shipping: BudolCatalog.money(values.shipping), discount: percentage ? 0 : BudolCatalog.money(values.discount), percent: percentage ? Number(values.percent) : 0, cap: percentage && values.cap ? BudolCatalog.money(values.cap) : null, minimum: BudolCatalog.money(values.minimum), cashback: 0 };
      const result = BudolCatalog.calculate(calculation);
      hasEstimate = true; $('estimate').dataset.state = 'ready';
      $('estimate').replaceChildren(element('p', 'Estimated payment'), element('strong', format(result.total)), element('p', 'Items ' + format(result.subtotal) + ' − voucher ' + format(result.voucher) + ' + shipping ' + format(result.shipping)));
      if (calculation.discount || calculation.percent) $('estimate').append(element('p', result.eligible ? 'Minimum met. Confirm voucher eligibility on Shopee.' : 'Minimum spend not met. Voucher not applied.'));
    } catch (error) { $('estimate').dataset.state = 'incomplete'; $('estimate').textContent = error.message; }
  }
  function calculatorChanged(event) {
    clearTimeout(estimateTimer);
    if (event.target.name === 'price') {
      priceProductId = null;
      for (const item of $('saved').children) item.classList.remove('price-selected');
      $('price-source').textContent = 'Manual price · confirm your chosen variant';
    }
    updateVoucher(); validate(false);
    if (hasEstimate) {
      // Invalidate the old total immediately; debounce the accessible announcement.
      $('estimate').dataset.state = 'incomplete'; $('estimate').textContent = 'Updating estimate…';
      estimateTimer = setTimeout(() => calculateEstimate(), 350);
    }
  }
  form.addEventListener('input', calculatorChanged);
  form.addEventListener('submit', event => { event.preventDefault(); calculateEstimate(true); });
  function resetCalculator() {
    clearTimeout(estimateTimer); hasEstimate = false; priceProductId = null; form.reset();
    updateVoucher();
    for (const input of form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
    for (const error of form.querySelectorAll('.field-error')) error.textContent = '';
    for (const card of $('saved').children) card.classList.remove('price-selected');
    $('voucher-options').open = false;
    $('price-source').textContent = 'No product selected · enter a price below';
    $('estimate').dataset.state = 'incomplete';
    $('estimate').textContent = 'Enter a price and shipping to calculate the total.';
  }
  $('reset-calculator').addEventListener('click', () => { resetCalculator(); form.elements.price.focus(); });
  for (const [id, delta] of [['quantity-minus', -1], ['quantity-plus', 1]]) {
    $(id).addEventListener('click', () => {
      const input = form.elements.quantity;
      input.value = Math.min(999, Math.max(1, (Number(input.value) || 1) + delta));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  updateVoucher();
  // Keep drafts and disclosures on refresh. Never replace an actively edited field.
  window.addEventListener('focus', async () => {
    if (document.activeElement?.closest('form')) return;
    try {
      const latest = await request('BUDOL_BOARD_GET');
      if (JSON.stringify(latest) !== JSON.stringify(board)) { board = latest; render(); }
    } catch (error) { notify(error.message, true); }
  });
  window.addEventListener('beforeunload', event => { if (drafts.size || configDrafts.size) { event.preventDefault(); event.returnValue = ''; } });
  (async () => {
    try {
      const settings = await chrome.storage.local.get({ threshold: 50 });
      if (typeof settings.threshold === 'number' && Number.isFinite(settings.threshold)) discountThreshold = Math.max(0, Math.min(100, settings.threshold));
    } catch { notify('Could not read your discount setting. Showing 50% or more; try reloading.', true); }
    $('deal-threshold').value = discountThreshold;
    try {
      board = await request('BUDOL_BOARD_GET'); render();
      try { await renderAlerts(); } catch { $('alerts').textContent = 'Alert history could not be loaded. Reload Budol to try again.'; }
      if (location.hash === '#alerts-panel') $('alerts-panel').open = true;
      $('source-panel').open = true;
      await readPage();
    } catch (error) { $('saved').setAttribute('aria-busy', 'false'); $('saved').textContent = 'Your board could not be loaded. Reload this page to try again.'; notify(error.message, true); }
  })();
})();
