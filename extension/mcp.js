(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('mcp-connect');
  let connection = null, connecting = false;
  function error(message) { $('mcp-error').textContent = message; $('mcp-error').hidden = !message; }
  function controls() {
    for (const field of form.elements) field.disabled = Boolean(connection || connecting);
    $('mcp-stop').disabled = !connection;
  }
  async function post(settings, path, body, timeout = 5000) {
    const response = await fetch(`http://127.0.0.1:${settings.port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeout) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Bridge request failed.');
    return result;
  }
  function log(command, success) {
    const row = document.createElement('li'); row.textContent = `${new Date().toLocaleTimeString()} · ${command} · ${success ? 'Completed' : 'Failed'}`;
    $('mcp-log').prepend(row); while ($('mcp-log').children.length > 20) $('mcp-log').lastElementChild.remove();
  }
  async function poll(current) {
    while (connection === current) {
      try {
        const { job } = await post(current, '/poll', { session: current.session });
        if (connection !== current) return;
        if (job) {
          let result;
          try { result = { ok: true, data: await BudolMcpActions.execute(job, current.capabilities, () => connection === current) }; }
          catch (failure) { result = { ok: false, error: failure.message || 'Tool failed.' }; }
          log(job.command, result.ok);
          // Never replay a tool when acknowledging a result fails.
          await post(current, '/result', { session: current.session, id: job.id, result });
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (failure) {
        if (connection !== current) return;
        await disconnect(); error(`${failure.message || 'Connection lost.'} Reconnect when the local MCP server is running. Dispatched actions are never retried automatically.`);
      }
    }
  }
  async function disconnect() {
    const previous = connection; connection = null; controls(); $('mcp-status').textContent = 'Disconnected';
    if (previous) await post(previous, '/disconnect', { session: previous.session }, 1500).catch(() => {});
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (connection || connecting) return;
    error('');
    const port = Number($('mcp-port').value), token = $('mcp-token').value.trim();
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)) { error('Enter a valid local port and pairing key.'); return; }
    if ($('mcp-discord').checked && !$('mcp-writes').checked) { error('Enable changes before allowing Discord sends.'); return; }
    connecting = true; controls();
    try {
      const granted = await chrome.permissions.request({ origins: ['http://127.0.0.1/*', 'https://*.shopee.ph/*'] });
      if (!granted) throw new Error('Local bridge and Shopee access were not granted.');
      const current = { port, token, capabilities: { writes: $('mcp-writes').checked, discord: $('mcp-discord').checked } };
      current.session = (await post(current, '/connect', current.capabilities)).session;
      connection = current; $('mcp-status').textContent = `Connected · ${current.capabilities.writes ? 'changes enabled' : 'read only'}${current.capabilities.discord ? ' · Discord enabled' : ''}`;
      poll(current);
    } catch (failure) { error(`${failure.message || 'Connection failed.'} Ask Codex to check Budol status to start the local bridge, then connect again.`); }
    finally { connecting = false; controls(); }
  });
  $('mcp-stop').addEventListener('click', disconnect);
  window.addEventListener('pagehide', () => { connection = null; });
  // Only fills the form; never grants permissions or starts a connection silently.
  fetch(chrome.runtime.getURL('mcp-local.json')).then(response => response.ok ? response.json() : null).then(seed => {
    if (!connecting && !connection && !$('mcp-token').value && /^[a-f0-9]{64}$/.test(seed?.extensionToken || '')) { $('mcp-token').value = seed.extensionToken; $('mcp-port').value = seed.port; }
  }).catch(() => {});
})();
