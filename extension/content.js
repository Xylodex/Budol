(() => {
  'use strict';
  if (globalThis.__budolLoaded) return;
  globalThis.__budolLoaded = true;

  const { DEFAULTS, normalizeSettings, getDiscount, findCards } = globalThis.Budol;
  let settings = { ...DEFAULTS };
  let highlighted = new Set();
  let badges = new Set();
  let muted = new Set();
  let scanTimer = null;
  let ready = false;
  let storageRevision = 0;
  let status = { total: 0, matched: 0, discounted: 0, muted: 0 };

  function scan() {
    if (!ready) return;
    const nextHighlights = new Set();
    const nextBadges = new Set();
    const nextMuted = new Set();
    const cards = findCards(document);
    let discounted = 0;
    for (const card of cards) {
      const discount = getDiscount(card);
      const matches = discount !== null && discount.value >= settings.threshold;
      if (discount !== null) discounted += 1;
      if (settings.enabled && settings.focus && !matches) {
        nextMuted.add(card);
        card.setAttribute('data-budol-muted', '');
      }
      if (!settings.enabled || !matches) continue;
      nextHighlights.add(card);
      nextBadges.add(discount.badge);
      card.setAttribute('data-budol-match', '');
      discount.badge.setAttribute('data-budol-badge', '');
    }
    for (const card of highlighted) {
      if (!nextHighlights.has(card)) card.removeAttribute('data-budol-match');
    }
    for (const badge of badges) {
      if (!nextBadges.has(badge)) badge.removeAttribute('data-budol-badge');
    }
    for (const card of muted) {
      if (!nextMuted.has(card)) card.removeAttribute('data-budol-muted');
    }
    highlighted = nextHighlights;
    badges = nextBadges;
    muted = nextMuted;
    status = { total: cards.length, matched: highlighted.size, discounted, muted: muted.size };
  }

  function scheduleScan() {
    // Throttle instead of restarting the timer, so continuous loading cannot starve a scan.
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 150);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'href', 'class', 'hidden'],
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.threshold && !changes.enabled && !changes.focus)) return;
    storageRevision += 1;
    settings = normalizeSettings({
      threshold: changes.threshold ? changes.threshold.newValue : settings.threshold,
      enabled: changes.enabled ? changes.enabled.newValue : settings.enabled,
      focus: changes.focus ? changes.focus.newValue : settings.focus,
    });
    ready = true;
    scan();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'BUDOL_GET_STATUS') return;
    scan();
    sendResponse({ ...status, ...settings, ready });
  });

  const initialRevision = storageRevision;
  chrome.storage.local.get(DEFAULTS).then(saved => {
    if (initialRevision === storageRevision) settings = normalizeSettings(saved);
  }).catch(() => {
    // A temporary storage failure still leaves the default highlighter usable.
  }).finally(() => {
    ready = true;
    scan();
  });
})();
