/**
 * AI 智能体配置 / 工具目录 / 对话控件 真机 GUI 冒烟（S1 + S2 + P2 落地后）。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-ai-agent-gui.mjs
 *
 * 与其余 GUI 冒烟完全隔离：独立临时工作区、独立 Electron profile、独立 CDP 端口
 * （默认 9237，可用 TOPOMIND_AI_AGENT_CDP_PORT 覆盖）。**绝不复用 9222**：
 * 那是 WorkBuddy IDE 自身的调试端口，连上去会操作到 IDE。
 *
 * 不依赖真实 API Key：所有断言都在「未配置 Key」的离线状态下跑，
 * 发送按钮只验证降级提示，不产生任何外部网络请求。
 *
 * 覆盖：设置页「AI 智能体」分区 → 内置模板卡片 / 置灰说明 / 20 项工具只读目录
 *   （P3 状态：17 已接入 / 0 未接入 / 3 永不开放）→ 使用模板创建 Agent 并落盘
 *   agents.json → 系统提示词 {{var}} 白名单注入与未命中降级 → 参数钳制 → reload
 *   持久化 → 对话界面 Agent 选择器 / 深度思考三态 / 工具能力说明 / 最终提示词只读
 *   预览 → 240 窄栏无横向溢出 → 无 Key 发送降级 → 零渲染异常 / 零外发。
 *
 * 注：P2 的 tool calling 链路由 verify-ai-agent-contracts.mts 做纯函数真跑断言；
 * 本脚本在无 Key 状态下不触发真实模型，只校验 UI 口径与工具状态的对外表达。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_AI_AGENT_CDP_PORT || 9237)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-ai-agent-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = 'AI冒烟库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const AGENTS_FILE = path.join(WORKDIR, '.topomind', 'ai', 'agents.json')
const SECTION = '[data-tm-settings-ai-agents]'

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readAgents = () => (fs.existsSync(AGENTS_FILE) ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) : null)

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-ai-agent-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  // 两个普通节点：hiddenNodeCount=0 不触发 LOD，zoom=1 保证画布可写。
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
    // 从设置页 / 首页回画布：先走全局导航 home，再点知识库名（画布 tab）。
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
    // 每轮从干净偏好起步：Electron profile 是复用的，避免上一轮的三态 / 窄栏残留。
    localStorage.removeItem('topomind:ai-reasoning-mode')
    localStorage.removeItem('topomind:ai-reasoning-protocol')
    localStorage.setItem('topomind_left_dock_width_v1', '280')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  return ensureCanvas(page)
}

async function openSettings(page) {
  await page.evaluate(() => document.querySelector('[data-tm-nav-item="settings"]')?.click())
  return waitFor(page, () => !!document.querySelector('[data-tm-settings-ai-agents]'), 10000)
}

async function openAgentPanel(page) {
  const onCanvas = await ensureCanvas(page)
  if (!onCanvas) return false
  await page.evaluate(() => document.querySelector('[data-tm-left-dock-tab="agent"]')?.click())
  return waitFor(page, () => !!document.querySelector('[data-tm-ai-agent-panel]'), 10000)
}

/** 点击容器内文本匹配的第一个按钮（React 合成事件可由原生 click 触发）。 */
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

async function sectionText(page) {
  return page.evaluate((sel) => document.querySelector(sel)?.innerText || '', SECTION)
}

/** 设置页「最终提示词」只读预览块。不能用整段 section 文本：模板卡片里也带 {{var}} 原文。 */
async function previewBlockText(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const block = [...(root?.querySelectorAll('div') ?? [])]
      .find((item) => item.className.includes('whitespace-pre-wrap') && item.className.includes('break-words'))
    return block?.innerText || ''
  }, SECTION)
}

