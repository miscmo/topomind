/**
 * 容器节点 + Excalidraw 编辑态 GUI 冒烟。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-container-gui.mjs
 *
 * 与 verify-linked-documents-gui.mjs 完全隔离：独立临时工作区、独立 Electron profile、
 * 独立 CDP 端口（默认 9223），不会连到别的测试实例或用户正在使用的应用。
 *
 * 真跑主链路：右键新建流程图容器 → 元数据/载荷落盘 → 双击激活（lazy chunk 挂载）
 *   → 字体与语言包离线可用 → 真实鼠标画一个矩形 → 400ms debounce 落盘
 *   → 退出编辑（flush → 卸载实例 → SVG 预览）→ reload 重开房间数据仍在。
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
  await page.evaluate(() => {
    const right = document.querySelector('.right-panel-container')
    if (!right || getComputedStyle(right).display === 'none') return
    document.querySelector('button[aria-label="折叠右侧面板"]')?.click()
  })
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

    // ---- 2. 激活编辑态（lazy chunk 真正挂载）----
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
      !!document.querySelector('[data-tm-container-surface="active"] .excalidraw'), 25000)
    check('双击激活后 Excalidraw 编辑器完成懒加载挂载', dblClicked && editorReady,
      JSON.stringify({ dblClicked, editorReady, beforeActivate,
        after: await page.evaluate((id) => ({
          active: document.querySelector(`[data-tm-container-card="${id}"]`)?.getAttribute('data-tm-container-active'),
          text: (document.querySelector(`[data-tm-container-card="${id}"]`)?.innerText || '').slice(0, 120),
        }), nodeId) }))

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
    // 节点默认 360x240，经画布 0.65 缩放后 canvas 只有 ~150x90，拖拽容易越界。
    // 临时放大节点外框（仅测试 DOM，不改磁盘），让真实鼠标手势有稳定落点。
    await page.evaluate((id) => {
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
      if (!node) return
      node.style.width = '900px'
      node.style.height = '620px'
    }, nodeId)
    await sleep(700) // 等 Excalidraw 的 ResizeObserver 重排 canvas
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

    // ---- 5. 退出编辑：flush → 卸载实例 → SVG 预览 ----
    const exited = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-tm-container-card] button')]
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
        excalidrawInstances: document.querySelectorAll('.excalidraw').length,
        preview: !!preview,
        svgChildren: preview ? preview.querySelectorAll('svg').length : 0,
      }
    })
    check('退出编辑后实例卸载并切回 SVG 预览（真实 DOM 挂载）',
      exited && !afterExit.activeSurface && afterExit.excalidrawInstances === 0
      && afterExit.preview && afterExit.svgChildren === 1,
      JSON.stringify({ exited, ...afterExit }))

    const savedOnExit = readPayload(meta)
    check('失焦 flush 后落盘元素未丢失',
      (savedOnExit?.payload?.scene?.elements?.length ?? 0) === (afterDraw?.payload?.scene?.elements?.length ?? -1),
      JSON.stringify({ before: afterDraw?.payload?.scene?.elements?.length,
        after: savedOnExit?.payload?.scene?.elements?.length }))

    // ---- 6. reload 重开房间 ----
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
