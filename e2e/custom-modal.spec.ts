/**
 * TopoMind E2E — 自定义弹窗测试（Prompt & Confirm）
 *
 * 验证应用使用自定义 PromptModal/ConfirmModal，
 * 而非浏览器原生的 window.prompt / window.confirm。
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('自定义弹窗（非原生）', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)
  })

  test('12.1 双击画布弹出 PromptModal（非原生 prompt）', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '弹窗测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=弹窗测试KB')
    await page.click('.card:has-text("弹窗测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })

    // Double-click canvas
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })

    // Custom PromptModal should appear (has data-testid, not browser dialog)
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await expect(page.locator('[data-testid="prompt-modal"]')).toBeVisible()

    // Verify it has custom buttons (确定 + 取消), not browser OK/Cancel
    await expect(page.locator('[data-testid="prompt-modal"] button:has-text("确定")')).toBeVisible()
    await expect(page.locator('[data-testid="prompt-modal"] button:has-text("取消")')).toBeVisible()

    // No browser native dialog dialogs should be open
    // (In Playwright, browser dialogs would block the page — if we reach here, it's custom)
  })

  test('12.2 PromptModal 取消后无节点创建', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '弹窗测试KB2')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=弹窗测试KB2')
    await page.click('.card:has-text("弹窗测试KB2")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })

    // Double-click canvas
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })

    // Cancel via button
    await page.click('[data-testid="prompt-modal"] button:has-text("取消")')
    await page.waitForTimeout(300)

    // Modal should be gone
    await expect(page.locator('[data-testid="prompt-modal"]')).toHaveCount(0)

    // No node should appear on canvas
    await expect(page.locator('.react-flow')).not.toContainText('未命名节点')
  })

  test('12.3 PromptModal 支持 Enter 确认', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '弹窗测试KB3')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=弹窗测试KB3')
    await page.click('.card:has-text("弹窗测试KB3")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })

    // Double-click canvas
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })

    // Type node name and press Enter
    await page.fill('[data-testid="prompt-modal"] input', 'Enter确认节点')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    // Modal should close
    await expect(page.locator('[data-testid="prompt-modal"]')).toHaveCount(0)

    // Node should appear
    await expect(page.locator('.react-flow')).toContainText('Enter确认节点')
  })

  test('13.1 Tab 关闭脏状态时弹出自定义 ConfirmModal（非原生 confirm）', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', 'Confirm测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=Confirm测试KB')
    await page.click('.card:has-text("Confirm测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })

    // Make a change (create a node) — tab becomes dirty
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '脏测试节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Wait for dirty marker on tab
    await page.waitForSelector('[role="tab"] text=•', { timeout: 3000 })

    // Find and click the close button on the KB tab
    const kbTab = page.locator('[role="tab"]').filter({ hasNotText: /^首页$/ }).last()
    const closeBtn = kbTab.locator('button[aria-label*="关闭"]')
    await closeBtn.click()

    // Custom ConfirmModal should appear
    await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })
    await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible()

    // Verify custom buttons (确定 + 取消), not browser native confirm buttons
    await expect(page.locator('[data-testid="confirm-modal"] button:has-text("确定")')).toBeVisible()
    await expect(page.locator('[data-testid="confirm-modal"] button:has-text("取消")')).toBeVisible()
  })

  test('13.2 ConfirmModal 取消后 Tab 不关闭', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', 'Confirm取消测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=Confirm取消测试KB')
    await page.click('.card:has-text("Confirm取消测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })

    // Create a node (make dirty)
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '脏节点X')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Wait for dirty marker
    await page.waitForSelector('[role="tab"] text=•', { timeout: 3000 })

    // Click close button on KB tab
    const kbTab = page.locator('[role="tab"]').filter({ hasNotText: /^首页$/ }).last()
    const closeBtn = kbTab.locator('button[aria-label*="关闭"]')
    await closeBtn.click()

    // Wait for confirm modal
    await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })

    // Click 取消
    await page.click('[data-testid="confirm-modal"] button:has-text("取消")')
    await page.waitForTimeout(300)

    // Tab should still be open (3 tabs: home + dirty KB + maybe others)
    const tabs = page.locator('[role="tab"]')
    await expect(tabs).toHaveCount(2)

    // Confirm modal should be gone
    await expect(page.locator('[data-testid="confirm-modal"]')).toHaveCount(0)
  })

  test('13.3 删除节点时弹出自定义 ConfirmModal', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '节点删除Confirm测试')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=节点删除Confirm测试')
    await page.click('.card:has-text("节点删除Confirm测试")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })

    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '待删除节点Confirm')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Verify node exists
    await expect(page.locator('.react-flow')).toContainText('待删除节点Confirm')

    // Right-click the node → Delete
    const node = page.locator('.react-flow__node').filter({ hasText: '待删除节点Confirm' })
    await node.click({ button: 'right' })
    await page.waitForSelector('text=删除节点', { timeout: 5000 })
    await page.click('text=删除节点')

    // Custom ConfirmModal should appear (delete confirmation)
    await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })
    await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible()
  })

})
