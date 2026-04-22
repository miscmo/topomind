/**
 * E2E browser context setup — runs before every test page loads.
 *
 * Playwright with `channel: 'chrome'` launches a regular Chromium, NOT an
 * Electron renderer, so the preload script is absent and `window.electronAPI`
 * is never defined. This file injects a mock that intercepts the IPC calls
 * App.tsx makes on mount so `checkAndNavigate()` succeeds and `#home-modal`
 * renders.
 *
 * Registered via `webServer.env.TOPOMIND_E2E_WORKDIR` so Chromium can read it.
 */

import path from 'path'
import os from 'os'

const TEMP_WORKDIR = path.join(os.tmpdir(), 'topomind-e2e-workdir')

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
          // Let unhandled channels return null so the app degrades gracefully
          // rather than throwing an unhandled promise rejection.
          return Promise.resolve(null)
      }
    },

    send(_channel: string, _data?: unknown): void {
      // no-op
    },

    on(_channel: string, _handler: (...args: unknown[]) => void): void {
      // no-op: register a no-op listener so the app's cleanup in useEffect
      // won't throw on an unregistered handler.
    },

    off(_channel: string, _handler: (...args: unknown[]) => void): void {
      // no-op: idempotent remove
    },

    /** Expose call log for test assertions. */
    __getCallLog() {
      return [...callLog]
    },
    /** Clear call log between tests. */
    __clearCallLog() {
      callLog.length = 0
    },
  }
}

// Install synchronously before any page JS runs
Object.defineProperty(globalThis, 'electronAPI', {
  value: makeMockAPI(),
  writable: true,
  configurable: true,
  enumerable: true,
})
