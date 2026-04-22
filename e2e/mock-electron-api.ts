/**
 * Mock electronAPI for Playwright's Chromium browser.
 *
 * Playwright with `channel: 'chrome'` launches a regular Chromium, NOT an Electron
 * renderer, so `window.electronAPI` is never available. This mock intercepts the
 * IPC calls that App.tsx uses on mount so checkAndNavigate() succeeds and
 * #home-modal renders.
 *
 * Injected via playwright.config.ts → `page.addInitScript`.
 */

import path from 'path'
import os from 'os'

const TEMP_WORKDIR = path.join(os.tmpdir(), 'topomind-e2e-workdir')

// Track which channels have been called (useful for test assertions)
const callLog: { channel: string; timestamp: number }[] = []

function makeMockAPI() {
  return {
    invoke(channel: string): Promise<unknown> {
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
          // For any unhandled channel, return a plausible "not implemented" response
          // rather than crashing. Tests can override per-test via addInitScript.
          console.warn(`[mock-electronAPI] Unhandled IPC channel: ${channel}`)
          return Promise.resolve(null)
      }
    },

    send(_channel: string, _data?: unknown): void {
      // no-op for send channels used by the app
    },

    on(channel: string, handler: (...args: unknown[]) => void): void {
      // no-op: register a no-op listener so the app's removeListener call doesn't throw
      // We intentionally don't store handlers so duplicate calls are idempotent.
    },

    off(channel: string, _handler: (...args: unknown[]) => void): void {
      // no-op: remove listener (idempotent)
    },

    // Expose call log for test debugging
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
    value: makeMockAPI(),
    writable: true,
    configurable: true,
    enumerable: true,
  })
})()