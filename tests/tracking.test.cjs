const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { webcrypto } = require('node:crypto');

const NUMBER = 'SPXPH123456789';
const spx = (number = NUMBER) => ({ retcode: 0, data: { order_info: { sls_tn: number, tracking_code_subgroup_name: 'In transit' }, sls_tracking_info: { records: [
  { description: 'Picked up', actual_time: 1700000000 }, { description: '<img src=x onerror=alert(1)> Arrived at hub', actual_time: 1700003600 },
] } } });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function harness(options = {}) {
  const state = structuredClone(options.state || {}), calls = [], listeners = [];
  let now = Date.now(), allowed = true;
  class Clock extends Date { static now() { return now; } }
  const signals = options.shortTimeout ? { any: AbortSignal.any.bind(AbortSignal), timeout: () => AbortSignal.timeout(20) } : AbortSignal;
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal: signals, AbortController, TextDecoder, Date: Clock, crypto: webcrypto,
    fetch: async (url, init) => { calls.push({ url, init }); return options.fetch ? options.fetch(url, init) : json(spx()); },
    chrome: {
      runtime: { getURL: file => `chrome-extension://budol/${file}`, onMessage: { addListener: fn => listeners.push(fn) } },
      storage: { local: {
        get: async key => ({ [key]: structuredClone(state[key]) }),
        set: async entries => { Object.assign(state, structuredClone(entries)); },
      } }, permissions: { contains: async () => allowed },
    },
  });
  for (const file of ['tracking.js', 'tracking-background.js']) vm.runInContext(readFileSync(resolve(__dirname, '../extension', file), 'utf8'), context);
  const send = (action, args = {}, url = 'chrome-extension://budol/options.html') => new Promise(done => listeners[0]({ type: `BUDOL_TRACKING_${action}`, ...args }, { url }, done));
  const add = async (carrier = 'spx', number = NUMBER, label = '') => { const result = await send('ADD', { carrier, number, label }); assert.equal(result.ok, true, result.error); return state.budolParcels[0].id; };
  return { state, calls, send, add, api: context.BudolTracking, advance: () => { now += 90000; }, deny: () => { allowed = false; } };
}

test('save, deduplicate, validate, cap and remove parcels without any network requests', async () => {
  const h = harness(), id = await h.add('spx', ` ${NUMBER.toLowerCase()} `, 'Cabinet');
  assert.equal(h.state.budolParcels[0].number, NUMBER);
  assert.match((await h.send('ADD', { carrier: 'spx', number: NUMBER, label: '' })).error, /already saved/);
  for (const args of [{ carrier: '__proto__', number: NUMBER }, { carrier: 'lbc', number: 'ABC123456' }, { carrier: 'spx', number: '../foo?bar' }, { carrier: 'spx', number: NUMBER, label: 'a'.repeat(81) }]) assert.equal((await h.send('ADD', args)).ok, false);
  for (let i = 1; i < 50; i++) await h.add('spx', `SPXPH00000${i}`);
  assert.match((await h.send('ADD', { carrier: 'spx', number: 'SPXPH999999' })).error, /50 parcels/);
  await h.send('REMOVE', { id }); assert.equal(h.state.budolParcels.length, 49);
  assert.equal(h.calls.length, 0);
});

test('all parcel actions are restricted to the extension options page', async () => {
  const h = harness();
  for (const action of ['LIST', 'ADD', 'REMOVE', 'REFRESH', 'CLEAR_CACHE', 'CLEAR_ALL']) {
    for (const url of ['https://shopee.ph/', 'chrome-extension://budol/board.html', 'chrome-extension://other/options.html']) {
      assert.equal((await h.send(action, {}, url)).ok, false);
    }
  }
  assert.equal(h.calls.length, 0);
});

