/**
 * TopoMind E2E — 详细面板测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('详细面板', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)

    // 创建并打开一个知识库
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '详细面板测试KB')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=详细面板测试KB')
    await page.click('.card:has-text("详细面板测试KB")')
    await page.waitForSelector('#graph-page', { timeout: 10000 })
    await page.waitForSelector('.react-flow', { timeout: 5000 })
  })

  test('2.1 点击节点显示详细面板', async ({ page }) => {
    // 创建一个节点
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal-input"]', '测试节点')
    await page.click('[data-testid="prompt-modal-confirm"]')

    // 点击节点
    await page.locator('.react-flow__node').filter({ hasText: '测试节点' }).click()

    // 等待详细面板出现
    await page.waitForSelector('#detail-panel', { timeout: 5000 })

    // 验证详细面板可见
    await expect(page.locator('#detail-panel')).toBeVisible()
  })

  test('2.2 编辑节点详细信息', async ({ page }) => {
    // 创建一个节点
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal-input"]', '编辑测试节点')
    await page.click('[data-testid="prompt-modal-confirm"]')

    // 点击节点打开详细面板
    await page.locator('.react-flow__node').filter({ hasText: '编辑测试节点' }).click()
    await page.waitForSelector('#detail-panel', { timeout: 5000 })

    // 编辑节点描述
    await page.fill('#node-description', '这是一个测试描述')

    // 等待状态更新（使用确定性等待，而非固定延时）
    await expect(page.locator('#node-description')).toHaveValue('这是一个测试描述')
  })

  test('2.3 关闭详细面板', async ({ page }) => {
    // 创建一个节点
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal-input"]', '关闭测试节点')
    await page.click('[data-testid="prompt-modal-confirm"]')

    // 点击节点打开详细面板
    await page.locator('.react-flow__node').filter({ hasText: '关闭测试节点' }).click()
    await page.waitForSelector('#detail-panel', { timeout: 5000 })

    // 点击空白画布区域取消选择节点，从而关闭面板
    await page.locator('.react-flow').click({ position: { x: 50, y: 50 } })

    // 验证详细面板消失
    await expect(page.locator('#detail-panel')).toHaveCount(0)
  })

  test('2.4 详细面板显示节点属性', async ({ page }) => {
    // 创建一个节点
    await page.locator('.react-flow').dblclick({ position: { x: 300, y: 200 } })
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    await page.fill('[data-testid="prompt-modal-input"]', '属性测试节点')
    await page.click('[data-testid="prompt-modal-confirm"]')

    // 点击节点打开详细面板
    await page.locator('.react-flow__node').filter({ hasText: '属性测试节点' }).click()
    await page.waitForSelector('#detail-panel', { timeout: 5000 })

    // 验证面板显示节点名称
    await expect(page.locator('#detail-panel')).toContainText('属性测试节点')
  })

})
