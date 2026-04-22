const { chromium } = require('playwright');

// Same mock script as in work-dir.ts
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
})();`;

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();

    // Inject mock via page.evaluate BEFORE goto
    await page.evaluate(MOCK_SCRIPT);

    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

    // Wait for electronAPI to be accessible
    await page.waitForFunction(() => !!(globalThis.electronAPI), { timeout: 10_000 });

    // Now check if #home-modal shows up
    console.log('Checking for #home-modal...');
    const homeModal = page.locator('#home-modal');
    await homeModal.waitFor({ timeout: 15_000 });
    console.log('#home-modal found!');

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();