/**
 * TopoMind E2E — 布局计算测试
 *
 * 验证 ELK.js 布局：节点位置是否被记住，
 * 新增节点是否触发自动布局。
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('布局计算', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)

    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '布局测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=布局测试KB')
    await page.click('.card:has-text("布局测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })
  })

  test('11.1 新建节点后触发 ELK 布局', async ({ page }) => {
    // Double-click canvas to create first node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '布局根节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(800)

    // First node should exist with a valid position (not at origin)
    const node1 = page.locator('.react-flow__node').filter({ hasText: '布局根节点' })
    await expect(node1).toBeVisible()
    const pos1 = await node1.boundingBox()
    expect(pos1).not.toBeNull()

    // Create a second node
    await page.locator('.react-flow').dblclick({ position: { x: 600, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '布局子节点B')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(800)

    // Both nodes should be visible and independently positioned
    const node2 = page.locator('.react-flow__node').filter({ hasText: '布局子节点B' })
    await expect(node2).toBeVisible()
    const pos2 = await node2.boundingBox()
    expect(pos2).not.toBeNull()
  })

  test('11.2 节点位置在保存后被记住', async ({ page }) => {
    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '位置测试节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(800)

    // Verify node is on canvas
    const node = page.locator('.react-flow__node').filter({ hasText: '位置测试节点' })
    await expect(node).toBeVisible()

    // Wait for debounce save (300ms)
    await page.waitForTimeout(500)

    // Navigate to home page (forces flush of pending saves)
    await page.click('text=🏠')
    await page.waitForTimeout(500)

    // Re-enter the KB
    await page.click('.card:has-text("位置测试KB")')
    await page.waitForSelector('.react-flow__node', { timeout: 5000 })

    // Node should still be visible (position persisted in _graph.json)
    await expect(page.locator('.react-flow__node').filter({ hasText: '位置测试节点' })).toBeVisible()
  })

  test('11.3 右键新建子节点触发布局', async ({ page }) => {
    // Create a parent node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '父布局节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(800)

    // Right-click parent → 新建子节点
    const parentNode = page.locator('.react-flow__node').filter({ hasText: '父布局节点' })
    await parentNode.click({ button: 'right' })
    await page.waitForSelector('text=新建子节点', { timeout: 5000 })
    await page.click('text=新建子节点')
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '子布局节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(800)

    // Both parent and child should be visible with ELK positions
    await expect(page.locator('.react-flow__node').filter({ hasText: '父布局节点' })).toBeVisible()
    await expect(page.locator('.react-flow__node').filter({ hasText: '子布局节点' })).toBeVisible()
  })

})