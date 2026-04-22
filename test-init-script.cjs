const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();

    // Test 1: simplest addInitScript
    await page.addInitScript('window.TEST_VALUE = 42');
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 10000 });

    const result = await page.evaluate(() => window.TEST_VALUE);
    console.log('TEST_VALUE:', result);

    // Test 2: also check electronAPI
    const hasAPI = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI exists:', hasAPI);

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();