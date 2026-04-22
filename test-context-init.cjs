const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();

    // Use same addInitScript as playwright.config.ts
    const mockScript = `(function () {
      var createdKBs = [];
      var storedGraphMeta = null;

      Object.defineProperty(globalThis, 'electronAPI', {
        value: {
          invoke: function (channel) {
            console.log('[MOCK] invoke called:', channel);
            var args = Array.prototype.slice.call(arguments, 1);
            switch (channel) {
              case 'fs:getRootDir':
                return Promise.resolve('C:\\\\Users\\\\75465\\\\AppData\\\\Local\\\\Temp\\\\topomind-e2e-workdir');
              case 'fs:init':
                return Promise.resolve({ valid: true, error: null });
              case 'fs:listChildren':
                if (args[0] === '') {
                  return Promise.resolve(createdKBs);
                }
                return Promise.resolve([]);
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
      console.log('[MOCK] electronAPI defined on globalThis');
    })();`;

    // Test with config-level approach (same as playwright.config.ts)
    await page.context().addInitScript(mockScript);

    const hasAPI = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI exists:', hasAPI);

    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

    // Check if home modal is visible
    const modalCount = await page.locator('#home-modal').count();
    console.log('#home-modal count after goto:', modalCount);

    // Check text content
    const body = await page.textContent('body');
    console.log('Body text:', body.slice(0, 200));

    // Check for setup page text
    const setupHeading = await page.locator('h1').textContent().catch(() => 'none');
    console.log('H1 text:', setupHeading);

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();