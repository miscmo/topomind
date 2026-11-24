/**
 * 标题栏「学习时长」等宽 GUI 端到端回归。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-titlebar-duration-gui.mjs
 *
 * 与其他 GUI 脚本完全隔离：独立临时工作区、独立 Electron profile、独立 CDP 端口
 * （默认 9229）。数据只写 <系统临时目录>/tm-titlebar-duration-gui-e2e/，不碰真实知识库。
 *
 * 覆盖：workspace 模式渲染出学习时长 widget → 把时长文本依次换成 0s / 59s /
 * 59m 59s / 23h 59m 59s 等全部合法形态 → 时长盒 / 按钮 / widget / tab 区边界与
 * 首个 tab 位置恒定 → 文本左对齐、紧贴状态点且不溢出最长占位 → 窗口宽度变化后仍恒定。
 *
 * 为什么不通过业务 store 改时长：计时器 1s tick 会立刻覆盖，且测试钩子会污染业务代码。
 * 这里原地改 React 持有的文本节点 nodeValue，在**一次同步 evaluate** 里完成全部测量：
 * React 没有机会插入 commit，文本节点引用也保持一致，测量结束后原值还原。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_TITLEBAR_DURATION_CDP_PORT || 9229)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-titlebar-duration-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '时长等宽测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-titlebar-duration-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  fs.mkdirSync(KB_DIR, { recursive: true })
  fs.mkdirSync(path.join(WORKDIR, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    children: { 'node-a': { name: '节点 A', kind: 'knowledge', x: 160, y: 160 } },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')
}

async function cdpReachable() {
  try {
    return (await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1200) })).ok
  } catch { return false }
}

async function connectOrLaunch() {
  if (await cdpReachable()) return null
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
  const spawned = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'], {
    cwd: process.cwd(), env, stdio: 'ignore', detached: false,
  })
  for (let i = 0; i < 60; i += 1) {
    if (await cdpReachable()) return spawned
    await sleep(500)
  }
  spawned.kill()
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

async function findRendererPage(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const candidate of await browser.pages()) {
      try { if (candidate.url().includes('index.html')) return candidate } catch { /* not ready */ }
    }
    await sleep(300)
  }
  throw new Error('找不到 renderer 页面')
}

async function enterWorkspace(page) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    localStorage.removeItem('topomind_node_tree_expanded_v2')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2500)
  for (let i = 0; i < 3; i += 1) {
    if (await waitFor(page, () => !!document.querySelector('.react-flow__node'), 4000)) break
    await page.evaluate((name) => {
      const els = [...document.querySelectorAll('*')].filter((e) =>
        e.children.length === 0 && (e.textContent || '').includes(name))
      if (els.length) els[0].parentElement?.click()
    }, KB_NAME)
    await sleep(1200)
  }
  return waitFor(page, () => !!document.querySelector('[data-tm-learning-duration]'), 12000)
}

/** 单次同步测量：所有字符串形态下，标题栏左侧占位与 tab 区几何量必须逐项相等。 */
const measureDurationLayout = (page) => page.evaluate(() => {
  const wrapper = document.querySelector('[data-tm-learning-duration]')
  const ghost = wrapper?.firstElementChild
  const label = wrapper?.lastElementChild
  const widget = document.querySelector('[data-tm-titlebar-widget]')
  const zone = document.querySelector('[data-tm-tab-zone]')
  const firstTab = document.querySelector('[data-tm-tab-zone] [role="tab"]')
  const button = wrapper?.closest('button')
  if (!wrapper || !ghost || !label || !widget || !zone || !button) {
    return { ok: false, reason: '标题栏时长 / tab 区节点缺失' }
  }
  const textNode = label.firstChild
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return { ok: false, reason: '时长文本节点不可直接改写' }
  }
  const original = textNode.nodeValue
  const round = (n) => Math.round(n * 100) / 100
  const measure = () => {
    const w = wrapper.getBoundingClientRect()
    const g = ghost.getBoundingClientRect()
    const l = label.getBoundingClientRect()
    const b = button.getBoundingClientRect()
    const t = widget.getBoundingClientRect()
    const z = zone.getBoundingClientRect()
    const tab = firstTab?.getBoundingClientRect()
    return {
      wrapperWidth: round(w.width),
      wrapperX: round(w.x),
      wrapperLeft: round(w.left),
      buttonWidth: round(b.width),
      widgetWidth: round(t.width),
      widgetRight: round(t.right),
      zoneX: round(z.x),
      zoneWidth: round(z.width),
      tabX: tab ? round(tab.x) : null,
      labelWidth: round(l.width),
      labelLeft: round(l.left),
      ghostWidth: round(g.width),
    }
  }
  const samples = ['0s', '9s', '59s', '1m 0s', '9m 59s', '59m 59s',
    '1h 0m 0s', '9h 59m 59s', '23h 59m 59s']
  const rows = samples.map((sample) => {
    textNode.nodeValue = sample
    return { sample, ...measure() }
  })
  textNode.nodeValue = original
  return {
    ok: true,
    ghostText: ghost.textContent,
    ghostVisibility: getComputedStyle(ghost).visibility,
    labelPosition: getComputedStyle(label).position,
    numericVariant: getComputedStyle(wrapper).fontVariantNumeric,
    rows,
  }
})

