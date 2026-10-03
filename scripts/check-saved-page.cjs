const { readFileSync } = require('node:fs');
const { createBrowser, wait } = require('../tests/helpers.cjs');

async function main() {
  const [path, rawThreshold = '50'] = process.argv.slice(2);
  const threshold = Number(rawThreshold);
  if (!path || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('Usage: node scripts/check-saved-page.cjs <saved HTML path> [threshold 0-100]');
  }
  // outside-only never executes scripts or downloads resources from the supplied document.
  const browser = createBrowser(readFileSync(path, 'utf8'), { threshold });
  try {
    browser.run('content.js');
    await wait();
    const status = await browser.chrome.tabs.sendMessage(1, { type: 'BUDOL_GET_STATUS' });
    console.log(JSON.stringify(status, null, 2));
  } finally {
    browser.dom.window.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
