const { chromium } = require('playwright');

const MOCK_SCRIPT = `(function () {
  Object.defineProperty(globalThis, 'electronAPI', {
    value: {
      invoke: function (channel) {
        var args = Array.prototype.slice.call(arguments, 1);
        switch (channel) {
          case 'fs:getRootDir':
            return Promise.resolve('C:\\\\Users\\\\75465\\\\AppData\\\\Local\\\\Temp\\\\topomind-e2e-workdir');
          case 'fs:init':
            return Promise.resolve({ valid: true, error: null });
          default:
            return Promise.resolve(null);
        }
      },
      send: function () {},
      on: function () {},
      off: function () {}
    },
    writable: true,
    configurable: true,
    enumerable: true
  });
})();`;

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();

    // Inject BEFORE goto - this is the key test
    await page.evaluate(MOCK_SCRIPT);

    // Verify it's set before navigation
    const hasBefore = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI before goto:', hasBefore);

    // Now navigate
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

    await page.waitForTimeout(500);

    // Check state after navigation
    const hasAfter = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI after goto:', hasAfter);

    const modal = page.locator('#home-modal');
    const modalCount = await modal.count();
    console.log('#home-modal count:', modalCount);

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();