const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();

    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Now try to inject and check
    const hasBefore = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI before injection:', hasBefore);

    // Inject mock
    const mockScript = `(function () {
      Object.defineProperty(globalThis, 'electronAPI', {
        value: {
          invoke: function (ch) { return Promise.resolve(null); },
          send: function () {},
          on: function () {},
          off: function () {}
        },
        writable: true,
        configurable: true,
        enumerable: true
      });
    })();`;
    await page.evaluate(mockScript);

    await page.waitForTimeout(500);

    const hasAfter = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI after injection:', hasAfter);

    // Check for #home-modal
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