const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './browser-tests',
  outputDir: 'artifacts/browser',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
});
