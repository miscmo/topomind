/**
 * 「知识卡片容器（CardSpec）」专属 GUI 端到端冒烟（阶段 5 / 主需求 §10 遗留补齐）。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-cardspec-container-gui.mjs
 *
 * 与其余 GUI 冒烟完全隔离：独立临时工作区、独立 Electron profile、独立 CDP 端口
 * （默认 9232，可用 TOPOMIND_CARDSPEC_CDP_PORT 覆盖）。**绝不使用 9222**——那是
 * WorkBuddy IDE 自身 Electron 的调试端口。
 *
 * 真跑主链路（静态门禁 / build 都覆盖不到的运行时路径）：
 *   右键新建知识卡片容器 → kind=container + cardspec 指针写进 _graph.json
 *   → .cardspec.json 与 tree.json 同步落盘 → 空卡片降级占位
 *   → 双击进入全屏编辑（宿主 portal 到 body、脱离画布 transform、节点内零编辑器）
 *   → 添加组件 / 改属性 / 切布局 / 未知组件降级占位 → 400ms debounce 落盘
 *   → 退出编辑（flush → 卸载 → 节点回到只读预览）
 *   → 缩小到 60% 以下走 LOD 降级占位 → reload 重开房间，载荷与预览仍在。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_CARDSPEC_CDP_PORT || 9232)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-cardspec-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '知识卡片测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const MARKER = 'CARDSPEC_MARKER_9527'
const FULLSCREEN = '[data-tm-fullscreen-editor]'
const EDITOR = '[data-tm-cardspec-editor="true"]'
const CARD_NODE = '[data-tm-container-card]'
const PREVIEW = '[data-tm-cardspec-preview="true"]'

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readGraph = () => (fs.existsSync(GRAPH_FILE) ? JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8')) : null)

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
// 隔离工作区 / 真机骨架（与 verify-container-gui.mjs 同构）
// ---------------------------------------------------------------------------

function setupWorkDir() {
  if (!ROOT.includes('tm-cardspec-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  // 两个普通节点：无 subordinate 边 → LOD 不抽稀，100% 下画布可写、节点恒在 DOM。
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    children: {
      'plain-a': { name: '普通节点 A', kind: 'knowledge', x: 80, y: 80 },
      'plain-b': { name: '普通节点 B', kind: 'knowledge', x: 80, y: 320 },
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

async function waitFor(page, fn, timeout = 12000, ...args) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...args)) return true
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

async function enterWorkspace(page) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    localStorage.removeItem('topomind_node_tree_expanded_v2')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  for (let i = 0; i < 3; i += 1) {
    if (await waitFor(page, () => !!document.querySelector('.react-flow__node'), 4000)) break
    await openKnowledgeBase(page)
    await sleep(1000)
  }
  return waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 12000)
}

async function setRightPanelCollapsed(page) {
  const alreadyHidden = await page.evaluate(() => {
    const right = document.querySelector('.right-panel-container')
    return !right || getComputedStyle(right).display === 'none'
  })
  if (!alreadyHidden) {
    await page.keyboard.down('Control')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Control')
  }
  return waitFor(page, () => {
    const right = document.querySelector('.right-panel-container')
    return !!right && getComputedStyle(right).display === 'none'
  }, 6000)
}

/** 在画布空白区派发右键菜单，再按文本点击菜单项（不受浮层遮挡影响）。 */
async function clickCanvasMenuItem(page, text, x = 760, y = 520) {
  await page.evaluate(({ x, y }) => {
    document.querySelector('.react-flow__pane')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: x, clientY: y,
    }))
  }, { x, y })
  await sleep(400)
  return page.evaluate((label) => {
    const leaf = [...document.querySelectorAll('*')].find((e) =>
      e.children.length === 0 && (e.textContent || '').trim() === label)
    const target = leaf?.closest('button,[role="menuitem"]') || leaf?.parentElement || leaf
    if (!target) return false
    target.click()
    return true
  }, text)
}

function readContainerMeta() {
  const graph = readGraph()
  const entry = Object.entries(graph?.children || {}).find(([, v]) => v?.container?.type === 'cardspec')
  return entry ? { cardId: entry[0], child: entry[1] } : null
}

