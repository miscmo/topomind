/**
 * Mock electronAPI for Playwright's Chromium browser.
 *
 * Playwright with `channel: 'chrome'` launches a regular Chromium, NOT an Electron
 * renderer, so `window.electronAPI` is never available. This mock intercepts the
 * IPC calls that App.tsx uses on mount so checkAndNavigate() succeeds and
 * #home-modal renders.
 *
 * NOTE: The primary mock is configured in playwright.config.ts (addInitScript)
 * which covers all IPC channels. This file provides a simplified fallback for
 * direct import scenarios and uses dynamic path resolution via os.tmpdir().
 */

import path from 'path'
import os from 'os'

const TEMP_WORKDIR = path.join(os.tmpdir(), 'topomind-e2e-workdir')

// Track which channels have been called (useful for test assertions)
const callLog: { channel: string; timestamp: number }[] = []

function makeMockAPI(workDir: string) {
  return {
    invoke(channel: string): Promise<unknown> {
      callLog.push({ channel, timestamp: Date.now() })
      switch (channel) {
        case 'fs:getRootDir':
          return Promise.resolve(workDir)
        case 'fs:init':
          return Promise.resolve({ valid: true, error: null })
        case 'app:getE2EState':
          return Promise.resolve({
            rootDir: workDir,
            valid: true,
            workDirConfigured: true,
            windowReady: true,
            ipcRegistered: true,
          })
        default:
          return Promise.resolve(null)
      }
    },

    send(_channel: string, _data?: unknown): void {},

    on(_channel: string, _handler: (...args: unknown[]) => void): void {},

    off(_channel: string, _handler: (...args: unknown[]) => void {},

    __getCallLog() {
      return [...callLog]
    },
    __clearCallLog() {
      callLog.length = 0
    },
  }
}

// Install immediately — runs before any JS on the page loads
;(function install() {
  if (typeof window === 'undefined') return
  Object.defineProperty(window, 'electronAPI', {
    value: makeMockAPI(TEMP_WORKDIR),
    writable: true,
    configurable: true,
    enumerable: true,
  })
})()
