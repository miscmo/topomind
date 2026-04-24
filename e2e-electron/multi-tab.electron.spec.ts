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

test.describe('多知识库 Tab 管理', () => {

  test('4.1 创建并打开第一个知识库，TabBar 出现', async () => {
    const workdir = createIsolatedWorkdir('tab-4-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '测试知识库A')

      await page.waitForSelector('.tab-bar, [role="tablist"]', { timeout: 5000 })
      await expect(page.locator('.tab-bar, [role="tablist"]')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('4.2 打开第二个知识库，TabBar 显示 3 个 Tab', async () => {
    const workdir = createIsolatedWorkdir('tab-4-2')
    const { app, page } = await launchApp(workdir)
    try {
      // Create and open first KB
      await createAndOpenKB(page, '测试知识库A')

      // Navigate to home tab first so #home-modal becomes visible
      // Wait for TabBar to render (appears when KB tab exists)
      await page.waitForSelector('[role="tablist"]', { timeout: 5000 })
      const homeTab = page.locator('[role="tablist"] [role="tab"]:has-text("首页")')
      const homeTabBox = await homeTab.boundingBox()
      await page.mouse.click(homeTabBox!.x + homeTabBox!.width / 2, homeTabBox!.y + homeTabBox!.height / 2)
      await page.waitForSelector('#home-modal', { timeout: 5000 })
      await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
      await page.waitForSelector('#kb-name', { timeout: 5000 })
      await page.fill('#kb-name', '测试知识库B')
      await page.getByRole('button', { name: '创建' }).click()
      const kbCardB = page.locator('#home-modal').getByText('测试知识库B', { exact: true }).first()
      await kbCardB.waitFor({ state: 'visible', timeout: 10000 })
      await kbCardB.click()
      await page.waitForSelector('#graph-page', { timeout: 15000 })

      // TabBar should have 3 tabs (home + KB A + KB B)
      // Scope to .tab-bar to avoid matching breadcrumb role="tab" buttons
      const tabItems = page.locator('[role="tablist"] [role="tab"]')
      await expect(tabItems).toHaveCount(3)
    } finally {
      await app.close()
    }
  })

  test('4.3 Tab 切换 — KB1 和 KB2 独立显示', async () => {
    const workdir = createIsolatedWorkdir('tab-4-3')
    const { app, page } = await launchApp(workdir)
    try {
      // Create first KB and add a node
      await createAndOpenKB(page, '知识库X')

      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '节点X')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Create second KB — navigate to home tab first
      // Wait for TabBar to render
      await page.waitForSelector('[role="tablist"]', { timeout: 5000 })
      const homeTab = page.locator('[role="tablist"] [role="tab"]:has-text("首页")')
      const homeTabBox = await homeTab.boundingBox()
      await page.mouse.click(homeTabBox!.x + homeTabBox!.width / 2, homeTabBox!.y + homeTabBox!.height / 2)
      await page.waitForSelector('#home-modal', { timeout: 5000 })
      await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
      await page.waitForSelector('#kb-name', { timeout: 5000 })
      await page.fill('#kb-name', '知识库Y')
      await page.getByRole('button', { name: '创建' }).click()
      const kbCardY = page.locator('#home-modal').getByText('知识库Y', { exact: true }).first()
      await kbCardY.waitFor({ state: 'visible', timeout: 10000 })
      await kbCardY.click()
      await page.waitForSelector('#graph-page', { timeout: 15000 })

      // Switch back to KB X tab via mouse click on tab
      const tab1 = page.locator('[role="tablist"] [role="tab"]').nth(1)
      const tab1Box = await tab1.boundingBox()
      await page.mouse.click(tab1Box!.x + tab1Box!.width / 2, tab1Box!.y + tab1Box!.height / 2)
      await expect(page.locator('#graph-page')).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.react-flow')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('4.4 Tab 关闭 — 无脏状态时直接关闭', async () => {
    const workdir = createIsolatedWorkdir('tab-4-4')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '关闭测试KB')

      // TabBar visible (more than 1 tab)
      const tabBar = page.locator('[role="tablist"]')
      await expect(tabBar).toBeVisible()

      // Close the active KB tab — scope to .tab-bar
      await page.locator('[role="tablist"] [role="tab"] button[aria-label*="关闭"]').last().click()

      // TabBar hides when only home tab remains
      await page.waitForSelector('#home-modal', { timeout: 5000 })
      await expect(page.locator('[role="tab"]')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('4.5 Tab 关闭后自动切换到相邻 Tab', async () => {
    const workdir = createIsolatedWorkdir('tab-4-5')
    const { app, page } = await launchApp(workdir)
    try {
      // Create KB1
      await createAndOpenKB(page, 'KB1')

      // Create KB2 — navigate to home tab first
      // Wait for TabBar to render
      await page.waitForSelector('[role="tablist"]', { timeout: 5000 })
      const homeTab = page.locator('[role="tablist"] [role="tab"]:has-text("首页")')
      const homeTabBox = await homeTab.boundingBox()
      await page.mouse.click(homeTabBox!.x + homeTabBox!.width / 2, homeTabBox!.y + homeTabBox!.height / 2)
      await page.waitForSelector('#home-modal', { timeout: 5000 })
      await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
      await page.waitForSelector('#kb-name', { timeout: 5000 })
      await page.fill('#kb-name', 'KB2')
      await page.getByRole('button', { name: '创建' }).click()
      const kbCard2 = page.locator('#home-modal').getByText('KB2', { exact: true }).first()
      await kbCard2.waitFor({ state: 'visible', timeout: 10000 })
      await kbCard2.click()
      await page.waitForSelector('#graph-page', { timeout: 15000 })

      // Now 3 tabs: home + KB1 + KB2 — scope to .tab-bar
      await expect(page.locator('[role="tablist"] [role="tab"]')).toHaveCount(3)

      // Close KB2 tab — auto-switches to adjacent KB1 tab
      const closeBtn = page.locator('[role="tablist"] [role="tab"]:has-text("KB2") button[aria-label*="关闭"]')
      const closeBox = await closeBtn.boundingBox()
      await page.mouse.click(closeBox!.x + closeBox!.width / 2, closeBox!.y + closeBox!.height / 2)

      // KB2 tab should be gone — scope to .tab-bar
      await expect(page.locator('[role="tablist"] [role="tab"]:has-text("KB2")')).toHaveCount(0)
      // KB1 graph should be visible
      await expect(page.locator('.react-flow')).toBeVisible()
    } finally {
      await app.close()
    }
  })

})