/**
 * 「节点关联已有文档」GUI 端到端回归用例。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-linked-documents-gui.mjs
 *
 * 行为：
 *   - 优先连接 http://127.0.0.1:9222 上已有的 Electron 实例（需带 --remote-debugging-port=9222）；
 *     端口不可达时，自行用隔离的 --user-data-dir 启动一个实例，跑完自动关闭。
 *   - 所有数据只写入 <系统临时目录>/tm-gui-e2e/，绝不触碰真实知识库或用户 Electron 配置。
 *   - 每次运行重建一份最小知识库（两节点 + 若干文档），因此可重复执行。
 *
 * 覆盖：右键菜单 → 选择对话框 → 上限 8 → 保存落盘 → 节点链环语义标记 →
 *       一键直达右栏关联视图 → SegmentedControl 切换 → ownerCardPath 写入隔离 →
 *       关联列表 / 在所属节点打开 / 移除关联；以及文档双链：
 *       `[[` 触发选择器 → 行内 chip 落盘 → 点击跨节点打开 → 引用关系上下两栏 →
 *       关系索引二次命中（parsed=0）→ 复制粘贴结构保真。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_CDP_PORT || 9222)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const DOC_A = path.join(KB_DIR, 'node-a', '_docs', 'doc_a.tdoc.json')
const DOC_B = path.join(KB_DIR, 'node-b', '_docs', 'doc_b.tdoc.json')
const MARKER = 'GUI_LINKED_WRITE_MARKER_9527'
const OWN_TITLE = 'A 自身文档'
const LINK_TITLE = 'B 的文档（待关联）'

const results = []
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readGraph = () => JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

/** 每次运行重建隔离测试库：两个顶层节点 + 11 篇候选文档（用于验证上限 8）。 */
function setupWorkDir() {
  if (!ROOT.includes('tm-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of [path.join(WORKDIR, 'kbs'), path.join(WORKDIR, 'logs')]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    children: {
      'node-a': { name: '节点 A', kind: 'knowledge' },
      'node-b': { name: '节点 B', kind: 'knowledge' },
    },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')

  const writeDocs = (nodeId, docs) => {
    const d = path.join(KB_DIR, nodeId, '_docs')
    fs.mkdirSync(d, { recursive: true })
    const manifest = { version: 2, documents: {} }
    docs.forEach(({ id, title }, i) => {
      manifest.documents[id] = { id, type: 'smart', title, path: `${id}.tdoc.json`, parentId: null, sortOrder: i }
      fs.writeFileSync(path.join(d, `${id}.tdoc.json`), JSON.stringify({
        schema: 'topomind.smart-document', id, version: 1, title, blocks: [], metadata: {},
      }, null, 2), 'utf8')
    })
    fs.writeFileSync(path.join(d, 'tree.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  writeDocs('node-a', [{ id: 'doc_a', title: OWN_TITLE }])
  writeDocs('node-b', [
    { id: 'doc_b', title: LINK_TITLE },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `doc_extra_${i}`, title: `备用文档 ${i + 1}` })),
  ])
}

async function cdpReachable() {
  try {
    const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch { return false }
}

async function connectOrLaunch() {
  if (await cdpReachable()) return { browser: null, spawned: null }
  const exe = path.join(process.cwd(), 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron')
  if (!fs.existsSync(exe)) throw new Error('找不到 electron 可执行文件: ' + exe)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // 否则主进程会被当成纯 Node 启动
  const spawned = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
    cwd: process.cwd(), env, stdio: 'ignore', detached: false,
  })
  for (let i = 0; i < 60; i += 1) {
    if (await cdpReachable()) return { browser: null, spawned }
    await sleep(500)
  }
  spawned.kill()
  throw new Error('Electron 调试端口未就绪: ' + CDP_URL)
}

async function waitFor(page, fn, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return true
    await sleep(250)
  }
  return false
}

const clickByDialogText = (page, text) => page.evaluate((text) => {
  const dlg = document.querySelector('[role="dialog"]')
  const btn = dlg && [...dlg.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === text)
  btn?.click()
  return !!btn
}, text)

