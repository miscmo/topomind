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

test.describe('自定义弹窗（非原生）', () => {

  test('12.1 双击画布弹出 PromptModal（非原生 prompt）', async () => {
    const workdir = createIsolatedWorkdir('custom-modal-12-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '弹窗测试KB')

      // Double-click canvas
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })

      // Custom PromptModal should appear (has data-testid, not browser dialog)
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await expect(page.locator('[data-testid="prompt-modal"]')).toBeVisible()

      // Verify custom buttons (确定 + 取消), not browser native OK/Cancel
      await expect(page.locator('[data-testid="prompt-modal"] button:has-text("确定")')).toBeVisible()
      await expect(page.locator('[data-testid="prompt-modal"] button:has-text("取消")')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('12.2 PromptModal 取消后无节点创建', async () => {
    const workdir = createIsolatedWorkdir('custom-modal-12-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '弹窗测试KB2')

      // Double-click canvas
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })

      // Cancel via button
      await page.click('[data-testid="prompt-modal"] button:has-text("取消")')
      await page.waitForTimeout(300)

      // Modal should be gone
      await expect(page.locator('[data-testid="prompt-modal"]')).toHaveCount(0)

      // No node should appear on canvas
      await expect(page.locator('.react-flow')).not.toContainText('未命名节点')
    } finally {
      await app.close()
    }
  })

  test('12.3 PromptModal 支持 Enter 确认', async () => {
    const workdir = createIsolatedWorkdir('custom-modal-12-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '弹窗测试KB3')

      // Double-click canvas
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })

      // Type node name and press Enter
      await page.fill('[data-testid="prompt-modal"] input', 'Enter确认节点')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Modal should close
      await expect(page.locator('[data-testid="prompt-modal"]')).toHaveCount(0)

      // Node should appear
      await expect(page.locator('.react-flow')).toContainText('Enter确认节点')
    } finally {
      await app.close()
    }
  })

  test('13.1 Tab 关闭脏状态时弹出自定义 ConfirmModal（非原生 confirm）', async () => {
    const workdir = createIsolatedWorkdir('custom-modal-13-1')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, 'Confirm测试KB')

      // Make a change (create a node) — tab becomes dirty
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '脏测试节点')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      // Poll for dirty bullet in TabBar tabs (poll immediately, debounce ~300ms may fire before tab bar is even visible)
      await expect.poll(async () => {
        return await page.locator('[role="tablist"] [role="tab"]').filter({ hasText: '\u2022' }).count()
      }, { timeout: 8000 }).toBeGreaterThan(0)

      // Click close button on KB tab — use .first() to get the non-home KB tab
      // (tabs order: [首页, Confirm测试KB], filter excludes 首页, .first() = KB tab)
      const kbTab = page.locator('[role="tablist"] [role="tab"]').filter({ hasNotText: /^首页$/ }).first()
      const closeBtn = kbTab.locator('button[aria-label*="关闭"]')
      const closeBtnBox = await closeBtn.boundingBox()
      expect(closeBtnBox).not.toBeNull()
      await page.mouse.click(closeBtnBox!.x + closeBtnBox!.width / 2, closeBtnBox!.y + closeBtnBox!.height / 2)

      // Custom ConfirmModal should appear
      await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })
      await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible()

      // Verify custom buttons (确定 + 取消)
      await expect(page.locator('[data-testid="confirm-modal"] button:has-text("确定")')).toBeVisible()
      await expect(page.locator('[data-testid="confirm-modal"] button:has-text("取消")')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('13.2 ConfirmModal 取消后 Tab 不关闭', async () => {
    const workdir = createIsolatedWorkdir('custom-modal-13-2')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, 'Confirm取消测试KB')

      // Wait for TabBar to be visible first (KB tab was created when createAndOpenKB ran)
      await page.waitForSelector('[role="tablist"]', { timeout: 5000 })

      // The prior node creation's debounce has already fired → tab is no longer dirty.
      // Trigger a FRESH change to set dirty again, then poll immediately before debounce fires.
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 400, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '脏节点X')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

      // Poll for dirty bullet immediately — bullet appears via queueMicrotask,
      // debounce fires ~300ms later so poll must happen within that window
      await expect.poll(async () => {
        return await page.locator('[role="tablist"] [role="tab"]').filter({ hasText: '\u2022' }).count()
      }, { timeout: 8000 }).toBeGreaterThan(0)

      // Immediately click close button on KB tab — use .first() to get the non-home KB tab
      const kbTab = page.locator('[role="tablist"] [role="tab"]').filter({ hasNotText: /^首页$/ }).first()
      const closeBtn = kbTab.locator('button[aria-label*="关闭"]')
      const closeBtnBox = await closeBtn.boundingBox()
      expect(closeBtnBox).not.toBeNull()
      await page.mouse.click(closeBtnBox!.x + closeBtnBox!.width / 2, closeBtnBox!.y + closeBtnBox!.height / 2)

      // Wait for confirm modal
      await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })

      // Click 取消
      await page.click('[data-testid="confirm-modal"] button:has-text("取消")')
      await page.waitForTimeout(300)

      // Tab should still be open (2 tabs: home + dirty KB)
      const tabs = page.locator('[role="tab"]')
      await expect(tabs).toHaveCount(2)

      // Confirm modal should be gone
      await expect(page.locator('[data-testid="confirm-modal"]')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('13.3 删除节点时弹出自定义 ConfirmModal', async () => {
    const workdir = createIsolatedWorkdir('custom-modal-13-3')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '节点删除Confirm测试')

      // Create a node
      const pane = page.locator('.react-flow__pane')
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForTimeout(80)
      await pane.click({ position: { x: 300, y: 200 } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', '待删除节点Confirm')
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(1200)

      // Verify node exists
      await expect(page.locator('.react-flow')).toContainText('待删除节点Confirm')

      // Fit view before right-clicking
      await page.evaluate(() => {
        const rf = (window as any).__reactFlow
        rf?.fitView?.({ padding: 0.3, duration: 300 })
      })
      await page.waitForTimeout(400)

      // Right-click the node → Delete
      const nodeEl = page.locator('.react-flow__node').filter({ hasText: '待删除节点Confirm' })
      const nodeBox = await nodeEl.boundingBox()
      expect(nodeBox).not.toBeNull()
      await page.mouse.click(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2, { button: 'right' })

      await page.waitForSelector('[data-testid="context-menu-删除节点"]', { timeout: 5000 })
      await page.locator('[data-testid="context-menu-删除节点"]').click()

      // 删除节点使用 PromptModal（需输入节点名确认），不是 ConfirmModal
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await expect(page.locator('[data-testid="prompt-modal"]')).toBeVisible()
    } finally {
      await app.close()
    }
  })

})