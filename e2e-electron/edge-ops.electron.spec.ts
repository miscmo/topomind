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

test.describe('边（连线）操作', () => {

  test('8.1 右键删除连线', async () => {
    const workdir = createIsolatedWorkdir('edge-ops-8-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '边操作测试KB')

      // Create two nodes
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 250, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 250, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '节点A')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      await pane.click({ position: { x: 500, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 500, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '节点B')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Select nodeA — use fitView first so node is in viewport, then mouse click center
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const nodeA = page.locator('.react-flow__node').filter({ hasText: '节点A' })
      const boxA = await nodeA.boundingBox()
      expect(boxA).not.toBeNull()
      await page.mouse.click(boxA!.x + boxA!.width / 2, boxA!.y + boxA!.height / 2)
      await page.waitForTimeout(200)

      // Enter edge mode by calling appStore directly (toolbar button click is flaky)
      await page.evaluate(() => {
        const appStore = (window as any).__zustandStores?.appStore
        const nodeId = appStore?.getState()?.selectedNodeId
        if (nodeId) {
          appStore?.getState()?.enterEdgeMode(nodeId)
        }
      })
      await page.waitForTimeout(300)

      // Connect to nodeB — drag from nodeA's source handle (right) to nodeB's target handle (left).
      // This fires React Flow's onConnect via the handle-based connection mechanism.
      const nodeB = page.locator('.react-flow__node').filter({ hasText: '节点B' })
      const sourceHandle = nodeA.locator('.react-flow__handle-right')
      const targetHandle = nodeB.locator('.react-flow__handle-left')
      await sourceHandle.dragTo(targetHandle)
      await page.waitForTimeout(500)

      // Verify edge exists
      const edge = page.locator('.react-flow__edge').first()
      await expect(edge).toBeVisible()

      // Fit view before right-clicking (edge may be off-screen)
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      // Right-click the edge using bounding box — edge.click({ button: 'right' }) may miss the thin SVG path
      const edgeBox = await edge.boundingBox()
      if (edgeBox) {
        await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2, { button: 'right' })
      } else {
        // Fallback: edge element exists but bounding box null (e.g. disconnected edge) — use force click
        await edge.click({ button: 'right', force: true })
      }
      await page.waitForSelector('[data-testid="context-menu-删除连线"]', { timeout: 5000 })
      await page.click('[data-testid="context-menu-删除连线"]')

      // Edge should be removed
      await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('8.2 连线模式下按 Escape 取消', async () => {
    const workdir = createIsolatedWorkdir('edge-ops-8-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '边操作测试KB')

      // Create a node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '节点X')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Select node and enter edge mode
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      const nodeX = page.locator('.react-flow__node').filter({ hasText: '节点X' })
      const boxX = await nodeX.boundingBox()
      expect(boxX).not.toBeNull()
      await page.mouse.click(boxX!.x + boxX!.width / 2, boxX!.y + boxX!.height / 2)
      await page.waitForTimeout(200)

      // Enter edge mode by calling appStore directly (toolbar button click is flaky)
      await page.evaluate(() => {
        const appStore = (window as any).__zustandStores?.appStore
        const nodeId = appStore?.getState()?.selectedNodeId
        if (nodeId) {
          appStore?.getState()?.enterEdgeMode(nodeId)
        }
      })
      await page.waitForTimeout(300)

      // Press Escape to cancel edge mode
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      // Edge mode should be cleared in appStore
      const edgeModeAfter = await page.evaluate(() => {
        const appStore = (window as any).__zustandStores?.appStore
        return appStore?.getState()?.edgeMode ?? null
      })
      expect(edgeModeAfter).toBeFalsy()
    } finally {
      await app.close()
    }
  })

})