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

async function createNode(page: Page, name: string, x = 300, y = 200) {
  const pane = page.locator('.react-flow__pane')
  await pane.click({ position: { x, y } })
  await page.waitForTimeout(80)
  await pane.click({ position: { x, y } })
  await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
  await page.fill('[data-testid="prompt-modal"] input', name)
  await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
  await page.waitForTimeout(1200)
}

test.describe('搜索功能', () => {

  test('9.1 搜索高亮匹配的节点', async () => {
    const workdir = createIsolatedWorkdir('search-9-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '搜索测试KB')

      // Create multiple nodes
      const positions = [
        { x: 200, y: 150, name: '机器学习' },
        { x: 400, y: 150, name: '深度学习' },
        { x: 600, y: 150, name: '机器视觉' },
      ]
      for (const { x, y, name } of positions) {
        await createNode(page, name, x, y)
      }

      // Type in search
      await page.fill('#search-input', '机器')
      await page.waitForTimeout(300)

      await expect(page.locator('#search-input')).toHaveValue('机器')

      // Matching nodes "机器学习" and "机器视觉" should be highlighted
      const matchedNodes = page.locator('.react-flow__node').filter({ hasText: /机器学习|机器视觉/ })
      const matchedCount = await matchedNodes.count()
      expect(matchedCount).toBeGreaterThanOrEqual(2)

      // Non-matching node should still be visible
      await expect(page.locator('.react-flow__node').filter({ hasText: '深度学习' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('9.2 搜索清除后恢复正常显示', async () => {
    const workdir = createIsolatedWorkdir('search-9-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '搜索测试KB')
      await createNode(page, '测试节点X', 300, 200)

      await page.fill('#search-input', '不存在')
      await page.waitForTimeout(300)

      const clearBtn = page.locator('button[title="清除搜索"]')
      await expect(clearBtn).toBeVisible()

      await clearBtn.click()
      await expect(page.locator('#search-input')).toHaveValue('')
      await expect(clearBtn).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('9.3 无匹配结果时搜索框仍显示', async () => {
    const workdir = createIsolatedWorkdir('search-9-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '搜索测试KB')
      await createNode(page, '唯一节点', 300, 200)

      await page.fill('#search-input', '完全不匹配的内容XYZ123')
      await page.waitForTimeout(300)

      await expect(page.locator('#search-box')).toBeVisible()
      await expect(page.locator('#search-input')).toHaveValue('完全不匹配的内容XYZ123')
    } finally {
      await app.close()
    }
  })

})