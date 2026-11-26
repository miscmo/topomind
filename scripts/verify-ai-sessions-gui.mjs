/**
 * P4-S 历史会话真机 GUI 冒烟。
 *
 * 与其余 GUI 冒烟隔离：独立临时工作区、独立 Electron profile、独立 CDP 端口
 * （默认 9239，可用 TOPOMIND_AI_SESSIONS_CDP_PORT 覆盖）。**绝不复用 9222**：
 * 那是 WorkBuddy IDE 自身的调试端口，连上去会操作到 IDE。
 *
 * 覆盖用户需求的完整闭环：首次进入自动建会话 → 对话正文自动落盘 →
 * 新建 / 切换 / 删除（含二次确认）→ **杀掉并重新启动 Electron 进程**后
 * 历史列表与正文仍能再次打开。不依赖 API Key：发送走「未配置 Key」降级，
 * 用户消息仍然进入会话并被持久化，全程零外部网络请求。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_AI_SESSIONS_CDP_PORT || 9239)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-ai-sessions-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '会话冒烟库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const SESSIONS_FILE = path.join(WORKDIR, '.topomind', 'ai', 'sessions.json')
const MARKER = '持久化验证标记-42'

const results = []
const pageErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readSessions = () => (fs.existsSync(SESSIONS_FILE)
  ? JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
  : { sessions: [] })

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-ai-sessions-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
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
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
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

async function findRendererPage(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let pages = []
    try { pages = await browser.pages() } catch { /* 启动期偶发 */ }
    for (const candidate of pages) {
      try { if (candidate.url().includes('index.html')) return candidate } catch { /* 忽略 */ }
    }
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
    localStorage.removeItem('topomind_node_tree_expanded_v2')
    localStorage.setItem('topomind_left_dock_width_v1', '280')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  return ensureCanvas(page)
}

async function openAgentPanel(page) {
  if (!await ensureCanvas(page)) return false
  await page.evaluate(() => document.querySelector('[data-tm-left-dock-tab="agent"]')?.click())
  return waitFor(page, () => !!document.querySelector('[data-tm-ai-agent-panel]'), 10000)
}

async function clickButton(page, scope, text) {
  return page.evaluate((sel, label) => {
    const root = document.querySelector(sel)
    if (!root) return false
    const button = [...root.querySelectorAll('button')]
      .find((item) => (item.textContent || '').trim().includes(label))
    if (!button) return false
    button.click()
    return true
  }, scope, text)
}

/** 按条目文本找会话 id；needle 为空表示取第一条。不用 eval，避开生产 CSP。 */
function findSessionId(page, needle) {
  return page.evaluate((text) => {
    const el = [...document.querySelectorAll('[data-tm-ai-session-item]')]
      .find((item) => (item.textContent || '').includes(text))
    return el?.getAttribute('data-tm-ai-session-item') ?? null
  }, needle)
}

/** 只查消息正文区：历史列表项的标题也含标记词，查整块面板会造成假阳性。 */
async function messagesHasMarker(page) {
  return waitFor(page, () => (document.querySelector('[data-tm-ai-messages]')?.innerText || '')
    .includes('持久化验证标记-42'))
}

async function messagesCleared(page) {
  return !await waitFor(page, () => (document.querySelector('[data-tm-ai-messages]')?.innerText || '')
    .includes('持久化验证标记-42'), 800)
}