async function main() {
  setupWorkDir()
  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  try {
    const page = await findRendererPage(browser)
    check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE))
    check('进入工作空间并渲染出学习时长 widget 与 tab 区', await enterWorkspace(page))

    const layout = await measureDurationLayout(page)
    check('时长盒由「最长合法字符串」隐形占位撑开，真实文本脱离文档流左对齐',
      layout.ok && layout.ghostText === '23h 59m 59s'
      && layout.ghostVisibility === 'hidden' && layout.labelPosition === 'absolute'
      && /tabular-nums/.test(layout.numericVariant || ''),
      JSON.stringify({ ok: layout.ok, ghostText: layout.ghostText,
        ghostVisibility: layout.ghostVisibility, labelPosition: layout.labelPosition,
        numericVariant: layout.numericVariant, reason: layout.reason }))

    const rows = layout.ok ? layout.rows : []
    const base = rows[0]
    const keys = ['wrapperWidth', 'wrapperX', 'buttonWidth', 'widgetWidth', 'widgetRight',
      'zoneX', 'zoneWidth', 'tabX']
    const drift = rows.filter((row) => keys.some((key) => Math.abs(row[key] - base[key]) > 0.05))
    check('全部时长形态（0s → 23h 59m 59s）下时长盒、按钮、widget 与 tab 区位置恒定',
      rows.length === 9 && drift.length === 0 && base.wrapperWidth > 0 && base.zoneX > base.widgetRight,
      JSON.stringify({ base, drift }))

    const misaligned = rows.filter((row) =>
      Math.abs(row.labelLeft - row.wrapperLeft) > 0.5 || row.labelWidth > row.ghostWidth + 0.5)
    check('时长文本始终左对齐、紧贴状态点且不溢出最长占位',
      rows.length === 9 && misaligned.length === 0,
      JSON.stringify({ misaligned, maxLabelWidth: Math.max(...rows.map((r) => r.labelWidth)),
        ghostWidth: base.ghostWidth }))

    // 窗口宽度变化也不该让左侧 widget 宽度或 tab 区左边界漂移。
    const viewportRows = []
    for (const width of [1400, 1100, 1600, 1400]) {
      await page.setViewport({ width, height: 900 })
      await sleep(250)
      viewportRows.push(await page.evaluate(() => {
        const widget = document.querySelector('[data-tm-titlebar-widget]')
        const zone = document.querySelector('[data-tm-tab-zone]')
        const wrapper = document.querySelector('[data-tm-learning-duration]')
        return {
          viewport: window.innerWidth,
          widgetWidth: Math.round((widget?.getBoundingClientRect().width ?? 0) * 100) / 100,
          wrapperWidth: Math.round((wrapper?.getBoundingClientRect().width ?? 0) * 100) / 100,
          zoneX: Math.round((zone?.getBoundingClientRect().x ?? 0) * 100) / 100,
        }
      }))
    }
    const viewportBase = viewportRows[0]
    const viewportDrift = viewportRows.filter((row) =>
      Math.abs(row.widgetWidth - viewportBase.widgetWidth) > 0.05
      || Math.abs(row.wrapperWidth - viewportBase.wrapperWidth) > 0.05
      || Math.abs(row.zoneX - viewportBase.zoneX) > 0.05)
    check('窗口宽度变化时左侧 widget 宽度与 tab 区左边界仍恒定',
      viewportDrift.length === 0,
      JSON.stringify({ viewportRows, viewportDrift }))

    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    if (failed.length) {
      console.log('TITLEBAR_DURATION_GUI_FAILED')
      process.exitCode = 1
    } else {
      console.log('TITLEBAR_DURATION_GUI_VERIFIED')
    }
  } finally {
    await browser.disconnect()
    if (spawned) spawned.kill()
  }
}

main().catch((error) => {
  console.error('TITLEBAR_DURATION_GUI_ERROR', error)
  process.exitCode = 1
})
