import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export async function bridgeRequest(config, path, body = {}, signal) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${config.clientToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Budol bridge authentication or protocol failed. Check the local setup and port.');
  return response.json();
}
export async function ensureBroker(config) {
  try { const status = await bridgeRequest(config, '/health'); if (status.protocol !== 1) throw new Error('Protocol mismatch'); return status; }
  catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
  const child = spawn(process.execPath, [fileURLToPath(new URL('./broker.mjs', import.meta.url))], { detached: true, windowsHide: true, stdio: 'ignore', env: process.env });
  child.on('error', () => {}); child.unref();
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(100);
    try { const status = await bridgeRequest(config, '/health'); if (status.protocol === 1) return status; } catch { /* Another client may be starting the shared broker. */ }
  }
  throw new Error('Could not start the local Budol bridge. Check whether port 38479 is occupied and rerun setup.');
}
