/**
 * 「外部粘贴 Markdown 表格源码」GUI 端到端回归。
 *
 * 用法（项目根目录执行，需先 npm run build）：
 *   node scripts/verify-markdown-table-paste-gui.mjs
 *
 * 独立临时工作区 / 独立 Electron profile / 独立 CDP 端口（默认 9243），
 * 绝不使用 9222（WorkBuddy IDE 自身调试端口）。GUI 冒烟不纳入 verify-all，
 * 只在改动粘贴链路后手动跑。
 *
 * 覆盖三种剪贴板来源，断言编辑器里真的出现 BlockNote 表格块
 * （[data-content-type="table"] + th/td），而不是 `| --- | --- |` 源码：
 *   1) 只有 text/plain（md 文件 / AI「复制 markdown」）
 *   2) text/html 是 <pre> 源码外壳 + text/plain
 *   3) text/html 自带渲染好的 <table>（富文本路径不回归）
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_MD_TABLE_CDP_PORT || 9243)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-md-table-paste-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '表格粘贴测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const DOC_FILE = path.join(KB_DIR, 'node-a', '_docs', 'doc_table.tdoc.json')

const TABLE = [
  '| **名称** | 说明 | 数值 |',
  '| :--- | :---: | ---: |',
  '| `拓扑` | **加粗** | 42 |',
  '| 乙 | 普通文本 | 7 |',
].join('\n')

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-md-table-paste-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(WORKDIR, 'kbs'), { recursive: true })
  fs.mkdirSync(path.join(WORKDIR, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    children: { 'node-a': { name: '节点 A', kind: 'knowledge', x: 160, y: 160 } },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')
  const docs = path.join(KB_DIR, 'node-a', '_docs')
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(docs, 'tree.json'), JSON.stringify({
    version: 2,
    documents: {
      doc_table: {
        id: 'doc_table', type: 'smart', title: '表格粘贴测试文档',
        path: 'doc_table.tdoc.json', parentId: null, sortOrder: 0,
      },
    },
  }, null, 2), 'utf8')
  fs.writeFileSync(DOC_FILE, JSON.stringify({
    schema: 'topomind.smart-document', id: 'doc_table', version: 1,
    title: '表格粘贴测试文档', blocks: [], metadata: {},
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
  return waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="node-a"]'), 12000)
}

async function openDocument(page) {
  await page.evaluate(() => document.querySelector('[data-tm-doc-icon="node-a"]')?.click())
  return waitFor(page, () => !!document.querySelector('.bn-editor[contenteditable="true"]'), 12000)
}

/** 每组用例重建隔离工作区并重新打开空文档，避免上一组留下的表格块影响下一组。 */
async function freshDocument(page) {
  setupWorkDir()
  const entered = await enterWorkspace(page)
  return entered && await openDocument(page)
}

async function pastePayload(page, payload) {
  await page.evaluate((data) => {
    const dt = new DataTransfer()
    if (data.html) dt.setData('text/html', data.html)
    if (data.markdown) dt.setData('text/markdown', data.markdown)
    if (data.plain !== undefined) dt.setData('text/plain', data.plain)
    document.querySelector('.bn-editor[contenteditable="true"]')?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, payload)
  await sleep(900)
  return page.evaluate(() => {
    const editor = document.querySelector('.bn-editor[contenteditable="true"]')
    return {
      tables: document.querySelectorAll('[data-content-type="table"]').length,
      th: document.querySelectorAll('[data-content-type="table"] th').length,
      td: document.querySelectorAll('[data-content-type="table"] td').length,
      text: editor?.innerText || '',
    }
  })
}

function assertTable(label, state) {
  check(`${label}：生成表格块且不留 md 源码`,
    state.tables === 1 && state.th === 3 && state.td === 6
    && !state.text.includes('| ---') && !state.text.includes(':---')
    && state.text.includes('拓扑') && state.text.includes('加粗'),
    JSON.stringify(state))
}

async function main() {
  setupWorkDir()
  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  try {
    const page = await findRendererPage(browser)
    check('隔离测试库构造完成', fs.existsSync(DOC_FILE) && fs.existsSync(GRAPH_FILE))
    check('第一组：进入工作空间并打开空文档', await enterWorkspace(page) && await openDocument(page))

    const plain = await pastePayload(page, { plain: TABLE })
    assertTable('纯 text/plain 的 markdown 表格', plain)

    check('第二组：重建空文档', await freshDocument(page))
    const preShell = await pastePayload(page, {
      plain: TABLE,
      html: `<pre><code>${TABLE.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`,
    })
    assertTable('text/html 只是 <pre> 源码外壳', preShell)

    check('第三组：重建空文档', await freshDocument(page))
    const rich = await pastePayload(page, {
      plain: '渲染后的表格',
      html: '<table><thead><tr><th>名称</th><th>说明</th><th>数值</th></tr></thead>'
        + '<tbody><tr><td>甲</td><td>乙</td><td>1</td></tr>'
        + '<tr><td>丙</td><td>丁</td><td>2</td></tr></tbody></table>',
    })
    check('HTML 自带渲染表格时富文本路径仍生成表格块',
      rich.tables === 1 && rich.th === 3 && rich.td === 6,
      JSON.stringify(rich))

    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    if (failed.length) {
      console.log('MARKDOWN_TABLE_PASTE_GUI_FAILED')
      process.exitCode = 1
    } else {
      console.log('MARKDOWN_TABLE_PASTE_GUI_VERIFIED')
    }
  } finally {
    await browser.disconnect()
    if (spawned) spawned.kill()
  }
}

main().catch((error) => {
  console.error('MARKDOWN_TABLE_PASTE_GUI_ERROR', error)
  process.exitCode = 1
})
