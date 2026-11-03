(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('parcel-form'), list = $('parcel-list'), carrierSelect = $('parcel-carrier');
  const status = $('parcel-status'), error = $('parcel-error'), busy = new Map();
  let parcels = [], loadVersion = 0;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
  const date = value => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  function notice(text, failed = false) {
    error.hidden = !failed; error.textContent = failed ? text : ''; status.textContent = failed ? '' : text;
  }
  async function message(action, args = {}) {
    const response = await chrome.runtime.sendMessage({ type: `BUDOL_TRACKING_${action}`, ...args });
    if (!response?.ok) throw new Error(response?.error || 'Could not reach Budol. Reload the extension and try again.');
    return response;
  }
  function button(text, action, id) {
    const control = node('button', text); control.type = 'button'; control.dataset.action = action; control.dataset.id = id; return control;
  }
  function render() {
    const open = new Set([...list.querySelectorAll('details[open]')].map(el => el.dataset.id));
    const focused = list.contains(document.activeElement) ? { id: document.activeElement.dataset.id, action: document.activeElement.dataset.action } : null;
    list.replaceChildren(); $('parcel-count').textContent = `${parcels.length} / 50`;
    $('parcel-clear-all').disabled = !parcels.length;
    $('parcel-clear-cache').disabled = !parcels.some(parcel => parcel.snapshot || parcel.lastAttempt) && !busy.size;
    if (!parcels.length) list.append(node('p', 'No saved parcels. Add the carrier’s tracking number above.', 'parcel-empty'));
    for (const parcel of parcels) {
      const config = BudolTracking.CARRIERS[parcel.carrier]; if (!config) continue;
      const card = node('article', '', 'parcel-card'); card.setAttribute('aria-label', parcel.label || parcel.number);
      const heading = node('div', '', 'parcel-heading');
      heading.append(node('h3', parcel.label || config.name), node('span', config.origin ? 'Manual refresh' : 'Official site', 'parcel-mode'));
      card.append(heading, node('p', `${config.name} · ${parcel.number}`, 'parcel-number'));
      const snapshot = parcel.snapshot;
      const emptyState = parcel.error ? (parcel.error.code === 'verification' ? 'Verification required' : 'Tracking unavailable') : (config.origin ? 'Not checked yet' : 'Check on the carrier’s site');
      card.append(node('p', snapshot?.status || emptyState, 'parcel-state'));
      if (snapshot) card.append(node('p', `Cached scans · fetched ${date(snapshot.fetchedAt)}${parcel.error ? ' · refresh failed' : ''}`, 'hint'));
      if (parcel.error) card.append(node('p', `${parcel.error.message} Last attempt: ${date(parcel.lastAttempt)}.`, 'parcel-warning'));
      const actions = node('div', '', 'actions');
      if (config.origin) {
        const refresh = button(busy.has(parcel.id) ? 'Refreshing…' : 'Refresh', 'refresh', parcel.id);
        refresh.disabled = [...busy.values()].includes(parcel.carrier); actions.append(refresh);
      }
      actions.append(button('Copy number', 'copy', parcel.id));
      const link = node('a', 'Open official tracker', 'button-link');
      link.href = config.url(parcel.number); link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
      actions.append(button('Remove', 'remove', parcel.id)); card.append(actions);
      if (snapshot?.events.length) {
        const details = node('details'); details.dataset.id = parcel.id; details.open = open.has(parcel.id);
        details.append(node('summary', `Scan history (${snapshot.events.length}${snapshot.events.length === 100 ? ', latest 100' : ''})`));
        const timeline = node('ol', '', 'parcel-timeline');
        for (const event of snapshot.events) {
          const scan = node('li');
          scan.append(node('p', event.description));
          if (event.at || event.date) scan.append(node('p', event.at ? date(event.at) : `${event.date} (carrier time)`, 'hint'));
          if (event.location) scan.append(node('p', event.location, 'hint'));
          timeline.append(scan);
        }
        details.append(timeline); card.append(details);
      }
      list.append(card);
    }
    if (focused) [...list.querySelectorAll('button')].find(el => el.dataset.id === focused.id && el.dataset.action === focused.action)?.focus();
  }
  async function load() {
    const version = ++loadVersion;
    try {
      const response = await message('LIST');
      if (version === loadVersion) { parcels = response.parcels; render(); }
    }
    catch (failure) { $('parcel-clear-all').disabled = false; throw failure; }
  }
  for (const [id, config] of Object.entries(BudolTracking.CARRIERS)) {
    const option = node('option', config.name); option.value = id; carrierSelect.append(option);
  }
  function carrierHelp() { $('parcel-carrier-help').textContent = BudolTracking.CARRIERS[carrierSelect.value].help; }
  carrierSelect.addEventListener('change', carrierHelp); carrierHelp();
  form.addEventListener('submit', async event => {
    event.preventDefault(); const submit = form.querySelector('button'); submit.disabled = true;
    try {
      await message('ADD', { carrier: carrierSelect.value, number: $('parcel-number').value, label: $('parcel-label').value });
      $('parcel-number').value = ''; $('parcel-label').value = '';
      await load(); notice('Parcel saved. Use Refresh or open its official tracker.'); $('parcel-number').focus();
    } catch (failure) { notice(failure.message, true); } finally { submit.disabled = false; }
  });
  list.addEventListener('click', async event => {
    const control = event.target.closest('button[data-action]'); if (!control) return;
    const parcel = parcels.find(row => row.id === control.dataset.id); if (!parcel) return;
    const action = control.dataset.action;
    try {
      if (action === 'copy') { await navigator.clipboard.writeText(parcel.number); notice('Tracking number copied.'); return; }
      if (action === 'remove') {
        await message('REMOVE', { id: parcel.id }); await load(); notice('Parcel removed.'); $('parcel-number').focus(); return;
      }
      if (action === 'refresh') {
        // Request optional host access directly in the click gesture, before awaiting messages.
        const permission = chrome.permissions.request({ origins: [BudolTracking.CARRIERS[parcel.carrier].origin] });
        busy.set(parcel.id, parcel.carrier); render(); notice(`Refreshing ${parcel.label || parcel.number}…`);
        if (!await permission) throw new Error('Carrier access was not granted. You can still use the official tracker.');
        const result = await message('REFRESH', { id: parcel.id });
        notice(result.refreshed ? 'Latest carrier scans saved.' : 'Refresh could not complete. See the parcel for details.');
      }
    } catch (failure) { notice(failure.message, true); }
    finally { busy.delete(parcel.id); await load().catch(failure => notice(failure.message, true)); }
  });
  for (const [id, action, question, done] of [
    ['parcel-clear-cache', 'CLEAR_CACHE', 'Clear all cached scans? Your saved tracking numbers will stay.', 'Cached scans cleared. Tracking numbers kept.'],
    ['parcel-clear-all', 'CLEAR_ALL', 'Remove all saved parcels and cached scans from this device?', 'Saved parcels and scans cleared.'],
  ]) $(id).addEventListener('click', async () => {
    if (!confirm(question)) return;
    try { await message(action); await load(); notice(done); } catch (failure) { notice(failure.message, true); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.budolParcels) load().catch(failure => notice(failure.message, true));
  });
  load().catch(failure => notice(failure.message, true));
})();
