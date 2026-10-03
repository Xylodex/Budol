(() => {
  "use strict";

  const DEFAULTS = Object.freeze({ threshold: 50, enabled: true, focus: false });
  const CARD_SELECTOR = [
    '[role="group"][aria-label="Product card"]',
    '[data-sqe="item"]',
    '.shopee-search-item-result__item',
    '.shopee-item-card',
  ].join(',');

  function normalizeSettings(value = {}) {
    return {
      threshold: typeof value.threshold === 'number' && Number.isFinite(value.threshold)
        ? Math.min(100, Math.max(0, value.threshold)) : DEFAULTS.threshold,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
      focus: typeof value.focus === 'boolean' ? value.focus : DEFAULTS.focus,
    };
  }

  function parseDiscount(text, allowBare = false) {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    const patterns = [
      /^[-\u2212\u2013]\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/,
      /^(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:off|discount)$/i,
      /^(?:discount|save)\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/i,
    ];
    if (allowBare) patterns.push(/^(\d{1,3}(?:[.,]\d+)?)\s*%$/);
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (!match) continue;
      const value = Number(match[1].replace(',', '.'));
      if (value >= 0 && value <= 100) return value;
    }
    return null;
  }

  function usableBadge(element) {
    if (element.closest('script, style, template, [hidden], [aria-hidden="true"], [data-budol-ignore], [data-sqe="name"], [class*="line-clamp-2"], h1')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = element.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function conditionalBadge(element, card) {
    for (let node = element, depth = 0; node && node !== card && depth < 3; node = node.parentElement, depth++) {
      if (node.querySelector('[aria-label="promotion price"], [aria-label="price"], [data-sqe="name"], [class*="line-clamp-2"]')) break;
      const text = `${node.getAttribute('aria-label') || ''} ${node.textContent}`.replace(/\s+/g, ' ').trim();
      if (text.length < 300 && /voucher|cashback|\bcoins?\b|shipping|spaylater|shopeepay|\bbank\b|\bpayment\b|\bbundle\b|\badd.on\b|\b(?:buy|any)\s+\d|\b(?:live|video)\b|new\s+user|first\s+order|up\s+to/i.test(text)) return true;
    }
    return false;
  }

  function getDiscount(card) {
    // Current Shopee cards expose the displayed discount as an accessible label.
    for (const label of card.querySelectorAll('[aria-label]')) {
      if (!usableBadge(label) || conditionalBadge(label, card)) continue;
      const value = parseDiscount(label.getAttribute('aria-label'));
      if (value !== null) {
        const parent = label.parentElement;
        const badge = parent && parseDiscount(parent.textContent) === value ? parent : label;
        return { value, badge };
      }
    }

    // Older cards use separate percentage and OFF elements inside a sale badge.
    for (const badge of card.querySelectorAll(
      '.shopee-badge__promotion, .shopee-badge--promotion, [data-sqe="discount"], [data-testid="discount-badge"]',
    )) {
      if (!usableBadge(badge) || conditionalBadge(badge, card)) continue;
      const percent = badge.querySelector('.percent');
      const value = parseDiscount(percent ? percent.textContent : badge.textContent, true);
      if (value !== null) return { value, badge };
    }

    // Require an explicit discount marker. A title such as "100% cotton" is not a sale.
    for (const badge of card.querySelectorAll('span, div, small')) {
      if (!usableBadge(badge) || conditionalBadge(badge, card) || badge.children.length > 0) continue;
      const value = parseDiscount(badge.textContent);
      if (value !== null) return { value, badge };
    }
    return null;
  }

  function findCards(root) {
    const cards = new Set([...root.querySelectorAll(CARD_SELECTOR)]
      .filter(card => !card.querySelector(CARD_SELECTOR)));

    // Product URLs survive changes to Shopee's generated CSS class names.
    for (const link of root.querySelectorAll('a[href*="-i."], a[href*="/product/"]')) {
      if (link.closest(CARD_SELECTOR) || link.querySelector(CARD_SELECTOR) || !link.querySelector('img')) continue;
      let url;
      try { url = new URL(link.getAttribute('href'), 'https://shopee.ph'); } catch { continue; }
      if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) continue;
      if (!/(?:-i\.\d+\.\d+\/?$|^\/product\/\d+\/\d+\/?$)/.test(url.pathname)) continue;
      // display: contents anchors have no box to outline.
      cards.add(link.classList.contains('contents') && link.children.length === 1
        ? link.firstElementChild : link);
    }
    return [...cards];
  }

  globalThis.Budol = Object.freeze({ DEFAULTS, normalizeSettings, parseDiscount, getDiscount, findCards });
})();
