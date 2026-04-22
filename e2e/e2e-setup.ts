/**
 * E2E browser context setup — runs before every test page loads.
 *
 * Playwright with `channel: 'chrome'` launches a regular Chromium, NOT an
 * Electron renderer, so the preload script is absent and `window.electronAPI`
 * is never defined. This file provides a minimal mock that intercepts the
 * core IPC calls App.tsx makes on mount so `checkAndNavigate()` succeeds.
 *
 * NOTE: The full-featured mock is in playwright.config.ts (addInitScript)
 * and fixtures/work-dir.ts. This file is kept for backward compatibility
 * but delegates path resolution to os.tmpdir() dynamically.
 */

import path from 'path'
import os from 'os'

const TEMP_WORKDIR = path.join(os.tmpdir(), 'topomind-e2e-workdir')

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

    off(_channel: string, _handler: (...args: unknown[]) => void): void {},

    __getCallLog() {
      return [...callLog]
    },
    __clearCallLog() {
      callLog.length = 0
    },
  }
}

// Install synchronously before any page JS runs
Object.defineProperty(globalThis, 'electronAPI', {
  value: makeMockAPI(TEMP_WORKDIR),
  writable: true,
  configurable: true,
  enumerable: true,
})