test('SPX refresh saves normalized scans, omits cookies and leaves read/list offline', async () => {
  const h = harness(), id = await h.add();
  assert.equal((await h.send('REFRESH', { id })).refreshed, true);
  const row = h.state.budolParcels[0];
  assert.equal(row.snapshot.events[0].at, 1700003600000);
  assert.match(row.snapshot.events[0].description, /<img/);
  assert.equal(row.snapshot.status, 'In transit');
  assert.equal(h.calls[0].init.credentials, 'omit'); assert.equal(h.calls[0].init.redirect, 'error');
  assert.equal(new URL(h.calls[0].url).searchParams.get('spx_tn'), NUMBER);
  await h.send('LIST'); assert.equal(h.calls.length, 1);
  assert.match((await h.send('REFRESH', { id })).error, /Wait/);
  await h.send('CLEAR_CACHE'); assert.equal(h.state.budolParcels[0].snapshot, null);
  assert.match((await h.send('REFRESH', { id })).error, /Wait/); // Clearing cache cannot bypass throttling.
});

test('permissions and official-site-only carriers never trigger network lookups', async () => {
  const h = harness(), id = await h.add(); h.deny();
  assert.match((await h.send('REFRESH', { id })).error, /Allow access/);
  const ninja = await h.add('ninja', 'NINJAPH12345');
  assert.match((await h.send('REFRESH', { id: ninja })).error, /official tracker/);
  assert.equal(h.calls.length, 0);
});

test('J&T checks CAPTCHA first and never submits a tracking number when verification is required', async () => {
  const h = harness({ fetch: () => json({ code: 1, succ: true, data: true }) }), id = await h.add('jt', '123456789012');
  assert.equal((await h.send('REFRESH', { id })).refreshed, false);
  assert.match(h.state.budolParcels[0].error.message, /CAPTCHA/);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init.body, undefined);
});

test('J&T only uses the official no-verification path after an explicit false gate', async () => {
  const number = '123456789012';
  const h = harness({ fetch: url => json(url.includes('isShowSlider') ? { code: 1, data: false } : { succ: true, data: [{ billcode: number, details: [{ scanstatus: 'Delivered', acceptTime: '2026-11-02 13:40:00', city: 'Manila' }] }] }) });
  const id = await h.add('jt', number); assert.equal((await h.send('REFRESH', { id })).refreshed, true);
  assert.deepEqual(JSON.parse(h.calls[1].init.body), { billCodes: [number], verify: 'test', vck: 'test' });
  assert.equal(h.state.budolParcels[0].snapshot.events[0].date, '2026-11-02 13:40:00');
});

test('an unknown J&T verification response never falls through to the tracking endpoint', async () => {
  for (const gate of [{ code: 1, data: 'false' }, { code: 0, data: false }, {}, { code: 1 }]) {
    const h = harness({ fetch: () => json(gate) }), id = await h.add('jt', '123456789012');
    assert.equal((await h.send('REFRESH', { id })).refreshed, false); assert.equal(h.calls.length, 1);
  }
});

test('a stalled carrier request times out and releases its in-flight slot', async () => {
  const h = harness({ shortTimeout: true, fetch: (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json(spx())), 500);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) }), id = await h.add();
  assert.equal((await h.send('REFRESH', { id })).refreshed, false);
  assert.match(h.state.budolParcels[0].error.message, /timed out/);
  h.advance(); assert.equal((await h.send('REFRESH', { id })).refreshed, false);
  assert.equal(h.calls.length, 2);
});

test('LBC obtains a fresh nonce and validates the returned tracking identity', async () => {
  const number = '001234567890';
  const data = { success: true, data: { Body: { LBCTrackAndTraceResponse: { LBCTrackAndTraceResult: { TrackingStatus: {
    StatusCode: '0001', TrackingDetails: { TrackingDetails: { TrackingNo: number, ShipperAddress: 'PRIVATE' } },
    TrackingHistory: { TrackingHistory: [{ StatusandLocation: 'Accepted', DatePosted: '11/01/2026' }, { StatusandLocation: 'Delivered', DatePosted: '11/02/2026', DatePostedTime: '01:00:00 PM' }] },
  } } } } } };
  const h = harness({ fetch: url => url.endsWith('/track/') ? new Response('var x={"track_package_nonce":"012345abcd"};') : json(data) });
  const id = await h.add('lbc', number); assert.equal((await h.send('REFRESH', { id })).refreshed, true);
  const body = h.calls[1].init.body; assert.equal(body.get('trackingNumber'), number); assert.equal(body.get('security'), '012345abcd');
  assert.equal(h.state.budolParcels[0].snapshot.events[0].description, 'Delivered');
  assert.equal(JSON.stringify(h.state).includes('PRIVATE'), false);
  assert.throws(() => h.api.parseLbc(data, '9999999999'), /different tracking/);
});

