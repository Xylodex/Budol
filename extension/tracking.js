/* Carrier adapters. Official website APIs are undocumented and may change. */
(() => {
  'use strict';
  const CARRIERS = Object.freeze({
    spx: { name: 'SPX Express', origin: 'https://spx.ph/*', help: 'Refresh directly from SPX. If access is restricted, use its official tracker.', url: number => `https://spx.ph/track?${encodeURIComponent(number)}` },
    jt: { name: 'J&T Express', origin: 'https://ylofficialjw.jtexpress.ph/*', help: 'Refresh checks J&T’s verification requirement. If CAPTCHA is required, copy the number and use its official tracker.', url: () => 'https://www.jtexpress.ph/trajectoryQuery?flag=1' },
    lbc: { name: 'LBC Express', origin: 'https://www.lbcexpress.com/*', help: 'Refresh directly from LBC’s public tracker.', url: number => `https://www.lbcexpress.com/track/?tracking-number=${encodeURIComponent(number)}` },
    ninja: { name: 'Ninja Van', help: 'Official tracker only. Ninja Van’s documented API requires a shipper account.', url: number => `https://www.ninjavan.co/en-ph/tracking?id=${encodeURIComponent(number)}` },
    flash: { name: 'Flash Express', help: 'Official tracker only. Copy the tracking number before opening the site.', url: () => 'https://www.flashexpress.ph/tracking/' },
  });
  const clean = (value, max = 600) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  function input(carrier, number, label = '') {
    if (!Object.hasOwn(CARRIERS, carrier)) throw new Error('Choose a supported carrier.');
    if (typeof number !== 'string' || typeof label !== 'string') throw new Error('Enter a tracking number and optional label.');
    number = number.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{5,39}$/.test(number)) throw new Error('Use a tracking number of 6–40 letters, digits or hyphens.');
    if (carrier === 'lbc' && !/^\d{6,16}$/.test(number)) throw new Error('LBC tracking numbers must contain 6–16 digits.');
    if (label.trim().length > 80) throw new Error('Keep the parcel label under 81 characters.');
    return { carrier, number, label: clean(label, 80) };
  }
  function failure(code, message, retryMs = 0) { return Object.assign(new Error(message), { code, retryMs }); }
  const unavailable = () => failure('unavailable', 'The carrier could not return tracking details. Check the number or open the official tracker.');
  const malformed = () => failure('format', 'The carrier returned an unsupported response. Open the official tracker.');
  function timestamp(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    const ms = value < 1e12 ? value * 1000 : value;
    return ms < 8640000000000000 ? ms : null;
  }
  function snapshot(status, events) {
    const seen = new Set();
    events = events.filter(event => {
      if (!event.description) return false;
      const key = JSON.stringify(event);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 100);
    if (!events.length && !clean(status)) throw unavailable();
    return { status: clean(status, 200) || events[0].description, events };
  }
  function parseSpx(json, number) {
    if (!json || typeof json.retcode !== 'number') throw malformed();
    if (json.retcode !== 0) throw unavailable();
    const data = json.data, records = data?.sls_tracking_info?.records;
    if (!Array.isArray(records)) throw malformed();
    const returned = data.order_info?.sls_tn;
    if (returned && returned !== number) throw failure('mismatch', 'The carrier returned a different tracking number. Open the official tracker.');
    const events = records.slice(0, 500).map(row => ({ description: clean(row?.description), at: timestamp(row?.actual_time), date: '', location: '' }));
    // SPX supplies epoch seconds; newest scan first even if source order changes.
    events.sort((a, b) => (b.at || 0) - (a.at || 0));
    return snapshot(data.order_info?.tracking_code_subgroup_name, events);
  }
  function parseJt(json, number) {
    if (json?.succ !== true) throw unavailable();
    if (!Array.isArray(json.data)) throw malformed();
    const parcel = json.data.find(row => row?.billcode === number);
    if (!parcel) throw failure('mismatch', 'J&T did not return this tracking number. Open the official tracker.');
    if (!Array.isArray(parcel.details)) throw malformed();
    // Keep J&T's newest-first order and date text: its response omits timezone.
    const events = parcel.details.slice(0, 100).map(row => ({ description: clean(row?.scanstatus), at: timestamp(row?.acceptTime), date: clean(row?.acceptTime, 80), location: clean(row?.city, 120) }));
    return snapshot('', events);
  }
  function parseLbc(json, number) {
    const status = json?.data?.Body?.LBCTrackAndTraceResponse?.LBCTrackAndTraceResult?.TrackingStatus;
    if (json?.success !== true || !status) throw malformed();
    if (status.StatusCode !== '0001') throw unavailable();
    const returned = status.TrackingDetails?.TrackingDetails?.TrackingNo;
    if (returned !== number) throw failure('mismatch', 'LBC returned a different tracking number. Open the official tracker.');
    const history = status.TrackingHistory?.TrackingHistory;
    if (!history || typeof history !== 'object') throw malformed();
    const rows = Array.isArray(history) ? history : [history];
    // LBC's public UI reverses its oldest-first history; retain date/time verbatim.
    const events = rows.slice(-100).reverse().map(row => ({ description: clean(row?.StatusandLocation), at: null, date: [clean(row?.DatePosted, 40), clean(row?.DatePostedTime, 40)].filter(Boolean).join(' '), location: '' }));
    return snapshot('', events);
  }
  async function request(url, signal, options = {}, asText = false) {
    const response = await fetch(url, { ...options, signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      throw failure('rate', 'The carrier is rate-limiting requests. Try again later.', Math.max(60000, Math.min(Number.isFinite(delay) ? delay : 60000, 86400000)));
    }
    if ([401, 403].includes(response.status)) throw failure('verification', 'The carrier requires verification. Open the official tracker.');
    if (!response.ok) throw failure('network', 'The carrier is unavailable. Try again later or open its official tracker.');
    // Bound the streamed body before JSON parsing or looking for a public nonce.
    if (Number(response.headers.get('Content-Length')) > 2000000) throw malformed();
    const reader = response.body?.getReader();
    if (!reader) throw malformed();
    const decoder = new TextDecoder(); let text = '', size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2000000) { await reader.cancel(); throw malformed(); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    if (asText) return text;
    try { return JSON.parse(text); } catch { throw malformed(); }
  }
  async function lookup(carrier, number, signal) {
    input(carrier, number);
    if (carrier === 'spx') {
      const url = new URL('https://spx.ph/shipment/order/open/order/get_order_info');
      url.search = new URLSearchParams({ spx_tn: number, language_code: 'en-ph' });
      return parseSpx(await request(url.href, signal), number);
    }
    if (carrier === 'jt') {
      const base = 'https://ylofficialjw.jtexpress.ph/website/';
      const headers = { langType: 'EN', timezone: 'GMT+0800', authToken: '' };
      const gate = await request(`${base}base/info/captcha/isShowSlider`, signal, { headers });
      // Only follow the site's no-CAPTCHA path after an explicit false response.
      if (gate?.code !== 1 || gate.data !== false) throw failure('verification', 'J&T requires CAPTCHA verification. Copy the number and open the official tracker.');
      return parseJt(await request(`${base}track/query`, signal, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ billCodes: [number], verify: 'test', vck: 'test' }) }), number);
    }
    if (carrier === 'lbc') {
      const page = await request('https://www.lbcexpress.com/track/', signal, {}, true);
      const nonce = page.match(/"track_package_nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1];
      if (!nonce) throw malformed();
      const body = new URLSearchParams({ action: 'track_package', security: nonce, trackingNumber: number });
      return parseLbc(await request('https://www.lbcexpress.com/wp-admin/admin-ajax.php', signal, { method: 'POST', body }), number);
    }
    throw failure('site', 'Use this carrier’s official tracker. In-app refresh is not available.');
  }
  globalThis.BudolTracking = { CARRIERS, input, lookup, parseSpx, parseJt, parseLbc };
})();
