import { test as base, expect } from '@playwright/test'

// Shared mock electronAPI — injected into every browser context before any page loads.
// Using context.addInitScript (not page.addInitScript) so the mock is present when
// React's useEffect (checkAndNavigate) first fires.
const MOCK_SCRIPT = `(function () {
  var createdKBs = [];
  var storedGraphMeta = null;

  Object.defineProperty(globalThis, 'electronAPI', {
    value: {
      invoke: function (channel) {
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
          case 'fs:mkDir':
            var dirPath = args[0] || '';
            var isCard = dirPath.includes('/') || dirPath.includes('\\');
            if (!isCard) {
              // KB creation - return relative path (not full Windows path)
              createdKBs.push({ path: dirPath, name: dirPath, isDir: true, order: createdKBs.length });
              return Promise.resolve(dirPath);
            } else {
              // Card creation - return relative path
              // dirPath is like "节点CRUD测试/待重命名节点"
              var cardId = dirPath;
              var cardName = cardId.split(/[/\\]/).pop() || dirPath;
              if (storedGraphMeta === null) {
                storedGraphMeta = { children: {}, edges: [] };
              }
              // Use just the card name as key (consistent with real implementation)
              storedGraphMeta.children[cardName] = { name: cardName, hasChildren: false };
              return Promise.resolve(cardId);
            }
          case 'fs:saveKBOrder':
            return Promise.resolve(null);
          case 'fs:readGraphMeta':
            if (storedGraphMeta !== null) {
              return Promise.resolve(storedGraphMeta);
            }
            return Promise.resolve({ children: {}, edges: [] });
          case 'fs:writeGraphMeta':
            storedGraphMeta = args[1];
            return Promise.resolve(null);
          case 'fs:countChildren':
            return Promise.resolve(0);
          case 'fs:getLastOpenedKB':
            return Promise.resolve(null);
          case 'fs:setLastOpenedKB':
            return Promise.resolve(null);
          case 'fs:selectWorkDirCandidate':
            return Promise.resolve({ valid: true, nodePath: 'C:\\\\Users\\\\75465\\\\AppData\\\\Local\\\\Temp\\\\topomind-e2e-workdir', error: null });
          case 'fs:setWorkDir':
            return Promise.resolve({ valid: true, nodePath: 'C:\\\\Users\\\\75465\\\\AppData\\\\Local\\\\Temp\\\\topomind-e2e-workdir', error: null });
          case 'fs:createWorkDir':
            return Promise.resolve({ valid: true, nodePath: 'C:\\\\Users\\\\75465\\\\AppData\\\\Local\\\\Temp\\\\topomind-e2e-workdir', error: null });
          case 'fs:readFile':
            return Promise.resolve('{}');
          case 'fs:writeFile':
            return Promise.resolve(null);
          case 'fs:deleteFile':
            return Promise.resolve(null);
          case 'fs:rmDir':
            return Promise.resolve(null);
          case 'fs:getDir':
            return Promise.resolve([]);
          case 'fs:ensureCardDir':
            return Promise.resolve(null);
          case 'fs:openInFinder':
            return Promise.resolve(null);
          case 'fs:readBlobFile':
            return Promise.resolve(null);
          case 'fs:writeBlobFile':
            return Promise.resolve(null);
          case 'fs:getKBCover':
            return Promise.resolve(null);
          case 'fs:saveKBCover':
            return Promise.resolve(null);
          case 'fs:renameKB':
            return Promise.resolve('mock-renamed-kb');
          case 'fs:updateCardMeta':
            return Promise.resolve('mock-renamed-card');
          case 'fs:importKB':
            return Promise.resolve('mock-imported-kb');
          case 'fs:clearAll':
            return Promise.resolve(null);
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
})();`

/**

 */
export async function mockBrowserContext(context: BrowserContext) {
  await context.addInitScript(MOCK_SCRIPT)
}

/**
 * Extended Playwright test with work-directory mock support.
 *
 * Usage: import { test } from './fixtures/work-dir'
 *        instead of: import { test } from '@playwright/test'
 */
export { expect }
export const test = base

/**
 * Initialize the work directory in the renderer.
 *
 * globalThis.electronAPI must be defined before React's checkAndNavigate() fires —
 * the Vite/React page load (triggered by goto) wipes any injection done after
 * the page starts loading. We install the mock at the CONTEXT level before
 * navigation so it is present when React first executes.
 */
export async function initWorkDir(page: import('@playwright/test').Page): Promise<void> {
  // Install mock at context level BEFORE navigating.
  // page.context() is the browser context shared by all pages in this test.
  await page.context().addInitScript(MOCK_SCRIPT)
  // Navigate. The mock is already in place before the page loads.
  await page.goto('/', { waitUntil: 'networkidle' })
}

/**
 * Wait for the home page to be fully rendered.
 *
 * Call this AFTER initWorkDir() in a beforeEach block.
 */
export async function waitForHomePage(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('#home-modal', { timeout: 15_000 })
}