test('network failure preserves older scans and records a failed attempt', async () => {
  let offline = false;
  const h = harness({ fetch: () => { if (offline) throw Error('private network info'); return json(spx()); } }), id = await h.add();
  await h.send('REFRESH', { id }); const cached = structuredClone(h.state.budolParcels[0].snapshot);
  offline = true; h.advance(); assert.equal((await h.send('REFRESH', { id })).refreshed, false);
  assert.deepEqual(h.state.budolParcels[0].snapshot, cached);
  assert.match(h.state.budolParcels[0].error.message, /cached scans/);
  assert.equal(JSON.stringify(h.state).includes('private network'), false);
});

test('malformed, blocked and oversized responses do not become successful tracking statuses', async () => {
  for (const response of [new Response('<html>captcha</html>'), json({}, 403), json({ retcode: 0, data: {} }), new Response('x'.repeat(2000001))]) {
    const h = harness({ fetch: () => response }), id = await h.add();
    assert.equal((await h.send('REFRESH', { id })).refreshed, false);
    assert.equal(h.state.budolParcels[0].snapshot, null); assert.ok(h.state.budolParcels[0].error);
  }
});

test('rate-limit Retry-After is persisted across worker restarts', async () => {
  const h = harness({ fetch: () => json({}, 429, { 'Retry-After': '3600' }) }), id = await h.add();
  await h.send('REFRESH', { id }); h.advance();
  const restarted = harness({ state: h.state });
  assert.match((await restarted.send('REFRESH', { id })).error, /Wait/);
  assert.equal(restarted.calls.length, 0);
});

test('delete, clear cache and clear all cannot resurrect an in-flight response', async () => {
  for (const action of ['REMOVE', 'CLEAR_CACHE', 'CLEAR_ALL']) {
    let finish, started;
    const began = new Promise(resolve => { started = resolve; });
    const h = harness({ fetch: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
    const id = await h.add(), pending = h.send('REFRESH', { id }); await began;
    assert.match((await h.send('REFRESH', { id })).error, /already running/);
    await h.send(action, { id }); finish(json(spx()));
    assert.equal((await pending).ok, false);
    if (action === 'CLEAR_CACHE') assert.equal(h.state.budolParcels[0].snapshot, null);
    else assert.deepEqual(h.state.budolParcels, []);
  }
});

test('parser bounds timelines and text without including private response fields', () => {
  const h = harness(), data = spx();
  data.data.sls_tracking_info.records = Array.from({ length: 600 }, (_, i) => ({ description: `${i} ${'x'.repeat(900)}`, actual_time: 1700000000 + i }));
  const parsed = h.api.parseSpx(data, NUMBER);
  assert.equal(parsed.events.length, 100); assert.ok(parsed.events.every(row => row.description.length <= 600));
  assert.equal(parsed.events[0].at, 1700000599000);
  assert.throws(() => h.api.parseSpx(spx('WRONGNUMBER'), NUMBER), /different tracking/);
  assert.throws(() => h.api.parseSpx({ retcode: 2 }, NUMBER), /could not return/);
});

test('clear all recovers unreadable storage without resetting carrier rate limits', async () => {
  const h = harness({ state: { budolParcels: { broken: true }, budolTrackingCooldowns: { spx: Date.now() + 60000 } } });
  assert.equal((await h.send('LIST')).ok, false);
  assert.equal((await h.send('CLEAR_ALL')).ok, true);
  assert.deepEqual(h.state.budolParcels, []); assert.ok(h.state.budolTrackingCooldowns.spx);
});
