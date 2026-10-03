const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
for (const name of ['extension', 'mcp']) {
  const directory = resolve(__dirname, '..', name);
  for (const file of readdirSync(directory).filter(name => /\.(?:mjs|js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', resolve(directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('All extension and MCP JavaScript syntax checks passed.');
