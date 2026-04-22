/**
 * Quick diagnostic: check what's on the app page at localhost:5173
 */
const { chromium } = require('@playwright/test')

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext()
  const page = await context.newPage()

  // Listen for console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[CONSOLE ERROR]', msg.text())
    }
  })

  // Listen for page errors
  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message)
  })

  try {
    console.log('Navigating to http://localhost:5173/ ...')
    await page.goto('http://localhost:5173/', { timeout: 15000 })
    console.log('Page loaded!')

    // Wait a bit for React to render
    await page.waitForTimeout(3000)

    // Get page title
    const title = await page.title()
    console.log('Page title:', title)

    // Check what elements are visible
    const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 2000))
    console.log('\nBody HTML (first 2000 chars):')
    console.log(bodyHTML)

    // Check for key elements
    const homeModal = await page.$('#home-modal')
    const setupPage = await page.$('#setup-page')
    const graphPage = await page.$('#graph-page')

    console.log('\nKey elements found:')
    console.log('  #home-modal:', homeModal ? 'FOUND' : 'NOT FOUND')
    console.log('  #setup-page:', setupPage ? 'FOUND' : 'NOT FOUND')
    console.log('  #graph-page:', graphPage ? 'FOUND' : 'NOT FOUND')

    // Check window.electronAPI
    const hasElectronAPI = await page.evaluate(() => typeof window.electronAPI !== 'undefined')
    console.log('  window.electronAPI:', hasElectronAPI ? 'FOUND' : 'NOT FOUND')

    // Check for any element with id
    const ids = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[id]')).map(el => el.id).slice(0, 20)
    })
    console.log('\nElement IDs found:', ids)

  } catch (e) {
    console.error('Error:', e.message)
  }

  await browser.close()
}

main().catch(console.error)
