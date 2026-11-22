/**
 * 容器节点（只读预览）+ Excalidraw 全屏编辑态 GUI 冒烟。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-container-gui.mjs
 *
 * 与 verify-linked-documents-gui.mjs 完全隔离：独立临时工作区、独立 Electron profile、
 * 独立 CDP 端口（默认 9223），不会连到别的测试实例或用户正在使用的应用。
 *
 * 真跑主链路：右键新建流程图容器 → 元数据/载荷落盘 → 双击进入全屏编辑
 *   （节点内零编辑器实例、全屏层脱离画布 transform）→ 字体与语言包离线可用
 *   → 真实鼠标画一个矩形 → 400ms debounce 落盘 → 退出编辑（flush → 卸载实例
 *   → 节点回到 SVG 预览）→ 真实鼠标拖拽边框调整节点尺寸并验证预览等比适配
 *   → reload 重开房间，数据与尺寸都仍在。
 * 这几步是静态门禁和 build 都覆盖不到的运行时路径（历史上 jotai 分包就是在这里白屏）。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_CONTAINER_CDP_PORT || 9223)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-container-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '容器测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readGraph = () => JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-container-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  // 只放两个普通节点：不会触发 LOD（hiddenNodeCount=0），zoom=1 保证画布可写。
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
  let lastError = null
  while (Date.now() < deadline) {
    let pages = []
    try { pages = await browser.pages() } catch (e) { lastError = e }
    for (const candidate of pages) {
      try { if (candidate.url().includes('index.html')) return candidate } catch (e) { lastError = e }
    }
    await sleep(300)
  }
  throw new Error('找不到 renderer 页面' + (lastError ? ': ' + lastError.message : ''))
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

async function enterWorkspace(page, diagnose = () => {}) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    localStorage.removeItem('topomind_node_tree_expanded_v2')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2500)
  // 新 profile 首次启动时 workspace 自动恢复是异步 IPC，点击知识库可能需要重试。
  for (let i = 0; i < 3; i += 1) {
    if (await waitFor(page, () => !!document.querySelector('.react-flow__node'), 4000)) break
    await openKnowledgeBase(page)
    await sleep(1200)
  }
  const ready = await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 12000)
  if (!ready) {
    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      body: (document.body?.innerText || '').slice(0, 500),
      nodes: document.querySelectorAll('.react-flow__node').length,
      lastWorkspace: localStorage.getItem('topomind_last_workspace'),
    }))
    console.log('[container-gui diag] 工作空间未就绪:', JSON.stringify(state))
    diagnose()
  }
  return ready
}

/** 右栏是覆盖画布右侧的浮层；不折叠时真实鼠标会点中浮层而不是画布节点。 */
async function setRightPanelCollapsed(page) {
  // 标题栏手动折叠按钮已移除，右栏改为「按需展开 + 失焦隐藏」。
  // 默认进入工作空间时右栏本就是收起的；若因残留状态展开，走全局 Ctrl+Tab
  // 键盘入口收起（与 verify-linked-documents-gui 的 toggleRightPanel 一致）。
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
    const pane = document.querySelector('.react-flow__pane')
    pane?.dispatchEvent(new MouseEvent('contextmenu', {
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
  const entry = Object.entries(graph.children || {}).find(([, v]) => v?.kind === 'container')
  if (!entry) return null
  return { cardId: entry[0], child: entry[1] }
}

function readPayload(meta) {
  if (!meta?.child?.container?.documentId) return null
  const docId = meta.child.container.documentId
  const docsDir = path.join(KB_DIR, meta.cardId, '_docs')
  const payloadPath = path.join(docsDir, `${docId}.exdraw.json`)
  const treePath = path.join(docsDir, 'tree.json')
  return {
    docId,
    payloadPath,
    payload: fs.existsSync(payloadPath) ? JSON.parse(fs.readFileSync(payloadPath, 'utf8')) : null,
    tree: fs.existsSync(treePath) ? JSON.parse(fs.readFileSync(treePath, 'utf8')) : null,
  }
}

async function main() {
  setupWorkDir()
  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  // Excalidraw 的 FontFace src 永远带一个 esm.sh fallback URL；离线 Electron 下它失败是预期噪声，
  // 但只要自托管 URL 生效，浏览器不会真的去请求它。三类分别统计，避免把噪声当回归。
  const selfHostedFailures = []
  const selfHostedResponses = []
  const cdnFallbacks = []
  const pageErrors = []
  try {
    const page = await findRendererPage(browser)
    page.on('requestfailed', (req) => {
      const url = req.url()
      if (url.includes('esm.sh')) { cdnFallbacks.push(url); return }
      if (url.includes('excalidraw-assets') || url.includes('.woff2')) {
        selfHostedFailures.push(`${url} :: ${req.failure()?.errorText || 'unknown'}`)
      }
    })
    page.on('response', (res) => {
      if (res.url().includes('excalidraw-assets')) {
        selfHostedResponses.push(`${res.status()} ${res.url().split('/').slice(-2).join('/')}`)
      }
    })
    page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 200)))

    check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE) && Object.keys(readGraph().children).length === 2)
    check('进入工作空间并渲染普通节点',
      await enterWorkspace(page, () => console.log('[container-gui diag] 运行时异常:',
        JSON.stringify({ pageErrors, selfHostedFailures }))))
    const panelCollapsed = await setRightPanelCollapsed(page)
    check('折叠右栏浮层，保证画布节点可被真实鼠标命中', panelCollapsed)

    // ---- 1. 新建容器 ----
    const clicked = await clickCanvasMenuItem(page, '新建流程图容器')
    const created = await waitFor(page, () => !!document.querySelector('[data-tm-container-card]'), 15000)
    check('右键「新建流程图容器」创建出 containerCard 节点', clicked && created,
      JSON.stringify({ clicked, created }))

    const meta = readContainerMeta()
    check('_graph.json 写入 kind=container 与 type=excalidraw 指针',
      !!meta && meta.child.kind === 'container'
      && meta.child.container?.type === 'excalidraw'
      && typeof meta.child.container?.documentId === 'string'
      && meta.child.container.documentId.length > 0,
      JSON.stringify(meta?.child ?? null))

    const payload = readPayload(meta)
    check('.exdraw.json 载荷与 tree.json 索引同步落盘',
      !!payload?.payload && payload.payload.schema === 'topomind.excalidraw-document'
      && Array.isArray(payload.payload.scene?.elements)
      && !!payload.tree?.documents?.[payload.docId],
      JSON.stringify({ path: payload?.payloadPath, treeKeys: Object.keys(payload?.tree?.documents ?? {}) }))

    if (!created || !meta || !payload?.payload) throw new Error('容器创建未成功，后续编辑态检查无法进行')
    const nodeId = await page.evaluate(() =>
      document.querySelector('[data-tm-container-card]')?.getAttribute('data-tm-container-card'))
    check('节点 id 与磁盘目录名一致', nodeId === meta.cardId, `${nodeId} vs ${meta.cardId}`)

    // ---- 2. 双击进入全屏编辑（lazy chunk 真正挂载）----
    const beforeActivate = await page.evaluate((id) => {
      const el = document.querySelector(`[data-tm-container-card="${id}"]`)
      const vp = document.querySelector('.react-flow__viewport')
      return {
        title: el?.getAttribute('title') ?? null,
        active: el?.getAttribute('data-tm-container-active') ?? null,
        innerText: (el?.innerText || '').slice(0, 120),
        viewportTransform: vp?.getAttribute('style') ?? null,
      }
    })
    const dblClicked = await page.evaluate((id) => {
      const el = document.querySelector(`[data-tm-container-card="${id}"]`)
      if (!el) return false
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }))
      return true
    }, nodeId)
    const editorReady = await waitFor(page, () =>
      !!document.querySelector('[data-tm-fullscreen-editor] [data-tm-container-surface="active"] .excalidraw'), 25000)
    check('双击进入全屏后 Excalidraw 编辑器完成懒加载挂载', dblClicked && editorReady,
      JSON.stringify({ dblClicked, editorReady, beforeActivate,
        after: await page.evaluate((id) => ({
          active: document.querySelector(`[data-tm-container-card="${id}"]`)?.getAttribute('data-tm-container-active'),
          text: (document.querySelector(`[data-tm-container-card="${id}"]`)?.innerText || '').slice(0, 120),
        }), nodeId) }))

    // 全屏层必须是 body 直属的 fixed 层：嵌在 .react-flow__viewport 的 CSS transform 内
    // 会让 Excalidraw 的指针坐标整体偏移，正是「节点内编辑很难操作 / 鼠标定位不准」的根因。
    const fullscreen = await page.evaluate((id) => {
      const host = document.querySelector('[data-tm-fullscreen-editor]')
      const node = document.querySelector(`[data-tm-container-card="${id}"]`)
      const surface = document.querySelector('[data-tm-container-surface="active"]')
      if (!host) return { present: false }
      const r = host.getBoundingClientRect()
      return {
        present: true,
        width: Math.round(r.width),
        height: Math.round(r.height),
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        insideFlowViewport: !!host.closest('.react-flow__viewport'),
        parentIsBody: host.parentElement === document.body,
        surfaceInsideHost: !!surface && host.contains(surface),
        excalidrawInsideNode: node ? node.querySelectorAll('.excalidraw').length : -1,
      }
    }, nodeId)
    check('全屏编辑模式：铺满工作区、脱离画布 transform、节点内零编辑器实例',
      fullscreen.present
      && fullscreen.width >= fullscreen.viewportW - 2
      && fullscreen.height >= fullscreen.viewportH - 40
      && fullscreen.insideFlowViewport === false
      && fullscreen.parentIsBody === true
      && fullscreen.surfaceInsideHost === true
      && fullscreen.excalidrawInsideNode === 0,
      JSON.stringify(fullscreen))

    const runtime = await page.evaluate(() => {
      const surface = document.querySelector('[data-tm-container-surface="active"]')
      return {
        surface: !!surface,
        scope: surface?.getAttribute('data-shortcut-scope') || null,
        nowheel: surface?.className?.includes?.('nowheel') ?? false,
        assetPath: window.EXCALIDRAW_ASSET_PATH || null,
        canvasCount: surface ? surface.querySelectorAll('canvas').length : 0,
        // 全局恰好一个活跃编辑器实例（多容器房间的核心约束）
        activeSurfaces: document.querySelectorAll('[data-tm-container-surface="active"]').length,
        excalidrawInstances: document.querySelectorAll('.excalidraw').length,
      }
    })
    check('编辑态契约：唯一实例 / 快捷键作用域 / nowheel / 绝对 asset path',
      runtime.surface && runtime.scope === 'excalidraw' && runtime.nowheel
      && typeof runtime.assetPath === 'string' && /^[a-z]+:/i.test(runtime.assetPath)
      && runtime.canvasCount > 0 && runtime.activeSurfaces === 1 && runtime.excalidrawInstances === 1,
      JSON.stringify(runtime))

    // ---- 3. 离线字体 / 语言包 ----
    const fontResult = await page.evaluate(async () => {
      try {
        const faces = await document.fonts.load('16px Excalifont')
        return { ok: faces.length > 0, families: faces.map((f) => f.family), error: null }
      } catch (e) {
        return { ok: false, families: [], error: String(e) }
      }
    })
    const localeEntries = await page.evaluate(() =>
      performance.getEntriesByType('resource')
        .filter((e) => e.name.includes('excalidraw-assets'))
        .map((e) => e.name.split('/').slice(-2).join('/'))
        .slice(0, 5))
    check('自托管字体可离线加载（不回落 CDN）', fontResult.ok,
      JSON.stringify({ ...fontResult, localeEntries }))
    check('运行时自托管资源生效、无自托管失败与渲染异常',
      selfHostedFailures.length === 0 && pageErrors.length === 0 && selfHostedResponses.length > 0,
      JSON.stringify({ selfHostedResponses: selfHostedResponses.slice(0, 4),
        selfHostedFailures: selfHostedFailures.slice(0, 3),
        cdnFallbacks: cdnFallbacks.length, pageErrors: pageErrors.slice(0, 3) }))

    // ---- 4. 真实鼠标绘制 ----
    // 全屏编辑器铺满工作区，canvas 视口足够大，手势直接用视口坐标即可；
    // v1.3 需要临时放大节点外框才能画，正是节点内编辑难用的实证。
    await sleep(400) // 等全屏层的 ResizeObserver 完成首轮 canvas 布局
    const toolPicked = await page.evaluate(() => {
      const surface = document.querySelector('[data-tm-container-surface="active"]')
      if (!surface) return 'no-surface'
      const candidates = [
        surface.querySelector('[data-testid="toolbar-rectangle"]'),
        surface.querySelector('input[value="rectangle"]'),
        surface.querySelector('[title*="矩形"]'),
        surface.querySelector('[aria-label*="Rectangle"]'),
      ]
      const btn = candidates.find(Boolean)
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked'
    })
    if (toolPicked !== 'clicked') {
      await page.evaluate(() => {
        document.querySelector('[data-tm-container-surface="active"] canvas')?.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true }))
      })
      await page.keyboard.press('r')
    }
    const canvasRect = await page.evaluate(() => {
      const surface = document.querySelector('[data-tm-container-surface="active"]')
      const list = surface ? [...surface.querySelectorAll('canvas')] : []
      const canvas = list[list.length - 1]
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    const toolState = await page.evaluate(() => {
      const surface = document.querySelector('[data-tm-container-surface="active"]')
      const radio = surface?.querySelector('[data-testid="toolbar-rectangle"]')
      return {
        exists: !!radio,
        checked: radio?.checked ?? radio?.getAttribute('aria-checked') ?? null,
        tag: radio?.tagName ?? null,
      }
    })
    const drawPoint = canvasRect && canvasRect.w > 60 && canvasRect.h > 60
      ? {
          x: canvasRect.x + canvasRect.w * 0.3,
          y: canvasRect.y + canvasRect.h * 0.35,
          dx: Math.min(70, canvasRect.w * 0.22),
          dy: Math.min(50, canvasRect.h * 0.25),
        }
      : null
    const hit = drawPoint ? await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return {
        tag: el?.tagName ?? null,
        cls: String(el?.className ?? '').slice(0, 120),
        inSurface: !!el?.closest?.('[data-tm-container-surface="active"]'),
      }
    }, drawPoint) : null
    let drawn = false
    if (drawPoint) {
      const { x, y, dx, dy } = drawPoint
      await page.mouse.move(x, y)
      await sleep(120)
      await page.mouse.down()
      await sleep(80)
      await page.mouse.move(x + dx, y + dy, { steps: 12 })
      await sleep(120)
      await page.mouse.up()
      drawn = true
    }
    await sleep(1800) // 400ms debounce + IPC 落盘余量
    let afterDraw = readPayload(meta)
    let elementCount = afterDraw?.payload?.scene?.elements?.filter((e) => !e.isDeleted)?.length ?? 0
    // CDP 的 Input.dispatchMouseEvent 在嵌套 canvas 上偶发不生成 Excalidraw 期待的
    // pointer 序列；退回同坐标的合成 PointerEvent，仍走完整的 onChange → debounce → 落盘链路。
    let usedPointerFallback = false
    if (elementCount === 0 && drawPoint) {
      usedPointerFallback = await page.evaluate(({ x, y, dx, dy }) => {
        const surface = document.querySelector('[data-tm-container-surface="active"]')
        const list = surface ? [...surface.querySelectorAll('canvas')] : []
        const canvas = list[list.length - 1]
        if (!canvas) return false
        const make = (type, cx, cy, buttons) => new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse',
          isPrimary: true, button: 0, buttons,
        })
        canvas.dispatchEvent(make('pointerdown', x, y, 1))
        for (let i = 1; i <= 8; i += 1) {
          canvas.dispatchEvent(make('pointermove', x + (dx * i) / 8, y + (dy * i) / 8, 1))
        }
        canvas.dispatchEvent(make('pointerup', x + dx, y + dy, 0))
        return true
      }, drawPoint)
      await sleep(1800)
      afterDraw = readPayload(meta)
      elementCount = afterDraw?.payload?.scene?.elements?.filter((e) => !e.isDeleted)?.length ?? 0
    }
    check('真实鼠标绘制的图形经 onChange → debounce → 落盘',
      drawn && hit?.inSurface === true && !usedPointerFallback && elementCount > 0,
      JSON.stringify({ toolPicked, toolState, canvasRect, hit, drawn, usedPointerFallback, elementCount,
        types: afterDraw?.payload?.scene?.elements?.map((e) => e.type).slice(0, 3) }))

    // ---- 5. 退出编辑：flush → 卸载全屏实例 → 节点重读盘重建 SVG 预览 ----
    const exited = await page.evaluate(() => {
      const host = document.querySelector('[data-tm-fullscreen-editor]')
      const btn = [...(host?.querySelectorAll('button') ?? [])]
        .find((b) => (b.textContent || '').trim() === '退出编辑')
      if (!btn) return false
      btn.click()
      return true
    })
    await sleep(1200)
    const afterExit = await page.evaluate(() => {
      const surface = document.querySelector('[data-tm-container-surface="active"]')
      const preview = document.querySelector('[data-tm-container-preview]')
      return {
        activeSurface: !!surface,
        fullscreenGone: !document.querySelector('[data-tm-fullscreen-editor]'),
        excalidrawInstances: document.querySelectorAll('.excalidraw').length,
        preview: !!preview,
        svgChildren: preview ? preview.querySelectorAll('svg').length : 0,
      }
    })
    check('退出全屏后实例卸载、节点切回 SVG 预览（真实 DOM 挂载）',
      exited && !afterExit.activeSurface && afterExit.fullscreenGone
      && afterExit.excalidrawInstances === 0
      && afterExit.preview && afterExit.svgChildren === 1,
      JSON.stringify({ exited, ...afterExit }))

    const savedOnExit = readPayload(meta)
    check('失焦 flush 后落盘元素未丢失',
      (savedOnExit?.payload?.scene?.elements?.length ?? 0) === (afterDraw?.payload?.scene?.elements?.length ?? -1),
      JSON.stringify({ before: afterDraw?.payload?.scene?.elements?.length,
        after: savedOnExit?.payload?.scene?.elements?.length }))

    // ---- 6. 真实鼠标拖拽边框调整节点尺寸 + 预览按新尺寸等比适配 ----
    // clientWidth 是 CSS 布局像素，getBoundingClientRect 是屏幕像素（乘了画布 zoom）；
    // 两者都要验：SVG 属性跟前者对齐，实际渲染框跟后者对齐。
    const readPreviewBox = (id) => page.evaluate((nodeId) => {
      const holder = document.querySelector(`[data-tm-container-preview="${nodeId}"]`)
      const svg = holder?.querySelector('svg')
      const hr = holder?.getBoundingClientRect()
      const sr = svg?.getBoundingClientRect()
      const card = document.querySelector(`[data-tm-container-card="${nodeId}"]`)
      return {
        holderW: Math.round(hr?.width ?? 0),
        holderH: Math.round(hr?.height ?? 0),
        clientW: holder?.clientWidth ?? 0,
        clientH: holder?.clientHeight ?? 0,
        svgW: Math.round(sr?.width ?? 0),
        svgH: Math.round(sr?.height ?? 0),
        sizeAttr: holder?.getAttribute('data-tm-container-preview-size') ?? null,
        fit: holder?.getAttribute('data-tm-container-preview-fit') ?? null,
        viewBox: svg?.getAttribute('viewBox') ?? null,
        aspect: svg?.getAttribute('preserveAspectRatio') ?? null,
        intrinsicW: svg?.getAttribute('width') ?? null,
        intrinsicH: svg?.getAttribute('height') ?? null,
        cardOverflow: card ? getComputedStyle(card).overflow : null,
      }
    }, id)

    const beforeResize = await readPreviewBox(nodeId)
    const nodeRect = await page.evaluate((id) => {
      const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    }, nodeId)
    if (nodeRect) {
      const cx = nodeRect.x + nodeRect.w / 2
      const cy = nodeRect.y + nodeRect.h / 2
      await page.mouse.move(cx, cy)
      await sleep(250)
      // 选中节点让手柄稳定挂载：拖到边框外时 hover 会消失，selected 不会。
      await page.mouse.click(cx, cy)
      await sleep(400)
    }
    const resizeHandle = await page.evaluate((id) => {
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
      const list = [...(node?.querySelectorAll('.react-flow__resize-control') ?? [])]
        .map((el) => {
          const r = el.getBoundingClientRect()
          return {
            x: r.x + r.width / 2, y: r.y + r.height / 2,
            right: r.right, bottom: r.bottom, w: r.width, h: r.height,
          }
        })
        .filter((h) => h.w > 0 && h.h > 0 && h.w <= 24 && h.h <= 24)
      // 右下角手柄：right + bottom 最大
      list.sort((a, b) => (b.right + b.bottom) - (a.right + a.bottom))
      return list[0] ?? null
    }, nodeId)
    let dragDone = false
    if (resizeHandle) {
      await page.mouse.move(resizeHandle.x, resizeHandle.y)
      await sleep(150)
      await page.mouse.down()
      await sleep(100)
      await page.mouse.move(resizeHandle.x + 120, resizeHandle.y + 90, { steps: 14 })
      await sleep(150)
      await page.mouse.up()
      dragDone = true
    }
    await sleep(1600) // dimensions change → saveLater → IPC 落盘余量
    const afterResize = await readPreviewBox(nodeId)
    let diskChild = null
    for (let i = 0; i < 25; i += 1) {
      diskChild = readGraph().children?.[nodeId] ?? null
      if (Math.max(diskChild?.expandedWidth ?? 0, diskChild?.width ?? 0) > 420) break
      await sleep(300)
    }
    const diskWidth = Math.max(diskChild?.expandedWidth ?? 0, diskChild?.width ?? 0)
    check('真实鼠标拖拽容器边框可调整节点大小并落盘',
      dragDone && afterResize.holderW > beforeResize.holderW + 55
      && afterResize.holderH > beforeResize.holderH + 35
      && diskWidth > 420,
      JSON.stringify({ dragDone, resizeHandle,
        before: { w: beforeResize.holderW, h: beforeResize.holderH },
        after: { w: afterResize.holderW, h: afterResize.holderH },
        disk: { width: diskChild?.width, expandedWidth: diskChild?.expandedWidth, expanded: diskChild?.expanded } }))
    check('预览 SVG 随节点尺寸等比适配（撑满内容区 + viewBox meet + 不裁切）',
      afterResize.fit === 'node' && afterResize.cardOverflow === 'visible'
      && afterResize.aspect === 'xMidYMid meet' && !!afterResize.viewBox
      && Math.abs(afterResize.svgW - afterResize.holderW) <= 2
      && Math.abs(afterResize.svgH - afterResize.holderH) <= 2
      && afterResize.sizeAttr === `${afterResize.clientW}x${afterResize.clientH}`
      && afterResize.intrinsicW === String(afterResize.clientW)
      && afterResize.intrinsicH === String(afterResize.clientH),
      JSON.stringify({ beforeResize, afterResize }))

    // ---- 7. reload 重开房间 ----
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(2200)
    await openKnowledgeBase(page)
    const reopened = await waitFor(page, () => !!document.querySelector('[data-tm-container-card]'), 12000)
    const previewBack = await waitFor(page, () =>
      (document.querySelector('[data-tm-container-preview]')?.querySelectorAll('svg').length ?? 0) === 1, 12000)
    const afterReload = readPayload(meta)
    check('重开房间后容器仍在且预览由落盘数据重建',
      reopened && previewBack
      && (afterReload?.payload?.scene?.elements?.length ?? 0) > 0,
      JSON.stringify({ reopened, previewBack,
        elements: afterReload?.payload?.scene?.elements?.length }))
    const afterReloadBox = await readPreviewBox(nodeId)
    const reloadedChild = readGraph().children?.[nodeId] ?? null
    check('重开后节点尺寸与预览适配均保持',
      Math.abs(afterReloadBox.holderW - afterResize.holderW) <= 12
      && Math.abs(afterReloadBox.svgW - afterReloadBox.holderW) <= 2
      && afterReloadBox.fit === 'node'
      && Math.max(reloadedChild?.expandedWidth ?? 0, reloadedChild?.width ?? 0) > 420,
      JSON.stringify({ afterResize: { w: afterResize.holderW, h: afterResize.holderH },
        afterReloadBox, reloadedChild }))
    check('重开后仍无渲染进程异常', pageErrors.length === 0 && selfHostedFailures.length === 0,
      JSON.stringify({ pageErrors: pageErrors.slice(0, 3), selfHostedFailures: selfHostedFailures.slice(0, 3) }))
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
    console.log('CONTAINER_GUI_VERIFIED')
  }
}

main().catch((e) => {
  console.error('CONTAINER_GUI_VERIFY_ERROR', e)
  process.exitCode = 1
})
