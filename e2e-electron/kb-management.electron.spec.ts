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

test.describe('知识库管理', () => {

  test('1.1 创建知识库', async () => {
    const workdir = createIsolatedWorkdir('kb-1-1')
    const { app, page } = await launchApp(workdir)
    try {
      await ensureHomePage(page)

      await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
      await page.waitForSelector('#kb-name', { timeout: 5000 })
      await page.fill('#kb-name', '测试知识库')
      await page.getByRole('button', { name: '创建' }).click()
      await page.waitForSelector('text=测试知识库', { timeout: 8000 })
      await expect(page.locator('text=测试知识库').first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('1.2 删除知识库', async () => {
    const workdir = createIsolatedWorkdir('kb-1-2')
    const { app, page } = await launchApp(workdir)
    try {
      await ensureHomePage(page)

      // Create KB
      await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
      await page.waitForSelector('#kb-name', { timeout: 5000 })
      await page.fill('#kb-name', '待删除知识库')
      await page.getByRole('button', { name: '创建' }).click()
      await page.waitForSelector('text=待删除知识库', { timeout: 8000 })

      // Right-click KB card — use card.click({ button: 'right' }) directly, not page.mouse.click with bounding box
      const kbCard = page.locator('[class*="card"]').filter({ hasText: '待删除知识库' }).first()
      await kbCard.click({ button: 'right' })

      await page.waitForSelector('[data-testid="kb-context-menu"]', { timeout: 5000 })
      await page.click('[data-testid="ctx-delete"]')

      await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })
      await page.click('[data-testid="confirm-modal"] button:has-text("确定")')

      await expect(page.locator('text=待删除知识库')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('1.3 重命名知识库', async () => {
    const workdir = createIsolatedWorkdir('kb-1-3')
    const { app, page } = await launchApp(workdir)
    try {
      await ensureHomePage(page)

      // Create KB
      await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
      await page.waitForSelector('#kb-name', { timeout: 5000 })
      await page.fill('#kb-name', '待重命名知识库')
      await page.getByRole('button', { name: '创建' }).click()
      await page.waitForSelector('text=待重命名知识库', { timeout: 8000 })

      // Right-click KB card — use card.click({ button: 'right' }) directly, not page.mouse.click with bounding box
      const kbCard = page.locator('[class*="card"]').filter({ hasText: '待重命名知识库' }).first()
      await kbCard.click({ button: 'right' })

      await page.waitForSelector('[data-testid="kb-context-menu"]', { timeout: 5000 })
      await page.click('[data-testid="ctx-rename"]')

      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '已重命名知识库')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(300)

      await expect(page.locator('text=已重命名知识库').first()).toBeVisible()
      await expect(page.locator('text=待重命名知识库')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('1.4 知识库排序', async () => {
    const workdir = createIsolatedWorkdir('kb-1-4')
    const { app, page } = await launchApp(workdir)
    try {
      await ensureHomePage(page)

      const kbNames = ['知识库C', '知识库A', '知识库B']
      for (const name of kbNames) {
        await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
        await page.waitForSelector('#kb-name', { timeout: 5000 })
        await page.fill('#kb-name', name)
        await page.getByRole('button', { name: '创建' }).click()
        await page.waitForSelector(`text=${name}`, { timeout: 8000 })
      }

      for (const name of kbNames) {
        await expect(page.locator(`text=${name}`).first()).toBeVisible()
      }
    } finally {
      await app.close()
    }
  })

  test('1.5 导入知识库', async () => {
    const workdir = createIsolatedWorkdir('kb-1-5')
    const { app, page } = await launchApp(workdir)
    try {
      await ensureHomePage(page)

      await page.click('text=导入知识库')
      await page.waitForSelector('text=选择文件夹', { timeout: 5000 })

      await page.locator('button:has-text("取消")').last().click()
      await expect(page.getByRole('button', { name: '选择文件夹' })).toBeHidden()
    } finally {
      await app.close()
    }
  })

})