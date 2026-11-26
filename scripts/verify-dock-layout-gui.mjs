/**
 * P4-L 三边栏布局真机冒烟（只针对本轮改动，不属于 npm run verify 全量门禁）。
 *
 * 独立临时工作区 / 独立 Electron profile / 独立 CDP 端口（默认 9242，
 * 可用 TOPOMIND_DOCK_LAYOUT_CDP_PORT 覆盖），绝不复用 9222。
 *
 * 覆盖：四个左栏页删掉冗余顶部块后第一行的形态、节点树功能按钮确实下移、
 * 折叠按钮在「新标题栏」最右边且能真正折叠 / 再次展开、240 窄栏无横向溢出、
 * 右栏折叠按钮位于全屏按钮上方且不破坏 pin 顺序、点击后右栏真的收起。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_DOCK_LAYOUT_CDP_PORT || 9242)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-dock-layout-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '布局冒烟库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')

const results = []
const pageErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-dock-layout-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    children: {
      'plain-a': { name: '普通节点 A', kind: 'knowledge', x: 80, y: 80 },
      'plain-b': { name: '普通节点 B', kind: 'knowledge', x: 80, y: 260 },
    },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')
}

async function cdpReachable() {
  try {
    const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch {
    return false
  }
}

async function launchApp() {
  const electronRoot = path.join(process.cwd(), 'node_modules', 'electron')
  const exe = process.platform === 'darwin'
    ? (() => {
      const pathTxt = path.join(electronRoot, 'path.txt')
      const rel = fs.existsSync(pathTxt)
        ? fs.readFileSync(pathTxt, 'utf8').trim()
        : 'Electron.app/Contents/MacOS/Electron'
      return path.join(electronRoot, 'dist', rel)
    })()
    : path.join(electronRoot, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  if (!fs.existsSync(exe)) throw new Error('找不到 electron 可执行文件: ' + exe)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const proc = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'], {
    cwd: process.cwd(), env, stdio: 'ignore', detached: false,
  })
  for (let i = 0; i < 60; i += 1) {
    if (await cdpReachable()) return proc
    await sleep(500)
  }
  proc.kill()
  throw new Error('Electron 调试端口未就绪: ' + CDP_URL)
}

async function waitFor(page, fn, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return true
    await sleep(200)
  }
  return false
}

async function findRendererPage(browser) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const pages = await browser.pages().catch(() => [])
    const found = pages.find((p) => p.url().includes('index.html'))
    if (found) return found
    await sleep(300)
  }
  throw new Error('找不到 renderer 页面')
}

async function openKnowledgeBase(page) {
  return page.evaluate((name) => {
    const els = [...document.querySelectorAll('*')].filter((e) =>
      e.children.length === 0 && (e.textContent || '').includes(name))
    if (!els.length) return false
    els[0].parentElement?.click()
    return true
  }, KB_NAME)
}

async function ensureCanvas(page) {
  if (await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 4000)) return true
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => document.querySelector('[data-tm-nav-item="home"]')?.click())
    await sleep(450)
    await openKnowledgeBase(page)
    await sleep(900)
    if (await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 4000)) return true
  }
  return false
}

async function enterWorkspace(page, width = 280) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate(({ dir, w }) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    localStorage.setItem('topomind_left_dock_width_v1', String(w))
  }, { dir: WORKDIR, w: width })
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  return ensureCanvas(page)
}

async function openDockTab(page, id) {
  if (!await ensureCanvas(page)) return false
  await page.evaluate((tab) => document.querySelector(`[data-tm-left-dock-tab="${tab}"]`)?.click(), id)
  return waitFor(page, () => !!document.querySelector('[data-tm-node-tree-panel]'), 8000)
}

/**
 * 读取左栏「新标题栏」的形态。
 * 四页 DOM 深度不同：节点结构页的工具行是外壳直接子元素，另外三页先包一层
 * flex 内容容器（画布设置页还多一层滚动区 + section）。按高度向下找到第一条
 * ≤48px 的行，避免把整个内容容器误当成标题行。
 */
async function firstRowMetrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-tm-node-tree-panel]')
    if (!root) return null
    let row = root.firstElementChild
    if (!row) return null
    for (let i = 0; i < 5 && row.getBoundingClientRect().height > 48 && row.firstElementChild; i += 1) {
      row = row.firstElementChild
    }
    const buttons = [...row.querySelectorAll('button')]
    const rects = buttons.map((b) => ({ label: b.getAttribute('aria-label') || b.getAttribute('title') || '', right: Math.round(b.getBoundingClientRect().right) }))
    const collapse = row.querySelector('[data-tm-left-dock-collapse]')
    const maxRight = Math.max(...rects.map((r) => r.right), -1)
    // 旧的 h-10 标题行是外壳唯一的直接 h-10 子元素；三条副标题各自唯一，
    // 不用「个节点」这种在说明文字里也会出现的宽泛词。
    const redundant = ['入口已预留', '当前工作区', '当前画布']
      .filter((needle) => (root.innerText || '').includes(needle))
    const hasOldHeader = [...root.children].some((el) => (el.className?.toString() || '').includes('h-10'))
    if (hasOldHeader) redundant.push('h-10 外壳标题行')
    return {
      rowHeight: Math.round(row.getBoundingClientRect().height),
      rowText: (row.innerText || '').slice(0, 100).replace(/\n/g, ' | '),
      redundant,
      collapseCount: root.querySelectorAll('[data-tm-left-dock-collapse]').length,
      collapseRight: collapse ? Math.round(collapse.getBoundingClientRect().right) : -1,
      maxRight,
      buttons: rects.map((r) => r.label),
      hasSearch: !!row.querySelector('[data-tm-node-tree-search]'),
      hasExpandAll: !!row.querySelector('[data-tm-node-tree-expand-all]'),
      hasCollapseAll: !!row.querySelector('[data-tm-node-tree-collapse-all]'),
      overflow: root.scrollWidth - root.clientWidth,
    }
  })
}

