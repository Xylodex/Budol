const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

// Explicit files work on Windows and Node versions with different glob behavior.
const root = resolve(__dirname, '..');
const files = readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.cjs')).map(name => resolve(root, 'tests', name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
