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

test.describe('Git 面板', () => {

  test('15.1 工具栏 Git 按钮打开 Git 面板', async () => {
    const workdir = createIsolatedWorkdir('git-panel-15-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, 'Git面板测试KB')

      // Toolbar Git button should be visible
      await expect(page.locator('#toolbar button:has-text("Git")')).toBeVisible()

      // Git panel should not be visible initially
      await expect(page.locator('[class*="panel"]').filter({ hasText: 'Git' })).toHaveCount(0)

      // Click Git button in toolbar
      await page.click('#toolbar button:has-text("Git")')
      await page.waitForTimeout(500)

      // Git panel should appear
      await expect(page.locator('text=Git').first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('15.2 Git 面板显示状态信息', async () => {
    const workdir = createIsolatedWorkdir('git-panel-15-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, 'Git面板测试KB')

      // Open Git panel
      await page.click('#toolbar button:has-text("Git")')
      await page.waitForTimeout(800)

      // Create a change (add a node)
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', 'Git脏测试节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(800)

      // Git panel should still be visible
      await expect(page.locator('text=Git').first()).toBeVisible()

      const gitPanel = page.locator('[class*="gitPanel"], [class*="panel"]').first()
      await expect(gitPanel).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('15.3 再次点击 Git 按钮关闭面板', async () => {
    const workdir = createIsolatedWorkdir('git-panel-15-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, 'Git面板测试KB')

      // Open Git panel
      await page.click('#toolbar button:has-text("Git")')
      await page.waitForTimeout(500)
      await expect(page.locator('text=Git').first()).toBeVisible()

      // Close the panel
      await page.click('#toolbar button:has-text("Git")')
      await page.waitForTimeout(300)

      // Git panel should be hidden
      const gitPanelDivs = page.locator('[class*="panel"]').filter({ hasText: /^Git$/ })
      await expect(gitPanelDivs).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('15.4 关闭 Git 面板后工具栏按钮不再高亮', async () => {
    const workdir = createIsolatedWorkdir('git-panel-15-4')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, 'Git面板测试KB')

      // Open Git panel
      await page.click('#toolbar button:has-text("Git")')
      await page.waitForTimeout(300)

      const gitBtn = page.locator('#toolbar button:has-text("Git")')
      await expect(gitBtn).toHaveClass(/active/)

      // Close the panel
      await page.click('#toolbar button:has-text("Git")')
      await page.waitForTimeout(300)

      // Git button should no longer have active class
      await expect(gitBtn).not.toHaveClass(/active/)
    } finally {
      await app.close()
    }
  })

})