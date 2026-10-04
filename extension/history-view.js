(() => {
  'use strict';
  const $ = id => document.getElementById(id), output = $('history-result'), status = $('history-status');
  let revision = 0;
  const node = (tag, text) => { const el = document.createElement(tag); if (text != null) el.textContent = text; return el; };
  const money = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
  function reset() { revision++; output.replaceChildren(); status.textContent = ''; }
  $('history-url').addEventListener('input', reset); $('history-provider').addEventListener('change', reset);
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
    } catch (error) { if (epoch === revision) status.textContent = error.message; }
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