async function main() {
  setupWorkDir()
  check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE) && !fs.existsSync(AGENTS_FILE))

  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  const pageErrors = []
  const externalRequests = []
  try {
    const page = await findRendererPage(browser)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const url = request.url()
      if (/^https?:\/\//.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
        externalRequests.push(url)
      }
    })

    check('进入工作空间并渲染普通节点', await enterWorkspace(page))

    // ===== A. 设置页：分区 / 模板 / 只读工具目录 =====
    check('设置页「AI 智能体」分区可打开', await openSettings(page))
    const section = await page.evaluate((sel) => {
      const root = document.querySelector(sel)
      if (!root) return null
      return {
        heading: root.querySelector('h2')?.textContent?.trim() || '',
        text: root.innerText || '',
        templateButtons: [...root.querySelectorAll('button')]
          .filter((item) => (item.textContent || '').trim() === '使用模板').length,
        importExportButtons: [...root.querySelectorAll('button')]
          .filter((item) => /导入|导出/.test(item.textContent || '')).length,
        hasForm: !!root.querySelector('[data-tm-ai-agent-form]'),
        prompt: root.querySelector('#agent-prompt')?.value || '',
      }
    }, SECTION)
    check('分区标题与默认 Agent 表单渲染',
      section?.heading.includes('AI 智能体') && section.hasForm && section.prompt.length > 20,
      JSON.stringify({ heading: section?.heading, hasForm: section?.hasForm, promptLen: section?.prompt.length }))
    check('内置模板恰好 3 张且各带「使用模板」', section?.templateButtons === 3,
      String(section?.templateButtons))
    check('技能 / MCP / 导入导出均为置灰说明，且无导入导出按钮',
      /技能（后续支持）/.test(section?.text || '')
      && /MCP（后续支持）/.test(section?.text || '')
      && /导入 \/ 导出（暂不支持）/.test(section?.text || '')
      && section?.importExportButtons === 0,
      JSON.stringify({ buttons: section?.importExportButtons }))
    check('默认配置未在启动时抢写 agents.json', readAgents() === null,
      fs.existsSync(AGENTS_FILE) ? '文件已存在' : '未创建')

    const catalog = await page.evaluate((sel) => {
      const root = document.querySelector(sel)
      const details = [...(root?.querySelectorAll('details') ?? [])]
        .find((item) => (item.querySelector('summary')?.textContent || '').includes('可调用工具列表'))
      if (!details) return null
      details.open = true
      const rows = [...details.querySelectorAll('tbody tr')].map((row) => ({
        id: row.dataset.tmToolId || row.querySelector('td')?.textContent?.trim() || '',
        status: row.dataset.tmToolStatus || [...row.querySelectorAll('td')].at(-1)?.textContent?.trim() || '',
        dimmed: row.className.includes('opacity-50'),
      }))
      return {
        summary: details.querySelector('summary')?.textContent?.trim() || '',
        rows,
        buttons: details.querySelectorAll('button').length,
        inputs: details.querySelectorAll('input, select, textarea').length,
      }
    }, SECTION)
    check('工具只读目录恰好 20 项、摘要标注只读与已接入数量',
      catalog?.rows.length === 20 && /20 项/.test(catalog.summary || '')
      && /只读/.test(catalog.summary || '') && /已接入 17 项/.test(catalog.summary || ''),
      JSON.stringify({ count: catalog?.rows.length, summary: catalog?.summary }))
    check('P3 状态：17 已接入 / 0 未接入 / 3 永不开放并置灰',
      catalog?.rows.filter((row) => row.status === '已接入' && !row.dimmed).length === 17
      && catalog?.rows.filter((row) => row.status === '未接入' && !row.dimmed).length === 0
      && catalog?.rows.filter((row) => row.status === '永不开放' && row.dimmed).length === 3,
      JSON.stringify(catalog?.rows.filter((row) => row.status !== '已接入')))
    check('工具目录内零增删改 / 启停 / 测试控件',
      catalog?.buttons === 0 && catalog?.inputs === 0,
      JSON.stringify({ buttons: catalog?.buttons, inputs: catalog?.inputs }))
    const aiSettingsText = await page.evaluate(() =>
      document.querySelector('[data-tm-settings-ai]')?.innerText || '')
    check('AI 助手设置页不再宣称「只读问答」，改为「预览确认后才写入」',
      !/当前阶段为只读问答/.test(aiSettingsText) && /预览并确认后才会写入/.test(aiSettingsText),
      aiSettingsText.slice(0, 180).replace(/\n/g, ' | '))

    // ===== B. 使用模板创建 Agent，验证独立落盘 =====
    check('点击「使用模板」', await clickButton(page, SECTION, '使用模板'))
    const savedOnce = (await (async () => {
      for (let i = 0; i < 30; i += 1) {
        if (readAgents()) return true
        await sleep(200)
      }
      return false
    })())
    const configAfterTemplate = readAgents()
    const subAgent = configAfterTemplate?.agents.find((agent) => agent.kind === 'sub')
    check('agents.json 独立落盘且新增一个子 Agent',
      savedOnce && configAfterTemplate?.agents.length === 2 && !!subAgent
      && configAfterTemplate.orchestratorId === 'orchestrator.default',
      JSON.stringify({ count: configAfterTemplate?.agents.length, orchestratorId: configAfterTemplate?.orchestratorId }))
    check('模板产物 origin=user / toolIds 全在白名单、不含永不开放项',
      subAgent?.origin === 'user' && Array.isArray(subAgent?.toolIds)
      && subAgent.toolIds.length > 0
      && !subAgent.toolIds.some((id) => ['node.delete', 'node.move_room', 'document.clear'].includes(id)),
      JSON.stringify({ origin: subAgent?.origin, toolIds: subAgent?.toolIds }))
    await clickButton(page, SECTION, '预览最终提示词')
    const fallbackText = await previewBlockText(page)
    check('模板变量降级如实展示（documentTitle / roomPath 本期不提供）',
      /\[未提供变量：/.test(fallbackText) && /documentTitle|roomPath/.test(fallbackText),
      fallbackText.slice(0, 180).replace(/\n/g, ' | '))

    // ===== C. 提示词注入 / 参数钳制 / 保存 / reload 持久化 =====
    await page.focus('#agent-prompt')
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.keyboard.type('今天 {{date}}；工具清单 {{tools}}')
    // 作用域必须限定在「模板变量」行：表单里还有 17 个工具白名单 checkbox，
    // 扫全表单会顺手把 Agent 的 toolIds 清空，污染后续所有工具口径断言。
    await page.evaluate(() => {
      const root = document.querySelector('[data-tm-agent-prompt-vars]')
      for (const label of [...(root?.querySelectorAll('label') ?? [])]) {
        const checkbox = label.querySelector('input[type="checkbox"]')
        if (!checkbox) continue
        const text = label.textContent || ''
        const want = text.includes('日期') || text.includes('可用工具清单')
        if (checkbox.checked !== want) checkbox.click()
      }
    })
    const previewUpdated = await waitFor(page, () => {
      const root = document.querySelector('[data-tm-settings-ai-agents]')
      const block = [...(root?.querySelectorAll('div') ?? [])]
        .find((item) => item.className.includes('whitespace-pre-wrap') && item.className.includes('break-words'))
      return (block?.innerText || '').includes('今天 ')
    }, 6000)
    const previewText = await previewBlockText(page)
    check('{{var}} 白名单注入：date / tools 被真实值替换，且工具清单反映本次开放项',
      previewUpdated && /今天 /.test(previewText) && /目录共 20 项/.test(previewText)
      && /已接入 17 项/.test(previewText) && /本次会话开放 [1-9]/.test(previewText)
      && !previewText.includes('{{date}}') && !previewText.includes('{{tools}}'),
      JSON.stringify({ len: previewText.length, text: previewText.slice(0, 220).replace(/\n/g, ' | ') }))
    check('最终 prompt 不含任何未替换的 {{var}}（校验闸生效）',
      previewText.length > 0 && !previewText.includes('{{'),
      previewText.slice(0, 120).replace(/\n/g, ' | '))

    const numberInputs = await page.$$('[data-tm-ai-agent-form] input[type="number"]')
    if (numberInputs[0]) {
      await numberInputs[0].click({ clickCount: 3 })
      await page.keyboard.down('Control')
      await page.keyboard.press('a')
      await page.keyboard.up('Control')
      await page.keyboard.type('99')
    }
    const savedClicked = !!numberInputs[0] && await clickButton(page, SECTION, '保存该智能体')
    check('填写越界参数并保存', savedClicked)
    const savedTwice = await (async () => {
      for (let i = 0; i < 30; i += 1) {
        const data = readAgents()
        const target = data?.agents.find((agent) => agent.kind === 'sub')
        if (target?.systemPrompt?.includes('{{date}}')) return true
        await sleep(200)
      }
      return false
    })()
    const persisted = readAgents()?.agents.find((agent) => agent.kind === 'sub')
    check('系统提示词 / 模板变量写入 agents.json', savedTwice
      && persisted?.systemPrompt.includes('{{date}}')
      && persisted?.promptVars.includes('date') && persisted?.promptVars.includes('tools'),
      JSON.stringify({ prompt: persisted?.systemPrompt, vars: persisted?.promptVars }))
    check('主进程 normalize 把 temperature=99 钳到 2',
      persisted?.model?.temperature === 2,
      JSON.stringify(persisted?.model))
    check('编辑提示词不会清空已分配的工具白名单',
      Array.isArray(persisted?.toolIds) && persisted.toolIds.length >= 1
      && persisted.toolIds.every((id) => id !== 'node.delete'),
      JSON.stringify(persisted?.toolIds))

    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(2000)
    await ensureCanvas(page)
    check('reload 后设置页仍能读到持久化的 Agent', await openSettings(page)
      && /文档写作助手/.test(await sectionText(page)))
    const afterReload = readAgents()?.agents.find((agent) => agent.kind === 'sub')
    check('reload 不覆盖已保存的提示词与参数',
      afterReload?.systemPrompt.includes('{{date}}') && afterReload?.model?.temperature === 2)

    // ===== D. 对话界面：Agent 选择器 / 深度思考三态 / 最终 prompt =====
    check('切到 AI Agent 左栏页并渲染会话面板', await openAgentPanel(page))
    const aiPanelIntro = await page.evaluate(() =>
      document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '')
    check('对话面板按 P2 口径说明「工具 · 需确认」与写操作需预览确认',
      /工具 · 需确认/.test(aiPanelIntro) && /写操作只会生成变更建议/.test(aiPanelIntro)
      && !/当前阶段为只读问答/.test(aiPanelIntro),
      aiPanelIntro.slice(0, 180).replace(/\n/g, ' | '))
    const agentOptions = await page.evaluate(() => ({
      value: document.querySelector('[aria-label="选择智能体"]')?.value || '',
      options: [...(document.querySelectorAll('[aria-label="选择智能体"] option') ?? [])]
        .map((item) => item.textContent?.trim() || ''),
    }))
    check('Agent 选择器列出全部 Agent 且默认选中唯一 orchestrator',
      agentOptions.options.length === 2
      && agentOptions.value === 'orchestrator.default'
      && agentOptions.options.some((item) => item.includes('★')),
      JSON.stringify(agentOptions))
    if (afterReload?.id) {
      await page.select('[aria-label="选择智能体"]', afterReload.id)
      await sleep(250)
    }
    const selectedValue = await page.evaluate(() => document.querySelector('[aria-label="选择智能体"]')?.value || '')
    check('可手动切换到模板创建的子 Agent',
      !!afterReload?.id && selectedValue === afterReload.id,
      JSON.stringify({ selectedValue, expected: afterReload?.id }))

    const controls = '[data-tm-ai-agent-controls]'
    check('深度思考「开启」写入会话偏好并展开协议选择',
      await clickButton(page, controls, '开启')
      && await waitFor(page, () => localStorage.getItem('topomind:ai-reasoning-mode') === 'on'
        && !!document.querySelector('[aria-label="推理协议"]'), 5000),
      await page.evaluate(() => localStorage.getItem('topomind:ai-reasoning-mode')))
    check('深度思考「关闭」不展开协议选择',
      await clickButton(page, controls, '关闭')
      && await waitFor(page, () => localStorage.getItem('topomind:ai-reasoning-mode') === 'off'
        && !document.querySelector('[aria-label="推理协议"]'), 5000))
    check('深度思考「自动」可切回并保留会话覆盖',
      await clickButton(page, controls, '自动')
      && await waitFor(page, () => localStorage.getItem('topomind:ai-reasoning-mode') === 'auto', 5000))
    check('「恢复为该 Agent 默认」清除会话覆盖',
      await page.evaluate(() => {
        const button = document.querySelector('[data-tm-ai-agent-controls] button[title^="清除会话覆盖"]')
        if (!button) return false
        button.click()
        return true
      })
      && await waitFor(page, () => localStorage.getItem('topomind:ai-reasoning-mode') === null
        && !document.querySelector('[data-tm-ai-agent-controls] button[title^="清除会话覆盖"]'), 5000))

    await page.click('[aria-label="查看本次最终提示词"]')
    const promptPreview = await page.evaluate(() => {
      const root = document.querySelector('[data-tm-ai-prompt-preview]')
      if (!root) return null
      return {
        text: root.innerText || '',
        editables: root.querySelectorAll('input, textarea, select, [contenteditable="true"]').length,
      }
    })
    check('最终提示词抽屉只读且展示生效参数 / P2 工具口径与正文',
      !!promptPreview && /最终系统提示词/.test(promptPreview.text)
      && /本视图只读/.test(promptPreview.text)
      && /工具目录：20 项/.test(promptPreview.text)
      && /已接入 17 项/.test(promptPreview.text)
      && /本 Agent 开放 [1-9]/.test(promptPreview.text)
      && promptPreview.editables === 0,
      JSON.stringify({ editables: promptPreview?.editables, tail: promptPreview?.text.slice(-90).replace(/\n/g, ' | ') }))

    // ===== E. 无 Key 发送降级（不产生外部请求） =====
    await page.type('[data-tm-ai-composer]', '你好，请做一次自我介绍')
    await clickButton(page, '[data-tm-ai-agent-panel]', '发送')
    check('未配置 Key 时发送给出明确降级提示，且请求未外发',
      await waitFor(page, () => (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '')
        .includes('尚未配置 API Key'), 8000)
      && externalRequests.length === 0,
      JSON.stringify({ external: externalRequests.slice(0, 3) }))

    // ===== F. 240 窄栏：控件不横向溢出 =====
    await page.evaluate(() => localStorage.setItem('topomind_left_dock_width_v1', '240'))
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(2000)
    check('240 窄栏下重新打开 AI Agent 面板', await openAgentPanel(page))
    await page.click('[aria-label="查看本次最终提示词"]')
    await waitFor(page, () => !!document.querySelector('[data-tm-ai-prompt-preview]'), 5000)
    const narrow = await page.evaluate(() => {
      const panel = document.querySelector('[data-tm-left-dock-panel="agent"]')
      const controls = document.querySelector('[data-tm-ai-agent-controls]')
      const preview = document.querySelector('[data-tm-ai-prompt-preview]')
      const composer = document.querySelector('[data-tm-ai-agent-panel]')
      const box = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), sw: el.scrollWidth, cw: el.clientWidth } : null
      return {
        panelW: Math.round(panel?.getBoundingClientRect().width ?? -1),
        controls: box(controls), preview: box(preview), composer: box(composer),
        buttonsVisible: [...(controls?.querySelectorAll('button') ?? [])]
          .every((item) => item.getBoundingClientRect().width > 0),
      }
    })
    check('左栏宽度按 240 偏好派生且三态按钮全部可见',
      narrow.panelW >= 235 && narrow.panelW <= 260 && narrow.buttonsVisible,
      JSON.stringify({ panelW: narrow.panelW, buttonsVisible: narrow.buttonsVisible }))
    check('窄栏下控件 / 输入框 / 展开的提示词预览均无横向溢出',
      narrow.controls.sw <= narrow.controls.cw + 2
      && narrow.composer.sw <= narrow.composer.cw + 2
      && !!narrow.preview && narrow.preview.sw <= narrow.preview.cw + 2,
      JSON.stringify(narrow))

    check('全流程零未捕获渲染异常、零外部网络请求',
      pageErrors.length === 0 && externalRequests.length === 0,
      JSON.stringify({ pageErrors: pageErrors.slice(0, 3), external: externalRequests.slice(0, 3) }))
  } finally {
    browser.disconnect()
    if (spawned) spawned.kill()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.name).join(' | '))
    process.exitCode = 1
  } else {
    console.log('AI_AGENT_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error('AI_AGENT_GUI_VERIFY_ERROR', error)
  process.exitCode = 1
})
