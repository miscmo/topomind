/**
 * P4-C 输入区真机 GUI 冒烟。
 *
 * 独立临时工作区 / 独立 Electron profile / 独立 CDP 端口（默认 9240），
 * 不与其它 GUI 冒烟、也不与 WorkBuddy IDE 的 9222 冲突。
 *
 * 覆盖用户反馈的四件事：上下 padding 对称、多行高度自适应（正常输入无内部
 * 滚动条、超长才由细滚动条接管）、快捷回复一键发送、输入历史回填 / 清空 /
 * 重载持久化；顺带回归「发送」按钮链路与 240 窄栏不溢出。不依赖 API Key：
 * 发送走「未配置 Key」降级，用户消息仍进入会话，全程零外部网络请求。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_AI_COMPOSER_CDP_PORT || 9240)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-ai-composer-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '输入区冒烟库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const MARKER_A = '输入区改造验证-A'
const QUICK_TEXT = '继续'
const CUSTOM_TEXT = '自定义回复-X'

const results = []
const pageErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-ai-composer-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
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

async function waitForText(page, selector, text, timeout = 8000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const ok = await page.evaluate((sel, needle) =>
      (document.querySelector(sel)?.innerText || '').includes(needle), selector, text)
    if (ok) return true
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

function composerMetrics(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-tm-ai-composer]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      height: Math.round(el.getBoundingClientRect().height),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      maxHeight: parseFloat(cs.maxHeight) || 0,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      overflowY: cs.overflowY,
      thinScroll: el.classList.contains('tm-scroll'),
      value: el.value,
    }
  })
}

function composerFocusState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-tm-ai-composer]')
    const card = document.querySelector('.tm-composer')
    if (!el || !card) return null
    const cs = getComputedStyle(el)
    const cardCs = getComputedStyle(card)
    return {
      focused: document.activeElement === el,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      cardBoxShadow: cardCs.boxShadow,
      cardBorderColor: cardCs.borderColor,
    }
  })
}

/** Shift+Enter 换行：Enter 单独按会触发发送，冒烟里必须用组合键造多行。 */
async function typeLines(page, lines) {
  await page.click('[data-tm-ai-composer]')
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) {
      await page.keyboard.down('Shift')
      await page.keyboard.press('Enter')
      await page.keyboard.up('Shift')
    }
    await page.type('[data-tm-ai-composer]', lines[i])
  }
}

async function clearComposer(page) {
  await page.click('[data-tm-ai-composer]')
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
}

