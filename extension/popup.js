(() => {
  'use strict';
  const { DEFAULTS, normalizeSettings } = globalThis.Budol;
  const threshold = document.getElementById('threshold');
  const range = document.getElementById('threshold-range');
  const enabled = document.getElementById('enabled');
  const focus = document.getElementById('focus');
  const error = document.getElementById('error');
  const saveStatus = document.getElementById('save-status');
  document.getElementById('open-board').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`board.html${tab?.id !== undefined ? `?tab=${tab.id}` : ''}`) });
    } catch { error.textContent = 'Could not open the board. Reload Budol and try again.'; error.hidden = false; }
  });
  let settings = { ...DEFAULTS };
  let pendingWrites = Promise.resolve();
  let revision = 0;
  let statusRevision = 0;

  function render() {
    threshold.value = settings.threshold;
    range.value = settings.threshold;
    enabled.checked = settings.enabled;
    focus.checked = settings.focus;
    focus.disabled = !settings.enabled;
    document.getElementById('boundary').textContent = `${settings.threshold}%`;
  }

  async function refreshStatus() {
    const requestRevision = ++statusRevision;
    let result;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) result = await chrome.tabs.sendMessage(tab.id, { type: 'BUDOL_GET_STATUS' });
    } catch { /* Tabs without the content script cannot answer. */ }
    if (requestRevision !== statusRevision) return;
    const title = document.getElementById('status-title');
    const detail = document.getElementById('status-detail');
    const panel = document.querySelector('.page-status');
    panel.dataset.state = result?.ready && settings.enabled ? 'active' : 'idle';
    if (!result?.ready) {
      title.textContent = 'Page highlighting is unavailable here';
      detail.textContent = 'External prices and saved products work without Shopee open.';
    } else if (!settings.enabled) {
      title.textContent = 'Filter is paused';
      detail.textContent = 'Turn it on to mark matching products again.';
    } else if (result.total === 0) {
      title.textContent = 'Waiting for products';
      detail.textContent = 'Open a shop, category, or search results on Shopee.';
    } else {
      title.textContent = `${result.matched} ${result.matched === 1 ? 'product' : 'products'} highlighted`;
      detail.textContent = settings.focus
        ? `${result.total} loaded products checked. ${result.muted} faded.`
        : `${result.total} loaded products checked. Scroll to load more.`;
    }
  }

  function save() {
    const snapshot = { ...settings };
    const saveRevision = ++revision;
    saveStatus.textContent = 'Saving...';
    // Keep writes in input order, including fast slider changes.
    pendingWrites = pendingWrites.then(async () => {
      try {
        await chrome.storage.local.set(snapshot);
        if (saveRevision === revision) {
          saveStatus.textContent = 'Saved automatically';
          if (threshold.getAttribute('aria-invalid') !== 'true') error.hidden = true;
          await refreshStatus();
        }
      } catch {
        if (saveRevision === revision) {
          saveStatus.textContent = 'Not saved';
          error.textContent = 'Could not save. Change the setting to try again.';
          error.hidden = false;
        }
      }
    });
  }

  function setThreshold(value) {
    settings.threshold = value;
    threshold.removeAttribute('aria-invalid');
    error.hidden = true;
    render();
    save();
  }

  threshold.addEventListener('input', () => {
    const value = threshold.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > 100 || !threshold.validity.valid) {
      threshold.setAttribute('aria-invalid', 'true');
      error.textContent = 'Enter a percentage from 0 to 100, with up to one decimal place.';
      error.hidden = false;
      return;
    }
    setThreshold(value);
  });
  threshold.addEventListener('blur', () => {
    if (threshold.getAttribute('aria-invalid') === 'true') {
      threshold.removeAttribute('aria-invalid');
      error.hidden = true;
      render();
    }
  });
  range.addEventListener('input', () => setThreshold(Number(range.value)));
  enabled.addEventListener('change', () => { settings.enabled = enabled.checked; render(); save(); });
  focus.addEventListener('change', () => { settings.focus = focus.checked; save(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const updates = {};
    for (const key of ['threshold', 'enabled', 'focus']) if (changes[key]) updates[key] = changes[key].newValue;
    if (!Object.keys(updates).length) return;
    settings = normalizeSettings({ ...settings, ...updates }); render(); refreshStatus();
  });

  async function initialize() {
    try {
      settings = normalizeSettings(await chrome.storage.local.get(DEFAULTS));
      saveStatus.textContent = 'Saved automatically';
    } catch {
      saveStatus.textContent = 'Using defaults';
      error.textContent = 'Could not load saved settings. Changes will try saving again.';
      error.hidden = false;
    }
    render();
    for (const control of [threshold, range, enabled]) control.disabled = false;
    await refreshStatus();
    // The popup only exists while open; keep counts current as the page loads.
    setInterval(refreshStatus, 1500);
  }
  initialize();
})();
