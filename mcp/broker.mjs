import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';

const commands = new Set(['list_tabs', 'get_products', 'list_saved', 'list_cached', 'get_alerts', 'save_product', 'remove_saved', 'send_discord', 'get_external_history']);
const writes = new Set(['save_product', 'remove_saved', 'send_discord']);
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function startBroker(config, { timeout = 25000, lease = 35000, idle = 90000 } = {}) {
  let connection = null, lastActivity = Date.now();
  const jobs = new Map();
  const finish = (id, result) => { const job = jobs.get(id); if (job) { clearTimeout(job.timer); jobs.delete(id); job.reply(result); } };
  const disconnect = () => { connection = null; for (const id of jobs.keys()) finish(id, { ok: false, error: 'Budol disconnected. An action already dispatched may have completed; check before retrying.' }); };
  const active = () => { if (connection && Date.now() - connection.seen > lease) disconnect(); return connection; };
  const server = http.createServer(async (req, res) => {
    const reply = (data, status = 200) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.socket.remoteAddress !== '127.0.0.1') return reply({ error: 'Invalid host' }, 403);
      const path = req.url;
      const extension = ['/connect', '/poll', '/result', '/disconnect'].includes(path);
      const origin = req.headers.origin;
      if (extension ? !/^chrome-extension:\/\/[a-p]{32}$/.test(origin || '') : Boolean(origin)) return reply({ error: 'Invalid origin' }, 403);
      if (extension) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'POST');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
          return reply({});
        }
      }
      if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);
      if (!equal(req.headers.authorization, `Bearer ${extension ? config.extensionToken : config.clientToken}`)) return reply({ error: 'Authentication failed' }, 401);
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return reply({ error: 'Use JSON' }, 415);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) { reply({ error: 'Request too large' }, 413); req.resume(); return; } chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return reply({ error: 'Invalid JSON' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid request' }, 400);
      lastActivity = Date.now(); active();
      if (path === '/health') return reply({ protocol: 1, connected: Boolean(connection), capabilities: connection?.capabilities || { writes: false, discord: false }, pending: jobs.size });
      if (path === '/connect') {
        if (connection) return reply({ error: 'Another Budol connector is active. Disconnect it first or wait 35 seconds after closing it.' }, 409);
        connection = { id: randomUUID(), origin, seen: Date.now(), capabilities: { writes: body.writes === true, discord: body.discord === true } };
        return reply({ session: connection.id });
      }
      if (extension) {
        if (!connection || connection.id !== body.session || connection.origin !== origin) return reply({ error: 'Connector session expired. Connect again.' }, 409);
        connection.seen = Date.now();
        if (path === '/disconnect') { disconnect(); return reply({ ok: true }); }
        if (path === '/poll') {
          const job = [...jobs.values()].find(job => !job.sent);
          if (job) job.sent = true;
          return reply({ job: job ? { id: job.id, command: job.command, args: job.args, deadline: job.deadline } : null });
        }
        if (path === '/result') {
          if (!jobs.get(body.id)?.sent) return reply({ error: 'Request expired or already completed' }, 410);
          if (typeof body.result?.ok !== 'boolean') return reply({ error: 'Invalid result' }, 400);
          finish(body.id, body.result); return reply({ ok: true });
        }
      }
      if (path === '/call') {
        if (!commands.has(body.command) || !body.args || typeof body.args !== 'object' || Array.isArray(body.args) || JSON.stringify(body.args).length > 8000) return reply({ error: 'Invalid command' }, 400);
        if (!connection) return reply({ ok: false, error: 'Open Budol → Codex MCP and click Connect. Keep that tab open.' });
        if ((writes.has(body.command) && !connection.capabilities.writes) || (body.command === 'send_discord' && !connection.capabilities.discord)) return reply({ ok: false, error: 'This action is disabled in the Budol connector. Enable the matching access switch and reconnect.' });
        if (jobs.size >= 16) return reply({ ok: false, error: 'Budol is busy. Wait for pending tools to finish.' });
        const id = randomUUID();
        const job = { id, command: body.command, args: body.args, reply, sent: false, deadline: Date.now() + timeout };
        job.timer = setTimeout(() => finish(id, { ok: false, error: 'Budol timed out. No automatic retry was made. A dispatched action may have completed; check before retrying.' }), timeout);
        jobs.set(id, job);
        res.on('close', () => { if (!res.writableEnded) { clearTimeout(job.timer); jobs.delete(id); } });
        return;
      }
      reply({ error: 'Unknown endpoint' }, 404);
    } catch { reply({ error: 'Bridge request failed' }, 500); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  const sweep = setInterval(() => { active(); if (Date.now() - lastActivity > idle && jobs.size === 0) close(); }, 5000);
  function close() { clearInterval(sweep); disconnect(); server.close(); server.closeAllConnections(); }
  return { server, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const broker = await startBroker(await loadConfig()); process.on('SIGTERM', broker.close); process.on('SIGINT', broker.close); }
  catch { process.exitCode = 1; } // Detached broker never logs tokens or product data.
}
