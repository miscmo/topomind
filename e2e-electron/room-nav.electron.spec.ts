import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

const electronMain = path.join(process.cwd(), 'dist-electron', 'main.js')

function createIsolatedWorkdir(testSlug: string) {
  const dir = path.join(os.tmpdir(), `topomind-e2e-${testSlug}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function launchApp(workdir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [electronMain],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TOPOMIND_E2E_WORKDIR: workdir,
    },
  })

  const page = await app.firstWindow()
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[electron-page:console]', msg.type(), msg.text())
  })
  page.on('pageerror', (error) => {
    // eslint-disable-next-line no-console
    console.log('[electron-page:error]', error.message)
  })

  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function ensureHomePage(page: Page) {
  if (await page.locator('#home-modal').isVisible().catch(() => false)) {
    return
  }

  if (await page.locator('#setup-page').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '打开已有工作目录' }).click()
  }

  await page.waitForSelector('#home-modal', { timeout: 15000 })
}

async function createAndOpenKB(page: Page, kbName: string) {
  await ensureHomePage(page)
  await page.locator('#home-modal').getByText('新建知识库', { exact: true }).first().click()
  await page.waitForSelector('#kb-name', { timeout: 5000 })
  await page.fill('#kb-name', kbName)
  await page.getByRole('button', { name: '创建' }).click()
  const kbCard = page.locator('#home-modal').getByText(kbName, { exact: true }).first()
  await kbCard.waitFor({ state: 'visible', timeout: 10000 })
  await kbCard.click()
  await page.waitForSelector('#graph-page', { timeout: 15000 })
  await page.waitForSelector('.react-flow', { timeout: 15000 })
  await expect(page.locator('#breadcrumb')).toContainText(kbName)
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const rf = (window as unknown as { __reactFlow?: { getNodes: () => Array<unknown> } }).__reactFlow
      return typeof rf?.getNodes === 'function'
    })
  }, { timeout: 10000 }).toBeTruthy()
}

async function waitForGraphNodeCount(page: Page, minCount: number) {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const rf = (window as unknown as { __reactFlow?: { getNodes: () => Array<unknown> } }).__reactFlow
      return rf?.getNodes?.().length ?? 0
    })
  }, { timeout: 10000 }).toBeGreaterThanOrEqual(minCount)
}

async function findNodeIdByLabel(page: Page, label: string): Promise<string> {
  const nodeId = await page.evaluate((targetLabel: string) => {
    const rf = (window as unknown as { __reactFlow?: { getNodes: () => Array<{ id: string; data?: { label?: string } }> } }).__reactFlow
    const nodes = rf?.getNodes?.() ?? []
    const found = nodes.find((n) => n?.data?.label === targetLabel)
    return found?.id ?? ''
  }, label)
  if (!nodeId) throw new Error(`Node not found by label: ${label}`)
  return nodeId
}

function nodeByLabel(page: Page, label: string) {
  return page.locator('.react-flow__node').filter({ hasText: label }).first()
}

async function createRootNode(page: Page, nodeName: string) {
  const pane = page.locator('.react-flow__pane')
  await expect(pane).toBeVisible()

  const beforeCount = await page.evaluate(() => {
    const rf = (window as unknown as { __reactFlow?: { getNodes: () => Array<unknown> } }).__reactFlow
    return rf?.getNodes?.().length ?? 0
  })

  await pane.click({ position: { x: 300, y: 220 } })
  await page.waitForTimeout(80)
  await pane.click({ position: { x: 300, y: 220 } })
  await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
  await page.fill('[data-testid="prompt-modal"] input', nodeName)
  await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

  const modalStillVisible = await page.locator('[data-testid="prompt-modal"]').isVisible().catch(() => false)
  const bodyText = await page.locator('body').innerText().catch(() => '')
  // eslint-disable-next-line no-console
  console.log('[electron-e2e:after-confirm]', JSON.stringify({ nodeName, modalStillVisible, bodyText: bodyText.slice(0, 600) }))

  await waitForGraphNodeCount(page, beforeCount + 1)
  await expect(nodeByLabel(page, nodeName)).toBeVisible()
}

async function createChildNodeFromContextMenu(page: Page, parentName: string, childName: string) {
  const parentNode = nodeByLabel(page, parentName)
  await expect(parentNode).toBeVisible()

  const beforeCount = await page.evaluate(() => {
    const rf = (window as unknown as { __reactFlow?: { getNodes: () => Array<unknown> } }).__reactFlow
    return rf?.getNodes?.().length ?? 0
  })

  // Fit view before right-click to ensure node is in viewport (ELK layout may place nodes off-screen)
  await page.evaluate(() => {
    const rf = (window as unknown as { __reactFlow?: { fitView?: (opts?: { padding?: number; duration?: number }) => void } }).__reactFlow
    rf?.fitView?.({ padding: 0.3, duration: 300 })
  })
  await page.waitForTimeout(400)

  await parentNode.click({ button: 'right', force: true })
  await page.waitForSelector('[data-testid="context-menu"]', { timeout: 5000 })
  await page.click('[data-testid="context-menu-新建子节点"]')
  await page.waitForSelector('[data-testid="prompt-modal"]', { timeout: 5000 })
  await page.fill('[data-testid="prompt-modal"] input', childName)
  await page.click('[data-testid="prompt-modal"] button:has-text("确定")')

  await waitForGraphNodeCount(page, beforeCount + 1)
  await expect(nodeByLabel(page, childName)).toBeVisible()
}

async function enterRoom(page: Page, nodeName: string) {
  const node = nodeByLabel(page, nodeName)
  await expect(node).toBeVisible()
  // Fit view before dblclick to ensure node is in viewport (ELK layout may place nodes off-screen)
  await page.evaluate(() => {
    const rf = (window as unknown as { __reactFlow?: { fitView?: (opts?: { padding?: number; duration?: number }) => void } }).__reactFlow
    rf?.fitView?.({ padding: 0.3, duration: 300 })
  })
  await page.waitForTimeout(400)
  // Use page.mouse.dblclick() with bounding box — node.dblclick({ force: true }) bypasses React Flow's onNodeDoubleClick
  const box = await node.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForTimeout(800)
}

test.describe('房间导航 Electron', () => {
  test('知识库根级显示面包屑', async () => {
    const workdir = createIsolatedWorkdir('breadcrumb-root')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '房间导航测试KB-根级')
      await createRootNode(page, '根节点')
      await expect(page.locator('#breadcrumb')).toBeVisible()
      await expect(page.locator('#breadcrumb')).toContainText('房间导航测试KB-根级')
    } finally {
      await app.close()
    }
  })

  test('钻入子房间后显示知识库根与当前房间', async () => {
    const workdir = createIsolatedWorkdir('breadcrumb-drill-in')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '房间导航测试KB-钻入')
      await createRootNode(page, '父节点')
      await createChildNodeFromContextMenu(page, '父节点', '子节点A')
      await enterRoom(page, '父节点')

      const breadcrumb = page.locator('#breadcrumb')
      await expect(breadcrumb).toBeVisible()
      await expect(breadcrumb).toContainText('房间导航测试KB-钻入')
      await expect(breadcrumb).toContainText('父节点')
    } finally {
      await app.close()
    }
  })

  test('点击知识库根面包屑直接返回根级', async () => {
    const workdir = createIsolatedWorkdir('breadcrumb-back-root')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '房间导航测试KB-回根')
      await createRootNode(page, '父房间节点')
      await createChildNodeFromContextMenu(page, '父房间节点', '子房间节点')
      await enterRoom(page, '父房间节点')

      const breadcrumb = page.locator('#breadcrumb')
      await expect(breadcrumb).toContainText('房间导航测试KB-回根')
      await expect(breadcrumb).toContainText('父房间节点')

      // Click KB root breadcrumb to navigate back to root
      await page.getByTestId('breadcrumb-root').click()
      await page.waitForTimeout(800)

      await expect(page.locator('#breadcrumb')).toBeVisible()
      await expect(page.locator('#breadcrumb')).toContainText('房间导航测试KB-回根')
      await expect(page.locator('#breadcrumb')).not.toContainText('父房间节点')
    } finally {
      await app.close()
    }
  })

  test('点击中间父级面包屑跳回指定房间', async () => {
    const workdir = createIsolatedWorkdir('breadcrumb-parent-jump')
    const { app, page } = await launchApp(workdir)
    try {
      await createAndOpenKB(page, '房间导航测试KB-父级跳转')
      await createRootNode(page, '父级A')
      await createChildNodeFromContextMenu(page, '父级A', '子级B')
      await enterRoom(page, '父级A')
      await createChildNodeFromContextMenu(page, '子级B', '孙级C')
      await enterRoom(page, '子级B')

      const breadcrumb = page.locator('#breadcrumb')
      await expect(breadcrumb).toContainText('房间导航测试KB-父级跳转')
      await expect(breadcrumb).toContainText('父级A')
      await expect(breadcrumb).toContainText('子级B')

      // Click '父级A' breadcrumb — scope to #breadcrumb to avoid matching close/tab buttons with same name
      await page.locator('#breadcrumb').getByRole('button', { name: '父级A' }).click()
      await page.waitForTimeout(800)

      await expect(page.locator('#breadcrumb')).toContainText('房间导航测试KB-父级跳转')
      await expect(page.locator('#breadcrumb')).toContainText('父级A')
      await expect(page.locator('#breadcrumb')).not.toContainText('子级B')
    } finally {
      await app.close()
    }
  })
})
