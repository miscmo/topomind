const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });

    // Apply addInitScript at CONTEXT level BEFORE creating page
    const context = await browser.newContext();
    await context.addInitScript(`(function () {
      console.log('[INIT] addInitScript running!');
      Object.defineProperty(globalThis, 'electronAPI', {
        value: {
          invoke: function (ch) {
            console.log('[INIT] invoke called:', ch);
            return Promise.resolve(null);
          },
          send: function () {},
          on: function () {},
          off: function () {}
        },
        writable: true,
        configurable: true,
        enumerable: true
      });
    })();`);

    const page = await context.newPage();

    // Check immediately
    const hasAPI = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI exists (before goto):', hasAPI);

    // Navigate
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

    await page.waitForTimeout(500);

    // Check after
    const hasAfter = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI exists (after goto):', hasAfter);

    // Get console logs
    const logs = await page.evaluate(() => {
      return (window as any).__consoleLogs || [];
    });
    console.log('Console logs:', logs);

    const modalCount = await page.locator('#home-modal').count();
    console.log('#home-modal count:', modalCount);

    const h1 = await page.locator('h1').textContent().catch(() => 'none');
    console.log('H1:', h1);

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();