/**
 * 多模型（P5）UI 真机冒烟：新增 / 修改 / 设为全局默认 / Agent 绑定 /
 * 对话界面临时切换 / 删除，全部按真实点击走一遍。
 *
 * 独立临时工作区、独立 Electron profile、独立 CDP 端口（默认 9244，
 * 可用 TOPOMIND_AI_MODELS_CDP_PORT 覆盖），绝不复用 9222。GUI 冒烟按项目
 * 约定不纳入 verify-all，需手动运行：node scripts/verify-ai-models-gui.mjs
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_AI_MODELS_CDP_PORT || 9244)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-ai-models-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = 'AI 多模型冒烟库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const CONFIG_FILE = path.join(WORKDIR, '.topomind', 'ai', 'config.json')

const results = []
const pageErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-ai-models-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  fs.writeFileSync(path.join(KB_DIR, '_graph.json'), JSON.stringify({
    children: { 'plain-a': { name: '普通节点 A', kind: 'knowledge', x: 80, y: 80 } },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')
}

const readConfig = () => (fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : null)

async function cdpReachable() {
  try {
    const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch { return false }
}

async function launchApp() {
  const electronRoot = path.join(process.cwd(), 'node_modules', 'electron')
  const exe = process.platform === 'darwin'
    ? (() => {
      const pathTxt = path.join(electronRoot, 'path.txt')
      const rel = fs.existsSync(pathTxt) ? fs.readFileSync(pathTxt, 'utf8').trim()
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

async function waitFor(page, fn, timeout = 10000, ...args) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...args)) return true
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
    localStorage.removeItem('topomind:ai-session-model-id')
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

async function typeInto(page, selector, text) {
  await page.focus(selector)
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.type(text)
}

async function clickByText(page, scope, text) {
  return page.evaluate((sel, label) => {
    const root = document.querySelector(sel)
    if (!root) return false
    const button = [...root.querySelectorAll('button')]
      .find((item) => (item.textContent || '').trim() === label)
    if (!button || button.disabled) return false
    button.click()
    return true
  }, scope, text)
}

const rowIds = (page) => page.evaluate(() => [...document.querySelectorAll('[data-tm-ai-model-row]')]
  .map((el) => el.getAttribute('data-tm-ai-model-row')))

async function main() {
  setupWorkDir()
  const spawned = await launchApp()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null })
  const page = await findRendererPage(browser)
  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    check('进入工作空间并渲染画布节点', await enterWorkspace(page))
    check('打开左栏 AI Agent 对话页', await openAgentPanel(page))
    await page.evaluate(() => {
      if (document.querySelector('[data-tm-ai-settings-window]')) return
      document.querySelector('[data-tm-ai-settings-toggle]')?.click()
    })
    check('打开覆盖式 AI 设置窗口', await waitFor(page,
      () => !!document.querySelector('[data-tm-ai-settings-window]'), 8000))
    // 显式切到「AI 助手」并等异步 IPC 把模型列表拉回来，避免列表还是空的时候就断言。
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-tab="assistant"]')?.click())
    check('AI 助手分区完成异步配置加载', await waitFor(page,
      () => document.querySelectorAll('[data-tm-ai-model-row]').length === 1, 10000))

    const initial = await rowIds(page)
    check('老工作区零迁移：初始只有 1 个默认模型', initial.length === 1, JSON.stringify(initial))
    const legacyId = initial[0]

    // ===== 新增 =====
    check('点击「新增模型」', await page.evaluate(() => {
      const button = document.querySelector('[data-tm-ai-model-add]')
      if (!button || button.disabled) return false
      button.click()
      return true
    }))
    const addVisible = await waitFor(page,
      () => document.querySelectorAll('[data-tm-ai-model-row]').length === 2, 8000)
    check('列表出现第 2 个模型且 config.json 已落盘', addVisible
      && readConfig()?.config?.models?.length === 2,
    JSON.stringify(readConfig()?.config?.models?.map((item) => item.id)))
    const afterAdd = await rowIds(page)
    const newId = afterAdd.find((id) => id !== legacyId) ?? ''
    check('新增模型 id 与旧模型不冲突', !!newId && newId !== legacyId, JSON.stringify(afterAdd))

    // ===== 修改 =====
    await typeInto(page, '#ai-model-name', '测试模型B')
    await typeInto(page, '#ai-base-url', 'https://b.example/v1')
    await typeInto(page, '#ai-model', 'model-b')
    check('点击「保存」提交当前模型编辑', await clickByText(page, '[data-tm-settings-ai]', '保存'))
    // DOM 行更新发生在 IPC 返回之后，此时 config.json 必然已落盘。
    const editVisible = await waitFor(page, (id) =>
      document.querySelector(`[data-tm-ai-model-row="${id}"]`)?.textContent?.includes('测试模型B') ?? false,
    8000, newId)
    const edited = readConfig()?.config?.models?.find((item) => item.id === newId)
    check('编辑结果落到 config.json 的对应模型', editVisible && edited?.name === '测试模型B'
      && edited?.baseURL === 'https://b.example/v1' && edited?.model === 'model-b',
    JSON.stringify(edited))

    // ===== 设为全局默认（顶层字段必须镜像） =====
    check('点击「设为默认」', await page.evaluate((id) => {
      const button = document.querySelector(`[data-tm-ai-model-default="${id}"]`)
      if (!button || button.disabled) return false
      button.click()
      return true
    }, newId))
    const defaultVisible = await waitFor(page, (id) =>
      document.querySelector(`[data-tm-ai-model-row="${id}"]`)?.textContent?.includes('全局默认') ?? false,
    8000, newId)
    const configAfterDefault = readConfig()?.config
    check('默认模型切换后 config.json 顶层连接参数同步镜像', defaultVisible
      && configAfterDefault?.defaultModelId === newId
      && configAfterDefault?.baseURL === 'https://b.example/v1'
      && configAfterDefault?.model === 'model-b',
    JSON.stringify({ top: configAfterDefault?.model, defaultId: configAfterDefault?.defaultModelId }))
    check('列表里新模型显示「全局默认」标记', await page.evaluate((id) =>
      document.querySelector(`[data-tm-ai-model-row="${id}"]`)?.textContent?.includes('全局默认') ?? false, newId))

    // ===== Agent 绑定 =====
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-tab="agents"]')?.click())
    // AgentForm 要等 agents.json 的 IPC 回来、orchestratorId 就绪后才挂载。
    const bindingReady = await waitFor(page, () => {
      const select = document.querySelector('[data-tm-ai-agent-model-select]')
      return !!select && select.options.length === 3
    }, 10000)
    const binding = await page.evaluate(() => {
      const select = document.querySelector('[data-tm-ai-agent-model-select]')
      return { exists: !!select, options: select ? [...select.options].map((o) => o.textContent) : [] }
    })
    check('AI 智能体表单有生效模型下拉且列出全部模型',
      bindingReady && binding.exists && binding.options.length === 3
        && binding.options.some((t) => t.includes('测试模型B')),
      JSON.stringify(binding.options))

    // ===== 对话界面临时切换 =====
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-close]')?.click())
    await sleep(300)
    check('底栏出现模型切换按钮', await waitFor(page,
      () => !!document.querySelector('[data-tm-ai-model-picker]'), 5000))
    await page.evaluate(() => document.querySelector('[data-tm-ai-model-picker]')?.click())
    check('点击后展开模型菜单', await waitFor(page,
      () => !!document.querySelector('[data-tm-ai-model-menu]'), 5000))
    check('选中新模型后写入会话偏好并更新按钮文字', await (async () => {
      const clicked = await page.evaluate((id) => {
        const option = document.querySelector(`[data-tm-ai-model-option="${id}"]`)
        if (!option) return false
        option.click()
        return true
      }, newId)
      if (!clicked) return false
      await sleep(300)
      return page.evaluate(() => localStorage.getItem('topomind:ai-session-model-id') !== null
        && document.querySelector('[data-tm-ai-model-picker]')?.textContent?.includes('测试模型B'))
    })())

    // ===== 删除 =====
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-toggle]')?.click())
    await waitFor(page, () => !!document.querySelector('[data-tm-ai-settings-window]'), 8000)
    // 上一次停在 agents tab；hidden pane 里的按钮虽能触发 click，显式切回来更贴近真实操作。
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-tab="assistant"]')?.click())
    await sleep(300)
    check('删除非默认的旧模型', await page.evaluate((id) => {
      const button = document.querySelector(`[data-tm-ai-model-delete="${id}"]`)
      if (!button || button.disabled) return false
      button.click()
      return true
    }, legacyId))
    const removedVisible = await waitFor(page,
      () => document.querySelectorAll('[data-tm-ai-model-row]').length === 1, 8000)
    const configAfterRemove = readConfig()?.config
    check('列表只剩 1 个模型，默认 id 仍指向新模型', removedVisible
      && configAfterRemove?.models?.length === 1
      && configAfterRemove?.defaultModelId === newId,
    JSON.stringify({ models: configAfterRemove?.models?.length, defaultId: configAfterRemove?.defaultModelId }))

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
    console.log('AI_MODELS_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
