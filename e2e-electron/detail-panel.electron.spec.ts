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

test.describe('详细面板', () => {

  test('2.1 点击节点显示详细面板', async () => {
    const workdir = createIsolatedWorkdir('detail-panel-2-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '详细面板测试KB')
      await createNode(page, '测试节点')

      // Fit view before clicking
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      // Click node using mouse.click
      const node = page.locator('.react-flow__node').filter({ hasText: '测试节点' })
      const box = await node.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)

      await page.waitForSelector('#detail-panel', { timeout: 5000 })
      await expect(page.locator('#detail-panel')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('2.2 编辑节点详细信息', async () => {
    const workdir = createIsolatedWorkdir('detail-panel-2-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '详细面板测试KB')
      await createNode(page, '编辑测试节点')

      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const node = page.locator('.react-flow__node').filter({ hasText: '编辑测试节点' })
      const box = await node.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.waitForSelector('#detail-panel', { timeout: 5000 })

      // Enter edit mode first, then fill the markdown textarea
      await page.click('button:has-text("编辑")')
      await page.waitForSelector('#detail-panel textarea', { timeout: 5000 })
      await page.fill('#detail-panel textarea', '这是一个测试描述')
      await expect(page.locator('#detail-panel textarea')).toHaveValue('这是一个测试描述')
    } finally {
      await app.close()
    }
  })

  test('2.3 关闭详细面板', async () => {
    const workdir = createIsolatedWorkdir('detail-panel-2-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '详细面板测试KB')
      await createNode(page, '关闭测试节点')

      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const node = page.locator('.react-flow__node').filter({ hasText: '关闭测试节点' })
      const box = await node.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.waitForSelector('#detail-panel', { timeout: 5000 })

      // Click Escape to deselect (triggers useKeyboard's clearSelection → appStore.clearSelection)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      // DetailPanel container is always in DOM when right panel not collapsed (shows empty state instead)
      await expect(page.locator('#detail-panel')).toContainText('选择一个节点查看详情')
    } finally {
      await app.close()
    }
  })

  test('2.4 详细面板显示节点属性', async () => {
    const workdir = createIsolatedWorkdir('detail-panel-2-4')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '详细面板测试KB')
      await createNode(page, '属性测试节点')

      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const node = page.locator('.react-flow__node').filter({ hasText: '属性测试节点' })
      const box = await node.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.waitForSelector('#detail-panel', { timeout: 5000 })

      await expect(page.locator('#detail-panel')).toContainText('属性测试节点')
    } finally {
      await app.close()
    }
  })

})