async function main() {
  setupWorkDir()
  const spawned = await launchApp()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null })
  const page = await findRendererPage(browser)
  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    check('进入工作空间并渲染节点', await enterWorkspace(page))

    for (const id of ['agent', 'kbList', 'tree', 'canvasSettings']) {
      const opened = await openDockTab(page, id)
      const m = opened ? await firstRowMetrics(page) : null
      check(`打开左栏「${id}」页`, opened, JSON.stringify(m?.rowText))
      check(`「${id}」页顶部冗余块已删除`, !!m && m.redundant.length === 0,
        JSON.stringify(m?.redundant))
      check(`「${id}」页新标题栏最右边是折叠按钮且只有一个`,
        !!m && m.collapseCount === 1 && m.collapseRight >= m.maxRight - 2
        && m.collapseRight > 0 && m.rowHeight <= 48,
        JSON.stringify({ rowHeight: m?.rowHeight, collapseCount: m?.collapseCount, collapseRight: m?.collapseRight, maxRight: m?.maxRight, buttons: m?.buttons }))
      check(`「${id}」页无横向溢出`, !!m && m.overflow <= 2, JSON.stringify(m?.overflow))
      if (id === 'tree') {
        check('节点结构页展开/收起按钮已下移到搜索行',
          !!m && m.hasSearch && m.hasExpandAll && m.hasCollapseAll,
          JSON.stringify({ hasSearch: m?.hasSearch, hasExpandAll: m?.hasExpandAll, hasCollapseAll: m?.hasCollapseAll }))
      }
    }

    // 左栏折叠按钮真的写 collapsed：面板整体消失，再点竖 tab 能回来。
    await openDockTab(page, 'agent')
    await page.evaluate(() => document.querySelector('[data-tm-left-dock-collapse]')?.click())
    const collapsed = await waitFor(page, () => !document.querySelector('[data-tm-node-tree-panel]'), 4000)
    check('点击左栏折叠按钮后面板消失', collapsed)
    const reopened = await openDockTab(page, 'agent')
    check('再点 NavRail 竖 tab 可重新展开左栏', reopened)

    // 240 窄栏：四页第一行都不能把面板撑出横向滚动。
    check('240 窄栏重载成功', await enterWorkspace(page, 240))
    for (const id of ['agent', 'kbList', 'tree', 'canvasSettings']) {
      const opened = await openDockTab(page, id)
      const m = opened ? await firstRowMetrics(page) : null
      check(`240 窄栏「${id}」页无横向溢出且折叠按钮仍可见`,
        !!m && m.overflow <= 2 && m.collapseCount === 1,
        JSON.stringify({ overflow: m?.overflow, collapseCount: m?.collapseCount, buttons: m?.buttons }))
    }

    // 右栏：选中节点 → 展开 → 竖 rail 顺序 → 点折叠按钮真的收起。
    await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node[data-id="plain-a"]')
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
    })
    await sleep(600)
    const rightVisible = () => page.evaluate(() => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display !== 'none'
    })
    if (!await rightVisible()) {
      await page.keyboard.down('Control')
      await page.keyboard.press('Tab')
      await page.keyboard.up('Control')
    }
    check('右侧详情面板可展开', await waitFor(page, () => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display !== 'none'
    }, 8000))

    const rail = await page.evaluate(() => {
      const fullscreen = document.querySelector('button[aria-label="最大化面板"], button[aria-label="还原面板"]')
      const labels = [...(fullscreen?.parentElement?.querySelectorAll('button') ?? [])]
        .map((b) => b.getAttribute('aria-label') || '')
      return {
        labels,
        collapseIndex: labels.indexOf('折叠右侧面板'),
        fullscreenIndex: labels.findIndex((l) => l === '最大化面板' || l === '还原面板'),
        pinIndex: labels.findIndex((l) => l === '固定右侧面板' || l === '取消固定右侧面板'),
        collapseCount: document.querySelectorAll('[data-tm-right-panel-collapse]').length,
      }
    })
    check('右栏折叠按钮在全屏按钮正上方，pin 仍在全屏正下方且唯一',
      rail.collapseIndex === 0 && rail.fullscreenIndex === 1 && rail.pinIndex === 2
      && rail.collapseCount === 1, JSON.stringify(rail))

    await page.evaluate(() => document.querySelector('[data-tm-right-panel-collapse]')?.click())
    const rightCollapsed = await waitFor(page, () => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display === 'none'
    }, 6000)
    check('点击右栏折叠按钮后面板收起', rightCollapsed)

    check('全流程零未捕获渲染异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)))
  } finally {
    browser.disconnect()
    spawned.kill()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.name).join(' | '))
    process.exitCode = 1
  } else {
    console.log('DOCK_LAYOUT_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