async function openNodeMenu(page, id) {
  await page.evaluate((id) => {
    const n = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    if (!n) return
    const r = n.getBoundingClientRect()
    n.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, buttons: 2,
      clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2),
    }))
  }, id)
  await sleep(450)
}

async function openLinkDialog(page) {
  await openNodeMenu(page, 'node-a')
  const ok = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) =>
      e.children.length === 0 && (e.textContent || '').trim().startsWith('关联已有文档'))
    const target = el?.closest('button,[role="menuitem"]') || el?.parentElement || el
    target?.click()
    return !!target
  })
  await waitFor(page, () => !!document.querySelector('[role="dialog"]'), 6000)
  return ok
}

async function enterWorkspace(page) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('*')].filter((e) =>
      e.children.length === 0 && (e.textContent || '').includes(name))
    if (els.length) els[0].parentElement?.click()
  }, KB_NAME)
  return waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="node-a"]'), 10000)
}

async function main() {
  setupWorkDir()
  const { spawned } = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null })
  try {
    const page = (await browser.pages()).find((p) => p.url().includes('index.html'))
    if (!page) throw new Error('找不到 renderer 页面')

    check('隔离测试库构造完成', fs.existsSync(DOC_A) && fs.existsSync(DOC_B))
    check('进入工作空间并渲染两个节点', await enterWorkspace(page))

    // ---- 阶段 A：对话框上限 8 ----
    check('右键菜单含「关联已有文档…」', await openLinkDialog(page) &&
      await page.evaluate(() => (document.body.innerText || '').includes('关联已有文档')))
    const dialogInfo = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return dlg ? { text: dlg.innerText || '', candidates: [...dlg.querySelectorAll('button')].filter((b) => (b.innerText || '').includes('\n')).length } : null
    })
    check('对话框列出候选文档与面包屑', !!dialogInfo && dialogInfo.candidates >= 9 &&
      dialogInfo.text.includes(LINK_TITLE) && dialogInfo.text.includes('测试库 / 节点 B'),
      dialogInfo ? `${dialogInfo.candidates} 个候选` : 'dialog missing')

    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      ;[...dlg.querySelectorAll('button')].filter((b) => (b.innerText || '').includes('\n')).forEach((b) => b.click())
    })
    await sleep(500)
    const over = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const save = [...dlg.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '保存')
      return { counter: (dlg.innerText || '').match(/已选 \d+ \/ 8/)?.[0], saveDisabled: !!save?.disabled }
    })
    check('超过 8 篇时保存被禁用（上限保护）', /已选 (9|10|11|12) \/ 8/.test(over.counter || '') && over.saveDisabled,
      `${over.counter}, disabled=${over.saveDisabled}`)
    await clickByDialogText(page, '取消')
    await sleep(500)

    // ---- 阶段 B：保存 1 篇关联 ----
    await openLinkDialog(page)
    await page.evaluate((title) => {
      const dlg = document.querySelector('[role="dialog"]')
      ;[...dlg.querySelectorAll('button')].find((b) => (b.innerText || '').includes(title))?.click()
    }, LINK_TITLE)
    await sleep(400)
    const counter1 = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').match(/已选 \d+ \/ 8/)?.[0])
    check('单选后计数为 已选 1 / 8', counter1 === '已选 1 / 8', counter1)
    await clickByDialogText(page, '保存')
    await sleep(1300)
    const saved = await page.evaluate(() => ({
      closed: !document.querySelector('[role="dialog"]'),
      toast: (document.body.innerText || '').includes('关联已更新'),
    }))
    check('保存后对话框关闭且提示成功', saved.closed && saved.toast)
    const diskAfterSave = readGraph().children
    check('磁盘写入 linkedDocuments 且未污染其它节点',
      diskAfterSave['node-a']?.linkedDocuments?.[0]?.docId === 'doc_b' &&
      diskAfterSave['node-a']?.linkedDocuments?.[0]?.cardRef === `${KB_NAME}/node-b` &&
      diskAfterSave['node-b']?.linkedDocuments === undefined,
      JSON.stringify(diskAfterSave['node-a']?.linkedDocuments))

    // ---- 阶段 C：链环标记与右栏关联视图 ----
    const badge = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('篇关联文档'))
      return { exists: !!b, title: b?.getAttribute('title') || '' }
    })
    check('节点标题前出现可点击链环语义标记', badge.exists && badge.title.includes('1 篇'), badge.title)
    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('title') || '').includes('篇关联文档'))?.click())
    await sleep(1500)
    const linkedView = await page.evaluate(({ link, own }) => ({
      hasLinkedTitle: (document.body.innerText || '').includes(link),
      hasOwnTitle: (document.body.innerText || '').includes(own),
      segmented: [...document.querySelectorAll('button')].filter((b) => /本节点文档|关联文档 ·/.test(b.innerText || '')).map((b) => (b.innerText || '').trim()),
      ownerPath: [...document.querySelectorAll('button')].map((b) => b.getAttribute('title') || '').find((t) => t.includes('在文件管理器中打开')),
      sourceLines: [...document.querySelectorAll('span')].map((s) => (s.innerText || '').trim()).filter((t) => t.startsWith('来源：')),
    }), { link: LINK_TITLE, own: OWN_TITLE })
    check('链环一键直达右栏关联视图', linkedView.hasLinkedTitle && !linkedView.hasOwnTitle &&
      linkedView.segmented.includes('本节点文档') && linkedView.segmented.includes('关联文档 · 1'),
      JSON.stringify(linkedView.segmented))
    check('右栏文档路径指向文档所属节点 node-b',
      (linkedView.ownerPath || '').includes('node-b/_docs/doc_b.tdoc.json'), linkedView.ownerPath)
    check('右栏来源面包屑显示所属节点名而非裸 id',
      linkedView.sourceLines.some((t) => t.includes('测试库 / 节点 B')) &&
      !linkedView.sourceLines.some((t) => t.includes('node-b') || t.includes('来源：测试库 / B')),
      JSON.stringify(linkedView.sourceLines))

    // ---- 阶段 D：ownerCardPath 写入隔离（最关键的回归）----
    const beforeA = sha(DOC_A)
    const editor = await page.$('.bn-editor[contenteditable="true"]')
    check('关联文档编辑器可编辑', !!editor)
    if (editor) {
      await editor.click()
      await page.keyboard.type(MARKER)
      await sleep(1000)
      await page.evaluate(() => document.querySelector('.bn-editor')?.blur?.())
      await sleep(4500)
      const aBody = fs.readFileSync(DOC_A, 'utf8')
      const bBody = fs.readFileSync(DOC_B, 'utf8')
      check('编辑关联文档只写入 node-b，node-a 文件零改动',
        sha(DOC_A) === beforeA && bBody.includes(MARKER) && !aBody.includes(MARKER),
        `A unchanged=${sha(DOC_A) === beforeA}, B has marker=${bBody.includes(MARKER)}`)
      check('正文自描述 id 随写入保持正确',
        JSON.parse(aBody).id === 'doc_a' && JSON.parse(bBody).id === 'doc_b')
    }

    // ---- 阶段 E：视图切换 / 关联列表 / 在所属节点打开 ----
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '本节点文档')?.click())
    await sleep(1100)
    const ownView = await page.evaluate(({ link, own }) => ({
      own: (document.body.innerText || '').includes(own),
      linked: (document.body.innerText || '').includes(link),
    }), { link: LINK_TITLE, own: OWN_TITLE })
    check('切回「本节点文档」只显示自身文档', ownView.own && !ownView.linked)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim().startsWith('关联文档'))?.click())
    await sleep(1100)
    check('切回「关联文档」恢复关联内容',
      await page.evaluate((link) => (document.body.innerText || '').includes(link), LINK_TITLE))

    await page.evaluate(() => {
      if (![...document.querySelectorAll('button')].some((b) => b.getAttribute('title') === '移除关联')) {
        [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '文档')?.click()
      }
    })
    await sleep(700)
    const list = await page.evaluate(() => ({
      remove: [...document.querySelectorAll('button')].some((b) => b.getAttribute('title') === '移除关联'),
      openOwner: [...document.querySelectorAll('button')].some((b) => b.getAttribute('title') === '在所属节点打开'),
      add: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === '添加'),
      sourceLines: [...document.querySelectorAll('span')].map((s) => (s.innerText || '').trim()).filter((t) => t.startsWith('来源：')),
    }))
    check('关联列表侧栏提供添加/在所属节点打开/移除', list.remove && list.openOwner && list.add, JSON.stringify(list))
    check('关联列表来源与右栏一致且显示节点名',
      list.sourceLines.some((t) => t.includes('测试库 / 节点 B')) &&
      !list.sourceLines.some((t) => t.includes('node-b')),
      JSON.stringify(list.sourceLines))

    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '在所属节点打开')?.click())
    await sleep(1300)
    check('「在所属节点打开」跳转到 node-b', await page.evaluate(() =>
      !!document.querySelector('.react-flow__node.selected[data-id="node-b"]')))

    // ---- 阶段 F：移除关联 ----
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const n = document.querySelector('.react-flow__node[data-id="node-a"]')
      const r = n.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      n.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y }))
      n.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: x, clientY: y }))
      n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }))
    })
    await sleep(900)
    await page.evaluate(() => {
      if (![...document.querySelectorAll('button')].some((b) => b.getAttribute('title') === '移除关联')) {
        [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '文档')?.click()
      }
    })
    await sleep(700)
    const removeBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '移除关联')
      b?.click()
      return !!b
    })
    await sleep(1000)
    const afterRemove = await page.evaluate((own) => ({
      badge: [...document.querySelectorAll('button')].some((b) => (b.getAttribute('title') || '').includes('篇关联文档')),
      segmented: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').startsWith('关联文档')),
      own: (document.body.innerText || '').includes(own),
    }), OWN_TITLE)
    check('移除关联后链环/切换控件消失并回到自身文档',
      removeBtn && !afterRemove.badge && !afterRemove.segmented && afterRemove.own, JSON.stringify(afterRemove))
    check('移除关联后磁盘键被删除', readGraph().children['node-a']?.linkedDocuments === undefined)

    // ---- 阶段 G：真实写库入口的分栏序列化往返（历史任务 #58）----
    // file-service.js 依赖 electron 的 shell，纯 Node 回归脚本无法整模块 import，
    // 因此在真实 Electron 里走 IPC 写到磁盘再读回，验证 columnList / column 不被剥掉。
    const columnBody = {
      schema: 'topomind.smart-document', version: 1, title: '分栏回归',
      metadata: { customFlag: { nested: [1, 2, 3] } },
      blocks: [{
        type: 'columnList', id: 'cl-1', props: { gap: 8 }, children: [
          { type: 'column', id: 'c-1', props: { width: 0.5 }, children: [
            { type: 'paragraph', id: 'p-1', content: [{ type: 'text', text: '左栏', styles: {} }] },
          ] },
          { type: 'column', id: 'c-2', props: { width: 0.5 }, children: [] },
        ],
      }],
    }
    const roundTrip = await page.evaluate(async ({ dir, body }) => {
      await window.electronAPI.invoke('fs:writeTopoDocument', dir, '测试库/node-b', 'doc_b', body)
      return window.electronAPI.invoke('fs:readTopoDocument', dir, '测试库/node-b', 'doc_b')
    }, { dir: WORKDIR, body: columnBody })
    check('真实写库入口保留 columnList/column 与扩展字段',
      JSON.stringify(roundTrip?.blocks) === JSON.stringify(columnBody.blocks) &&
      JSON.stringify(roundTrip?.metadata) === JSON.stringify(columnBody.metadata) &&
      roundTrip?.id === 'doc_b',
      `blocks=${JSON.stringify(roundTrip?.blocks) === JSON.stringify(columnBody.blocks)}, id=${roundTrip?.id}`)
    const onDisk = JSON.parse(fs.readFileSync(DOC_B, 'utf8'))
    check('分栏正文落盘后仍完整',
      JSON.stringify(onDisk.blocks) === JSON.stringify(columnBody.blocks) && onDisk.id === 'doc_b')

    // ---- 阶段 H：文档双链（[[ 触发 → 行内 chip → 落盘 → 点击跨节点打开 → 反向链接）----
    await waitFor(page, () => !!document.querySelector('.bn-editor[contenteditable="true"]'), 8000)
    const docLinkEditor = await page.$('.bn-editor[contenteditable="true"]')
    if (docLinkEditor) {
      await docLinkEditor.click()
      await page.keyboard.type('[[')
    }
    check('输入 [[ 弹出全库文档选择器',
      await waitFor(page, () => !!document.querySelector('[data-tm-doc-link-picker]'), 6000))
    // 选择器浮层是 portal 且候选列表异步加载：必须等目标项出现，不能只等浮层挂载。
    check('选择器列出目标文档 doc_b',
      await waitFor(page, () => !!document.querySelector('[data-tm-doc-link-item="doc_b"]'), 9000))
    await page.evaluate(() => document.querySelector('[data-tm-doc-link-item="doc_b"]')?.click())
    await sleep(900)
    const chip = await page.evaluate(() => {
      const el = document.querySelector('.tm-doc-link-chip')
      return { exists: !!el, docId: el?.getAttribute('data-doc-id') || '', text: el?.innerText || '' }
    })
    check('选中后插入行内引用 chip（带稳定 docId）',
      chip.exists && chip.docId === 'doc_b' && chip.text.includes(LINK_TITLE), JSON.stringify(chip))
    await page.evaluate(() => document.querySelector('.bn-editor')?.blur?.())
    await sleep(4500)
    const aBodyAfter = JSON.parse(fs.readFileSync(DOC_A, 'utf8'))
    const aRaw = JSON.stringify(aBodyAfter)
    check('双链引用落盘且只写 docId / 标题快照',
      aRaw.includes('"docLink"') && aRaw.includes('"doc_b"') && aBodyAfter.id === 'doc_a')

    // 直接真跑主进程反向链接 IPC（渲染层 store 之外的一条独立验证）。
    const backlinksFromIpc = await page.evaluate(async (dir) => (
      window.electronAPI.invoke('fs:listDocumentBacklinks', dir, 'doc_b')
    ), WORKDIR)
    check('主进程反向链接 IPC 返回引用者与引用次数',
      Array.isArray(backlinksFromIpc) &&
      backlinksFromIpc.some((item) => item.docId === 'doc_a' && item.references >= 1) &&
      !backlinksFromIpc.some((item) => item.docId === 'doc_b'),
      JSON.stringify(backlinksFromIpc))

    // 关系索引：强制重建时真读正文，二次查询必须完全命中索引（parsed=0）。
    const forceRelations = await page.evaluate(async (dir) => (
      window.electronAPI.invoke('fs:listDocumentRelations', dir, 'doc_b', true)
    ), WORKDIR)
    check('统一查询一次返回入链 / 出链与索引统计',
      Array.isArray(forceRelations?.incoming) && Array.isArray(forceRelations?.outgoing) &&
      forceRelations.incoming.some((item) => item.docId === 'doc_a') &&
      forceRelations.parsed > 0,
      JSON.stringify({ incoming: forceRelations?.incoming?.length, outgoing: forceRelations?.outgoing?.length, parsed: forceRelations?.parsed }))
    check('强制重建时落盘关系索引文件',
      fs.existsSync(path.join(WORKDIR, '.topomind', 'doc-relations.json')))
    const cachedRelations = await page.evaluate(async (dir) => (
      window.electronAPI.invoke('fs:listDocumentRelations', dir, 'doc_b', false)
    ), WORKDIR)
    check('二次查询完全命中索引（parsed=0，不再读全库正文）',
      cachedRelations?.parsed === 0 && cachedRelations?.indexed > 0 &&
      cachedRelations.incoming.some((item) => item.docId === 'doc_a'),
      JSON.stringify({ parsed: cachedRelations?.parsed, indexed: cachedRelations?.indexed }))

    // chip 点击必须按 docId 反查真实归属节点，不能把内容写进当前节点。
    await page.evaluate(() => {
      document.querySelector('.tm-doc-link-chip')?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
      }))
    })
    const openedByChip = await waitFor(page, () => [...document.querySelectorAll('button')]
      .some((b) => (b.getAttribute('title') || '').includes('node-b/_docs/doc_b.tdoc.json')), 9000)
    check('点击 chip 在右栏跨节点打开 doc_b', openedByChip)

    await page.evaluate(() => document.querySelector('[data-tm-backlinks-header]')?.click())
    await sleep(1200)
    const backlinksPanel = await waitFor(page, () => !!document.querySelector('[data-tm-backlinks-panel]'), 6000)
    const backlinkItem = await waitFor(page, () => !!document.querySelector('[data-tm-backlink-item="doc_a"]'), 9000)
    check('「引用了本页」上栏列出引用了 doc_b 的 doc_a', backlinksPanel && backlinkItem)
    check('引用关系页拆成上下两个栏', await page.evaluate(() =>
      !!document.querySelector('[data-tm-relations-incoming]') &&
      !!document.querySelector('[data-tm-relations-outgoing]')))
    check('doc_a 条目确实落在上栏内', await page.evaluate(() =>
      !!document.querySelector('[data-tm-relations-incoming] [data-tm-backlink-item="doc_a"]')))
    await page.evaluate(() => document.querySelector('[data-tm-backlink-item="doc_a"]')?.click())
    await sleep(1600)
    check('反向链接条目跳回引用者 doc_a', await waitFor(page, () => [...document.querySelectorAll('button')]
      .some((b) => (b.getAttribute('title') || '').includes('node-a/_docs/doc_a.tdoc.json')), 9000))

    // 复制/粘贴结构保真：外部 HTML 带 data-doc-id 时必须还原成 docLink 节点，
    // 不能退化成纯文本（DOMPurify 白名单漏一项就会出现这个静默丢失）。
    await waitFor(page, () => !!document.querySelector('.bn-editor[contenteditable="true"]'), 8000)
    const pasteEditor = await page.$('.bn-editor[contenteditable="true"]')
    if (pasteEditor) {
      await pasteEditor.click()
      await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData('text/html', '<span data-inline-content-type="docLink" data-doc-id="doc_extra_0" data-title="备用文档 1">备用文档 1</span>')
        dt.setData('text/plain', '备用文档 1')
        document.querySelector('.bn-editor')?.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt, bubbles: true, cancelable: true,
        }))
      })
      await sleep(900)
      check('粘贴含 data-doc-id 的引用 HTML 后仍是可点击 chip', await page.evaluate(() =>
        !!document.querySelector('.tm-doc-link-chip[data-doc-id="doc_extra_0"]')))
    }

    // 跳回 doc_a 后打开引用关系页：下栏「本页引用了」必须列出 doc_a 正文里的目标。
    await page.evaluate(() => document.querySelector('[data-tm-backlinks-header]')?.click())
    await sleep(1300)
    check('「本页引用了」下栏列出 doc_a 引用的 doc_b', await waitFor(page, () =>
      !!document.querySelector('[data-tm-relations-outgoing] [data-tm-outgoing-item="doc_b"]'), 9000))
    check('下栏条目状态可点击（目标文档仍存在）', await page.evaluate(() => {
      const item = document.querySelector('[data-tm-relations-outgoing] [data-tm-outgoing-item="doc_b"]')
      return !!item && !item.hasAttribute('disabled')
    }))
    await page.evaluate(() => document.querySelector('[data-tm-relations-outgoing] [data-tm-outgoing-item="doc_b"]')?.click())
    await sleep(1600)
    check('下栏条目按 docId 跳回目标文档 doc_b', await waitFor(page, () => [...document.querySelectorAll('button')]
      .some((b) => (b.getAttribute('title') || '').includes('node-b/_docs/doc_b.tdoc.json')), 9000))
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
    console.log('LINKED_DOCUMENTS_GUI_VERIFIED')
  }
}

main().catch((e) => {
  console.error('GUI_VERIFY_ERROR', e)
  process.exitCode = 1
})
