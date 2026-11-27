/**
 * 覆盖式「AI 设置窗口」真机 GUI 冒烟（不属于 npm run verify 全量门禁）。
 *
 * 独立临时工作区 / 独立 Electron profile / 独立 CDP 端口（默认 9241，
 * 可用 TOPOMIND_AI_SETTINGS_WINDOW_CDP_PORT 覆盖），绝不复用 9222。
 *
 * 覆盖：窗口从左栏对话页右缘铺到应用右边界、层级高于右栏文档面板且展开文档时
 * 整片盖住、顶部 tab 栏与右上角关闭按钮、两个分区切 tab 不卸载、左栏对话仍可
 * 交互、右栏不会被失焦自动折叠、关闭按钮 / Esc / 齿轮按钮 toggle、全局设置页
 * 只剩入口引导且可一键跳回画布、零未捕获渲染异常。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_AI_SETTINGS_WINDOW_CDP_PORT || 9241)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-ai-settings-window-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = 'AI 设置窗口冒烟库'
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
  if (!ROOT.includes('tm-ai-settings-window-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
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

async function enterWorkspace(page) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    localStorage.setItem('topomind_left_dock_width_v1', '280')
    localStorage.removeItem('topomind_node_tree_panel_v1')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  return ensureCanvas(page)
}

async function openAgentPanel(page) {
  if (!await ensureCanvas(page)) return false
  if (await page.evaluate(() => !!document.querySelector('[data-tm-ai-agent-panel]'))) return true
  await page.evaluate(() => document.querySelector('[data-tm-left-dock-tab="agent"]')?.click())
  return waitFor(page, () => !!document.querySelector('[data-tm-ai-agent-panel]'), 10000)
}

async function main() {
  setupWorkDir()
  const spawned = await launchApp()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null })
  const page = await findRendererPage(browser)
  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    check('进入工作空间并渲染画布节点', await enterWorkspace(page))
    check('打开左栏 AI Agent 对话页', await openAgentPanel(page))

    // ===== A. 打开窗口 + 几何 / 层级契约 =====
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-toggle]')?.click())
    check('齿轮按钮打开覆盖式 AI 设置窗口',
      await waitFor(page, () => !!document.querySelector('[data-tm-ai-settings-window]'), 8000))
    await sleep(350)

    const geo = await page.evaluate(() => {
      const win = document.querySelector('[data-tm-ai-settings-window]')
      const dock = document.querySelector('[data-tm-node-tree-panel]')
      const layout = document.querySelector('#app-layout')
      const rail = document.querySelector('[data-tm-nav-rail-root]')
      const right = document.querySelector('.right-panel-container')
      if (!win || !layout) return null
      const rect = (el) => el ? {
        left: Math.round(el.getBoundingClientRect().left),
        right: Math.round(el.getBoundingClientRect().right),
        top: Math.round(el.getBoundingClientRect().top),
        bottom: Math.round(el.getBoundingClientRect().bottom),
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
      } : null
      return {
        win: rect(win), dock: rect(dock), layout: rect(layout), rail: rect(rail), right: rect(right),
        winZ: Number(getComputedStyle(win).zIndex) || 0,
        rightZ: right ? Number(getComputedStyle(right).zIndex) || 0 : 0,
        boundary: parseFloat(getComputedStyle(layout).getPropertyValue('--tm-workspace-left-boundary')),
        keepRightPanel: win.hasAttribute('data-tm-keep-right-panel'),
        viewportWidth: window.innerWidth,
      }
    })
    check('窗口左边界 = 左栏对话页右缘（--tm-workspace-left-boundary）',
      !!geo && Math.abs(geo.win.left - geo.dock.right) <= 2
      && Math.abs(geo.win.left - (geo.layout.left + geo.boundary)) <= 2,
      JSON.stringify({ winLeft: geo?.win.left, dockRight: geo?.dock.right, boundary: geo?.boundary }))
    check('窗口贴住应用右边界并铺满左栏之外的整个画布页（上下同高）',
      !!geo && Math.abs(geo.win.right - geo.layout.right) <= 2
      && Math.abs(geo.win.top - geo.layout.top) <= 2
      && Math.abs(geo.win.bottom - geo.layout.bottom) <= 2
      && geo.win.width > geo.layout.width * 0.6,
      JSON.stringify({ win: geo?.win, layout: geo?.layout }))
    check('窗口层级高于右栏文档面板，且不与全局导航栏重叠',
      !!geo && geo.winZ > geo.rightZ && geo.winZ >= 40
      && (!geo.rail || geo.win.left >= geo.rail.right - 1) && geo.keepRightPanel,
      JSON.stringify({ winZ: geo?.winZ, rightZ: geo?.rightZ, railRight: geo?.rail?.right }))

    // ===== B. 顶部 tab 栏 / 右上角关闭按钮 =====
    const header = await page.evaluate(() => {
      const win = document.querySelector('[data-tm-ai-settings-window]')
      const head = document.querySelector('[data-tm-ai-settings-header]')
      const tabs = [...document.querySelectorAll('[role="tab"][data-tm-ai-settings-tab]')]
      const close = document.querySelector('[data-tm-ai-settings-close]')
      return {
        headerHeight: Math.round(head?.getBoundingClientRect().height ?? -1),
        tabs: tabs.map((t) => ({ id: t.getAttribute('data-tm-ai-settings-tab'), selected: t.getAttribute('aria-selected') })),
        closeRight: Math.round(close?.getBoundingClientRect().right ?? -1),
        winRight: Math.round(win?.getBoundingClientRect().right ?? -1),
        assistantVisible: !document.querySelector('[data-tm-ai-settings-pane="assistant"]')?.hidden,
        agentsHidden: !!document.querySelector('[data-tm-ai-settings-pane="agents"]')?.hidden,
        hasAiSection: !!document.querySelector('[data-tm-settings-ai]'),
      }
    })
    check('顶部 tab 栏有「AI 助手 / AI 智能体」两项且默认停在 AI 助手',
      header.tabs.length === 2 && header.tabs[0].id === 'assistant' && header.tabs[0].selected === 'true'
      && header.tabs[1].id === 'agents' && header.tabs[1].selected === 'false'
      && header.hasAiSection && header.assistantVisible && header.agentsHidden,
      JSON.stringify(header.tabs))
    check('关闭按钮固定在窗口右上角',
      header.closeRight > 0 && header.winRight - header.closeRight <= 20
      && header.headerHeight >= 36 && header.headerHeight <= 48,
      JSON.stringify({ closeRight: header.closeRight, winRight: header.winRight, height: header.headerHeight }))

    const roundsGroup = await page.evaluate(() => {
      const group = document.querySelector('[data-tm-ai-max-tool-rounds-group]')
      const buttons = [...(group?.querySelectorAll('[data-tm-ai-max-tool-rounds]') ?? [])]
      return {
        exists: !!group,
        values: buttons.map((item) => item.getAttribute('data-tm-ai-max-tool-rounds')),
        active: buttons.find((item) => item.getAttribute('aria-pressed') === 'true')
          ?.getAttribute('data-tm-ai-max-tool-rounds'),
      }
    })
    check('AI 助手页默认 20 轮上限，提供 5/10/20/30/50 档可调',
      roundsGroup.exists && roundsGroup.active === '20'
      && roundsGroup.values.join(',') === '5,10,20,30,50',
      JSON.stringify(roundsGroup))
    await page.evaluate(() => document.querySelector('[data-tm-ai-max-tool-rounds="30"]')?.click())
    check('调整轮次上限立即写入本地偏好', await waitFor(page, () =>
      localStorage.getItem('topomind:ai-max-tool-rounds') === '30'
      && document.querySelector('[data-tm-ai-max-tool-rounds="30"]')?.getAttribute('aria-pressed') === 'true', 6000))
    await page.evaluate(() => document.querySelector('[data-tm-ai-max-tool-rounds="20"]')?.click())

    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-tab="agents"]')?.click())
    const switched = await waitFor(page, () => {
      const a = document.querySelector('[data-tm-ai-settings-pane="assistant"]')
      const b = document.querySelector('[data-tm-ai-settings-pane="agents"]')
      return !!a && !!b && a.hidden && !b.hidden
    }, 6000)
    const bothMounted = await page.evaluate(() =>
      !!document.querySelector('[data-tm-settings-ai]') && !!document.querySelector('[data-tm-settings-ai-agents]'))
    check('切到 AI 智能体 tab，两个分区仍常驻挂载（不丢已填草稿）',
      switched && bothMounted, JSON.stringify({ switched, bothMounted }))

    // ===== C. 左栏对话仍可交互（窗口不覆盖左栏） =====
    const dockInteractive = await page.evaluate(() => {
      const composer = document.querySelector('[data-tm-ai-composer]')
      const win = document.querySelector('[data-tm-ai-settings-window]')
      if (!composer || !win) return null
      const c = composer.getBoundingClientRect()
      const w = win.getBoundingClientRect()
      const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
      return {
        composerRight: Math.round(c.right), windowLeft: Math.round(w.left),
        hitInDock: !!hit?.closest('[data-tm-ai-agent-panel]'),
        hitInWindow: !!hit?.closest('[data-tm-ai-settings-window]'),
      }
    })
    check('左栏对话面板仍完全可见、输入框可命中，未被设置窗口遮挡',
      !!dockInteractive && dockInteractive.composerRight <= dockInteractive.windowLeft + 2
      && dockInteractive.hitInDock && !dockInteractive.hitInWindow,
      JSON.stringify(dockInteractive))

    // ===== D. 文档面板展开时仍被整片盖住，且不会被失焦自动折叠 =====
    await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node[data-id="plain-a"]')
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
    })
    const rightVisible = () => page.evaluate(() => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display !== 'none'
    })
    if (!await rightVisible()) {
      // 与 verify:dock:layout:gui 同口径：选中普通节点不必然带文档，Ctrl+Tab 显式展开右栏。
      await page.keyboard.down('Control')
      await page.keyboard.press('Tab')
      await page.keyboard.up('Control')
    }
    check('右侧文档面板可展开', await waitFor(page, () => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display !== 'none'
    }, 8000))
    await sleep(400)
    const covered = await page.evaluate(() => {
      const win = document.querySelector('[data-tm-ai-settings-window]')
      const right = document.querySelector('.right-panel-container')
      if (!win || !right) return null
      const w = win.getBoundingClientRect()
      const r = right.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        winZ: Number(getComputedStyle(win).zIndex) || 0,
        rightZ: Number(getComputedStyle(right).zIndex) || 0,
        contains: w.left <= r.left + 1 && w.right >= r.right - 1 && w.top <= r.top + 1 && w.bottom >= r.bottom - 1,
        hitInWindow: !!hit?.closest('[data-tm-ai-settings-window]'),
        rightVisible: getComputedStyle(right).display !== 'none',
      }
    })
    check('文档面板展开时窗口仍完整覆盖它且层级更高',
      !!covered && covered.contains && covered.winZ > covered.rightZ && covered.hitInWindow,
      JSON.stringify(covered))

    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-tab="assistant"]')?.click())
    await page.evaluate(() => document.querySelector('#ai-base-url')?.focus())
    await sleep(600)
    const rightStillOpen = await page.evaluate(() => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display !== 'none'
    })
    check('焦点进入设置窗口后，展开的文档面板不会被失焦自动折叠', rightStillOpen)

    // ===== E. 关闭按钮 / Esc / 齿轮 toggle =====
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-close]')?.click())
    check('右上角关闭按钮收起窗口',
      await waitFor(page, () => !document.querySelector('[data-tm-ai-settings-window]'), 6000))
    check('关闭后文档面板仍保持展开（可继续看文档）', await page.evaluate(() => {
      const el = document.querySelector('.right-panel-container')
      return !!el && getComputedStyle(el).display !== 'none'
    }))

    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-toggle]')?.click())
    check('再点齿轮可重新打开', await waitFor(page, () => !!document.querySelector('[data-tm-ai-settings-window]'), 6000))
    await page.keyboard.press('Escape')
    check('Esc 可关闭窗口', await waitFor(page, () => !document.querySelector('[data-tm-ai-settings-window]'), 6000))

    // ===== F. 全局设置页只留入口引导，且可一键跳回画布 =====
    await page.evaluate(() => document.querySelector('[data-tm-nav-item="settings"]')?.click())
    const globalSettings = await waitFor(page, () => !!document.querySelector('[data-tm-settings-ai-entry]'), 8000)
      && await page.evaluate(() => ({
        noAiSections: !document.querySelector('[data-tm-settings-ai]')
          && !document.querySelector('[data-tm-settings-ai-agents]'),
        hasOpenButton: !!document.querySelector('[data-tm-settings-ai-open]'),
        disabled: document.querySelector('[data-tm-settings-ai-open]')?.disabled === true,
      }))
    check('全局设置页不再渲染 AI 助手 / AI 智能体分区，只留可发现性入口',
      !!globalSettings && globalSettings.noAiSections && globalSettings.hasOpenButton && !globalSettings.disabled,
      JSON.stringify(globalSettings))

    await page.evaluate(() => document.querySelector('[data-tm-settings-ai-open]')?.click())
    const jumped = await waitFor(page, () => !!document.querySelector('[data-tm-ai-settings-window]')
      && !!document.querySelector('[data-tm-ai-agent-panel]'), 10000)
    const jumpTab = await page.evaluate(() => ({
      active: document.querySelector('[data-tm-ai-settings-window]')?.getAttribute('data-tm-ai-settings-active-tab'),
      paneVisible: !document.querySelector('[data-tm-ai-settings-pane="assistant"]')?.hidden,
    }))
    check('全局设置页「打开 AI 设置」跳回画布并展开左栏对话页与设置窗口',
      jumped && jumpTab.active === 'assistant' && jumpTab.paneVisible,
      JSON.stringify(jumpTab))

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
    console.log('AI_SETTINGS_WINDOW_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
