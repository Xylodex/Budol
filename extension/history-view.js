(() => {
  'use strict';
  const $ = id => document.getElementById(id), output = $('history-result'), status = $('history-status');
  let revision = 0;
  let cachedRows = [];
  const node = (tag, text) => { const el = document.createElement(tag); if (text != null) el.textContent = text; return el; };
  const money = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  function reset() { revision++; output.replaceChildren(); status.textContent = ''; }
  $('history-url').addEventListener('input', reset); $('history-provider').addEventListener('change', reset);
  function showCached(row) {
    reset();
    const data = row.data;
    $('history-provider').value = data.provider; $('history-url').value = data.url;
    const stale = Date.now() - row.at >= 30 * 60000;
    render({ ...data, cached: true, stale, warning: stale ? 'Saved provider response. Look up history to check for newer records.' : '' }, { provider: data.provider, url: data.url, variantId: data.variantId });
    status.textContent = 'Showing saved provider history. No website or network request needed.';
  }
  function updateRecent(rows) {
    cachedRows = (Array.isArray(rows) ? rows : []).filter(row => row?.data && Object.hasOwn(BudolHistory.PROVIDERS, row.data.provider)).slice(-20).reverse();
    const select = $('history-recent'), selected = select.value;
    select.replaceChildren();
    const placeholder = node('option', cachedRows.length ? 'Choose a saved lookup' : 'No saved lookups yet'); placeholder.value = ''; select.append(placeholder);
    for (const row of cachedRows) {
      const data = row.data, variant = data.variants.find(v => v.id === data.variantId);
      const option = node('option', `${data.title || data.url} · ${data.providerName}${variant ? ` · ${variant.name}` : ''}`); option.value = row.key; select.append(option);
    }
    select.value = cachedRows.some(row => row.key === selected) ? selected : ''; select.disabled = !cachedRows.length;
  }
  $('history-recent').addEventListener('change', event => {
    const row = cachedRows.find(row => row.key === event.target.value); if (row) showCached(row);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.budolExternalHistory) return;
    updateRecent(changes.budolExternalHistory.newValue);
    if (!cachedRows.length) { reset(); hidePreview(); }
  });
  const initialRevision = revision;
  chrome.storage.local.get('budolExternalHistory').then(values => {
    updateRecent(values.budolExternalHistory);
    if (revision === initialRevision && cachedRows.length) { showCached(cachedRows[0]); $('history-recent').value = cachedRows[0].key; }
  }).catch(() => { status.textContent = 'Could not read saved history. You can still look up a product.'; });
  // A dwell avoids provider requests when the pointer merely crosses an item.
  const preview = node('div'); preview.id = 'history-preview'; preview.className = 'history-preview'; preview.setAttribute('role', 'tooltip'); preview.hidden = true; document.body.append(preview);
  let hoverTimer, leaveTimer, hoverTarget, hoverRevision = 0, oldDescription = null;
  function hidePreview() {
    clearTimeout(hoverTimer); clearTimeout(leaveTimer); hoverRevision++;
    if (hoverTarget && oldDescription !== null) hoverTarget.setAttribute('aria-describedby', oldDescription);
    else hoverTarget?.removeAttribute('aria-describedby');
    hoverTarget = null; oldDescription = null; preview.hidden = true;
  }
  function positionPreview(target) {
    const rect = target.getBoundingClientRect();
    preview.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - preview.offsetWidth - 8))}px`;
    preview.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - preview.offsetHeight - 8))}px`;
  }
  async function showPreview(target, epoch) {
    if (epoch !== hoverRevision || !target.isConnected) return;
    preview.replaceChildren(node('strong', 'External price'), node('p', 'Loading provider history…')); preview.hidden = false;
    target.setAttribute('aria-describedby', [oldDescription, preview.id].filter(Boolean).join(' ')); positionPreview(target);
    try {
      const url = BudolHistory.identity(target.dataset.historyUrl).url, provider = $('history-provider').value;
      const matches = cachedRows.filter(row => row.data.url === url && row.data.provider === provider);
      const cached = matches.find(row => row.data.points.length) || matches[0];
      let data;
      if (cached) data = { ...cached.data, cached: true, stale: Date.now() - cached.at >= 30 * 60000 };
      else {
        if (!await chrome.permissions.contains({ origins: [BudolHistory.PROVIDERS[provider].origin] })) throw new Error('Enable this provider with Look up history in External prices first.');
        if (epoch !== hoverRevision || !target.isConnected) return;
        const response = await chrome.runtime.sendMessage({ type: 'BUDOL_HISTORY_LOOKUP', provider, url });
        if (!response?.ok) throw new Error(response?.error || 'Provider lookup unavailable.');
        data = response.history;
      }
      if (epoch !== hoverRevision || !target.isConnected) return;
      const point = data.points.at(-1), variant = data.variants.find(v => v.id === data.variantId);
      preview.replaceChildren(node('strong', point ? money(point.price) : 'No recorded price'));
      preview.append(node('p', `${data.providerName} · ${data.scope === 'listing' ? 'listing-level; variant unknown' : variant ? `recorded variant: ${variant.name}` : 'select a variant in Price history'}`));
      if (point) preview.append(node('p', `Last observed ${new Date(point.at).toLocaleString()}. Not a current checkout price.`));
      preview.append(node('p', `${data.cached ? 'Saved response' : 'Provider response'}${data.stale ? ' · stale' : ''} · fetched ${new Date(data.fetchedAt).toLocaleString()}`));
      if (!point && !data.variants.length) preview.append(node('p', 'The provider returned no usable history.'));
    } catch (error) {
      if (epoch !== hoverRevision || !target.isConnected) return;
      preview.replaceChildren(node('strong', 'External price unavailable'), node('p', error.message));
    }
    positionPreview(target);
  }
  function schedulePreview(target) {
    if (hoverTarget === target) { clearTimeout(leaveTimer); return; }
    hidePreview(); hoverTarget = target; oldDescription = target.getAttribute('aria-describedby');
    const epoch = hoverRevision; hoverTimer = setTimeout(() => showPreview(target, epoch), 3000);
  }
  document.addEventListener('pointerover', event => { const target = event.target.closest('[data-history-url]'); if (target && event.pointerType !== 'touch') schedulePreview(target); });
  document.addEventListener('pointerout', event => {
    if (!hoverTarget || !hoverTarget.contains(event.target) || hoverTarget.contains(event.relatedTarget)) return;
    if (preview.hidden) { hidePreview(); return; }
    clearTimeout(hoverTimer); leaveTimer = setTimeout(hidePreview, 180);
  });
  preview.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
  preview.addEventListener('pointerleave', () => { leaveTimer = setTimeout(hidePreview, 180); });
  document.addEventListener('focusin', event => { const target = event.target.closest('[data-history-url]'); if (target) schedulePreview(target); else hidePreview(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hidePreview(); });
  document.addEventListener('click', hidePreview);
  window.addEventListener('blur', hidePreview); window.addEventListener('resize', hidePreview);
  document.addEventListener('scroll', () => { if (!preview.hidden) hidePreview(); }, true);
  $('history-provider').addEventListener('change', hidePreview);
  function render(data, args) {
    output.replaceChildren();
    const title = node('h3', data.title || (data.platform === 'shopee' ? 'Shopee item' : 'Lazada item')); output.append(title);
    const link = node('a', 'Product link'); link.href = data.url; link.target = '_blank'; link.rel = 'noreferrer'; output.append(link);
    output.append(node('p', `${data.providerName} · fetched ${new Date(data.fetchedAt).toLocaleString()}${data.cached ? ' · cached' : ''}${data.stale ? ' · stale' : ''}`));
    if (data.warning) output.append(node('p', data.warning));
    output.append(node('p', data.scope === 'listing' ? 'Listing-level history. AiPrice does not identify the selected variant; prices may refer to a different option.' : 'Choose the exact provider variant before comparing prices.'));
    if (data.reportUrl) { const report = node('a', 'Open provider report'); report.href = data.reportUrl; report.target = '_blank'; report.rel = 'noreferrer'; output.append(report); }
    if (data.variants.length) {
      const label = node('label', 'Recorded variant'), select = node('select'); select.id = 'history-variant';
      const placeholder = node('option', 'Select a variant'); placeholder.value = ''; select.append(placeholder);
      for (const v of data.variants) { const option = node('option', `${v.name}${v.active ? '' : ' (inactive)'}${v.modelId ? ` · ${v.modelId}` : ''}`); option.value = v.id; select.append(option); }
      select.value = data.variantId; label.append(select); output.append(label);
      const button = node('button', 'Load variant history'); button.type = 'button';
      button.addEventListener('click', () => { if (select.value) lookup({ ...args, variantId: select.value }, button); }); output.append(button);
    }
    if (data.truncated) output.append(node('p', 'Provider results are limited: up to 100 variants and 200 observations are shown.'));
    if (!data.points.length) { output.append(node('p', data.variants.length && !data.variantId ? 'Select a variant to load its records.' : 'No usable history returned for the last 90 days. This does not mean the price never changed.')); return; }
    const prices = data.points.map(p => p.price);
    output.append(node('p', `Lowest in returned records: ${money(Math.min(...prices))} · highest: ${money(Math.max(...prices))}. Shipping, personalized vouchers and cashback are not included.`));
    const container = node('div'); container.className = 'history-table-scroll';
    const table = node('table'); table.className = 'external-history-table'; table.append(node('caption', `${data.points.length} recorded prices · newest first`));
    const head = node('thead'), header = node('tr');
    for (const text of ['Observed', 'Price', 'Stock']) { const th = node('th', text); th.scope = 'col'; header.append(th); } head.append(header); table.append(head);
    const body = node('tbody');
    for (const point of [...data.points].reverse()) { const row = node('tr'); row.append(node('td', new Date(point.at).toLocaleString()), node('td', money(point.price)), node('td', point.inStock === true ? 'In stock then' : point.inStock === false ? 'Out of stock then' : 'Unknown')); body.append(row); }
    table.append(body); container.append(table); output.append(container);
  }
  async function lookup(args, button) {
    const epoch = ++revision; button.disabled = true; button.setAttribute('aria-busy', 'true'); output.replaceChildren(); status.textContent = 'Loading provider history…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'BUDOL_HISTORY_LOOKUP', ...args });
      if (epoch !== revision) return;
      if (!response?.ok) throw new Error(response?.error || 'Provider lookup failed.');
      render(response.history, args); status.textContent = response.history.stale ? 'Showing cached history; refresh failed.' : 'History lookup complete.';
    } catch (error) {
      if (epoch === revision) {
        status.textContent = error.message;
        const retry = node('button', 'Try this lookup again'); retry.type = 'button';
        retry.addEventListener('click', () => lookup(args, retry)); output.append(retry);
      }
    }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
  $('external-history-form').addEventListener('submit', async event => {
    event.preventDefault();
    const provider = $('history-provider').value; let url;
    try {
      url = BudolHistory.identity($('history-url').value).url;
      if (provider === 'pricetrack' && !url.startsWith('https://shopee.ph/')) throw new Error('Choose AiPrice for Lazada history.');
      // Request only the selected provider's optional host access, from this gesture.
      const epoch = ++revision;
      const allowed = await chrome.permissions.request({ origins: [BudolHistory.PROVIDERS[provider].origin] });
      if (epoch !== revision) return;
      if (!allowed) throw new Error('Provider access was not enabled.');
      await lookup({ provider, url, variantId: '' }, $('history-lookup'));
    } catch (error) { status.textContent = error.message; }
  });
  $('clear-external-history').addEventListener('click', async () => {
    const button = $('clear-external-history'); button.disabled = true; reset();
    try { const result = await chrome.runtime.sendMessage({ type: 'BUDOL_HISTORY_CLEAR' }); if (!result?.ok) throw new Error(result?.error || 'Cleanup failed.'); $('history-clear-status').textContent = 'External history cache cleared. Local history and watches remain.'; }
    catch (error) { $('history-clear-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
