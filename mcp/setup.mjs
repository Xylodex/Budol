import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createConfig, configPath } from './config.mjs';
import { ensureBroker } from './client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => !['--register'].includes(arg))) throw new Error('Usage: npm run mcp:setup [-- --register]');
const config = await createConfig();
const seed = JSON.stringify({ port: config.port, extensionToken: config.extensionToken }, null, 2);
await writeFile(resolve(root, 'extension/mcp-local.json'), seed, { mode: 0o600 });
try { await access(resolve(root, 'dist/manifest.json')); await writeFile(resolve(root, 'dist/mcp-local.json'), seed, { mode: 0o600 }); } catch { /* No packaged folder yet. */ }
if (args.includes('--register')) {
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const result = spawnSync(executable, ['mcp', 'add', 'budol', '--env', `BUDOL_MCP_CONFIG=${configPath}`, '--', process.execPath, resolve(root, 'mcp/server.mjs')], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Codex registration failed. Add the server using the command documented in docs/MCP.md.');
}
await ensureBroker(config);
console.log(`Budol MCP setup complete. Private configuration: ${configPath}`);
console.log('Reload Budol, open Discord settings → Codex MCP, and click Connect. Keep that page open. Restart Codex MCP servers to load newly registered tools.');
