import { test } from './fixtures/work-dir'

test('diagnostic: capture console logs', async ({ page }) => {
  // Inject mock BEFORE page loads — must be a plain string (not function)
  // to avoid Playwright serialization issues
  await page.addInitScript(`
(function () {
  Object.defineProperty(globalThis, 'electronAPI', {
    value: {
      invoke: function (channel) {
        switch (channel) {
          case 'fs:getRootDir':
            return Promise.resolve('C:\\Users\\75465\\AppData\\Local\\Temp\\topomind-e2e-workdir');
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
})();
  `)

  // Check electronAPI status right after inject (before navigating)
  const apiCheckGlobal = await page.evaluate(() => {
    return {
      hasGlobalElectron: (globalThis as any).electronAPI !== undefined,
      globalElectronType: typeof (globalThis as any).electronAPI,
    }
  })
  console.log('\n=== GLOBALTHIS ELECTRON API (after addInitScript, before goto) ===')
  console.log(JSON.stringify(apiCheckGlobal, null, 2))

  await page.goto('http://localhost:5173')

  // Wait for app to initialize
  await page.waitForTimeout(3000)

  const apiCheckAfter = await page.evaluate(() => {
    return {
      hasGlobalElectron: (globalThis as any).electronAPI !== undefined,
      globalElectronType: typeof (globalThis as any).electronAPI,
    }
  })
  console.log('\n=== GLOBALTHIS ELECTRON API (after 3s) ===')
  console.log(JSON.stringify(apiCheckAfter, null, 2))

  // Check page state
  const homeModal = page.locator('#home-modal')
  const homeVisible = await homeModal.isVisible().catch(() => false)
  console.log('\n#home-modal visible:', homeVisible)

  if (!homeVisible) {
    const setupPageText = await page.locator('body').innerText().catch(() => '')
    console.log('\nPage text (first 500 chars):', setupPageText.substring(0, 500))
  }
})
