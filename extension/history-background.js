(() => {
  'use strict';
  const STORE = 'budolExternalHistory', TTL = 30 * 60000;
  let queue = Promise.resolve(), revision = 0;
  const active = new Map();
  const serialize = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function lookup(message) {
    const { provider, variantId = '' } = message;
    const item = BudolHistory.identity(message.url), config = BudolHistory.PROVIDERS[provider];
    if (!Object.hasOwn(BudolHistory.PROVIDERS, provider) || typeof variantId !== 'string' || !/^\d{0,20}$/.test(variantId)) throw new Error('Invalid history request.');
    if (provider === 'pricetrack' && item.platform !== 'shopee') throw new Error('Choose AiPrice for Lazada history.');
    const key = `${provider}:${item.url}:${variantId}`, epoch = revision;
    const { [STORE]: rows = [] } = await chrome.storage.local.get(STORE);
    const cached = Array.isArray(rows) ? rows.find(row => row.key === key) : null;
    if (cached && Date.now() - cached.at < TTL) return { ...cached.data, cached: true };
    if (active.has(provider)) throw new Error('This provider already has a lookup in progress.');
    const controller = new AbortController(); active.set(provider, controller);
    try {
      if (!await chrome.permissions.contains({ origins: [config.origin] })) throw new Error('Enable this provider from External price history in Budol first.');
      await serialize(async () => {
        const { budolHistoryCooldowns: cooldowns = {} } = await chrome.storage.local.get('budolHistoryCooldowns');
        if (cooldowns[provider] > Date.now()) throw new Error('Wait a few seconds before another provider lookup.');
        await chrome.storage.local.set({ budolHistoryCooldowns: { ...cooldowns, [provider]: Date.now() + 5000 } });
      });
      const data = await BudolHistory.lookup(provider, item.url, variantId, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
      await serialize(async () => {
        if (epoch !== revision) throw new Error('History lookup cancelled by cache cleanup.');
        const { [STORE]: stored = [] } = await chrome.storage.local.get(STORE);
        const next = (Array.isArray(stored) ? stored : []).filter(row => row.key !== key).slice(-19);
        next.push({ key, at: Date.now(), data }); await chrome.storage.local.set({ [STORE]: next });
      });
      return { ...data, cached: false };
    } catch (error) {
      if (error.retryMs) await serialize(async () => {
        const { budolHistoryCooldowns: cooldowns = {} } = await chrome.storage.local.get('budolHistoryCooldowns');
        await chrome.storage.local.set({ budolHistoryCooldowns: { ...cooldowns, [provider]: Date.now() + error.retryMs } });
      });
      if (cached && epoch === revision) return { ...cached.data, cached: true, stale: true, warning: 'Refresh failed. Showing an older cached provider response.' };
      throw error;
    } finally { if (active.get(provider) === controller) active.delete(provider); }
  }
  async function handle(message, sender) {
    const page = (sender.url || '').split(/[?#]/)[0];
    if (![chrome.runtime.getURL('board.html'), chrome.runtime.getURL('mcp.html')].includes(page)) throw new Error('Open Budol to request external history.');
    if (message.type === 'BUDOL_HISTORY_LOOKUP') return { ok: true, history: await lookup(message) };
    if (page !== chrome.runtime.getURL('board.html')) throw new Error('Open Budol storage controls to clear history cache.');
    revision++; for (const controller of active.values()) controller.abort();
    await serialize(() => chrome.storage.local.set({ [STORE]: [] }));
    return { ok: true };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['BUDOL_HISTORY_LOOKUP', 'BUDOL_HISTORY_CLEAR'].includes(message?.type)) return;
    handle(message, sender).then(respond, error => respond({ ok: false, error: /Abort|Timeout/.test(error.name) ? 'History lookup timed out or was cancelled.' : error.message })); return true;
  });
})();
