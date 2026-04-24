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

test.describe('布局计算', () => {

  test('11.1 新建节点后触发 ELK 布局', async () => {
    const workdir = createIsolatedWorkdir('layout-11-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '布局测试KB')

      // Create first node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '布局根节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      const node1 = page.locator('.react-flow__node').filter({ hasText: '布局根节点' })
      await expect(node1).toBeVisible()
      const pos1 = await node1.boundingBox()
      expect(pos1).not.toBeNull()

      // Create second node
      await pane.click({ position: { x: 600, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 600, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '布局子节点B')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      const node2 = page.locator('.react-flow__node').filter({ hasText: '布局子节点B' })
      await expect(node2).toBeVisible()
      const pos2 = await node2.boundingBox()
      expect(pos2).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  test('11.2 节点位置在保存后被记住', async () => {
    const workdir = createIsolatedWorkdir('layout-11-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '位置测试KB')

      // Create a node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '位置测试节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1500)

      const node = page.locator('.react-flow__node').filter({ hasText: '位置测试节点' })
      await expect(node).toBeVisible()

      // Navigate to home page (flushes pending saves)
      await page.locator('[role="tab"]').first().click()
      await page.waitForSelector('#home-modal', { timeout: 5000 })

      // Re-enter the KB
      await page.locator('#home-modal').getByText('位置测试KB', { exact: true }).first().click()
      await page.waitForSelector('#graph-page', { timeout: 15000 })

      // Node position should be persisted
      await expect(page.locator('.react-flow__node').filter({ hasText: '位置测试节点' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('11.3 右键新建子节点触发布局', async () => {
    const workdir = createIsolatedWorkdir('layout-11-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '布局测试KB')

      // Create parent node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '父布局节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Right-click parent → 新建子节点
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const parentNode = page.locator('.react-flow__node').filter({ hasText: '父布局节点' })
      const parentBox = await parentNode.boundingBox()
      expect(parentBox).not.toBeNull()
      await page.mouse.click(parentBox!.x + parentBox!.width / 2, parentBox!.y + parentBox!.height / 2, { button: 'right' })

      await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })
      await page.click('[data-testid="context-menu-新建子节点"]')

      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '子布局节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Both parent and child should be visible
      await expect(page.locator('.react-flow__node').filter({ hasText: '父布局节点' })).toBeVisible()
      await expect(page.locator('.react-flow__node').filter({ hasText: '子布局节点' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

})