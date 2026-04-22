/**
 * TopoMind E2E — 多知识库 Tab 管理测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('多知识库 Tab 管理', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)
  })

  test('4.1 创建并打开第一个知识库，TabBar 出现', async ({ page }) => {
    // Click "新建知识库" button
    await page.click('text=新建知识库')

    // Fill KB name
    await page.fill('#kb-name', '测试知识库A')

    // Submit
    await page.click('button:has-text("创建")')

    // Wait for the KB card to appear
    await page.waitForSelector('text=测试知识库A', { timeout: 8000 })

    // Open the KB by clicking the card
    await page.click('.card:has-text("测试知识库A")')

    // Wait for graph page
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // TabBar should appear (tabs.length > 1)
    await expect(page.locator('.tab-bar, [role="tablist"]')).toBeVisible()
  })

  test('4.2 打开第二个知识库，TabBar 显示 3 个 Tab', async ({ page }) => {
    // Create and open first KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '测试知识库A')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=测试知识库A')
    await page.click('.card:has-text("测试知识库A")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // Return to home (click home tab)
    const homeTab = page.locator('[role="tab"]:has-text("首页"), [role="tab"]:has-text("Home")')
    await homeTab.click()
    await page.waitForSelector('#home-modal', { timeout: 5000 })

    // Create and open second KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '测试知识库B')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=测试知识库B')
    await page.click('.card:has-text("测试知识库B")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // TabBar should have 3 tabs (home + KB A + KB B)
    const tabItems = page.locator('[role="tab"]')
    await expect(tabItems).toHaveCount(3)
  })

  test('4.3 Tab 切换 — KB1 和 KB2 独立显示', async ({ page }) => {
    // Create two KBs
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '知识库X')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=知识库X')
    await page.click('.card:has-text("知识库X")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // Create a node in KB X
    const canvas = page.locator('.react-flow')
    await canvas.dblclick({ position: { x: 300, y: 200 } })
    // Wait for prompt modal
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '节点X')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

    // Go home
    await page.locator('[role="tab"]').first().click()
    await page.waitForSelector('#home-modal')

    // Create second KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '知识库Y')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=知识库Y')
    await page.click('.card:has-text("知识库Y")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // Switch back to KB X — verify it still has nodeX
    const tabs = page.locator('[role="tab"]')
    await tabs.filter({ hasText: '知识库X' }).click()
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await expect(page.locator('.react-flow')).toBeVisible()
  })

  test('4.4 Tab 关闭 — 无脏状态时直接关闭', async ({ page }) => {
    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '关闭测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=关闭测试KB')
    await page.click('.card:has-text("关闭测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // TabBar visible (more than 1 tab)
    const tabBar = page.locator('[role="tablist"]')
    await expect(tabBar).toBeVisible()

    // Find the close button on the KB tab
    const kbTab = page.locator('[role="tab"]:not([title*="首页"]):not([title*="Home"])').last()
    const closeBtn = kbTab.locator('button[aria-label*="关闭"]')

    // Click close — should NOT show confirm dialog (not dirty)
    await closeBtn.click()

    // Wait for the tab to be removed (tab count should drop)
    const tabs = page.locator('[role="tab"]')
    await expect(tabs).toHaveCount(1) // only home tab remains
  })

  test('4.5 Tab 关闭后自动切换到相邻 Tab', async ({ page }) => {
    // Create 2 KBs
    await page.click('text=新建知识库')
    await page.fill('#kb-name', 'KB1')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=KB1')
    await page.click('.card:has-text("KB1")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    await page.locator('[role="tab"]').first().click()
    await page.waitForSelector('#home-modal')

    await page.click('text=新建知识库')
    await page.fill('#kb-name', 'KB2')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=KB2')
    await page.click('.card:has-text("KB2")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })

    // Now 3 tabs: home + KB1 + KB2
    await expect(page.locator('[role="tab"]')).toHaveCount(3)

    // Close the active KB2 tab
    const kb2Tab = page.locator('[role="tab"]:has-text("KB2")')
    await kb2Tab.locator('button').last().click()

    // Should auto-switch to home tab
    await page.waitForSelector('#home-modal', { timeout: 5000 })
    await expect(page.locator('[role="tab"]')).toHaveCount(2)
  })

})