function readPayload() {
  const meta = readContainerMeta()
  const docId = meta?.child?.container?.documentId
  if (!docId) return null
  const docsDir = path.join(KB_DIR, meta.cardId, '_docs')
  const payloadPath = path.join(docsDir, `${docId}.cardspec.json`)
  const treePath = path.join(docsDir, 'tree.json')
  return {
    docId,
    payloadPath,
    payload: fs.existsSync(payloadPath) ? JSON.parse(fs.readFileSync(payloadPath, 'utf8')) : null,
    tree: fs.existsSync(treePath) ? JSON.parse(fs.readFileSync(treePath, 'utf8')) : null,
  }
}

async function clickEditorButton(page, text) {
  return page.evaluate((label) => {
    const root = document.querySelector('[data-tm-cardspec-editor="true"]')
    const button = [...(root?.querySelectorAll('button') ?? [])]
      .find((item) => (item.textContent || '').trim() === label)
    if (!button) return false
    button.click()
    return true
  }, text)
}

async function setEditorSelect(page, value) {
  return page.evaluate((target) => {
    const select = [...document.querySelectorAll('[data-tm-cardspec-editor="true"] select')]
      .find((item) => [...item.options].some((option) => option.value === target))
    if (!select) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, target)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, value)
}

/** 切换右栏 JSON 视图并读回规范化后的 draft（编辑器唯一数据源）。 */
async function readEditorJson(page) {
  const shown = await page.evaluate(() => {
    const root = document.querySelector('[data-tm-cardspec-editor="true"]')
    const pre = root?.querySelector('pre')
    return pre ? pre.textContent || '' : null
  })
  if (shown === null) return null
  try { return JSON.parse(shown) } catch { return null }
}

/** 精确设置比例：100% 时滑块隐藏，先滚轮缩小一格让它出现。 */
async function setZoomPercent(page, percent) {
  const hasSlider = await page.evaluate(() => !!document.querySelector('[data-tm-canvas-zoom-slider-input]'))
  if (!hasSlider && percent < 100) {
    await page.mouse.move(500, 750)
    await page.mouse.wheel({ deltaY: 220 })
    await waitFor(page, () => !!document.querySelector('[data-tm-canvas-zoom-slider-input]'), 6000)
    await sleep(550)
  }
  await page.evaluate((p) => {
    const input = document.querySelector('[data-tm-canvas-zoom-slider-input]')
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, String(p))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, percent)
}

// ---------------------------------------------------------------------------

