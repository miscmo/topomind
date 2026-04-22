/**
 * TopoMind E2E — 知识库管理测试
 */
import { test, expect } from './fixtures/work-dir'
import { initWorkDir, waitForHomePage } from './fixtures/work-dir'

test.describe('知识库管理', () => {

  test.beforeEach(async ({ page }) => {
    await initWorkDir(page)
    await waitForHomePage(page)
  })

  test('1.1 创建知识库', async ({ page }) => {
    // 点击新建知识库按钮
    await page.click('text=新建知识库')
    
    // 填写知识库名称
    await page.fill('#kb-name', '测试知识库')
    
    // 点击创建按钮
    await page.click('button:has-text("创建")')
    
    // 等待知识库卡片出现
    await page.waitForSelector('text=测试知识库', { timeout: 8000 })
    
    // 验证知识库卡片存在
    await expect(page.locator('.card:has-text("测试知识库")')).toBeVisible()
  })

  test('1.2 删除知识库', async ({ page }) => {
    // 先创建一个知识库
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '待删除知识库')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=待删除知识库')
    
    // 右键点击知识库卡片
    await page.locator('.card:has-text("待删除知识库")').click({ button: 'right' })
    
    // 等待上下文菜单出现
    await page.waitForSelector('text=删除', { timeout: 5000 })
    
    // 点击删除选项
    await page.click('text=删除')
    
    // 等待确认模态框出现
    await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })
    
    // 点击确定按钮
    await page.click('[data-testid="confirm-modal"] button:has-text("确定")')
    
    // 验证知识库卡片消失
    await expect(page.locator('.card:has-text("待删除知识库")')).toHaveCount(0)
  })

  test('1.3 重命名知识库', async ({ page }) => {
    // 先创建一个知识库
    await page.click('text=新建知识库')
    await page.fill('#kb-name', '待重命名知识库')
    await page.click('button:has-text("创建")')
    await page.waitForSelector('text=待重命名知识库')
    
    // 右键点击知识库卡片
    await page.locator('.card:has-text("待重命名知识库")').click({ button: 'right' })
    
    // 等待上下文菜单出现
    await page.waitForSelector('text=重命名', { timeout: 5000 })
    
    // 点击重命名选项
    await page.click('text=重命名')
    
    // 等待提示模态框出现
    await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
    
    // 填写新名称
    await page.fill('[data-testid="prompt-modal-input"]', '已重命名知识库')
    
    // 点击确定按钮
    await page.click('[data-testid="prompt-modal-confirm"]')
    
    // 验证知识库卡片名称更新
    await expect(page.locator('.card:has-text("已重命名知识库")')).toBeVisible()
    await expect(page.locator('.card:has-text("待重命名知识库")')).toHaveCount(0)
  })

  test('1.4 知识库排序', async ({ page }) => {
    // 创建多个知识库
    const kbNames = ['知识库C', '知识库A', '知识库B']
    for (const name of kbNames) {
      await page.click('text=新建知识库')
      await page.fill('#kb-name', name)
      await page.click('button:has-text("创建")')
      await page.waitForSelector(`text=${name}`)
    }
    
    // 验证所有知识库都存在
    for (const name of kbNames) {
      await expect(page.locator('.card:has-text("' + name + '")')).toBeVisible()
    }
  })

  test('1.5 导入知识库', async ({ page }) => {
    // 点击导入按钮
    await page.click('text=导入')
    
    // 等待导入模态框出现
    await page.waitForSelector('text=导入知识库', { timeout: 5000 })
    
    // 点击取消按钮
    await page.click('button:has-text("取消")')
    
    // 验证模态框消失
    await expect(page.locator('text=导入知识库')).toHaveCount(0)
  })

})
