import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

const electronMain = path.join(process.cwd(), 'dist-electron', 'main.js')

function createIsolatedWorkdir(testSlug: string) {
  const dir = path.join(os.tmpdir(), `topomind-e2e-${testSlug}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function launchApp(workdir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [electronMain],
    env: { ...process.env, NODE_ENV: 'test', TOPOMIND_E2E_WORKDIR: workdir },
  })
  const page = await app.firstWindow()
  page.on('console', (msg) => { console.log('[electron-page:console]', msg.type(), msg.text()) })
  page.on('pageerror', (error) => { console.log('[electron-page:error]', error.message) })
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function ensureHomePage(page: Page) {
  if (await page.locator('#home-modal').isVisible().catch(() => false)) return
  if (await page.locator('#setup-page').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '打开已有工作目录' }).click()
  }
  await page.waitForSelector('#home-modal', { timeout: 15000 })
}

async function createAndOpenKB(page: Page, kbName: string) {
  await ensureHomePage(page)
  await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
  await page.waitForSelector('#kb-name', { timeout: 5000 })
  await page.fill('#kb-name', kbName)
  await page.getByRole('button', { name: '创建' }).click()
  const kbCard = page.locator('#home-modal').getByText(kbName, { exact: true }).first()
  await kbCard.waitFor({ state: 'visible', timeout: 10000 })
  await kbCard.click()
  await page.waitForSelector('#graph-page', { timeout: 15000 })
  await page.waitForSelector('.react-flow', { timeout: 15000 })
}

test.describe('脏状态指示', () => {

  test('6.1 修改后 Tab 显示脏标记', async () => {
    const workdir = createIsolatedWorkdir('dirty-6-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '脏状态测试KB')

      const kbTab = page.locator('[role="tab"]').filter({ hasNotText: /^首页$/ }).last()

      // Before any change, no dirty marker
      await expect(kbTab.locator('text=•')).toHaveCount(0)

      // Double-click canvas to create a node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 300 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 300 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '脏测试节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

      // Dirty marker should appear on the tab
      await page.waitForFunction(() => {
        const tabs = document.querySelectorAll('[role="tab"]')
        return Array.from(tabs).some(t => t.textContent?.includes('\u2022'))
      }, { timeout: 3000 })
      const dirtyTab = page.locator('[role="tab"]').filter({ hasText: '\u2022' })
      await expect(dirtyTab).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('6.2 保存后脏标记消失（300ms debounce）', async () => {
    const workdir = createIsolatedWorkdir('dirty-6-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '脏状态测试KB')

      const kbTab = page.locator('[role="tab"]').filter({ hasNotText: /^首页$/ }).last()

      // Trigger a change
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 300 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 300 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '待保存节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

            // Dirty marker should appear
      await page.waitForFunction(() => {
        const tabs = document.querySelectorAll('[role="tab"]')
        return Array.from(tabs).some(t => t.textContent?.includes('\u2022'))
      }, { timeout: 3000 })
      await expect(kbTab.locator('text=\u2022')).toBeVisible()

      // Wait for debounce save (300ms + margin)
      await page.waitForTimeout(500)
      await page.waitForFunction(() => {
        const tabs = document.querySelectorAll('[role="tab"]')
        return !Array.from(tabs).some(t => t.textContent?.includes('\u2022'))
      }, { timeout: 15000 })
      await expect(kbTab.locator('text=\u2022')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('6.3 脏状态通过回调触发，无 setInterval 轮询', async () => {
    const workdir = createIsolatedWorkdir('dirty-6-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '脏状态测试KB')

      // Trigger a change — dirty state should appear within milliseconds, not after 1 second interval
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 300 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 300 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '节点A')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

      // Dirty state should appear immediately (not after a polling interval)
      await page.waitForFunction(() => {
        const tabs = document.querySelectorAll('[role="tab"]')
        return Array.from(tabs).some(t => t.textContent?.includes('\u2022'))
      }, { timeout: 500 })
    } finally {
      await app.close()
    }
  })

})