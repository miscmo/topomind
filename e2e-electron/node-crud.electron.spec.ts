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

test.describe('节点 CRUD 操作', () => {

  test('7.1 双击画布新建节点', async () => {
    const workdir = createIsolatedWorkdir('node-crud-7-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '节点CRUD测试')

      const canvas = page.locator('.react-flow__pane')
      await expect(canvas).toBeVisible()
      await canvas.click({ position: { x: 400, y: 200 } })
      await page.waitForTimeout(80)
      await canvas.click({ position: { x: 400, y: 200 } })

      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '新节点测试')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      await expect(page.locator('.react-flow__node').filter({ hasText: '新节点测试' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('7.2 右键菜单新建子节点', async () => {
    const workdir = createIsolatedWorkdir('node-crud-7-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '节点CRUD测试')

      // Create parent node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '父节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      const parentNode = page.locator('.react-flow__node').filter({ hasText: '父节点' })
      await expect(parentNode).toBeVisible()

      // Fit view before right-click
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      // Right-click using mouse.click to bypass TabBar interception
      const box = await parentNode.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' })

      await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })
      await page.click('[data-testid="context-menu-新建子节点"]')

      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '子节点A')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForSelector('.react-flow__node:has-text("子节点A")', { timeout: 10000 })

      await expect(page.locator('.react-flow')).toContainText('父节点')
      await expect(page.locator('.react-flow')).toContainText('子节点A')
    } finally {
      await app.close()
    }
  })

  test('7.3 重命名节点', async () => {
    const workdir = createIsolatedWorkdir('node-crud-7-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '节点CRUD测试')

      // Create node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '待重命名节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Fit view before right-click
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const nodeBox = await page.locator('.react-flow__node').filter({ hasText: '待重命名节点' }).boundingBox()
      expect(nodeBox).not.toBeNull()
      await page.mouse.click(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2, { button: 'right' })
      await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })
      await page.click('[data-testid="context-menu-重命名"]')

      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '新名称节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForSelector('.react-flow__node:has-text("新名称节点")', { timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  test('7.4 删除节点', async () => {
    const workdir = createIsolatedWorkdir('node-crud-7-4')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '节点CRUD测试')

      // Create node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '待删除节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      await expect(page.locator('.react-flow')).toContainText('待删除节点')

      // Fit view before right-click
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const nodeBox = await page.locator('.react-flow__node').filter({ hasText: '待删除节点' }).boundingBox()
      expect(nodeBox).not.toBeNull()
      await page.mouse.click(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2, { button: 'right' })

      await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })
      await page.click('[data-testid="context-menu-删除节点"]')

      // Confirm modal — handleDelete requires typing the EXACT node name
      // Use Enter key instead of button click for reliable React state sync
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '待删除节点')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(3000)

      // Verify node is removed using waitForFunction (more robust than fixed wait)
      await expect.poll(async () => {
        return await page.locator('.react-flow__node').filter({ hasText: '待删除节点' }).count()
      }, { timeout: 10000 }).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('7.5 键盘 Delete 键删除选中节点', async () => {
    const workdir = createIsolatedWorkdir('node-crud-7-5')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '节点CRUD测试')

      // Create node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', 'Delete测试节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Fit view then click node to select it
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)
      const nodeBox = await page.locator('.react-flow__node').filter({ hasText: 'Delete测试节点' }).boundingBox()
      expect(nodeBox).not.toBeNull()
      await page.mouse.click(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2)

      // Press Delete — handleDelete requires typing the EXACT node name
      await page.keyboard.press('Delete')

      // Use Enter key instead of button click for reliable React state sync
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', 'Delete测试节点')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)

      // Verify node is removed using waitForFunction (more robust than fixed wait)
      await expect.poll(async () => {
        return await page.locator('.react-flow__node').filter({ hasText: 'Delete测试节点' }).count()
      }, { timeout: 10000 }).toBe(0)
    } finally {
      await app.close()
    }
  })

})
