const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();

    // Test what addInitScript with MOCK_SCRIPT-like code does
    const testScript = `(function () {
  Object.defineProperty(globalThis, 'electronAPI', {
    value: {
      invoke: function (channel) {
        console.log('invoke called:', channel);
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
  console.log('Mock script ran!');
})();`;

    await page.addInitScript(testScript);
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Wait a bit for the script to potentially run
    await page.waitForTimeout(1000);

    // Check electronAPI
    const hasAPI = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI exists after goto:', hasAPI);

    // Also check TEST_VALUE to verify addInitScript ran
    const testVal = await page.evaluate(() => window.TEST_VALUE);
    console.log('TEST_VALUE:', testVal);

    // Try to directly set it via evaluate AFTER page load
    console.log('\n--- Testing page.evaluate() approach ---');
    const setResult = await page.evaluate(() => {
      try {
        Object.defineProperty(globalThis, 'electronAPI', {
          value: {
            invoke: function (ch) {
              console.log('invoke called:', ch);
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
        return 'defined successfully';
      } catch (e) {
        return 'error: ' + e.message;
      }
    });
    console.log('page.evaluate set result:', setResult);

    const hasAPI2 = await page.evaluate(() => typeof globalThis.electronAPI !== 'undefined');
    console.log('electronAPI exists after evaluate:', hasAPI2);

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
