/**
 * Debug script: test if config-level addInitScript with file path actually works.
 * Run from project root: node e2e/debug-addInitScript.mjs
 */
import { chromium } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Script is in e2e/ dir, so project root is one level up
const projectRoot = path.resolve(__dirname, '..')
// e2e-setup.js is in the same dir as this script (e2e/)
const e2eSetupPath = path.join(__dirname, 'e2e-setup.js')

console.log('__dirname:', __dirname)
console.log('Project root:', projectRoot)
console.log('e2e-setup.js path:', e2eSetupPath)
console.log('File exists:', fs.existsSync(e2eSetupPath))

// Read the actual file content
const scriptContent = fs.readFileSync(e2eSetupPath, 'utf8')
console.log('Script content (first 300 chars):\n', scriptContent.substring(0, 300))

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext()
const page = await context.newPage()

const apiTypeBefore = await page.evaluate(() => typeof window.electronAPI)
console.log('\nelectronAPI before navigation:', apiTypeBefore)

// Load the actual JS file as init script — simulating what the config does
await context.addInitScript(scriptContent)

await page.goto('http://localhost:5173/')
await page.waitForLoadState('networkidle')

const apiType = await page.evaluate(() => typeof window.electronAPI)
const homeModal = await page.locator('#home-modal').count()
const setupPage = await page.locator('#setup-page').count()
console.log('\nelectronAPI type after load:', apiType)
console.log('#home-modal:', homeModal, '#setup-page:', setupPage)

await browser.close()