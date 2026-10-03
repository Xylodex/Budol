const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = resolve(__dirname, '../extension');
for (const file of readdirSync(directory).filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', resolve(directory, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('All extension JavaScript syntax checks passed.');
