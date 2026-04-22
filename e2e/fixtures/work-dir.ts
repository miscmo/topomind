import { test as base, expect } from '@playwright/test'
import path from 'path'
import os from 'os'

// Dynamic work directory path — matches global-setup.ts
const TEMP_WORKDIR = path.join(os.tmpdir(), 'topomind-e2e-workdir')

// Shared mock electronAPI — injected into every browser context before any page loads.
// Uses dynamic TEMP_WORKDIR instead of hardcoded path for cross-machine compatibility.
function buildMockScript(workDir: string): string {
  return `(function () {
  var createdKBs = [];
  var storedGraphMeta = null;
  var WORK_DIR = ${JSON.stringify(workDir)};

  Object.defineProperty(globalThis, 'electronAPI', {
    value: {
      invoke: function (channel) {
        var args = Array.prototype.slice.call(arguments, 1);
        switch (channel) {
          case 'fs:getRootDir':
            return Promise.resolve(WORK_DIR);
          case 'fs:init':
            return Promise.resolve({ valid: true, error: null });
          case 'fs:listChildren':
            if (args[0] === '') {
              return Promise.resolve(createdKBs);
            }
            return Promise.resolve([]);
          case 'fs:mkDir':
            var dirPath = args[0] || '';
            var isCard = dirPath.includes('/') || dirPath.includes('\\\\');
            if (!isCard) {
              createdKBs.push({ path: dirPath, name: dirPath, isDir: true, order: createdKBs.length });
              return Promise.resolve(dirPath);
            } else {
              var cardId = dirPath;
              var cardName = cardId.split(/[/\\\\]/).pop() || dirPath;
              if (storedGraphMeta === null) {
                storedGraphMeta = { children: {}, edges: [] };
              }
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
            return Promise.resolve({ valid: true, nodePath: WORK_DIR, error: null });
          case 'fs:setWorkDir':
            return Promise.resolve({ valid: true, nodePath: WORK_DIR, error: null });
          case 'fs:createWorkDir':
            return Promise.resolve({ valid: true, nodePath: WORK_DIR, error: null });
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
}

/**
 * Inject the mock electronAPI into a browser context.
 * Uses the dynamic work directory path from os.tmpdir().
 */
export async function mockBrowserContext(context: import('@playwright/test').BrowserContext) {
  await context.addInitScript(buildMockScript(TEMP_WORKDIR))
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
 * the page starts loading. We use the mock injected at the config level in playwright.config.ts.
 */
export async function initWorkDir(page: import('@playwright/test').Page): Promise<void> {
  // Navigate. The mock is already in place before the page loads (from playwright.config.ts).
  await page.goto('/', { waitUntil: 'networkidle' })
}

/**
 * Wait for the home page to be fully rendered.
 *
 * Call this AFTER initWorkDir() in a beforeEach block.
 */
export async function waitForHomePage(page: import('@playwright/test').Page): Promise<void> {
  try {
    // 首先检查是否停留在 SetupPage
    await page.waitForSelector('#setup-page', { timeout: 5000 })
    // 如果停留在 SetupPage，尝试手动触发导航到 HomePage
    await page.click('button:has-text("打开已有工作目录")')
    // 等待 HomePage 出现
    await page.waitForSelector('#home-modal', { timeout: 10_000 })
  } catch {
    // 如果没有停留在 SetupPage，直接等待 HomePage
    await page.waitForSelector('#home-modal', { timeout: 15_000 })
  }
}
