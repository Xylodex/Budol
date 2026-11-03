(() => {
  'use strict';
  const STORE = 'budolParcels', COOLDOWNS = 'budolTrackingCooldowns';
  const TYPES = ['LIST', 'ADD', 'REMOVE', 'REFRESH', 'CLEAR_CACHE', 'CLEAR_ALL'].map(action => `BUDOL_TRACKING_${action}`);
  let queue = Promise.resolve(), revision = 0;
  const active = new Map();
  const serialize = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function rows() {
    const data = (await chrome.storage.local.get(STORE))[STORE];
    if (data !== undefined && !Array.isArray(data)) throw new Error('Parcel storage is unreadable. Clear saved parcels to reset it.');
    return data || [];
  }
  const save = parcels => chrome.storage.local.set({ [STORE]: parcels });
  function cancel(id) {
    for (const [carrier, job] of active) if (!id || job.id === id) { job.controller.abort(); active.delete(carrier); }
  }
  async function refresh(id) {
    const epoch = revision;
    let job, parcel;
    await serialize(async () => {
      const parcels = await rows(); parcel = parcels.find(row => row.id === id);
      if (!parcel) throw new Error('This parcel was removed.');
      BudolTracking.input(parcel.carrier, parcel.number);
      const config = BudolTracking.CARRIERS[parcel.carrier];
      if (!config.origin) throw new Error('Use this carrier’s official tracker.');
      if (active.has(parcel.carrier)) throw new Error('A lookup for this carrier is already running.');
      if (!await chrome.permissions.contains({ origins: [config.origin] })) throw new Error('Allow access to this carrier when you click Refresh.');
      const { [COOLDOWNS]: cooldowns = {} } = await chrome.storage.local.get(COOLDOWNS);
      if (cooldowns[parcel.carrier] > Date.now()) throw new Error(`Wait ${Math.ceil((cooldowns[parcel.carrier] - Date.now()) / 1000)} seconds before refreshing this carrier again.`);
      await chrome.storage.local.set({ [COOLDOWNS]: { ...cooldowns, [parcel.carrier]: Date.now() + 30000 } });
      job = { id, controller: new AbortController() }; active.set(parcel.carrier, job);
    });
    try {
      let snapshot, failure;
      try { snapshot = await BudolTracking.lookup(parcel.carrier, parcel.number, AbortSignal.any([job.controller.signal, AbortSignal.timeout(15000)])); }
      catch (error) {
        failure = { code: error.code || 'network', message: /Abort|Timeout/.test(error.name) ? 'Tracking timed out or was cancelled. Try again or open the official tracker.' : (error.code ? error.message : 'Could not reach the carrier. Your cached scans are still available.') };
        if (error.retryMs) await serialize(async () => {
          const { [COOLDOWNS]: cooldowns = {} } = await chrome.storage.local.get(COOLDOWNS);
          await chrome.storage.local.set({ [COOLDOWNS]: { ...cooldowns, [parcel.carrier]: Date.now() + error.retryMs } });
        });
      }
      return await serialize(async () => {
        const parcels = await rows(), current = parcels.find(row => row.id === id);
        if (epoch !== revision || !current || job.controller.signal.aborted) throw new Error('Lookup cancelled because the parcel or cache was cleared.');
        current.lastAttempt = Date.now(); current.error = failure || null;
        if (snapshot) current.snapshot = { ...snapshot, fetchedAt: Date.now() };
        await save(parcels); return { ok: true, refreshed: !failure };
      });
    } finally { if (active.get(parcel.carrier) === job) active.delete(parcel.carrier); }
  }
  async function handle(message, sender) {
    if ((sender.url || '').split(/[?#]/)[0] !== chrome.runtime.getURL('options.html')) throw new Error('Open Budol settings to manage parcel tracking.');
    if (message.type === 'BUDOL_TRACKING_REFRESH') return refresh(message.id);
    return serialize(async () => {
      if (message.type === 'BUDOL_TRACKING_CLEAR_ALL') {
        revision++; cancel(); await save([]); return { ok: true };
      }
      const parcels = await rows();
      if (message.type === 'BUDOL_TRACKING_LIST') return { ok: true, parcels };
      if (message.type === 'BUDOL_TRACKING_ADD') {
        const value = BudolTracking.input(message.carrier, message.number, message.label);
        if (parcels.some(row => row.carrier === value.carrier && row.number === value.number)) throw new Error('This parcel is already saved.');
        if (parcels.length >= 50) throw new Error('You can save up to 50 parcels. Remove a finished parcel first.');
        parcels.unshift({ ...value, id: crypto.randomUUID(), createdAt: Date.now(), snapshot: null, error: null, lastAttempt: null });
      } else if (message.type === 'BUDOL_TRACKING_REMOVE') {
        cancel(message.id);
        await save(parcels.filter(row => row.id !== message.id)); return { ok: true };
      } else if (message.type === 'BUDOL_TRACKING_CLEAR_CACHE') {
        revision++; cancel();
        for (const parcel of parcels) { parcel.snapshot = null; parcel.error = null; parcel.lastAttempt = null; }
      }
      await save(parcels); return { ok: true };
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!TYPES.includes(message?.type)) return;
    handle(message, sender).then(respond, error => respond({ ok: false, error: error.message })); return true;
  });
})();
