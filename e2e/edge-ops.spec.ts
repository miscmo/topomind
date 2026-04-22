/**
 * TopoMind E2E — 边操作测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('边（连线）操作', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)

    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '边操作测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=边操作测试KB')
    await page.click('.card:has-text("边操作测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })
  })

  test('8.1 右键删除连线', async ({ page }) => {
    // Create two nodes first
    await page.locator('.react-flow').dblclick({ position: { x: 250, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '节点A')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

    await page.waitForTimeout(300)

    await page.locator('.react-flow').dblclick({ position: { x: 500, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '节点B')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

    await page.waitForTimeout(500)

    // Enter edge mode via toolbar
    const nodeA = page.locator('.react-flow__node').filter({ hasText: '节点A' })
    await nodeA.click()
    await page.click('text=🔗 连线')

    // Connect nodeA to nodeB by clicking nodeB
    const nodeB = page.locator('.react-flow__node').filter({ hasText: '节点B' })
    await nodeB.click()

    await page.waitForTimeout(500)

    // Right-click on an edge to open context menu
    // Find any edge element (React Flow renders edges as SVG lines)
    const edge = page.locator('.react-flow__edge').first()
    await expect(edge).toBeVisible()

    await edge.click({ button: 'right' })

    // Context menu should appear with "删除连线"
    await page.waitForSelector('text=删除连线', { timeout: 5000 })
    await page.click('text=删除连线')

    // Edge should be removed from the canvas
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
  })

  test('8.2 连线模式下取消', async ({ page }) => {
    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '节点X')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Select the node and enter edge mode
    const node = page.locator('.react-flow__node').filter({ hasText: '节点X' })
    await node.click()
    await page.click('text=🔗 连线')

    // Press Escape to cancel edge mode
    await page.keyboard.press('Escape')

    // Edge mode button should no longer be active (colored orange)
    const edgeBtn = page.locator('button:has-text("🔗 连线")')
    await expect(edgeBtn).not.toHaveCSS('color', 'rgb(230, 126, 34)')
  })

})