async function main() {
  setupWorkDir()
  check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE) && Object.keys(readGraph().children).length === 2)

  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  const pageErrors = []
  const externalRequests = []
  try {
    const page = await findRendererPage(browser)
    page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 200)))
    page.on('request', (request) => {
      const url = request.url()
      if (/^https?:\/\//.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
        externalRequests.push(url)
      }
    })

    check('进入工作空间并渲染普通节点', await enterWorkspace(page))
    check('折叠右栏浮层，保证画布节点可被真实鼠标命中', await setRightPanelCollapsed(page))

    // ---- 1. 创建容器 + 落盘 ----
    const clicked = await clickCanvasMenuItem(page, '新建知识卡片容器')
    const created = await waitFor(page, (sel) => !!document.querySelector(sel), 15000, CARD_NODE)
    check('右键「新建知识卡片容器」创建出 containerCard 节点', clicked && created,
      JSON.stringify({ clicked, created }))
    if (!created) throw new Error('容器创建未成功，后续编辑态检查无法进行')

    const meta = readContainerMeta()
    check('_graph.json 写入 kind=container 与 type=cardspec 指针',
      !!meta && meta.child.kind === 'container'
      && meta.child.container?.type === 'cardspec'
      && typeof meta.child.container?.documentId === 'string'
      && meta.child.container.documentId.length > 0,
      JSON.stringify(meta?.child ?? null))

    const payload = readPayload()
    check('.cardspec.json 载荷与 tree.json 索引同步落盘',
      !!payload?.payload && payload.payload.schema === 'topomind.card-spec'
      && payload.payload.version === 1 && Array.isArray(payload.payload.components)
      && payload.payload.metadata?.generatedBy === 'user'
      && !!payload.tree?.documents?.[payload.docId],
      JSON.stringify({ path: payload?.payloadPath, treeKeys: Object.keys(payload?.tree?.documents ?? {}) }))
    check('新建卡片默认 layout=stack 且零组件（空白卡片降级占位）',
      payload?.payload?.layout === 'stack' && payload.payload.components.length === 0,
      JSON.stringify({ layout: payload?.payload?.layout, count: payload?.payload?.components?.length }))
    if (!meta || !payload?.payload) throw new Error('载荷未落盘，后续编辑态检查无法进行')

    const nodeId = await page.evaluate((sel) =>
      document.querySelector(sel)?.getAttribute('data-tm-container-card'), CARD_NODE)
    check('节点 id 与磁盘目录名一致', nodeId === meta.cardId, `${nodeId} vs ${meta.cardId}`)
    const emptyHint = await page.evaluate((sel) =>
      (document.querySelector(sel)?.innerText || '').includes('空白卡片'), CARD_NODE)
    check('节点内空卡片显示「空白卡片 · 双击开始编辑」降级占位', emptyHint)

    // ---- 2. 双击进入全屏编辑 ----
    const dblClicked = await page.evaluate((id) => {
      const el = document.querySelector(`[data-tm-container-card="${id}"]`)
      if (!el) return false
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }))
      return true
    }, nodeId)
    const editorReady = await waitFor(page, () =>
      !!document.querySelector('[data-tm-fullscreen-editor] [data-tm-cardspec-editor="true"]'), 20000)
    check('双击进入全屏后 CardSpecEditor 完成挂载', dblClicked && editorReady,
      JSON.stringify({ dblClicked, editorReady }))

    const fullscreen = await page.evaluate((id) => {
      const host = document.querySelector('[data-tm-fullscreen-editor]')
      const node = document.querySelector(`[data-tm-container-card="${id}"]`)
      if (!host) return { present: false }
      const r = host.getBoundingClientRect()
      return {
        present: true,
        width: Math.round(r.width), height: Math.round(r.height),
        viewportW: window.innerWidth, viewportH: window.innerHeight,
        insideFlowViewport: !!host.closest('.react-flow__viewport'),
        parentIsBody: host.parentElement === document.body,
        editorsInsideNode: node ? node.querySelectorAll('[data-tm-cardspec-editor="true"]').length : -1,
        hasSave: !!document.querySelector('[data-tm-fullscreen-save]'),
        hasClose: !!document.querySelector('[data-tm-fullscreen-close]'),
      }
    }, nodeId)
    check('全屏宿主铺满工作区、脱离画布 transform、节点内零编辑器实例',
      fullscreen.present
      && fullscreen.width >= fullscreen.viewportW - 2
      && fullscreen.height >= fullscreen.viewportH - 40
      && fullscreen.insideFlowViewport === false && fullscreen.parentIsBody === true
      && fullscreen.editorsInsideNode === 0 && fullscreen.hasSave && fullscreen.hasClose,
      JSON.stringify(fullscreen))

    const editorLayout = await page.evaluate(() => {
      const root = document.querySelector('[data-tm-cardspec-editor="true"]')
      return {
        present: !!root,
        selects: root?.querySelectorAll('select').length ?? 0,
        addButton: [...(root?.querySelectorAll('button') ?? [])].some((b) => (b.textContent || '').trim() === '添加'),
        jsonToggle: [...(root?.querySelectorAll('button') ?? [])].some((b) => (b.textContent || '').includes('查看 JSON')),
        box: root ? { sw: root.scrollWidth, cw: root.clientWidth } : null,
      }
    })
    check('编辑器三栏齐备（组件列表 / 属性表单 / 实时预览）且无横向溢出',
      editorLayout.present && editorLayout.selects >= 2 && editorLayout.addButton
      && editorLayout.jsonToggle && editorLayout.box.sw <= editorLayout.box.cw + 2,
      JSON.stringify(editorLayout))

    // ---- 3. 添加组件 / 改属性 ----
    const added = await clickEditorButton(page, '添加')
    await sleep(250)
    const textFilled = await page.evaluate((marker) => {
      const area = document.querySelector('[data-tm-cardspec-editor="true"] textarea')
      if (!area) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(area, marker)
      area.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }, MARKER)
    await sleep(250)
    const previewText = await page.evaluate(() =>
      document.querySelector('[data-tm-cardspec-editor="true"] [data-tm-cardspec-layout]')?.innerText || '')
    check('添加 text 组件并编辑属性后实时预览同步渲染',
      added && textFilled && previewText.includes(MARKER),
      JSON.stringify({ added, textFilled, preview: previewText.slice(0, 100) }))

    // ---- 4. 布局切换 + 未知组件降级 ----
    const gridSet = await setEditorSelect(page, 'grid')
    await sleep(250)
    const gridPreview = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-cardspec-editor="true"] [data-tm-cardspec-layout]')
      return { layout: el?.getAttribute('data-tm-cardspec-layout') ?? '', classes: el?.className || '' }
    })
    check('布局切到两列网格，实时预览按 grid 排布',
      gridSet && gridPreview.layout === 'grid' && gridPreview.classes.includes('grid-cols-2'),
      JSON.stringify({ gridSet, ...gridPreview }))

    const htmlTypeSet = await setEditorSelect(page, 'html')
    const htmlAdded = await clickEditorButton(page, '添加')
    await sleep(250)
    const htmlPreview = await page.evaluate(() =>
      document.querySelector('[data-tm-cardspec-editor="true"] [data-tm-cardspec-layout]')?.innerText || '')
    check('HTML 组件只保存不渲染，单组件降级占位不拖垮整张卡片',
      htmlTypeSet && htmlAdded && htmlPreview.includes('HTML 组件（默认关闭）')
      && htmlPreview.includes(MARKER),
      JSON.stringify({ htmlTypeSet, htmlAdded, preview: htmlPreview.slice(0, 140) }))

    // ---- 5. 只读 JSON 视图 + 400ms debounce 落盘 ----
    const jsonShown = await clickEditorButton(page, '查看 JSON（只读）')
    await sleep(200)
    const draft = await readEditorJson(page)
    check('只读 JSON 视图展示规范化后的 CardSpec（version / layout / 组件）',
      jsonShown && !!draft && draft.schema === 'topomind.card-spec' && draft.version === 1
      && draft.layout === 'grid' && draft.components.length === 2
      && draft.components.some((c) => c.type === 'text' && c.props?.text === MARKER)
      && draft.components.some((c) => c.type === 'html'),
      JSON.stringify({ jsonShown, layout: draft?.layout, types: draft?.components?.map((c) => c.type) }))

    const saved = await waitFor(page, () =>
      document.querySelector('[data-tm-fullscreen-save]')?.getAttribute('data-tm-fullscreen-save') === 'saved', 8000)
    const disk = readPayload()
    check('400ms debounce 后保存状态回到 saved 且 .cardspec.json 真正写回',
      saved && !!disk?.payload && disk.payload.layout === 'grid'
      && disk.payload.components.length === 2
      && disk.payload.components.some((c) => c.props?.text === MARKER)
      && disk.payload.metadata?.generatedBy === 'user',
      JSON.stringify({ saved, layout: disk?.payload?.layout, count: disk?.payload?.components?.length }))
    check('落盘数据仍是归一化格式（无任意脚本字段、无 AI 生成标记漂移）',
      !!disk?.payload && disk.payload.schema === 'topomind.card-spec'
      && disk.payload.version === 1 && Array.isArray(disk.payload.components)
      && disk.payload.metadata?.updatedAt >= disk.payload.metadata?.createdAt,
      JSON.stringify({ schema: disk?.payload?.schema, version: disk?.payload?.version }))
    check('tree.json 索引仍指向同一 docId',
      !!disk?.tree?.documents?.[disk.docId]
      && disk.tree.documents[disk.docId].type === 'cardspec',
      JSON.stringify({ type: disk?.tree?.documents?.[disk.docId]?.type }))

    // ---- 6. 退出编辑 → 节点回到只读预览 ----
    const closed = await page.evaluate(() => {
      const button = document.querySelector('[data-tm-fullscreen-close]')
      if (!button) return false
      button.click()
      return true
    })
    const hostGone = await waitFor(page, (sel) => !document.querySelector(sel), 8000, FULLSCREEN)
    const nodePreview = await waitFor(page, (sel) =>
      !!document.querySelector(sel), 10000, PREVIEW)
    check('退出编辑后全屏层卸载、节点回到 CardSpec 只读预览',
      closed && hostGone && nodePreview,
      JSON.stringify({ closed, hostGone, nodePreview }))
    const nodePreviewState = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      const card = document.querySelector('[data-tm-container-card]')
      return {
        text: (el?.innerText || '').slice(0, 160),
        layout: el?.querySelector('[data-tm-cardspec-layout]')?.getAttribute('data-tm-cardspec-layout') ?? '',
        cardActive: card?.getAttribute('data-tm-container-active') ?? '',
        box: el ? { sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight } : null,
      }
    }, PREVIEW)
    check('节点预览渲染已保存文本 / grid 布局，且预览区域不溢出节点',
      nodePreviewState.text.includes(MARKER)
      && nodePreviewState.text.includes('HTML 组件（默认关闭）')
      && nodePreviewState.layout === 'grid' && nodePreviewState.cardActive === 'false'
      && nodePreviewState.box.sw <= nodePreviewState.box.cw + 2
      && nodePreviewState.box.sh <= nodePreviewState.box.ch + 2,
      JSON.stringify(nodePreviewState))

    // ---- 7. 缩小到 60% 以下走 LOD 降级占位 ----
    await setZoomPercent(page, 40)
    const lodHint = await waitFor(page, () =>
      (document.querySelector('[data-tm-container-card]')?.innerText || '').includes('缩小显示中'), 8000)
    check('远景（<60%）下预览降级为「缩小显示中」占位，不加载组件', lodHint,
      JSON.stringify({ zoom: await page.evaluate(() =>
        document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent')) }))
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)

    // ---- 8. reload 持久化 ----
    check('reload 后重新进入工作空间', await enterWorkspace(page))
    const persisted = await waitFor(page, (sel) => !!document.querySelector(sel), 12000, PREVIEW)
    const persistedText = await page.evaluate((sel) =>
      (document.querySelector(sel)?.innerText || '').slice(0, 160), PREVIEW)
    const persistedPayload = readPayload()
    check('reload 重开房间后 .cardspec.json 与节点预览均持久化',
      persisted && persistedText.includes(MARKER)
      && !!persistedPayload?.payload && persistedPayload.payload.components.length === 2
      && persistedPayload.payload.layout === 'grid',
      JSON.stringify({ persisted, count: persistedPayload?.payload?.components?.length }))

    // ---- 9. 未知组件类型降级（直接改盘，验证单组件失败不影响整卡） ----
    const degradedRaw = {
      schema: 'topomind.card-spec', version: 1, title: '知识卡片容器', layout: 'stack',
      components: [
        { id: 'cmp_valid', type: 'text', props: { text: MARKER } },
        { id: 'cmp_future', type: 'future-widget', props: { foo: 'bar' } },
      ],
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), generatedBy: 'user' },
    }
    fs.writeFileSync(persistedPayload.payloadPath, JSON.stringify(degradedRaw, null, 2), 'utf8')
    check('重新载入后重新进入工作空间（读取含未知组件的载荷）', await enterWorkspace(page))
    const degradedReady = await waitFor(page, (sel) => {
      const el = document.querySelector(sel)
      return !!el && (el.innerText || '').includes('暂不支持的内容类型')
    }, 12000, PREVIEW)
    const degradedState = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return el ? { text: (el.innerText || '').slice(0, 200) } : null
    }, PREVIEW)
    check('未知组件类型单条降级占位，合法组件仍正常渲染且原始数据不丢',
      degradedReady && degradedState?.text.includes('暂不支持的内容类型：future-widget')
      && degradedState.text.includes(MARKER),
      JSON.stringify(degradedState))

    // ---- 10. 安全 ----
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
    console.log('CARDSPEC_CONTAINER_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error('CARDSPEC_CONTAINER_GUI_VERIFY_ERROR', error)
  process.exitCode = 1
})
