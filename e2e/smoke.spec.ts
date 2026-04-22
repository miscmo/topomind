/**
 * TopoMind E2E 测试 — 共享测试设置和 Page Object helpers
 */
import type { Page } from '@playwright/test'
import { initWorkDir, expect } from './fixtures/work-dir'

// Re-export for use in other spec files
export { initWorkDir }

// 等待页面加载的辅助函数
export async function waitForGraphPage(page: Page) {
  await page.waitForSelector('#graph-page', { timeout: 10000 })
}

// 等待 GraphPage 内的 ReactFlow canvas 加载
export async function waitForCanvas(page: Page) {
  await page.waitForSelector('.react-flow', { timeout: 10000 })
}

// 等待节点出现
export async function waitForNode(page: Page, label: string, timeout = 5000) {
  await page.waitForSelector(`[data-testid="rf-node"] >> text=${label}`, { timeout })
}

// 等待 PromptModal 出现
export async function waitForPromptModal(page: Page) {
  await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
}

// 等待 ConfirmModal 出现
export async function waitForConfirmModal(page: Page) {
  await page.waitForSelector('[data-testid="confirm-modal"]', { timeout: 5000 })
}

// 创建测试用知识库（在 HomePage 中点击新建按钮 → 填名 → 创建）
export async function createTestKB(page: Page, name: string) {
  // 点击新建按钮
  await page.click('text=新建知识库')
  // 填写名称
  await page.fill('#kb-name', name)
  // 提交
  await page.click('button:has-text("创建")')
  // 等待 KB 出现
  await page.waitForSelector(`text=${name}`)
}

// 打开一个已存在的知识库
export async function openKB(page: Page, name: string) {
  await page.click(`.card:has-text("${name}")`)
  await waitForGraphPage(page)
}