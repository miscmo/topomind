import { defineConfig } from '@playwright/test'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Shared work directory path — must match global-setup.ts
const TEMP_WORKDIR = path.join(os.tmpdir(), 'topomind-e2e-workdir')

// Mock electronAPI injected into every page before navigation.
// Using a context-level addInitScript ensures the mock is present when
// React's useEffect (checkAndNavigate) first fires — before any async boundary.
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
            var isCard = dirPath.includes('/') || dirPath.includes('\\\\');
            if (!isCard) {
              var kbPath = 'C:\\\\Users\\\\75465\\\\AppData\\\\Local\\\\Temp\\\\topomind-e2e-workdir\\\\' + dirPath;
              createdKBs.push({ path: kbPath, name: dirPath, isDir: true, order: createdKBs.length });
              return Promise.resolve(kbPath);
            } else {
              var cardId = dirPath;
              var cardName = cardId.split(/[/\\\\]/).pop() || dirPath;
              if (storedGraphMeta === null) {
                storedGraphMeta = { children: {}, edges: [] };
              }
              storedGraphMeta.children[cardId] = { name: cardName, hasChildren: false };
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

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    channel: 'chrome',
    launchOptions: {
      args: ['--disable-devtools'],
    },
    // Config-level addInitScript: injects into every context before any page loads.
    // This is the key difference from page.addInitScript which runs too late —
    // the Vite-rendered page starts with globalThis.electronAPI already defined.
    addInitScript: MOCK_SCRIPT,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        viewport: { width: 1280, height: 720 },
        permissions: [],
      },
    },
  ],

  webServer: {
    command: `npm run dev`,
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      TOPOMIND_E2E_WORKDIR: TEMP_WORKDIR,
    },
  },
})