async function main() {
  setupWorkDir()
  check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE))
  if (await cdpReachable()) {
    throw new Error(`CDP 端口 ${PORT} 已被占用，请换 TOPOMIND_AI_COMPOSER_CDP_PORT 后重跑`)
  }

  const spawned = await launchApp()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  const page = await findRendererPage(browser)
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  try {
    check('进入工作空间', await enterWorkspace(page))
    check('打开 AI 会话面板', await openAgentPanel(page))

    // 焦点方框回归：Chromium 下鼠标点击 textarea 也会匹配 :focus-visible，
    // 全局 2px / offset 2px 的 outline 必须在文本输入控件上被压掉。
    await page.evaluate(() => document.activeElement?.blur?.())
    const idleBorder = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.tm-composer')).borderColor)
    await page.click('[data-tm-ai-composer]')
    await sleep(250) // 等 border-color 的 150ms 过渡走完，别读到起始色
    const focus = await composerFocusState(page)
    check('点击输入框不再出现额外的 2px 外描边方框',
      !!focus && focus.focused && focus.outlineStyle === 'none' && focus.outlineWidth === '0px',
      JSON.stringify(focus))
    check('输入卡片聚焦只换边框色、不再叠外扩光晕',
      !!focus && focus.cardBoxShadow === 'none',
      JSON.stringify(focus))
    check('去掉方框后仍有可见焦点反馈（边框变为强调色）',
      !!focus && focus.cardBorderColor !== idleBorder,
      JSON.stringify({ idleBorder, focusedBorder: focus?.cardBorderColor }))

    const initial = await composerMetrics(page)
    check('输入框上下间隙对称且文字不贴顶',
      !!initial && initial.paddingTop === initial.paddingBottom && parseFloat(initial.paddingTop) >= 8,
      JSON.stringify(initial))
    check('单行输入时无内部滚动条',
      !!initial && initial.scrollHeight <= initial.clientHeight + 2,
      JSON.stringify(initial))

    await typeLines(page, ['第一行内容', '第二行内容', '第三行内容', '第四行内容', '第五行内容'])
    await sleep(250)
    const multi = await composerMetrics(page)
    check('多行输入时高度自适应增长',
      !!multi && multi.height > initial.height + 30,
      JSON.stringify({ initial: initial?.height, multi: multi?.height }))
    check('多行时不再出现丑陋的内部滚动条',
      !!multi && multi.scrollHeight <= multi.clientHeight + 2,
      JSON.stringify(multi))

    await typeLines(page, Array.from({ length: 16 }, (_, i) => `追加第${i + 1}行`))
    await sleep(250)
    const long = await composerMetrics(page)
    check('超长输入被 max-height 钳制，仅此时才滚动',
      !!long && long.height <= long.maxHeight + 2 && long.scrollHeight > long.clientHeight + 4,
      JSON.stringify(long))
    check('滚动条沿用统一细滚动条契约',
      !!long && long.thinScroll && long.overflowY === 'auto')

    // 回归：发送按钮按文本点击仍可用，且用户消息进入消息区（无 Key 降级）。
    await clearComposer(page)
    await page.type('[data-tm-ai-composer]', MARKER_A)
    check('点击「发送」仍可用', await clickButton(page, '[data-tm-ai-agent-panel]', '发送'))
    check('用户消息进入消息区', await waitForText(page, '[data-tm-ai-messages]', MARKER_A, 8000))

    const bubble = await page.evaluate(() => {
      const host = document.querySelector('[data-tm-ai-messages]')
      const row = document.querySelector('[data-tm-ai-message-row="user"]')
      const card = row?.firstElementChild
      if (!host || !row || !card) return null
      const hr = host.getBoundingClientRect()
      const cr = card.getBoundingClientRect()
      const hcs = getComputedStyle(host)
      const contentLeft = hr.left + parseFloat(hcs.paddingLeft)
      const contentRight = hr.right - parseFloat(hcs.paddingRight)
      return {
        justify: getComputedStyle(row).justifyContent,
        rightGap: Math.round(contentRight - cr.right),
        leftGap: Math.round(cr.left - contentLeft),
        widthRatio: Number((cr.width / (contentRight - contentLeft)).toFixed(3)),
        roleLabels: row.querySelectorAll('.tm-hint').length,
      }
    })
    check('用户气泡右对齐、限宽且不再显示「你 / AI 助手」标签',
      !!bubble && bubble.justify === 'flex-end' && bubble.rightGap <= 2
      && bubble.leftGap > 4 && bubble.widthRatio <= 0.86 && bubble.roleLabels === 0,
      JSON.stringify(bubble))

    const quickClicked = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-ai-quick-reply="继续"]')
      if (!el) return false
      el.click()
      return true
    })
    check('快捷回复项存在且可点击', quickClicked)
    check('快捷回复一键发送到消息区', await waitForText(page, '[data-tm-ai-messages]', QUICK_TEXT, 8000))

    await page.click('[data-tm-ai-input-history-toggle]')
    check('输入历史面板展开且含两条已发送输入',
      await waitFor(page, () => document.querySelectorAll('[data-tm-ai-input-history-item]').length >= 2, 5000))
    const firstTitle = await page.evaluate(() =>
      document.querySelector('[data-tm-ai-input-history-item="0"]')?.getAttribute('title'))
    await page.click('[data-tm-ai-input-history-item="0"]')
    await sleep(300)
    const restored = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-ai-composer]')
      return { value: el?.value, focused: document.activeElement === el }
    })
    check('点击历史项复制回输入框并聚焦光标',
      restored.value === firstTitle && restored.focused,
      JSON.stringify({ firstTitle, ...restored }))

    await page.click('[data-tm-ai-input-history-toggle]')
    await page.click('[data-tm-ai-input-history-clear]')
    check('输入历史可一键清空',
      await waitFor(page, () => document.querySelectorAll('[data-tm-ai-input-history-item]').length === 0, 3000))
    await page.click('[data-tm-ai-input-history-toggle]')

    await clearComposer(page)
    await page.type('[data-tm-ai-composer]', CUSTOM_TEXT)
    await page.click('[data-tm-ai-quick-add]')
    const customAdded = await waitFor(page, () =>
      !!document.querySelector('[data-tm-ai-quick-reply="自定义回复-X"]'), 3000)
    check('当前输入可存为自定义快捷回复且输入框清空',
      customAdded && (await composerMetrics(page)).value === '')

    await page.evaluate(() => document.querySelector('[data-tm-ai-quick-reply="自定义回复-X"]')?.click())
    check('自定义快捷回复同样可一键发送',
      await waitForText(page, '[data-tm-ai-messages]', CUSTOM_TEXT, 8000))
    await page.evaluate(() => document.querySelector('[data-tm-ai-quick-reply-remove="自定义回复-X"]')?.click())
    check('自定义快捷回复可删除',
      await waitFor(page, () => !document.querySelector('[data-tm-ai-quick-reply="自定义回复-X"]'), 3000))

    // 240 窄栏 + 重载：localStorage 里的输入历史必须还在。
    await page.evaluate(() => localStorage.setItem('topomind_left_dock_width_v1', '240'))
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(2200)
    check('240 窄栏下重新打开 AI 面板', await openAgentPanel(page))
    const narrow = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel)
        return el ? { sw: el.scrollWidth, cw: el.clientWidth } : null
      }
      return {
        panel: box('[data-tm-ai-agent-panel]'),
        host: box('[data-tm-ai-composer-host]'),
        chips: box('[data-tm-ai-composer-chips] > div'),
      }
    })
    check('窄栏下面板与输入区无横向溢出',
      narrow.panel.sw <= narrow.panel.cw + 2 && narrow.host.sw <= narrow.host.cw + 2,
      JSON.stringify(narrow))
    check('快捷回复行以横向滚动消化窄栏宽度',
      narrow.chips.sw > narrow.chips.cw,
      JSON.stringify(narrow.chips))

    await page.click('[data-tm-ai-input-history-toggle]')
    check('重载后输入历史仍在（localStorage 持久化）',
      await waitFor(page, () => [...document.querySelectorAll('[data-tm-ai-input-history-item]')]
        .some((el) => (el.getAttribute('title') || '').includes('自定义回复-X')), 5000))

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
    console.log('AI_COMPOSER_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error('AI_COMPOSER_GUI_FAILED', error)
  process.exitCode = 1
})
