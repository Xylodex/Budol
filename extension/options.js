(() => {
  'use strict';
  const form = document.getElementById('discord-settings');
  const input = document.getElementById('webhook');
  const connection = document.getElementById('connection');
  const error = document.getElementById('settings-error');
  const disconnect = document.getElementById('disconnect');
  async function update(type, webhook) {
    for (const control of form.elements) control.disabled = true;
    error.hidden = true;
    try {
      const result = await chrome.runtime.sendMessage({ type, webhook });
      if (!result?.ok) throw new Error(result?.error || 'Settings could not be loaded. Reload Budol and try again.');
      connection.textContent = result.configured ? 'Webhook configured. Right-click a Shopee product to send it.' : 'No webhook configured.';
      form.dataset.configured = result.configured;
      input.placeholder = result.configured ? 'Paste a new webhook to replace the saved one' : 'https://discord.com/api/webhooks/…';
      input.value = '';
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally {
      for (const control of form.elements) control.disabled = false;
      disconnect.disabled = form.dataset.configured !== 'true';
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); update('BUDOL_DISCORD_SETTINGS_SAVE', input.value); });
  disconnect.addEventListener('click', () => update('BUDOL_DISCORD_SETTINGS_CLEAR'));
  update('BUDOL_DISCORD_SETTINGS_GET');
})();
