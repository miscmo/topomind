/**
 * Mock electronAPI for Playwright's Chromium browser.
 *
 * Playwright with `channel: 'chrome'` launches a regular Chromium, NOT an Electron
 * renderer, so `window.electronAPI` is never available. This script intercepts the
 * IPC calls that App.tsx makes on mount so `checkAndNavigate()` succeeds and
 * `#home-modal` renders.
 *
 * NOTE: This file runs in the BROWSER context. Do NOT use Node.js APIs (process,
 * path, os, require, __dirname, etc.) — they don't exist in Chromium's V8 engine.
 * Use hardcoded values instead.
 *
 * Loaded via playwright.config.ts `use.addInitScript`.
 */

// DEBUG: Signal that addInitScript ran
window.__E2E_MOCK_INSTALLED__ = true
console.log('[E2E-SETUP] Mock electronAPI installed')

// Hardcoded path — must match playwright.config.ts TEMP_WORKDIR
// Default Node.js os.tmpdir() on Windows: C:\Users\<user>\AppData\Local\Temp
const TEMP_WORKDIR = 'C:\\Users\\75465\\AppData\\Local\\Temp\\topomind-e2e-workdir'

const callLog = []

function makeMockAPI() {
  return {
    invoke(channel) {
      callLog.push({ channel, timestamp: Date.now() })
      switch (channel) {
        case 'fs:getRootDir':
          return Promise.resolve(TEMP_WORKDIR)

        case 'fs:init':
          return Promise.resolve({ valid: true, error: null })

        case 'app:getE2EState':
          return Promise.resolve({
            rootDir: TEMP_WORKDIR,
            valid: true,
            workDirConfigured: true,
            windowReady: true,
            ipcRegistered: true,
          })

        default:
          // Degrade gracefully for unhandled channels
          return Promise.resolve(null)
      }
    },

    send() {
      // no-op
    },

    on() {
      // no-op
    },

    off() {
      // no-op
    },

    __getCallLog() {
      return [...callLog]
    },

    __clearCallLog() {
      callLog.length = 0
    },
  }
}

// Install before any page JS runs
Object.defineProperty(globalThis, 'electronAPI', {
  value: makeMockAPI(),
  writable: true,
  configurable: true,
  enumerable: true,
})
