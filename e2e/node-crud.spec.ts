/**
 * TopoMind E2E — 节点 CRUD 测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('节点 CRUD 操作', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)

    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '节点CRUD测试')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=节点CRUD测试')
    await page.click('[class*="card"]:has-text("节点CRUD测试")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })
  })

  test('7.1 双击画布新建节点', async ({ page }) => {
    const canvas = page.locator('.react-flow')

    // Double-click on canvas
    await canvas.dblclick({ position: { x: 400, y: 200 } })

    // Prompt modal should appear
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })

    // Enter node name
    await page.fill('[data-testid="prompt-modal-input"]', '新节点测试')
    await page.evaluate(() => { (document.querySelector('[data-testid="prompt-modal-confirm"]') as HTMLElement)?.click() })

    // Modal should close
    await expect(page.locator('[data-testid="prompt-modal"]')).toHaveCount(0)

    // Wait for node to appear on canvas
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Node should appear on the canvas
    await expect(page.locator('.react-flow')).toContainText('新节点测试')
  })

  test('7.2 右键菜单新建子节点', async ({ page }) => {
    // First create a parent node
    await page.locator('.react-flow').dblclick({ position: { x: 400, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]')
    await page.fill('[data-testid="prompt-modal-input"]', '父节点')
    await page.evaluate(() => { (document.querySelector('[data-testid="prompt-modal-confirm"]') as HTMLElement)?.click() })

    // Wait for ELK layout to complete
    await page.waitForTimeout(1500)

    // Wait for parent node to appear
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Fit view to ensure node is in viewport (React Flow uses CSS transforms, not native scroll)
    await page.evaluate(() => {
      const rf = (window as any).__reactFlow
      rf?.fitView?.({ padding: 0.3, duration: 300 })
    })
    await page.waitForTimeout(400)

    // Right-click using locator (handles viewport transform internally)
    await page.locator('.react-flow__node').filter({ hasText: '父节点' }).click({ button: 'right' })

    // Context menu should appear
    await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })

    // Click "新建子节点" option
    await page.locator('[data-testid="context-menu-新建子节点"]').click()

    // Prompt modal should appear
    await page.waitForSelector('[data-testid="prompt-modal"]')
    await page.fill('[data-testid="prompt-modal-input"]', '子节点A')
    await page.locator('[data-testid="prompt-modal-confirm"]').click()

    // Wait for child node to appear
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Both nodes should be visible
    await expect(page.locator('.react-flow')).toContainText('父节点')
    await expect(page.locator('.react-flow')).toContainText('子节点A')
  })

  test('7.3 重命名节点', async ({ page }) => {
    // Create a node first
    await page.locator('.react-flow').dblclick({ position: { x: 400, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]')
    await page.fill('[data-testid="prompt-modal-input"]', '待重命名节点')
    await page.evaluate(() => { (document.querySelector('[data-testid="prompt-modal-confirm"]') as HTMLElement)?.click() })

    // Wait for node to appear
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Right-click the node — fitView first to ensure node is in viewport (React Flow uses CSS transforms, not native scroll)
    await page.evaluate(() => {
      const rf = (window as any).__reactFlow
      rf?.fitView?.({ padding: 0.3, duration: 300 })
    })
    await page.waitForTimeout(400)
    await page.locator('.react-flow__node').filter({ hasText: '待重命名节点' }).click({ button: 'right' })

    // Context menu should appear
    await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })

    // Click "重命名"
    await page.locator('[data-testid="context-menu-重命名"]').click()

    // Prompt modal should appear with current name
    await page.waitForSelector('[data-testid="prompt-modal"]')
    await page.fill('[data-testid="prompt-modal-input"]', '新名称节点')
    await page.locator('[data-testid="prompt-modal-confirm"]').click()

    // Node should show new name
    await expect(page.locator('.react-flow')).toContainText('新名称节点')
  })

  test('7.4 删除节点', async ({ page }) => {
    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 400, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]')
    await page.fill('[data-testid="prompt-modal-input"]', '待删除节点')
    await page.locator('[data-testid="prompt-modal-confirm"]').click()

    // Wait for node to appear
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Verify node exists
    await expect(page.locator('.react-flow')).toContainText('待删除节点')

    // Right-click the node — fitView first to ensure node is in viewport (React Flow uses CSS transforms, not native scroll)
    await page.evaluate(() => {
      const rf = (window as any).__reactFlow
      rf?.fitView?.({ padding: 0.3, duration: 300 })
    })
    await page.waitForTimeout(400)
    await page.locator('.react-flow__node').filter({ hasText: '待删除节点' }).click({ button: 'right' })

    // Context menu should appear
    await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })

    // Click "删除节点"
    await page.locator('[data-testid="context-menu-删除节点"]').click()

    // Confirm modal — handleDelete requires typing the EXACT node name
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal-input"]', '待删除节点')
    await page.locator('[data-testid="prompt-modal-confirm"]').click()

    // Node should be removed
    await expect(page.locator('.react-flow')).not.toContainText('待删除节点')
  })

  test('7.5 键盘 Delete 键删除选中节点', async ({ page }) => {
    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 400, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]')
    await page.fill('[data-testid="prompt-modal-input"]', 'Delete测试节点')
    await page.locator('[data-testid="prompt-modal-confirm"]').click()

    // Wait for node to appear
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Click the node to select it — fitView first so node is in viewport
    await page.evaluate(() => {
      const rf = (window as any).__reactFlow
      rf?.fitView?.({ padding: 0.3, duration: 300 })
    })
    await page.waitForTimeout(400)
    await page.locator('.react-flow__node').filter({ hasText: 'Delete测试节点' }).click()

    // Press Delete key — deleteSelectedNode requires typing the EXACT node name
    await page.keyboard.press('Delete')

    // Confirm modal — handleDelete requires typing the EXACT node name
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal-input"]', 'Delete测试节点')
    await page.locator('[data-testid="prompt-modal-confirm"]').click()

    // Node should be removed
    await expect(page.locator('.react-flow')).not.toContainText('Delete测试节点')
  })

})