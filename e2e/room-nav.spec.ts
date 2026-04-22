/**
 * TopoMind E2E — 房间导航测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('房间导航', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)

    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '房间导航测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=房间导航测试KB')
    await page.click('.card:has-text("房间导航测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })
  })

  test('10.1 双击有子节点钻入子房间', async ({ page }) => {
    // Create a parent node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '父节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Create a child node under the parent
    // Right-click the parent → 新建子节点
    const parentNode = page.locator('.react-flow__node').filter({ hasText: '父节点' })
    await parentNode.click({ button: 'right' })
    await page.waitForSelector('text=新建子节点', { timeout: 5000 })
    await page.click('text=新建子节点')
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '子节点A')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Double-click the parent node to drill in
    await parentNode.dblclick()
    await page.waitForTimeout(1000)

    // Breadcrumb should now show the path (父节点 > 子节点A)
    // The breadcrumb appears only when drilled in
    const breadcrumb = page.locator('#breadcrumb')
    await expect(breadcrumb).toBeVisible()
    await expect(breadcrumb).toContainText('父节点')
  })

  test('10.2 Breadcrumb 返回上级房间', async ({ page }) => {
    // Create a parent node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '父房间节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Create a child node
    const parentNode = page.locator('.react-flow__node').filter({ hasText: '父房间节点' })
    await parentNode.click({ button: 'right' })
    await page.waitForSelector('text=新建子节点', { timeout: 5000 })
    await page.click('text=新建子节点')
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '子房间节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Double-click parent to drill in
    await parentNode.dblclick()
    await page.waitForTimeout(1000)

    // Verify breadcrumb shows parent path
    const breadcrumb = page.locator('#breadcrumb')
    await expect(breadcrumb).toContainText('父房间节点')

    // Click the home/global breadcrumb button to go back to root
    await page.click('text=🏠 全局')
    await page.waitForTimeout(800)

    // Breadcrumb should be hidden (back at root)
    await expect(page.locator('#breadcrumb')).toHaveCount(0)
  })

  test('10.3 无导航历史时 Breadcrumb 不显示', async ({ page }) => {
    // Create a single node at root level
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '根节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // At root level with no history, breadcrumb should not be visible
    await expect(page.locator('#breadcrumb')).toHaveCount(0)
  })

})
