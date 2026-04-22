/**
 * TopoMind E2E global setup
 *
 * Sets up the persistent temp work directory before tests run.
 *
 * HOW IT WORKS:
 * The work directory path is passed to the Electron app via the
 * TOPOMIND_E2E_WORKDIR environment variable (injected by playwright.config.ts
 * into the dev server command). The Electron main process reads this env var
 * at startup and initializes _fs_rootDir directly — no IPC call needed.
 *
 * This file is called by Playwright before any tests run.
 */
import { chromium, FullConfig } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

export default async function globalSetup(_config: FullConfig) {
  // Create a persistent temp work directory for all E2E tests
  const tempDir = path.join(os.tmpdir(), 'topomind-e2e-workdir')

  // Clean up any previous run's leftovers
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }

  fs.mkdirSync(tempDir, { recursive: true })

  // Write the required _config.json so file-service.js validation passes
  fs.writeFileSync(
    path.join(tempDir, '_config.json'),
    JSON.stringify({ lastOpenedKB: null, orders: {}, covers: {} }, null, 2)
  )

  // Write the .env file to the project root so electron/main.js (running
  // from project root via vite-plugin-electron) can load it via process.cwd().
  // playwright.config.ts webServer.env only reaches the Vite dev server shell,
  // not the Electron main process started internally by vite-plugin-electron.
  fs.writeFileSync(
    path.join(projectRoot, '.env'),
    `TOPOMIND_E2E_WORKDIR=${tempDir}\n`
  )

  // Persist the path so fixtures can re-use the same directory per test run
  // This is consumed by playwright.config.ts (webServer.env) and fixtures/work-dir.ts
  process.env.TOPOMIND_E2E_WORKDIR = tempDir

  // Launch Chromium to verify the app is ready before tests start.
  // The work directory is already initialized via TOPOMIND_E2E_WORKDIR env var
  // passed to the Electron main process. This step only checks connectivity.
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('http://localhost:5173/')

  // Wait for the app to render — at this point, the Electron renderer
  // should have window.electronAPI available (Electron + preload script).
  // Wait for home page (or setup page) to appear.
  try {
    await page.waitForSelector('#home-modal, #setup-page', { timeout: 15000 })
  } catch (e) {
    // ignore — the page will be checked by individual tests
  }

  await browser.close()

  // Persist a marker file so globalTeardown knows what to clean up
  process.env.TOPOMIND_E2E_WORKDIR_MARKER = tempDir
}
