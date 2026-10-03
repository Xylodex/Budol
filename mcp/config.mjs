import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const configPath = process.env.BUDOL_MCP_CONFIG || join(homedir(), '.budol-mcp', 'config.json');
export function validateConfig(value) {
  if (value?.version !== 1 || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
      ![value.clientToken, value.extensionToken].every(token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) || value.clientToken === value.extensionToken) throw new Error('Invalid Budol MCP configuration. Run npm run mcp:setup.');
  return value;
}
export async function loadConfig(path = configPath) {
  try { return validateConfig(JSON.parse(await readFile(path, 'utf8'))); }
  catch { throw new Error('Budol MCP is not configured. Run npm run mcp:setup in the Budol repository.'); }
}
export async function createConfig(path = configPath) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const value = { version: 1, port: 38479, clientToken: randomBytes(32).toString('hex'), extensionToken: randomBytes(32).toString('hex') };
  try { await writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return loadConfig(path);
}
