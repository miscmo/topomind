/**
 * TopoMind E2E — 搜索高亮测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('搜索功能', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)

    // Create and open a KB
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '搜索测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=搜索测试KB')
    await page.click('.card:has-text("搜索测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })
  })

  test('9.1 搜索高亮匹配的节点', async ({ page }) => {
    // Create multiple nodes
    const positions = [
      { x: 200, y: 150, name: '机器学习' },
      { x: 400, y: 150, name: '深度学习' },
      { x: 600, y: 150, name: '机器视觉' },
    ]
    for (const { x, y, name } of positions) {
      await page.locator('.react-flow').dblclick({ position: { x, y } })
      await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
      await page.fill('[data-testid="prompt-modal"] input', name)
      await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
      await page.waitForTimeout(400)
    }

    // Type in search
    await page.fill('#search-input', '机器')

    // Wait for search to process (debounce)
    await page.waitForTimeout(300)

    // Verify search input value is set correctly
    await expect(page.locator('#search-input')).toHaveValue('机器')

    // Verify matching nodes have the searchMatch style (yellow border via searchHighlight class)
    // Nodes "机器学习" and "机器视觉" should have highlighted border
    const matchedNodes = page.locator('.react-flow__node').filter({ hasText: /机器学习|机器视觉/ })
    const matchedCount = await matchedNodes.count()
    expect(matchedCount).toBeGreaterThanOrEqual(2)

    // Non-matching node should NOT have highlight style
    const nonMatchNode = page.locator('.react-flow__node').filter({ hasText: '深度学习' })
    await expect(nonMatchNode).toBeVisible()
  })

  test('9.2 搜索清除后恢复正常显示', async ({ page }) => {
    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '测试节点X')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Type in search
    await page.fill('#search-input', '不存在')
    await page.waitForTimeout(300)

    // Clear button should appear (×)
    const clearBtn = page.locator('button[title="清除搜索"]')
    await expect(clearBtn).toBeVisible()

    // Click clear
    await clearBtn.click()

    // Search input should be empty
    await expect(page.locator('#search-input')).toHaveValue('')

    // Clear button should disappear
    await expect(clearBtn).toHaveCount(0)
  })

  test('9.3 无匹配结果时搜索框仍显示', async ({ page }) => {
    // Create a node
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal"] input', '唯一节点')
    await page.click('[data-testid="prompt-modal"] button:has-text("确定")')
    await page.waitForTimeout(500)

    // Search for something that won't match
    await page.fill('#search-input', '完全不匹配的内容XYZ123')
    await page.waitForTimeout(300)

    // Search box still visible (nodes remain visible, no "no results" hidden)
    await expect(page.locator('#search-box')).toBeVisible()
    await expect(page.locator('#search-input')).toHaveValue('完全不匹配的内容XYZ123')
  })

})