async function main() {
  setupWorkDir()
  check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE) && !fs.existsSync(SESSIONS_FILE))
  if (await cdpReachable()) {
    throw new Error(`CDP 端口 ${PORT} 已被占用，请换 TOPOMIND_AI_SESSIONS_CDP_PORT 后重跑`)
  }

  let spawned = await launchApp()
  let browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  let page = await findRendererPage(browser)
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  try {
    check('进入工作空间', await enterWorkspace(page))
    check('打开 AI 会话面板', await openAgentPanel(page))
    check('首次进入自动建一条空会话并写入 sessions.json',
      await waitFor(page, () => document.querySelector('[data-tm-ai-session-current]')?.textContent === '新会话'
        && document.querySelector('[data-tm-ai-session-count]')?.textContent === '1')
      && fs.existsSync(SESSIONS_FILE))

    await page.type('[data-tm-ai-composer]', MARKER)
    check('点击发送（未配置 Key 走降级提示）', await clickButton(page, '[data-tm-ai-agent-panel]', '发送'))
    check('用户消息进入当前会话', await messagesHasMarker(page))
    await sleep(1400)
    const afterSend = readSessions()
    check('对话正文自动落盘，标题派生自首条提问',
      afterSend.sessions.length === 1
      && JSON.stringify(afterSend.sessions[0].messages).includes(MARKER)
      && afterSend.sessions[0].title.includes(MARKER),
      JSON.stringify({ count: afterSend.sessions.length, title: afterSend.sessions[0]?.title }))

    await page.click('[data-tm-ai-session-toggle]')
    check('历史会话列表展开并渲染 1 条',
      await waitFor(page, () => document.querySelectorAll('[data-tm-ai-session-item]').length === 1))

    await page.click('[data-tm-ai-session-new]')
    check('新建会话后列表变 2 条、面板清空、当前标题回到「新会话」',
      await waitFor(page, () => document.querySelectorAll('[data-tm-ai-session-item]').length === 2
        && document.querySelector('[data-tm-ai-session-current]')?.textContent === '新会话')
      && await messagesCleared(page))

    const savedId = await findSessionId(page, '持久化验证标记')
    check('历史会话条目可定位', Boolean(savedId), String(savedId))
    if (savedId) {
      await page.click(`[data-tm-ai-session-item="${savedId}"]`)
      check('点开历史会话后正文恢复', await messagesHasMarker(page))
    }

    const blankId = await findSessionId(page, '新会话')
    if (blankId) {
      await page.click(`[data-tm-ai-session-delete="${blankId}"]`)
      check('删除走内联二次确认',
        await waitFor(page, () => !!document.querySelector('[data-tm-ai-session-confirm]')))
      await page.click('[data-tm-ai-session-confirm-delete]')
      check('确认删除后列表与磁盘同步只剩 1 条',
        await waitFor(page, () => document.querySelectorAll('[data-tm-ai-session-item]').length === 1)
        && readSessions().sessions.length === 1)
    }

    // ---- 真正重开软件：杀掉整个 Electron 进程再重新拉起，profile / 工作目录不变 ----
    browser.disconnect()
    spawned.kill()
    // 等旧进程彻底释放 CDP 端口与 profile 锁，再拉起新进程。
    for (let i = 0; i < 30 && await cdpReachable(); i += 1) await sleep(300)
    if (await cdpReachable()) throw new Error('旧 Electron 进程未退出，无法模拟重新打开软件')
    spawned = await launchApp()
    browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
    page = await findRendererPage(browser)
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    check('重新打开软件后仍能进入工作空间', await enterWorkspace(page))
    check('重新打开 AI 会话面板', await openAgentPanel(page))
    check('重启后历史会话列表仍在（计数 1）',
      await waitFor(page, () => document.querySelector('[data-tm-ai-session-count]')?.textContent === '1'))
    check('重启后自动恢复上次会话且历史正文仍可再次打开', await messagesHasMarker(page))

    await page.click('[data-tm-ai-session-toggle]')
    check('重启后列表条目可点开且标题正确',
      await waitFor(page, () => [...document.querySelectorAll('[data-tm-ai-session-item]')]
        .some((el) => (el.textContent || '').includes('持久化验证标记'))))
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-ai-session-history]')
      return el ? { sw: el.scrollWidth, cw: el.clientWidth } : null
    })
    check('历史会话列表无横向溢出', Boolean(overflow) && overflow.sw <= overflow.cw + 2,
      JSON.stringify(overflow))

    const activeId = await findSessionId(page, '')
    if (activeId) {
      await page.click(`[data-tm-ai-session-delete="${activeId}"]`)
      await waitFor(page, () => !!document.querySelector('[data-tm-ai-session-confirm]'))
      await page.click('[data-tm-ai-session-confirm-delete]')
      check('删除当前会话后自动补一条空会话且面板清空',
        await waitFor(page, () => document.querySelector('[data-tm-ai-session-current]')?.textContent === '新会话'
          && document.querySelector('[data-tm-ai-session-count]')?.textContent === '1')
        && await messagesCleared(page))
      check('删除当前会话后磁盘仍保留一条可用会话', readSessions().sessions.length === 1)
    }

    check('全流程零未捕获渲染异常', pageErrors.length === 0,
      JSON.stringify(pageErrors.slice(0, 3)))
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
    console.log('AI_SESSIONS_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error('AI_SESSIONS_GUI_VERIFY_ERROR', error)
  process.exitCode = 1
})
