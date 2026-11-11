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
 *       关系索引二次命中（parsed=0）→ 复制粘贴结构保真；顶部工具栏：
 *       右侧按钮折叠/展开往返 → 高度收缩、正文变高、偏好落盘；样式迁移：
 *       「样式」浮层 10 类设置齐全 → 改字号/套预设写进 _config.json → 折叠态仍可打开
 *       → 右栏只剩指引；以及连线关系（两类语义迁移后）：右栏打开「连线关系」→
 *       恰好 related/subordinate 两项、自定义关系新增入口已移除 →
 *       改名以稳定 id 落盘、标签开关写进 _config.json。
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

/** 每次运行重建隔离测试库：两个顶层节点 + 15 篇候选文档（含一棵三层的节点内文档树）。 */
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
      // 阶段 K 的语义缩放树：1 根 / 2 个一级 / 1 个三级 + 2 个游离。
      // 树节点 4 / 总 8 = 50% 覆盖，应自动启用 LOD；位置放在右下空白区，
      // 既在视口内（便于断言 DOM 显隐），又不遮挡 node-a 的右键菜单。
      'lod-root': { name: 'LOD 树根', kind: 'knowledge', x: 60, y: 360 },
      // depth 1 / 2 的**全部**节点默认永久显示（30% 也在），彼此拉开距离，
      // 才能同时验证「两层全部保留」与「可见卡片零重叠」。
      'lod-c1': { name: 'LOD 一级 A', kind: 'knowledge', x: 60, y: 660 },
      'lod-c2': { name: 'LOD 一级 B', kind: 'knowledge', x: 700, y: 700 },
      // depth 3 非永久显示：故意贴着树根制造真实重合，
      // 端到端验证「紧凑到重叠就渐隐」把非保护节点抽掉。
      'lod-g1': { name: 'LOD 三级', kind: 'knowledge', x: 130, y: 405 },
      'lod-free1': { name: 'LOD 游离 1', kind: 'knowledge', x: 300, y: 360 },
      'lod-free2': { name: 'LOD 游离 2', kind: 'knowledge', x: 300, y: 560 },
    },
    edges: [
      { id: 'lod-e1', source: 'lod-root', target: 'lod-c1', relation: 'subordinate', weight: 'main' },
      { id: 'lod-e2', source: 'lod-root', target: 'lod-c2', relation: 'subordinate', weight: 'main' },
      { id: 'lod-e3', source: 'lod-c1', target: 'lod-g1', relation: 'subordinate', weight: 'main' },
      { id: 'lod-e4', source: 'lod-free1', target: 'lod-free2', relation: 'related', weight: 'minor' },
    ], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')

  const writeDocs = (nodeId, docs) => {
    const d = path.join(KB_DIR, nodeId, '_docs')
    fs.mkdirSync(d, { recursive: true })
    const manifest = { version: 2, documents: {} }
    docs.forEach(({ id, title, parentId = null }, i) => {
      manifest.documents[id] = { id, type: 'smart', title, path: `${id}.tdoc.json`, parentId, sortOrder: i }
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
    // 节点内文档树 + 同名文档：一篇在顶层、一篇在「需求分组 / 子分组」下，
    // 只有节点内路径能区分引用的是哪一篇（本次需求的消歧场景）。
    { id: 'doc_group', title: '需求分组' },
    { id: 'doc_sub', title: '子分组', parentId: 'doc_group' },
    { id: 'doc_nested', title: LINK_TITLE, parentId: 'doc_sub' },
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

// CDP 的 Input.dispatchMouseEvent 偶发超时（历史上多次在滚轮步骤抖动，非断言失败）。
// 优先用真实滚轮；超时就退回同参数的合成 WheelEvent —— 依然走画布捕获阶段的
// 阻尼钳制 / rAF 逐帧派发 / d3-zoom 全链路，断言语义不变，避免整轮 GUI 白跑。
async function wheelOnPane(page, deltaY, x = 500, y = 750) {
  if (typeof page.mouse.wheel === 'function') {
    try {
      await page.mouse.wheel({ deltaY })
      return
    } catch (error) {
      console.log(`[wheel fallback] ${String(error).slice(0, 140)}`)
    }
  }
  await page.evaluate(({ deltaY, x, y }) => {
    document.querySelector('.react-flow__pane')?.dispatchEvent(new WheelEvent('wheel', {
      deltaY, bubbles: true, cancelable: true, clientX: x, clientY: y,
    }))
  }, { deltaY, x, y })
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

    // 节点内文档树路径：同名文档消歧 + 按路径检索（本次需求）。
    const candidateRows = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return [...(dlg?.querySelectorAll('[data-tm-link-document-id]') ?? [])].map((b) => ({
        docId: b.getAttribute('data-tm-link-document-id') || '',
        path: b.getAttribute('data-tm-link-document-path') || '',
        text: b.innerText || '',
      }))
    })
    const nestedRow = candidateRows.find((r) => r.docId === 'doc_nested')
    const topRow = candidateRows.find((r) => r.docId === 'doc_b')
    const sameTitleRows = candidateRows.filter((r) => r.text.split('\n')[0]?.trim() === LINK_TITLE)
    check('节点关联对话框显示节点内文档树路径',
      !!nestedRow && nestedRow.path === '需求分组 / 子分组' && nestedRow.text.includes('↳ 需求分组 / 子分组'),
      JSON.stringify(nestedRow))
    check('同名文档可用节点内路径区分（顶层无路径 / 嵌套有路径）',
      sameTitleRows.length === 2 && !!topRow && topRow.path === '' && !topRow.text.includes('↳') &&
      !!nestedRow && nestedRow.path !== '',
      JSON.stringify(sameTitleRows.map((r) => `${r.docId}:${r.path}`)))
    check('节点面包屑与节点内路径同时展示',
      !!nestedRow && nestedRow.text.includes('测试库 / 节点 B'), JSON.stringify(nestedRow?.text))

    const setDialogQuery = (value) => page.evaluate((next) => {
      const input = document.querySelector('[role="dialog"] input')
      if (!input) return
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, next)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    // 用完整的多级路径做关键字：它不是任何文档标题，只有 documentPathLabel 能命中。
    await setDialogQuery('需求分组 / 子分组')
    await sleep(450)
    const byPath = await page.evaluate(() => [
      ...(document.querySelector('[role="dialog"]')?.querySelectorAll('[data-tm-link-document-id]') ?? []),
    ].map((b) => b.getAttribute('data-tm-link-document-id') || ''))
    check('可按节点内文档路径检索候选',
      byPath.includes('doc_nested') && !byPath.includes('doc_b') && !byPath.includes('doc_group'),
      JSON.stringify(byPath))
    await setDialogQuery('')
    await sleep(450)

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
    const overCount = Number((over.counter || '').match(/已选 (\d+) \/ 8/)?.[1] || 0)
    check('超过 8 篇时保存被禁用（上限保护）', overCount > 8 && over.saveDisabled,
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
    // 编辑器 `[[` 选择器与节点关联对话框共用同一份候选数据，也必须显示节点内路径。
    const pickerRows = await page.evaluate(() => [
      ...document.querySelectorAll('[data-tm-doc-link-item]'),
    ].map((el) => ({
      docId: el.getAttribute('data-tm-doc-link-item') || '',
      path: el.getAttribute('data-tm-doc-link-path') || '',
      text: el.innerText || '',
    })))
    const pickerNested = pickerRows.find((r) => r.docId === 'doc_nested')
    const pickerTop = pickerRows.find((r) => r.docId === 'doc_b')
    const pickerSameTitle = pickerRows.filter((r) => r.text.split('\n')[0]?.trim() === LINK_TITLE)
    check('编辑器引用选择器显示节点内文档树路径',
      !!pickerNested && pickerNested.path === '需求分组 / 子分组' &&
      pickerNested.text.includes('↳ 需求分组 / 子分组') && pickerNested.text.includes('测试库 / 节点 B'),
      JSON.stringify(pickerNested))
    check('编辑器引用选择器同样能区分同名文档',
      !!pickerTop && pickerTop.path === '' && !!pickerNested && pickerNested.path !== '' &&
      pickerSameTitle.length === 2,
      JSON.stringify(pickerSameTitle.map((r) => `${r.docId}:${r.path}`)))
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

    // ===== 阶段 I：顶部工具栏折叠/展开 =====
    await sleep(600)
    const toolbarReady = await waitFor(page, () => !!document.querySelector('[data-tm-editor-top-toolbar-toggle]'), 8000)
    // 隔离 profile 可能复用上一次的折叠偏好，先归一到展开态再验证往返
    await page.evaluate(() => {
      const bar = document.querySelector('[data-tm-editor-top-toolbar]')
      if (bar?.getAttribute('data-collapsed') === 'true') {
        document.querySelector('[data-tm-editor-top-toolbar-toggle]')?.click()
      }
    })
    const expandedReady = await waitFor(page, () =>
      document.querySelector('[data-tm-editor-top-toolbar]')?.getAttribute('data-collapsed') === 'false', 5000)
    const readToolbar = () => page.evaluate(() => {
      const bar = document.querySelector('[data-tm-editor-top-toolbar]')
      const toggle = document.querySelector('[data-tm-editor-top-toolbar-toggle]')
      const content = bar?.querySelector('.tm-editor-top-toolbar__content')
      const styleTrigger = bar?.querySelector('[data-tm-editor-style-trigger]')
      const scroller = document.querySelector('.tm-smart-editor-scroll')
      if (!bar || !toggle || !content) return null
      const barRect = bar.getBoundingClientRect()
      const toggleRect = toggle.getBoundingClientRect()
      return {
        collapsed: bar.getAttribute('data-collapsed'),
        height: Math.round(barRect.height),
        toggleOnRight: toggleRect.left > barRect.left + barRect.width / 2 && toggleRect.right <= barRect.right + 1,
        controlsVisible: getComputedStyle(content).visibility === 'visible',
        styleVisible: !!styleTrigger && getComputedStyle(styleTrigger).display !== 'none',
        hasNumbering: !!bar.querySelector('[aria-label="自动编号"]'),
        scrollerHeight: Math.round(scroller?.getBoundingClientRect().height ?? 0),
        stored: localStorage.getItem('topomind_editor_top_toolbar_collapsed'),
        ariaExpanded: toggle.getAttribute('aria-expanded'),
      }
    })
    await sleep(300)
    const expandedToolbar = await readToolbar()
    check('顶部工具栏默认展开且折叠按钮在右侧', toolbarReady && expandedReady && !!expandedToolbar
      && expandedToolbar.collapsed === 'false' && expandedToolbar.height >= 34 && expandedToolbar.height <= 38
      && expandedToolbar.toggleOnRight && expandedToolbar.controlsVisible
      && expandedToolbar.hasNumbering && expandedToolbar.ariaExpanded === 'true', JSON.stringify(expandedToolbar))

    await page.evaluate(() => document.querySelector('[data-tm-editor-top-toolbar-toggle]')?.click())
    const didCollapse = await waitFor(page, () =>
      document.querySelector('[data-tm-editor-top-toolbar]')?.getAttribute('data-collapsed') === 'true', 5000)
    await sleep(320)
    const collapsedToolbar = await readToolbar()
    check('点击右侧按钮后工具栏折叠（高度归零 / 不留控件条 / 仅留展开按钮 / 偏好落盘）', didCollapse && !!collapsedToolbar
      && collapsedToolbar.height >= 0 && collapsedToolbar.height <= 2 && !collapsedToolbar.controlsVisible
      && !collapsedToolbar.styleVisible && collapsedToolbar.ariaExpanded === 'false' && collapsedToolbar.stored === 'true'
      && collapsedToolbar.toggleOnRight, JSON.stringify(collapsedToolbar))
    check('折叠后正文滚动区确实多出垂直空间', !!expandedToolbar && !!collapsedToolbar
      && collapsedToolbar.scrollerHeight > expandedToolbar.scrollerHeight,
      `${expandedToolbar?.scrollerHeight} → ${collapsedToolbar?.scrollerHeight}`)

    await page.evaluate(() => document.querySelector('[data-tm-editor-top-toolbar-toggle]')?.click())
    const didExpand = await waitFor(page, () =>
      document.querySelector('[data-tm-editor-top-toolbar]')?.getAttribute('data-collapsed') === 'false', 5000)
    await sleep(320)
    const restoredToolbar = await readToolbar()
    check('再次点击恢复展开且控件仍可用', didExpand && !!restoredToolbar
      && restoredToolbar.height >= 34 && restoredToolbar.height <= 38 && restoredToolbar.controlsVisible
      && restoredToolbar.hasNumbering && restoredToolbar.stored === 'false', JSON.stringify(restoredToolbar))

    // ===== 阶段 I-2：编辑器样式设置迁到顶部工具栏 =====
    await page.evaluate(() => document.querySelector('[data-tm-editor-style-trigger]')?.click())
    const stylePopoverReady = await waitFor(page, () => !!document.querySelector('[data-tm-editor-style-popover]'), 6000)
    const expectedStyleFields = [
      'fontSize', 'fontFamily', 'lineHeight', 'letterSpacing', 'fontWeight',
      'headingSpacingRatio', 'blockSpacing', 'textColor', 'backgroundColor', 'paperBackground',
    ]
    const styleFieldInfo = await page.evaluate(() => {
      const pop = document.querySelector('[data-tm-editor-style-popover]')
      if (!pop) return { fields: [], presets: 0, papers: 0, inBody: false }
      return {
        fields: [...pop.querySelectorAll('[data-tm-editor-style-field]')].map((el) => el.getAttribute('data-tm-editor-style-field')),
        presets: pop.querySelectorAll('[data-tm-editor-style-preset]').length,
        papers: pop.querySelectorAll('[data-tm-editor-style-paper]').length,
        inBody: pop.parentElement === document.body,
      }
    })
    check('顶部工具栏「样式」浮层打开且 10 类设置项齐全', stylePopoverReady
      && expectedStyleFields.every((field) => styleFieldInfo.fields.includes(field)), JSON.stringify(styleFieldInfo.fields))
    check('风格预设 3 个与纸张 6 种都迁到浮层', styleFieldInfo.presets === 3 && styleFieldInfo.papers === 6,
      `presets=${styleFieldInfo.presets}, papers=${styleFieldInfo.papers}`)
    check('浮层 portal 到 body（不被工具栏 overflow 裁剪）', styleFieldInfo.inBody)

    // 改字号：原生 setter + input 事件驱动 React onChange，blur 触发一次提交
    await page.evaluate(() => {
      const input = document.querySelector('[data-tm-editor-style-popover] [data-tm-editor-style-field="fontSize"] input[type="number"]')
      if (!input) return
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '19')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.blur()
    })
    const configPathForStyle = path.join(WORKDIR, '_config.json')
    let fontSizeWritten = false
    for (let attempt = 0; attempt < 20 && !fontSizeWritten; attempt += 1) {
      try {
        const config = JSON.parse(fs.readFileSync(configPathForStyle, 'utf8'))
        fontSizeWritten = config.defaultEditorStyle?.fontSize === 19
      } catch { /* 写盘尚未完成 */ }
      if (!fontSizeWritten) await sleep(200)
    }
    check('浮层改字号一次提交即写进工作区 _config.json', fontSizeWritten)
    check('编辑器正文 CSS 变量随配置实时更新', await waitFor(page, () => {
      const el = document.querySelector('[style*="--topomind-smart-body-font-size"]')
      return !!el && el.style.getPropertyValue('--topomind-smart-body-font-size').trim() === '19px'
    }, 6000))

    await page.evaluate(() => document.querySelector('[data-tm-editor-style-preset="护眼"]')?.click())
    let presetWritten = false
    for (let attempt = 0; attempt < 20 && !presetWritten; attempt += 1) {
      try {
        const config = JSON.parse(fs.readFileSync(configPathForStyle, 'utf8'))
        presetWritten = config.defaultEditorStyle?.backgroundColor === '#f7f3e8'
          && config.defaultEditorStyle?.fontSize === 16
      } catch { /* 写盘尚未完成 */ }
      if (!presetWritten) await sleep(200)
    }
    check('风格预设一键套用整套样式并落盘', presetWritten)

    await page.keyboard.press('Escape')
    check('Esc 关闭样式浮层', await waitFor(page, () => !document.querySelector('[data-tm-editor-style-popover]'), 4000))

    await page.evaluate(() => document.querySelector('[data-tm-editor-top-toolbar-toggle]')?.click())
    await sleep(320)
    await page.evaluate(() => document.querySelector('[data-tm-editor-style-trigger]')?.click())
    check('工具栏折叠态下「样式」入口仍可打开', await waitFor(page, () => !!document.querySelector('[data-tm-editor-style-popover]'), 5000))
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.querySelector('[data-tm-editor-top-toolbar-toggle]')?.click())
    await sleep(320)

    // ===== 阶段 J：连线关系管理（全局 _config.json） =====
    await page.evaluate(() => {
      const group = document.querySelector('[role="radiogroup"][aria-label="右侧面板分区"]')
      const button = Array.from(group?.querySelectorAll('button') ?? [])
        .find((item) => item.textContent?.trim() === '样式')
      button?.click()
    })
    await sleep(500)
    // 右栏「文档编辑器」分区入口已整体移除：编辑器样式设置全部在顶部工具栏「样式」浮层
    const editorTabExists = await page.evaluate(() => {
      const group = document.querySelector('[role="radiogroup"][aria-label="样式面板分区"]')
      return Array.from(group?.querySelectorAll('button') ?? [])
        .some((item) => item.textContent?.trim() === '文档编辑器')
    })
    check('右栏「文档编辑器」入口已移除', editorTabExists === false)
    check('右栏迁移指引已移除', await page.evaluate(
      () => !document.querySelector('[data-tm-editor-style-migrated-hint]'),
    ))

    await page.evaluate(() => {
      const group = document.querySelector('[role="radiogroup"][aria-label="样式面板分区"]')
      const button = Array.from(group?.querySelectorAll('button') ?? [])
        .find((item) => item.textContent?.trim() === '连线关系')
      button?.click()
    })
    check('右栏「连线关系」管理面板可打开', await waitFor(page, () =>
      !!document.querySelector('[data-tm-edge-relations-panel]'), 8000))
    // 【用户决策 2026-11-08】关系物理收敛为两类，自定义关系 CRUD 已彻底删除。
    check('内置恰好两种连线关系（关联/从属）', await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-tm-edge-relation-item]')]
      const ids = items.map((item) => item.getAttribute('data-tm-edge-relation-item'))
      return items.length === 2
        && ids.includes('related') && ids.includes('subordinate')
        && !ids.some((id) => /^rel_/.test(id || ''))
    }))
    check('自定义关系新增入口已移除', await page.evaluate(
      () => !document.querySelector('[data-tm-edge-relation-add]')
        && !document.querySelector('[data-tm-edge-relation-new-name]')))
    check('必选关系浮层默认不显示', await page.evaluate(
      () => !document.querySelector('[data-tm-edge-relation-picker]')))

    // 受控输入要用原生 setter + input 事件，直接赋值不会触发 React onChange。
    // 改名内置关系：id 恒定，不能生成 rel_* 之类新 id。
    await page.evaluate(() => {
      const input = document.querySelector('[data-tm-edge-relation-name]')
      if (!input) return
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '关联关系测试')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.keyboard.press('Enter')
    check('改名后面板显示新名称', await waitFor(page, () =>
      [...document.querySelectorAll('[data-tm-edge-relation-item]')]
        .some((item) => (item.textContent || '').includes('关联关系测试')), 8000))

    const configPath = path.join(WORKDIR, '_config.json')
    let relationWritten = false
    for (let attempt = 0; attempt < 20 && !relationWritten; attempt += 1) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        relationWritten = Array.isArray(config.edgeRelations)
          && config.edgeRelations.length === 2
          && config.edgeRelations.some((item) => item.id === 'related' && item.name === '关联关系测试')
          && !config.edgeRelations.some((item) => /^rel_/.test(item.id))
      } catch { /* 写盘尚未完成 */ }
      if (!relationWritten) await sleep(200)
    }
    check('内置关系改名以稳定 id 写进工作区 _config.json（无自定义项）', relationWritten)

    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-tm-edge-relations-panel] button')]
      buttons.find((item) => item.textContent?.trim() === '隐藏')?.click()
    })
    let labelToggleWritten = false
    for (let attempt = 0; attempt < 20 && !labelToggleWritten; attempt += 1) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        labelToggleWritten = config.showEdgeRelationLabels === false
      } catch { /* 写盘尚未完成 */ }
      if (!labelToggleWritten) await sleep(200)
    }
    check('关系标签显隐开关写进工作区 _config.json', labelToggleWritten)

    // ===== 阶段 K：语义缩放 LOD（镜头档位 / 树根保护 / 游离先隐藏 / pin） =====
    // 测试库初始图是一棵合规树（4 树节点 + 2 游离 + 2 原有节点 = 50% 覆盖）。
    // 先用空白点击清掉选中态，避免「选中节点始终可见」干扰隐藏断言。
    await page.mouse.click(500, 800)
    await sleep(250)
    const lodFull = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return {
        exists: !!el,
        tier: el?.getAttribute('data-tm-lod-tier'),
        active: el?.getAttribute('data-tm-lod-active'),
        pressure: el?.getAttribute('data-tm-lod-pressure'),
        samples: Number(el?.getAttribute('data-tm-lod-pressure-samples') ?? '0'),
        text: el?.textContent || '',
        ids: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')),
        collapsedTotal: Number(el?.getAttribute('data-tm-lod-collapsed-total') ?? '0'),
        badgeCount: document.querySelectorAll('[data-tm-lod-collapse-badge]').length,
      }
    })
    check('几何重叠压力在真实布局上生效（不是恒等退回）',
      lodFull.pressure === 'on' && lodFull.samples >= 3,
      JSON.stringify({ pressure: lodFull.pressure, samples: lodFull.samples }))
    check('画布存在镜头 LOD 控件且完整档启用',
      lodFull.exists && lodFull.tier === '0' && lodFull.active === 'true',
      JSON.stringify({ tier: lodFull.tier, active: lodFull.active, text: lodFull.text.slice(0, 60) }))
    check('完整档下树根 / 深层 / 游离节点全部渲染',
      ['lod-root', 'lod-c1', 'lod-g1', 'lod-free1', 'node-a'].every((id) => lodFull.ids.includes(id)),
      JSON.stringify(lodFull.ids))
    check('100% 全图可见时没有折叠徽标，控件合计为 0',
      lodFull.badgeCount === 0 && lodFull.collapsedTotal === 0,
      JSON.stringify({ badgeCount: lodFull.badgeCount, collapsedTotal: lodFull.collapsedTotal }))

    // 真实滚轮缩小：单格已阻尼 + 逐帧缓动（约 240ms 滑过去），逐格采样可见节点数验证「平滑」。
    // 新节奏按累计节点数铺阈值，深层 3 级不再在跨 70% 的一瞬收起，所以采样要一直
    // 做到「3 级确实收起」为止，而不是停在刚进 2 档的那一格。
    await page.mouse.move(500, 750)
    let smallTier = '0'
    let deepCollapsed = false
    const visibleCounts = []
    const depthSteps = []
    const pressureStates = []
    const collapseSteps = []
    const overlapSteps = []
    const chainSteps = []
    const collisionStates = []
    // 【默认永久显示 2 层后】depth 3 会在 80% 左右就收起，不能再拿它当「滚够了」的
    // 终止条件（否则只采 2 格，单调 / 零重叠 / 压力节奏全都没有足够样本）。
    // 固定滚 6 格到远景区间，覆盖完整退场序列。
    for (let i = 0; i < 6; i += 1) {
      await wheelOnPane(page, 220)
      await sleep(320)
      const sample = await page.evaluate(() => {
        const el = document.querySelector('[data-tm-lod-control]')
        const badges = [...document.querySelectorAll('[data-tm-lod-collapse-badge]')].map((badge) => {
          const id = badge.getAttribute('data-tm-lod-collapse-badge') || ''
          return {
            id,
            count: Number(badge.getAttribute('data-tm-lod-collapse-count') ?? '0'),
            opacity: Number(getComputedStyle(badge).opacity),
            pointerEvents: getComputedStyle(badge).pointerEvents,
            visible: !!document.querySelector(`.react-flow__node[data-id="${id}"]`),
          }
        })
        const glyphRects = [...document.querySelectorAll('.react-flow__node')].map((node) => {
          const layer = node.querySelector('[data-tm-glyph-layer]')
          const anchor = node.querySelector('[data-tm-card-anchor]')
          if (!layer || !anchor) return null
          const r = layer.getBoundingClientRect()
          const a = anchor.getBoundingClientRect()
          return { id: node.getAttribute('data-id') || '', left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, aw: a.width, ah: a.height }
        }).filter(Boolean)
        let overlapPairs = 0
        for (let x = 0; x < glyphRects.length; x += 1) {
          for (let y = x + 1; y < glyphRects.length; y += 1) {
            const p = glyphRects[x], q = glyphRects[y]
            if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) overlapPairs += 1
          }
        }
        return {
          overlapPairs,
          visibleIds: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id') || ''),
          glyphRects: glyphRects.map((r) => ({ id: r.id, w: Math.round(r.w), h: Math.round(r.h), aw: Math.round(r.aw), ah: Math.round(r.ah) })),
          tier: el?.getAttribute('data-tm-lod-tier') ?? '0',
          count: Number(el?.getAttribute('data-tm-lod-visible-count') ?? '0'),
          pressure: el?.getAttribute('data-tm-lod-pressure') ?? '',
          collapsedTotal: Number(el?.getAttribute('data-tm-lod-collapsed-total') ?? '0'),
          collapsedFree: Number(el?.getAttribute('data-tm-lod-collapsed-free') ?? '0'),
          collision: el?.getAttribute('data-tm-lod-collision') ?? '',
          collisionHidden: Number(el?.getAttribute('data-tm-lod-collision-hidden') ?? '0'),
          guard: Number(el?.getAttribute('data-tm-lod-collision-guard') ?? '0'),
          badges,
          levels: [...document.querySelectorAll('[data-tm-depth-level]')].map((item) => ({
            depth: Number(item.getAttribute('data-tm-depth-level')),
            visible: Number(item.getAttribute('data-tm-depth-visible')),
            total: Number(item.getAttribute('data-tm-depth-total')),
          })),
        }
      })
      smallTier = sample.tier
      visibleCounts.push(sample.count)
      depthSteps.push(sample.levels)
      pressureStates.push(sample.pressure)
      collapseSteps.push(sample)
      overlapSteps.push(sample.overlapPairs)
      chainSteps.push(sample.visibleIds)
      collisionStates.push({ on: sample.collision, hidden: sample.collisionHidden, guard: sample.guard })
      const l3 = sample.levels.find((item) => item.depth === 3)
      deepCollapsed = !!l3 && l3.visible < l3.total
    }
    check('缩小画布进入 2/3 档（镜头拉近 / 远离）', Number(smallTier) >= 2, `tier=${smallTier}`)
    const lodSmall = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return {
        ids: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')),
        active: el?.getAttribute('data-tm-lod-active'),
        visibleCount: Number(el?.getAttribute('data-tm-lod-visible-count') ?? '0'),
        text: el?.textContent || '',
      }
    })
    check('缩小后树根永不隐藏，节点按连续阈值渐进隐藏',
      lodSmall.ids.includes('lod-root') && lodSmall.visibleCount > 1 && lodSmall.visibleCount < 8,
      JSON.stringify({ ids: lodSmall.ids, visibleCount: lodSmall.visibleCount }))
    check('缩放过程中可见节点数单调下降且不成批消失',
      visibleCounts.every((count, i) => i === 0 || count <= visibleCounts[i - 1])
      && visibleCounts.every((count, i) => i === 0 || visibleCounts[i - 1] - count <= 3)
      && new Set(visibleCounts).size >= 3,
      JSON.stringify(visibleCounts))
    check('控件显示树覆盖率与隐藏计数', /树覆盖 50%/.test(lodSmall.text) && /隐藏 \d+ 节点/.test(lodSmall.text),
      lodSmall.text.replace(/\s+/g, ' ').slice(0, 90))

    // 【P0 方向铁律，2026-11-09】用户报「缩小的时候树的主干先消失」。
    // 面板逐深度的「可见/总数」必须证明：深层 3 级先归零、一级主干仍全在。
    const depthPanel = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-depth-panel]')
      return {
        exists: !!el,
        maxDepth: el?.getAttribute('data-tm-lod-tree-max-depth') || '',
        rootCount: el?.getAttribute('data-tm-lod-root-count') || '',
        text: el?.textContent || '',
      }
    })
    check('左上角面板显示层级诊断（最大深度 / 树根 / 每级可见数）',
      depthPanel.exists && depthPanel.maxDepth === '3' && depthPanel.rootCount === '1'
      && /1级 \d+\/\d+/.test(depthPanel.text) && /3级 \d+\/\d+/.test(depthPanel.text),
      JSON.stringify(depthPanel))
    // 【P1.9 碰撞硬约束】P0 把视觉壳钉在屏幕尺寸上，密集布局缩小时会真的压在一起
    // （改密集布局前实测逐档为 [0,1,2,2,2]）。逐档用真实 getBoundingClientRect 验证
    // 「主干紧凑到重叠 → 相对边缘节点渐隐」把重叠彻底消掉，而不是只看隐藏计数。
    const LOD_PARENTS = { 'lod-c1': 'lod-root', 'lod-c2': 'lod-root', 'lod-g1': 'lod-c1' }
    const chainIntact = (ids) => Object.entries(LOD_PARENTS)
      .every(([child, parent]) => !ids.includes(child) || ids.includes(parent))
    const chainBrokenAt = chainSteps.findIndex((ids) => !chainIntact(ids))
    check('缩放全程可见卡片两两不重叠（紧凑到重叠就渐隐）',
      overlapSteps.length >= 3 && overlapSteps.every((pairs) => pairs === 0),
      JSON.stringify(overlapSteps))
    check('缩放全程不会出现「子节点可见、父节点已隐藏」的断链', chainBrokenAt === -1,
      JSON.stringify({ chainBrokenAt, chainSteps }))
    // 几何抽稀（谁挤在一起谁先退）与按 depth 的退场计数是两条正交维度：
    // 不同分支的一级主干可能因为贴着树根先被抽稀、远处深叶仍留，这不算断链；
    // 但树根恒定、父子链完整、单步小量三条铁律不能破。
    const deepCollapseIndex = depthSteps.findIndex((levels) => {
      const l3 = levels.find((item) => item.depth === 3)
      return !!l3 && l3.visible < l3.total
    })
    check('深层 3 级收起时树根仍可见、且该格没有父子断链',
      deepCollapseIndex >= 0 && !!chainSteps[deepCollapseIndex]
      && chainSteps[deepCollapseIndex].includes('lod-root')
      && chainIntact(chainSteps[deepCollapseIndex]),
      JSON.stringify({ deepCollapseIndex, ids: chainSteps[deepCollapseIndex] }))
    check('碰撞约束在远景平滑启用并真的抽稀了重叠节点',
      collisionStates.some((state) => state.on === 'on' && state.hidden > 0 && state.guard > 0),
      JSON.stringify(collisionStates))
    check('隐藏摊到多格而不是集中在一两格（前期不空转、后期不骤降）',
      visibleCounts.filter((count, i) => i > 0 && visibleCounts[i - 1] - count > 0).length >= 3,
      JSON.stringify(visibleCounts))
    check('缩放全程几何压力持续生效（渐隐节奏跟着布局走）',
      pressureStates.length >= 3 && pressureStates.every((state) => state === 'on'),
      JSON.stringify(pressureStates))
    // 【P1.75】主干上要能读出「底下收了多少」，且计数不能在祖先链上重复。
    const collapseBrief = collapseSteps.map((s) => ({
      count: s.count, total: s.collapsedTotal, free: s.collapsedFree,
      badges: s.badges.map((b) => `${b.id}:+${b.count}`),
    }))
    check('缩小时主干出现 +N 折叠徽标（不是把节点悄悄藏掉）',
      collapseSteps.some((s) => s.badges.some((b) => b.count > 0)),
      JSON.stringify(collapseBrief))
    check('徽标只挂在可见节点上，各卡片计数之和恰等于控件合计',
      collapseSteps.every((s) => s.badges.every((b) => b.visible && b.count > 0)
        && s.badges.reduce((sum, b) => sum + b.count, 0) === s.collapsedTotal),
      JSON.stringify(collapseBrief))
    check('折叠计数守恒（已折叠 + 游离收起 = 隐藏数）且随缩小单调不减',
      collapseSteps.every((s, i) => s.collapsedTotal + s.collapsedFree === 8 - s.count
        && (i === 0 || s.collapsedTotal >= collapseSteps[i - 1].collapsedTotal)),
      JSON.stringify(collapseBrief))
    check('徽标随镜头渐显且不吃鼠标事件',
      collapseSteps.flatMap((s) => s.badges).length > 0
      && collapseSteps.flatMap((s) => s.badges).every((b) => b.opacity >= 0.55 && b.pointerEvents === 'none'),
      JSON.stringify(collapseSteps.flatMap((s) => s.badges).map((b) => [b.opacity, b.pointerEvents])))

    await page.evaluate(() => document.querySelector('[data-tm-lod-mode="off"]')?.click())
    await sleep(250)
    check('关闭 LOD 后全部节点回来', await page.evaluate(() =>
      !!document.querySelector('.react-flow__node[data-id="node-a"]')
      && document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-active') === 'false'))

    await page.evaluate(() => document.querySelector('[data-tm-lod-mode="auto"]')?.click())
    await sleep(250)
    check('切回自动档重新按连续阈值收起边缘节点', await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return el?.getAttribute('data-tm-lod-active') === 'true'
        && Number(el?.getAttribute('data-tm-lod-visible-count') ?? '99') < 8
    }))

    await page.evaluate(() => document.querySelector('[data-tm-lod-mode="force"]')?.click())
    await sleep(250)
    check('强制模式状态为 forced', await page.evaluate(() =>
      document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-reason') === 'forced'))
    await page.evaluate(() => document.querySelector('[data-tm-lod-mode="auto"]')?.click())

    // 缩小视图现在是只读态；pin 夹具先回到 100% 再做真实点击选中，
    // 避免远景下补偿放大的视觉壳 / 只读提示条影响 page.click 的命中判定。
    await page.evaluate(() => document.querySelector('[data-tm-zoom-reset]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000)

    // pin：选中树根 → 置顶 → 持久化 → 清除。
    let rootSelected = false
    try {
      await page.click('.react-flow__node[data-id="lod-root"]', { timeout: 4000 })
      rootSelected = await waitFor(page, () =>
        !!document.querySelector('.react-flow__node.selected[data-id="lod-root"]'), 4000)
    } catch { rootSelected = false }
    check('树根节点仍可真实点击选中', rootSelected)
    check('选中节点后置顶按钮可用', await page.evaluate(() =>
      !document.querySelector('[data-tm-lod-pin-toggle]')?.disabled))
    const selectedDepthOk = await waitFor(page, () => {
      const el = document.querySelector('[data-tm-lod-depth-panel]')
      return el?.getAttribute('data-tm-lod-selected-depth') === '1'
        && el?.getAttribute('data-tm-lod-selected-kind') === 'root'
        && (el?.textContent || '').includes('树根')
    }, 4000)
    const selectedDepthState = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-depth-panel]')
      return {
        depth: el?.getAttribute('data-tm-lod-selected-depth') ?? '',
        kind: el?.getAttribute('data-tm-lod-selected-kind') ?? '',
        text: (el?.textContent || '').slice(-70),
      }
    })
    check('选中节点后左上角显示它的深度与节点类型', selectedDepthOk, JSON.stringify(selectedDepthState))
    await page.evaluate(() => document.querySelector('[data-tm-lod-pin-toggle]')?.click())
    await sleep(250)
    const pinState = await page.evaluate(() => ({
      stored: localStorage.getItem('topomind_semantic_lod_preferences_v1') || '',
      label: document.querySelector('[data-tm-lod-pin-toggle]')?.textContent?.trim() || '',
      count: document.querySelector('[data-tm-lod-pinned-count]')?.textContent?.trim() || '',
      hasClear: !!document.querySelector('[data-tm-lod-pin-clear]'),
    }))
    check('置顶选中节点写进本机偏好且控件回显',
      pinState.stored.includes('lod-root') && pinState.label.includes('取消置顶')
        && pinState.count === '1' && pinState.hasClear,
      JSON.stringify(pinState))
    await page.evaluate(() => document.querySelector('[data-tm-lod-pin-clear]')?.click())
    await sleep(250)
    check('清除置顶后偏好不再含该节点', await page.evaluate(() =>
      !(localStorage.getItem('topomind_semantic_lod_preferences_v1') || '').includes('lod-root')))

    // ===== 阶段 L：房间级图型分类（P3-A） =====
    // 图型存全局 _config.json 的 roomProfiles；验证写盘 / 刷新恢复 / LOD 定制 /
    // 用户手动模式压过图型，以及新字段不挤掉既有配置。
    const configPathL = path.join(WORKDIR, '_config.json')
    const profileState = () => page.evaluate(() => {
      const panel = document.querySelector('[data-tm-lod-control]')
      return {
        value: document.querySelector('[data-tm-graph-profile-select]')?.value || '',
        options: [...document.querySelectorAll('[data-tm-graph-profile-select] option')].map((o) => o.value),
        effective: document.querySelector('[data-tm-graph-profile-effective]')?.getAttribute('data-tm-graph-profile-effective') || '',
        id: panel?.getAttribute('data-tm-graph-profile-id') || '',
        reason: panel?.getAttribute('data-tm-lod-reason') || '',
        active: panel?.getAttribute('data-tm-lod-active') || '',
        policySource: panel?.getAttribute('data-tm-lod-policy-source') || '',
        effectiveMode: panel?.getAttribute('data-tm-lod-effective-mode') || '',
        text: (panel?.textContent || '').replace(/\s+/g, ' '),
        nodeA: !!document.querySelector('.react-flow__node[data-id="node-a"]'),
      }
    })
    const initialProfile = await profileState()
    check('画布控件提供 4 种图型且旧房间默认自动识别',
      initialProfile.value === 'auto' && initialProfile.id === 'auto'
      && initialProfile.options.join(',') === 'auto,tree,flow,network',
      JSON.stringify({ value: initialProfile.value, options: initialProfile.options }))
    check('自动识别给出可解释的建议图型',
      initialProfile.effective === 'network' && initialProfile.text.includes('自动识别'),
      JSON.stringify({ effective: initialProfile.effective, text: initialProfile.text.slice(0, 80) }))

    await page.select('[data-tm-graph-profile-select]', 'flow')
    await sleep(350)
    const flowState = await profileState()
    check('流程图图型自动关闭语义缩放并显示全部节点',
      flowState.value === 'flow' && flowState.reason === 'off' && flowState.active === 'false'
      && flowState.policySource === 'profile' && flowState.nodeA,
      JSON.stringify(flowState).slice(0, 220))

    await page.evaluate(() => document.querySelector('[data-tm-lod-mode="force"]')?.click())
    await sleep(250)
    const forcedState = await profileState()
    check('用户「强制」压过流程图的关闭策略',
      forcedState.reason === 'forced' && forcedState.policySource === 'user'
      && forcedState.effectiveMode === 'force',
      JSON.stringify({ reason: forcedState.reason, source: forcedState.policySource }))
    await page.evaluate(() => document.querySelector('[data-tm-lod-mode="auto"]')?.click())
    await sleep(250)
    const backState = await profileState()
    check('切回自动后图型重新接管', backState.reason === 'off' && backState.policySource === 'profile',
      JSON.stringify({ reason: backState.reason, source: backState.policySource }))

    await page.select('[data-tm-graph-profile-select]', 'tree')
    await sleep(350)
    let treeWritten = false
    for (let attempt = 0; attempt < 20 && !treeWritten; attempt += 1) {
      try {
        const config = JSON.parse(fs.readFileSync(configPathL, 'utf8'))
        treeWritten = !!config.roomProfiles
          && Object.values(config.roomProfiles).includes('tree')
      } catch { /* 写盘尚未完成 */ }
      if (!treeWritten) await sleep(200)
    }
    check('图型选择写进工作区 _config.json 的 roomProfiles', treeWritten)
    const treeState = await profileState()
    check('层级图图型保持语义缩放启用且控件回显已指定图型',
      treeState.value === 'tree' && treeState.id === 'tree' && treeState.effective === 'tree'
      && treeState.reason === 'active' && treeState.text.includes('已指定'),
      JSON.stringify({ value: treeState.value, reason: treeState.reason, text: treeState.text.slice(0, 80) }))

    // 不能复用 enterWorkspace 的「等待 node-a」判据：K 阶段缩小画布后 viewport 会落盘，
    // 重载仍在低档位，node-a 本就该被 LOD 隐藏。镜头控件恒在，用它判断画布已恢复。
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(1800)
    await page.evaluate((name) => {
      const els = [...document.querySelectorAll('*')].filter((e) =>
        e.children.length === 0 && (e.textContent || '').includes(name))
      if (els.length) els[0].parentElement?.click()
    }, KB_NAME)
    check('重载后画布与镜头控件恢复', await waitFor(page, () =>
      !!document.querySelector('[data-tm-lod-control]')
      && !!document.querySelector('[data-tm-graph-profile-select]'), 15000))
    await sleep(400)
    const reloadedProfile = await profileState()
    check('重启后图型从 _config.json 恢复（hydrate）',
      reloadedProfile.value === 'tree' && reloadedProfile.id === 'tree',
      JSON.stringify({ value: reloadedProfile.value, id: reloadedProfile.id }))
    const configAfter = JSON.parse(fs.readFileSync(configPathL, 'utf8'))
    check('新增图型字段没有挤掉既有配置',
      configAfter.showEdgeRelationLabels === false
      && Array.isArray(configAfter.edgeRelations) && configAfter.edgeRelations.length === 2
      && Object.values(configAfter.roomProfiles).includes('tree'),
      JSON.stringify({ labels: configAfter.showEdgeRelationLabels, relations: configAfter.edgeRelations?.length }))

    // ===== 阶段 M：知识库总览（P3-B） =====
    // 只读房间树 / 卡片统计 / 双击懒加载进入 / Esc 与关闭按钮 / 全程不写盘。
    const graphBeforeM = sha(GRAPH_FILE)
    const configBeforeM = sha(configPathL)
    const childrenBeforeM = JSON.stringify(readGraph().children)
    const edgesBeforeM = JSON.stringify(readGraph().edges)
    const expectedRootNodes = Object.keys(readGraph().children).length
    await page.evaluate(() => document.querySelector('[data-tm-room-overview-open]')?.click())
    check('镜头控件能打开知识库总览', await waitFor(page, () =>
      !!document.querySelector('[data-tm-room-overview]')
      && document.querySelector('[data-tm-room-overview]')?.getAttribute('data-tm-room-overview-loading') === 'false', 15000))
    // ReactFlow 自定义节点在 loading=false 之后还要异步测量一遍才挂载，必须等具体卡片出现。
    check('总览卡片完成异步渲染', await waitFor(page, () =>
      document.querySelectorAll('[data-tm-room-summary-card]').length === Number(
        document.querySelector('[data-tm-room-overview]')?.getAttribute('data-tm-room-overview-count') || -1), 15000))
    const overviewState = await page.evaluate(() => {
      const root = document.querySelector('[data-tm-room-overview]')
      const kb = root?.getAttribute('data-tm-room-overview-kb') || ''
      const cards = [...document.querySelectorAll('[data-tm-room-summary-card]')]
      return {
        count: Number(root?.getAttribute('data-tm-room-overview-count') || 0),
        kb,
        cardPaths: cards.map((c) => c.getAttribute('data-tm-room-summary-card')),
        rootNodeCount: Number(cards.find((c) => c.getAttribute('data-tm-room-summary-card') === kb)
          ?.getAttribute('data-tm-room-summary-node-count') || -1),
        depth: cards.map((c) => c.getAttribute('data-tm-room-summary-depth')),
        edges: document.querySelectorAll('[data-tm-room-overview] .react-flow__edge[data-id^="room-link:"]').length,
        nodeIds: [...document.querySelectorAll('[data-tm-room-overview] .react-flow__node')].map((n) => n.getAttribute('data-id')),
      }
    })
    check('总览画布与底层房间画布彼此隔离（没有复用节点 store）',
      overviewState.nodeIds.length === overviewState.count
      && !overviewState.nodeIds.includes('node-a')
      && overviewState.nodeIds.every((id) => id.startsWith(overviewState.kb)),
      JSON.stringify(overviewState.nodeIds))
    check('总览列出根房间与含文档的子房间', overviewState.count >= 3
      && overviewState.kb.length > 0 && overviewState.cardPaths.includes(overviewState.kb),
      JSON.stringify({ count: overviewState.count, kb: overviewState.kb, paths: overviewState.cardPaths, nodes: overviewState.nodeIds }))
    check('根房间卡片统计来自真实 _graph.json', overviewState.rootNodeCount === expectedRootNodes,
      `${overviewState.rootNodeCount} vs ${expectedRootNodes}`)
    check('父子层级连线数与房间树一致', overviewState.edges === overviewState.cardPaths.length - 1,
      `${overviewState.edges} edges / ${overviewState.cardPaths.length} cards`)
    check('子房间卡片带层级深度', overviewState.depth.includes('1'), JSON.stringify(overviewState.depth))
    check('总览只读：根图与全局配置均未被改写',
      sha(GRAPH_FILE) === graphBeforeM && sha(configPathL) === configBeforeM)

    await page.evaluate(() => document.querySelector('[data-tm-room-overview-refresh]')?.click())
    check('刷新后房间数保持不变', await waitFor(page, () =>
      document.querySelector('[data-tm-room-overview]')?.getAttribute('data-tm-room-overview-loading') === 'false'
      && Number(document.querySelector('[data-tm-room-overview]')?.getAttribute('data-tm-room-overview-count') || 0) >= 3, 15000))

    // 双击卡片必须走 enterRoomInTab（房间内容此刻才加载），并自动收起总览。
    const rootCardSelector = `[data-tm-room-overview] .react-flow__node[data-id="${overviewState.kb}"]`
    const rootCard = await page.$(rootCardSelector)
    check('总览渲染出可双击的根房间卡片', !!rootCard)
    if (rootCard) {
      await page.evaluate((selector) => {
        document.querySelector(selector)?.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, view: window,
        }))
      }, rootCardSelector)
    }
    check('双击房间卡片进入房间并收起总览', !!rootCard && await waitFor(page, () =>
      !document.querySelector('[data-tm-room-overview]') && !!document.querySelector('[data-tm-lod-control]'), 12000))

    await page.evaluate(() => document.querySelector('[data-tm-room-overview-open]')?.click())
    const escOpened = await waitFor(page, () => !!document.querySelector('[data-tm-room-overview]'), 10000)
    await page.keyboard.press('Escape')
    check('Esc 可退出总览', escOpened && await waitFor(page, () =>
      !document.querySelector('[data-tm-room-overview]'), 10000))

    await page.evaluate(() => document.querySelector('[data-tm-room-overview-open]')?.click())
    const closeOpened = await waitFor(page, () => !!document.querySelector('[data-tm-room-overview]'), 10000)
    await page.evaluate(() => document.querySelector('[data-tm-room-overview-close]')?.click())
    check('返回按钮可退出总览', closeOpened && await waitFor(page, () =>
      !document.querySelector('[data-tm-room-overview]'), 10000))
    // 进入房间会触发既有 viewport 落盘，不能拿整文件 sha 判「总览写盘」；
    // 只比较节点/边数据与全局配置。
    check('进出总览后节点/边数据与全局配置均未被改写',
      JSON.stringify(readGraph().children) === childrenBeforeM
      && JSON.stringify(readGraph().edges) === edgesBeforeM
      && sha(configPathL) === configBeforeM,
      JSON.stringify({ graphShaChanged: sha(GRAPH_FILE) !== graphBeforeM, configChanged: sha(configPathL) !== configBeforeM }))

    // ===== 阶段 N：缩放比例尺（旧 130% = 新 100% / 100% 上限 / 左下角一键重置 / 滚轮缓动 / 渐隐渐出） =====
    const zoomPercent = () => page.evaluate(() =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') || '')
    // 语义缩放读数：CSS 变量来自最外层画布容器，视觉壳 transform 与锚点壳分离。
    const semanticZoomRead = () => page.evaluate(() => {
      const scope = document.querySelector('[data-shortcut-scope="canvas"]')
      const glyphLayer = document.querySelector('[data-tm-glyph-layer]')
      const anchor = document.querySelector('[data-tm-card-anchor]')
      const title = document.querySelector('[data-tm-glyph-layer] span[title]')
      const cs = scope ? getComputedStyle(scope) : null
      const comp = Number(cs?.getPropertyValue('--tm-glyph-comp') || '1')
      const alpha = Number(cs?.getPropertyValue('--tm-detail-alpha') || '1')
      const hit = (cs?.getPropertyValue('--tm-detail-hit') || 'auto').trim()
      const matrixScale = (el) => {
        if (!el) return 1
        const m = /matrix\(([^,]+)/.exec(getComputedStyle(el).transform)
        return m ? Number(m[1]) : 1
      }
      const viewportScale = matrixScale(document.querySelector('.react-flow__viewport'))
      const layerScale = matrixScale(glyphLayer)
      const fontPx = title ? parseFloat(getComputedStyle(title).fontSize) : 0
      const anchorRect = anchor?.getBoundingClientRect()
      const layerRect = glyphLayer?.getBoundingClientRect()
      return {
        comp: Number(comp.toFixed(3)), alpha, hit, layerScale: Number(layerScale.toFixed(3)),
        viewportScale: Number(viewportScale.toFixed(3)),
        fontScreenPx: Number((fontPx * layerScale * viewportScale).toFixed(2)),
        anchorW: Number((anchorRect?.width ?? 0).toFixed(1)),
        layerW: Number((layerRect?.width ?? 0).toFixed(1)),
      }
    })
    let read100 = null
    let read30 = null
    // 视口中心对应的 flow 坐标：一键重置只改比例、不改平移，它必须保持不变。
    const viewportCenterFlow = () => page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport')
      const pane = document.querySelector('.react-flow__pane')
      if (!viewport || !pane) return null
      const m = /matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/.exec(getComputedStyle(viewport).transform)
      if (!m) return null
      const zoom = Number(m[1])
      const x = Number(m[5])
      const y = Number(m[6])
      const rect = pane.getBoundingClientRect()
      return { zoom, flowX: (rect.width / 2 - x) / zoom, flowY: (rect.height / 2 - y) / zoom }
    })
    const zoomControlRead = () => page.evaluate(() => {
      const control = document.querySelector('[data-tm-zoom-control]')
      const resetView = document.querySelector('[data-tm-zoom-reset-view]')
      const zoomIn = document.querySelector('[data-tm-zoom-in]')
      const zoomOut = document.querySelector('[data-tm-zoom-out]')
      return {
        max: control?.getAttribute('data-tm-zoom-max-percent') ?? '',
        min: control?.getAttribute('data-tm-zoom-min-percent') ?? '',
        atMax: control?.getAttribute('data-tm-zoom-at-max') ?? '',
        zoomInDisabled: !!zoomIn?.disabled,
        zoomOutDisabled: !!zoomOut?.disabled,
        resetViewExists: !!resetView,
        resetViewPercent: resetView?.getAttribute('data-tm-zoom-percent') ?? '',
        resetViewAtReference: resetView?.getAttribute('data-tm-zoom-at-reference') ?? '',
        resetViewInBottomLeft: !!resetView?.closest('.react-flow__panel.bottom.left'),
        resetViewLabel: resetView?.getAttribute('aria-label') ?? '',
        resetViewText: resetView?.textContent?.trim() ?? '',
      }
    })
    await page.evaluate(() => document.querySelector('[data-tm-zoom-reset]')?.click())
    check('点击 100% 可复位到常规阅读比例', await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000),
      await zoomPercent())
    // 清空选中态：LOD 会强制显示选中节点，否则 30% 端点的折叠计数读数会漂移。
    await page.mouse.click(500, 800)
    await sleep(200)
    check('常规比例下镜头处于完整档且 8 个节点全部可见', await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return el?.getAttribute('data-tm-lod-tier') === '0'
        && Number(el?.getAttribute('data-tm-lod-visible-count') ?? '0') === 8
    }))
    read100 = await semanticZoomRead()
    check('几何压力已计入远景字形放大（主干更清晰但不会挤成一堆）', await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return el?.getAttribute('data-tm-lod-pressure') === 'on'
        && el?.getAttribute('data-tm-lod-pressure-glyph') === 'on'
    }), await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return `${el?.getAttribute('data-tm-lod-pressure')}/${el?.getAttribute('data-tm-lod-pressure-glyph')}`
    }))
    // 【2026-11-10】100% 已是放大上限：按钮在端点禁用，滚轮往上推也不能越过它。
    const atReferenceControl = await zoomControlRead()
    check('左下角常驻「一键重置视角到 100%」按钮，且挂在 bottom-left 面板内',
      atReferenceControl.resetViewExists && atReferenceControl.resetViewInBottomLeft
      && atReferenceControl.resetViewLabel === '一键重置视角到 100%'
      && atReferenceControl.resetViewText === '100%',
      JSON.stringify(atReferenceControl))
    check('比例尺上下限读作 100% / 5%，100% 时放大按钮禁用',
      atReferenceControl.max === '100%' && atReferenceControl.min === '5%'
      && atReferenceControl.atMax === 'true' && atReferenceControl.zoomInDisabled
      && !atReferenceControl.zoomOutDisabled && atReferenceControl.resetViewPercent === '100%'
      && atReferenceControl.resetViewAtReference === 'true',
      JSON.stringify(atReferenceControl))
    // 连点放大按钮（已禁用）+ 滚轮上推（deltaY 负 = 放大），验证 UI 与 d3-zoom 双重钳制。
    for (let i = 0; i < 6; i += 1) {
      await page.evaluate(() => document.querySelector('[data-tm-zoom-in]')?.click())
      await sleep(80)
    }
    await page.mouse.move(500, 750)
    await wheelOnPane(page, -220)
    await sleep(400)
    check('连点放大 + 滚轮上推都被锁在 100% 上限（再放大没有意义）', await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000),
      await zoomPercent())
    check('100% 上限处语义缩放恒等（不虚胖、不补偿、细节完整）', await page.evaluate(() => {
      const scope = document.querySelector('[data-shortcut-scope="canvas"]')
      if (!scope) return false
      const comp = Number(getComputedStyle(scope).getPropertyValue('--tm-glyph-comp') || '0')
      const alpha = Number(getComputedStyle(scope).getPropertyValue('--tm-detail-alpha') || '0')
      return Math.abs(comp - 1) < 0.02 && alpha === 1
    }), JSON.stringify(await semanticZoomRead()))
    // 【2026-11-11 两段镜头】先缩小 8 格到 20% 渐隐终点（每格 -10%，节点少于
    // 密度参考值所以灵敏度为 1），在这里做全部 LOD / 只读 / 字形断言。
    await page.evaluate(() => document.querySelector('[data-tm-zoom-reset]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000)
    for (let i = 0; i < 8; i += 1) {
      await page.evaluate(() => document.querySelector('[data-tm-zoom-out]')?.click())
      await sleep(300)
    }
    check('连续缩小到 20% 渐隐终点（100%~20% 每格 -10%）', await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '20%', 8000),
      await zoomPercent())
    read30 = await semanticZoomRead()

    // 【画布只读，2026-11-11】缩小 + 有隐藏节点时整张画布禁写，恢复 100% 才解锁。
    const readOnlyRead = () => page.evaluate(() => {
      const scope = document.querySelector('[data-shortcut-scope="canvas"]')
      const control = document.querySelector('[data-tm-lod-control]')
      return {
        scope: scope?.getAttribute('data-tm-canvas-readonly') ?? '',
        reason: scope?.getAttribute('data-tm-canvas-readonly-reason') ?? '',
        hidden: Number(scope?.getAttribute('data-tm-canvas-readonly-hidden') ?? '0'),
        control: control?.getAttribute('data-tm-canvas-readonly') ?? '',
        panelRow: !!document.querySelector('[data-tm-lod-readonly]'),
        banner: !!document.querySelector('[data-tm-canvas-readonly-banner]'),
        restore: !!document.querySelector('[data-tm-canvas-readonly-restore]'),
      }
    })
    const readOnly30 = await readOnlyRead()
    check('20% 缩小 + 有隐藏节点时画布进入只读（状态面板 / 容器 / 提示条同源）',
      readOnly30.scope === 'true' && readOnly30.control === 'true'
      && readOnly30.reason === 'zoomed-out' && readOnly30.hidden > 0
      && readOnly30.panelRow && readOnly30.banner && readOnly30.restore,
      JSON.stringify(readOnly30))
    const nodeRect30 = await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node[data-id="lod-root"]') ?? document.querySelector('.react-flow__node')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, transform: el.style.transform || '' }
    })
    if (nodeRect30) {
      // 双击标题（重命名入口）+ 按住左键拖动节点：两者在只读期都必须毫无效果。
      await page.mouse.click(nodeRect30.x, nodeRect30.y, { clickCount: 2 })
      await page.mouse.move(nodeRect30.x, nodeRect30.y)
      await page.mouse.down()
      await page.mouse.move(nodeRect30.x + 70, nodeRect30.y + 45, { steps: 6 })
      await page.mouse.up()
      await sleep(250)
    }
    const nodeAfterDrag = await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node[data-id="lod-root"]') ?? document.querySelector('.react-flow__node')
      return {
        transform: el?.style.transform || '',
        titleEditing: !!document.querySelector('.react-flow__node input'),
        selected: !!document.querySelector('.react-flow__node.selected'),
      }
    })
    check('只读期双击重命名不进入编辑、拖动节点坐标不变',
      !!nodeRect30 && !!nodeRect30.transform
      && nodeAfterDrag.transform === nodeRect30.transform && !nodeAfterDrag.titleEditing,
      JSON.stringify({ nodeRect30, nodeAfterDrag }))
    check('只读期仍可选中节点查看（只禁写、不禁看）', nodeAfterDrag.selected,
      JSON.stringify({ selected: nodeAfterDrag.selected }))

    // 【保底两层，2026-11-11】最远镜头必须仍有 depth 1（树根）+ depth 2（一级主干），
    // 不能最后只剩孤零零一个节点；折叠计数守恒、徽标只挂可见骨架。
    const collapse30 = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return {
        visibleCount: Number(el?.getAttribute('data-tm-lod-visible-count') ?? '0'),
        visibleDepthLevels: Number(el?.getAttribute('data-tm-lod-visible-depth-levels') ?? '0'),
        levels: [...document.querySelectorAll('[data-tm-depth-level]')].map((item) => ({
          depth: Number(item.getAttribute('data-tm-depth-level')),
          visible: Number(item.getAttribute('data-tm-depth-visible')),
        })),
        total: Number(el?.getAttribute('data-tm-lod-collapsed-total') ?? '0'),
        free: Number(el?.getAttribute('data-tm-lod-collapsed-free') ?? '0'),
        holders: Number(el?.getAttribute('data-tm-lod-collapsed-holders') ?? '0'),
        summary: document.querySelector('[data-tm-lod-collapsed-summary]')?.textContent || '',
        badges: [...document.querySelectorAll('[data-tm-lod-collapse-badge]')].map((b) => {
          const id = b.getAttribute('data-tm-lod-collapse-badge') || ''
          return {
            id,
            count: Number(b.getAttribute('data-tm-lod-collapse-count') ?? '0'),
            text: (b.textContent || '').trim(),
            opacity: Number(getComputedStyle(b).opacity),
            pointerEvents: getComputedStyle(b).pointerEvents,
            visible: !!document.querySelector(`.react-flow__node[data-id="${id}"]`),
          }
        }),
      }
    })
    check('20% 渐隐终点至少保留两层深度（树根 + 全部一级主干），不会只剩一个节点',
      collapse30.visibleDepthLevels >= 2 && collapse30.visibleCount >= 3
      && (collapse30.levels.find((l) => l.depth === 1)?.visible ?? 0) === 1
      && (collapse30.levels.find((l) => l.depth === 2)?.visible ?? 0) === 2,
      JSON.stringify(collapse30))
    check('20% 折叠计数守恒，徽标只挂可见骨架且完全显现、不吃鼠标事件',
      collapse30.total + collapse30.free === 8 - collapse30.visibleCount
      && collapse30.badges.length === collapse30.holders && collapse30.badges.length > 0
      && collapse30.badges.every((b) => b.visible && b.count > 0 && b.text === `+${b.count}`
        && b.opacity >= 0.99 && b.pointerEvents === 'none'),
      JSON.stringify(collapse30))

    // 【自定义永久显示层数，2026-11-11】面板随时改：1 层 → 3 层 → 2 层，
    // 20% 渐隐端点必须立即跟着变，并把偏好写进 localStorage（不用刷新 / 换房间）。
    const depthPanelRead = () => page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      const select = document.querySelector('[data-tm-lod-preserved-depth-select]')
      return {
        preserved: Number(el?.getAttribute('data-tm-lod-preserved-depth') ?? '0'),
        selectValue: select?.value ?? '',
        visibleCount: Number(el?.getAttribute('data-tm-lod-visible-count') ?? '0'),
        levels: [...document.querySelectorAll('[data-tm-depth-level]')].map((item) => ({
          depth: Number(item.getAttribute('data-tm-depth-level')),
          visible: Number(item.getAttribute('data-tm-depth-visible')),
        })),
        stored: localStorage.getItem('topomind_semantic_lod_preferences_v1') || '',
      }
    })
    const initialDepth = await depthPanelRead()
    check('左侧状态面板默认「永久显示 2 层」，下拉值与生效值一致',
      initialDepth.preserved === 2 && initialDepth.selectValue === '2',
      JSON.stringify(initialDepth))
    await page.select('[data-tm-lod-preserved-depth-select]', '1')
    const oneLevel = await waitFor(page, () =>
      document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-preserved-depth') === '1'
      && document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-visible-count') === '1', 8000)
    check('改成 1 层后立即只剩树根（随时变更、无需刷新）', oneLevel,
      JSON.stringify(await depthPanelRead()))
    await page.select('[data-tm-lod-preserved-depth-select]', '3')
    const threeLevels = await waitFor(page, () => {
      const el = document.querySelector('[data-tm-lod-control]')
      const l3 = document.querySelector('[data-tm-depth-level="3"]')
      return el?.getAttribute('data-tm-lod-preserved-depth') === '3'
        && el?.getAttribute('data-tm-lod-visible-count') === '4'
        && l3?.getAttribute('data-tm-depth-visible') === '1'
    }, 8000)
    check('改成 3 层后 depth 3 也永久显示（层数优先于碰撞抽稀）', threeLevels,
      JSON.stringify(await depthPanelRead()))
    await page.select('[data-tm-lod-preserved-depth-select]', '2')
    const backToTwo = await waitFor(page, () => {
      const el = document.querySelector('[data-tm-lod-control]')
      const raw = localStorage.getItem('topomind_semantic_lod_preferences_v1') || ''
      return el?.getAttribute('data-tm-lod-preserved-depth') === '2'
        && el?.getAttribute('data-tm-lod-visible-count') === '3'
        && /"preservedDepth":2/.test(raw)
    }, 8000)
    check('改回 2 层立即恢复两层全保，且偏好已持久化', backToTwo,
      JSON.stringify(await depthPanelRead()))

    check('100% 是语义缩放恒等点（不补偿、细节完整、锚点壳与视觉壳同尺寸）',
      !!read100 && Math.abs(read100.comp - 1) < 0.02 && Math.abs(read100.layerScale - 1) < 0.02
      && read100.alpha === 1 && read100.hit === 'auto',
      JSON.stringify(read100))
    const atFloorControl = await zoomControlRead()
    check('20% 渐隐终点：仍可继续缩小进入紧凑区、左下角实时读作 20% 且未误判为已复位',
      !atFloorControl.zoomOutDisabled && !atFloorControl.zoomInDisabled
      && atFloorControl.atMax === 'false' && atFloorControl.resetViewPercent === '20%'
      && atFloorControl.resetViewAtReference === 'false',
      JSON.stringify(atFloorControl))
    check('20% 时视觉壳按 glyphScale/0.2 补偿，屏幕节点尺寸不再缩小',
      !!read30 && Math.abs(read30.comp - 1.3 / 0.2) < 0.15
      && Math.abs(read30.layerScale - read30.comp) < 0.05
      && Math.abs(read30.layerW / Math.max(1, read30.anchorW) - read30.comp) < 0.5,
      JSON.stringify(read30))
    check('20% 时远景字形放大，主干标题比 100% 更大且可读',
      !!read30 && !!read100 && read30.fontScreenPx >= 8
      && read30.fontScreenPx > read100.fontScreenPx * 1.2
      && read30.fontScreenPx < read100.fontScreenPx * 1.5,
      JSON.stringify({ at30: read30?.fontScreenPx, at100: read100?.fontScreenPx }))
    check('远景细节连续淡出且不吃鼠标事件，近景完整显现',
      !!read30 && !!read100 && read30.alpha === 0 && read30.hit === 'none'
      && read100.alpha === 1 && read100.hit === 'auto',
      JSON.stringify({ at30: [read30?.alpha, read30?.hit], at100: [read100?.alpha, read100?.hit] }))

    // 【2026-11-11 紧凑行程】20%→5% 只让图谱更紧凑：可见集合冻结、字形补偿冻结、
    // 节点与间距同比例缩小；越接近 5% 每格幅度越小（等比衰减 + 保底步长）。
    const compactSteps = []
    for (let i = 0; i < 12; i += 1) {
      await page.evaluate(() => document.querySelector('[data-tm-zoom-out]')?.click())
      await sleep(300)
      compactSteps.push(Number((await zoomPercent()).replace('%', '')))
    }
    check('继续缩小被锁在 5% 下限（最小比例可以到 5%）', await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '5%', 8000),
      JSON.stringify({ percent: await zoomPercent(), steps: compactSteps }))
    const read5 = await semanticZoomRead()
    const compactState = await page.evaluate(() => {
      const control = document.querySelector('[data-tm-lod-control]')
      const scope = document.querySelector('[data-shortcut-scope="canvas"]')
      const zoomOut = document.querySelector('[data-tm-zoom-out]')
      return {
        visibleCount: Number(control?.getAttribute('data-tm-lod-visible-count') ?? '0'),
        visibleDepthLevels: Number(control?.getAttribute('data-tm-lod-visible-depth-levels') ?? '0'),
        compact: control?.getAttribute('data-tm-lod-compact') ?? '',
        compactHint: !!document.querySelector('[data-tm-lod-compact-hint]'),
        canvasCompact: scope?.getAttribute('data-tm-canvas-compact') ?? '',
        readOnly: scope?.getAttribute('data-tm-canvas-readonly') ?? '',
        zoomOutDisabled: !!zoomOut?.disabled,
      }
    })
    check('5% 紧凑镜头：可见集合与 20% 端点完全一致（不再隐藏或放出节点）',
      compactState.visibleCount === collapse30.visibleCount
      && compactState.visibleDepthLevels === collapse30.visibleDepthLevels
      && compactState.visibleDepthLevels >= 2 && compactState.readOnly === 'true',
      JSON.stringify({ compactState, at20: { visible: collapse30.visibleCount, levels: collapse30.visibleDepthLevels } }))
    // 【文字仍保持】紧凑区补偿按 1/ratio 继续撑大（5% 时 1.3/0.05=26），
    // 于是屏幕字号与 20% 端点一致；只有节点间距随镜头继续收紧。
    // 5% 端点带按钮保底步长的残差（实测停在 5.22%），comp 不会恰好等于 1.3/0.05；
    // 真正要锁住的是「comp × 镜头比例」恒定 → 屏幕字号不缩水。
    check('5% 紧凑镜头：文字保持可读字号、整图间距继续收紧',
      !!read5 && !!read30 && read5.comp > read30.comp * 3
      && read5.viewportScale < read30.viewportScale / 3
      && Math.abs(read5.fontScreenPx - read30.fontScreenPx) < read30.fontScreenPx * 0.12
      && Math.abs(read5.comp * read5.viewportScale - read30.comp * read30.viewportScale)
        < read30.comp * read30.viewportScale * 0.08,
      JSON.stringify({ at20: read30, at5: read5 }))
    check('5% 紧凑镜头：越接近下限每格幅度越小、端点禁用、面板与容器同源提示',
      compactState.zoomOutDisabled && compactState.compact === 'true'
      && compactState.canvasCompact === 'true' && compactState.compactHint
      && compactSteps[0] - compactSteps[1] > compactSteps[6] - compactSteps[7],
      JSON.stringify({ compactSteps, compactState }))
    // 从 5% 紧凑远景用「左下角一键重置」回到 100%：必须真的改比例，且保持平移中心不变。
    const centerBeforeReset = await viewportCenterFlow()
    // 用真实鼠标点击：.react-flow__panel 默认 pointer-events:none，必须验证按钮真能命中。
    const resetViewRect = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-zoom-reset-view]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }
    })
    const resetViewHittable = resetViewRect
      ? await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return !!el?.closest('[data-tm-zoom-reset-view]')
      }, resetViewRect)
      : false
    check('左下角按钮真实可见且可命中（非 pointer-events:none）',
      !!resetViewRect && resetViewRect.width > 10 && resetViewRect.height > 10 && resetViewHittable,
      JSON.stringify({ resetViewRect, resetViewHittable }))
    if (resetViewRect) await page.mouse.click(resetViewRect.x, resetViewRect.y)
    check('5% 紧凑远景可一键重置视角到 100%（左下角按钮，真实鼠标点击）', await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000),
      await zoomPercent())
    await sleep(300)
    const centerAfterReset = await viewportCenterFlow()
    check('一键重置只改比例、不平移视野（视口中心 flow 坐标不变）',
      !!centerBeforeReset && !!centerAfterReset
      && Math.abs(centerBeforeReset.flowX - centerAfterReset.flowX) < 2
      && Math.abs(centerBeforeReset.flowY - centerAfterReset.flowY) < 2
      && Math.abs(centerAfterReset.zoom - 0.65) < 0.02,
      JSON.stringify({ centerBeforeReset, centerAfterReset }))
    check('重置后左下角按钮回到「已在 100%」状态，放大按钮再次禁用', await waitFor(page, () => {
      const c = document.querySelector('[data-tm-zoom-control]')
      const r = document.querySelector('[data-tm-zoom-reset-view]')
      const i = document.querySelector('[data-tm-zoom-in]')
      return c?.getAttribute('data-tm-zoom-at-max') === 'true'
        && r?.getAttribute('data-tm-zoom-at-reference') === 'true'
        && r?.getAttribute('data-tm-zoom-percent') === '100%'
        && !!i?.disabled
    }, 8000), JSON.stringify(await zoomControlRead()))
    const editable100 = await readOnlyRead()
    const atMaxControl = await zoomControlRead()
    check('恢复 100% 后只读解除（提示条消失，画布重新可编辑）',
      editable100.scope === 'false' && editable100.control === 'false'
      && !editable100.banner && !editable100.panelRow && !editable100.restore
      && atMaxControl.atMax === 'true',
      JSON.stringify({ editable100, atMax: atMaxControl.atMax }))
    const beforeWheel = Number((await zoomPercent()).replace('%', ''))
    await page.mouse.move(500, 750)
    await wheelOnPane(page, 220)
    // 在 240ms 渐隐窗口里多次采样：节点必须带 enter/exit 关键帧动画，而不是硬切 hidden。
    const wheelAnimNames = new Set()
    for (let i = 0; i < 6; i += 1) {
      // 浏览器会把 animation 简写规范化成「时长在前、名称在后」，不能只取首段；
      // 同时读 computed animationName（只返回名称），两种读数都收进来。
      const names = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')]
        .flatMap((el) => [el.style.animation || '', getComputedStyle(el).animationName || ''])
        .filter((value) => value && value !== 'none'))
      names.forEach((name) => wheelAnimNames.add(name))
      await sleep(45)
    }
    await sleep(200)
    const afterWheel = Number((await zoomPercent()).replace('%', ''))
    check('滚轮单格被阻尼（不再一格跳掉 26%）',
      beforeWheel - afterWheel >= 2 && beforeWheel - afterWheel <= 15,
      `${beforeWheel}% → ${afterWheel}%`)
    check('缩放中节点带渐隐 / 渐显关键帧动画（不是硬切）',
      [...wheelAnimNames].some((name) => name.includes('tm-lod-enter') || name.includes('tm-lod-exit')),
      JSON.stringify([...wheelAnimNames]))
    await page.evaluate(() => document.querySelector('[data-tm-zoom-reset]')?.click())
    check('滚轮缩放后仍可一键回到 100%', await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000))

    // ===== 阶段 O：从属连线原样式 + 关联关系名强显示 + 一次性「返回上个视野」 =====
    // 阶段 J 已把 showEdgeRelationLabels 关成 false、把 related 改名成「关联关系测试」，
    // 正好用来验证「关联边关系名不可被隐藏」「从属边恢复原样式、无额外固定标记」。
    check('从属连线恢复原样式：没有双线轨道 / 层级徽标 / 专用语义色', await waitFor(page, () => {
      const marks = document.querySelectorAll('[data-tm-edge-subordinate-rail], [data-tm-edge-subordinate-mark]')
      const semanticStrokes = [...document.querySelectorAll('.react-flow__edge path')]
        .filter((el) => (el.getAttribute('stroke') || '').includes('edge-subordinate')
          || (el.style?.stroke || '').includes('edge-subordinate'))
      return marks.length === 0 && semanticStrokes.length === 0
        && document.querySelectorAll('.react-flow__edge-path').length >= 2
    }, 8000))
    check('从属关系名随开关隐藏（原行为），只有关联边强制显示', await page.evaluate(() => {
      const labels = [...document.querySelectorAll('[data-tm-edge-relation-label]')]
      return labels.length >= 1
        && labels.every((el) => el.getAttribute('data-tm-edge-relation-label') === 'related')
        && labels.every((el) => el.getAttribute('data-tm-edge-relation-mandatory') === 'true')
    }))
    check('关闭「显示关系名」后关联连线仍强制写明关系名', await page.evaluate(() => {
      const labels = [...document.querySelectorAll('[data-tm-edge-relation-label="related"]')]
      return labels.length >= 1
        && labels.every((el) => el.getAttribute('data-tm-edge-relation-mandatory') === 'true')
        && labels.every((el) => (el.textContent || '').trim() === '关联关系测试')
    }))

    const viewportState = () => page.evaluate(() => {
      const t = document.querySelector('.react-flow__viewport')?.style.transform || ''
      const m = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/)
      return m ? { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) } : null
    })
    const sameViewport = (a, b) => !!a && !!b
      && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.zoom - b.zoom) < 0.001
    const beforeJump = await viewportState()

    // 搜索跳到远处的 LOD 三级节点（受控输入要用原生 setter，直接赋值不触发 React onChange）
    await page.keyboard.down('Control')
    await page.keyboard.press('f')
    await page.keyboard.up('Control')
    await waitFor(page, () => !!document.querySelector('input[placeholder="搜索画布中的节点..."]'), 5000)
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder="搜索画布中的节点..."]')
      if (!input) return
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'LOD 三级')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(450)
    await page.keyboard.press('Enter')
    check('搜索跳到远处节点后出现「返回上个视野」', await waitFor(page, () =>
      document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-available') === 'true', 8000))
    check('返回按钮标明目标节点名', await page.evaluate(() =>
      document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-label') === 'LOD 三级'))
    const afterJump = await viewportState()
    check('搜索确实改变了画布视野', !sameViewport(beforeJump, afterJump),
      `${JSON.stringify(beforeJump)} → ${JSON.stringify(afterJump)}`)
    const remainBefore = Number(await page.evaluate(() =>
      document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-remaining') ?? '0'))
    await page.mouse.move(100, 200)
    await sleep(1300)
    const remainAfter = Number(await page.evaluate(() =>
      document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-remaining') ?? '0'))
    check('返回按钮倒计时递减（超时自动消失）', remainAfter > 0 && remainAfter < remainBefore,
      `${remainBefore}s → ${remainAfter}s`)

    await page.evaluate(() => document.querySelector('[data-tm-viewport-back-action]')?.click())
    // waitFor 会把函数序列化进浏览器执行，闭包里的 beforeJump / sameViewport 带不过去，
    // 所以这里在 Node 侧轮询比较数值。
    let returnedToOrigin = false
    for (let i = 0; i < 32 && !returnedToOrigin; i += 1) {
      returnedToOrigin = sameViewport(await viewportState(), beforeJump)
      if (!returnedToOrigin) await sleep(250)
    }
    check('点击后平滑返回跳转前的视野', returnedToOrigin, JSON.stringify(await viewportState()))
    check('返回后按钮立即消失', await waitFor(page, () =>
      !document.querySelector('[data-tm-viewport-back]')
      || document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-available') === 'false', 4000))

    // 再跳一次，用滚轮验证「用户开始自己操作画布，提示立刻失效」。
    await page.keyboard.down('Control')
    await page.keyboard.press('f')
    await page.keyboard.up('Control')
    await waitFor(page, () => !!document.querySelector('input[placeholder="搜索画布中的节点..."]'), 5000)
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder="搜索画布中的节点..."]')
      if (!input) return
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'LOD 游离 2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(450)
    await page.keyboard.press('Enter')
    await waitFor(page, () =>
      document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-available') === 'true', 8000)
    await page.mouse.move(500, 400)
    await wheelOnPane(page, 120, 500, 400)
    check('用户自己操作画布后返回提示立刻消失', await waitFor(page, () =>
      !document.querySelector('[data-tm-viewport-back]')
      || document.querySelector('[data-tm-viewport-back]')?.getAttribute('data-tm-viewport-back-available') === 'false', 4000))

    // ===== 阶段 P：多选区域水平镜像（上方菜单 / 只读 / 幂等） =====
    await page.evaluate(() => document.querySelector('[data-tm-zoom-reset]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000)
    await page.mouse.click(500, 800)
    await sleep(250)
    const mirrorRects = () => page.evaluate(() => ['lod-c1', 'lod-c2'].map((id) => {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const match = (el.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
      return {
        id,
        x: match ? Number(match[1]) : Number.NaN,
        y: match ? Number(match[2]) : Number.NaN,
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
      }
    }))
    const beforeMirror = await mirrorRects()
    if (beforeMirror.every(Boolean) && beforeMirror.every((r) => Number.isFinite(r.x))) {
      await page.keyboard.down('Shift')
      await page.mouse.click(beforeMirror[0].cx, beforeMirror[0].cy)
      await page.mouse.click(beforeMirror[1].cx, beforeMirror[1].cy)
      await page.keyboard.up('Shift')
    }
    check('Shift 多选两个节点后上方出现镜像菜单（显示选中数）', await waitFor(page, () => {
      const menu = document.querySelector('[data-tm-selection-mirror-menu]')
      return menu?.getAttribute('data-tm-selection-mirror-count') === '2'
        && !!document.querySelector('[data-tm-selection-mirror-flip]')
    }, 6000), JSON.stringify(beforeMirror))

    const flipRect = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-selection-mirror-flip]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
    })
    if (flipRect && flipRect.w > 10) await page.mouse.click(flipRect.x, flipRect.y)
    let afterMirror = null
    for (let i = 0; i < 20; i += 1) {
      const rects = await mirrorRects()
      if (rects.every(Boolean) && Math.abs(rects[0].x - beforeMirror[0].x) > 1) {
        afterMirror = rects
        break
      }
      await sleep(150)
    }
    const edgeCountAfterMirror = await page.evaluate(() =>
      document.querySelectorAll('.react-flow__edge').length)
    check('水平镜像翻转：节点左右互换、纵坐标不变、连线仍在',
      !!afterMirror && beforeMirror.every(Boolean)
      && beforeMirror[0].x < beforeMirror[1].x && afterMirror[0].x > afterMirror[1].x
      && Math.abs(afterMirror[0].y - beforeMirror[0].y) < 0.01
      && Math.abs(afterMirror[1].y - beforeMirror[1].y) < 0.01
      && edgeCountAfterMirror >= 2,
      JSON.stringify({ beforeMirror, afterMirror, edgeCountAfterMirror }))

    // 再点一次：纯函数保证幂等，端到端必须逐值回到原布局。
    if (flipRect && flipRect.w > 10 && afterMirror) {
      await sleep(200)
      await page.mouse.click(flipRect.x, flipRect.y)
    }
    let restoredMirror = false
    for (let i = 0; i < 20; i += 1) {
      const rects = await mirrorRects()
      if (rects.every(Boolean)
        && Math.abs(rects[0].x - beforeMirror[0].x) < 0.01
        && Math.abs(rects[1].x - beforeMirror[1].x) < 0.01) {
        restoredMirror = true
        break
      }
      await sleep(150)
    }
    check('再次点击翻转回到原布局（幂等，可来回切换左右方向）',
      !!afterMirror && restoredMirror, JSON.stringify(await mirrorRects()))

    // 缩小进入只读：菜单必须收起（位置失真时禁止任何编辑）；恢复 100% 再回来。
    await page.evaluate(() => document.querySelector('[data-tm-zoom-out]')?.click())
    const mirrorReadonly = await waitFor(page, () =>
      document.querySelector('[data-shortcut-scope="canvas"]')?.getAttribute('data-tm-canvas-readonly') === 'true', 8000)
    const menuWhileReadOnly = await page.evaluate(() =>
      !!document.querySelector('[data-tm-selection-mirror-menu]'))
    check('缩小进入只读时多选菜单收起（位置失真时禁止翻转）',
      mirrorReadonly && !menuWhileReadOnly,
      JSON.stringify({ mirrorReadonly, menuWhileReadOnly, percent: await zoomPercent() }))
    await page.evaluate(() => document.querySelector('[data-tm-zoom-reset]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-zoom-reset]')?.getAttribute('data-tm-zoom-percent') === '100%', 8000)
    check('恢复 100% 后菜单重新出现（选中态保留）', await waitFor(page, () =>
      document.querySelector('[data-tm-selection-mirror-menu]')?.getAttribute('data-tm-selection-mirror-count') === '2', 6000))
    await page.mouse.click(500, 800)
    check('取消多选后菜单收起', await waitFor(page, () =>
      !document.querySelector('[data-tm-selection-mirror-menu]'), 4000))
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
