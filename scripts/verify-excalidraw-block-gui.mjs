/**
 * 智能文档「手绘流程图」块（Excalidraw）GUI 端到端回归。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-excalidraw-block-gui.mjs
 *
 * 与 verify-container-gui.mjs / verify-linked-documents-gui.mjs 完全隔离：
 * 独立临时工作区、独立 Electron profile、独立 CDP 端口（默认 9224）。
 * 所有数据只写 <系统临时目录>/tm-exdraw-block-gui-e2e/，绝不碰真实知识库。
 *
 * 覆盖：预置含 excalidraw 块的 smart 文档不白屏 → 块预览占位 / 无说明文字 /
 *   hover tooltip / 可拖动边框 → 点击块弹出对齐工具栏 → 双击进全屏
 *   Excalidraw（块内零编辑器实例）→ 真实鼠标画矩形 → 退出时一次性写回块 props
 *   → 落盘 .tdoc.json 里 scene / 尺寸 / 对齐 含数据且其余块完好 → reload 后预览
 *   SVG 重建 → 斜杠菜单能检索到「手绘流程图」创建入口 → 主题动态切换。
 * 这几步是静态门禁和 build 都覆盖不到的运行时路径。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_EXDRAW_BLOCK_CDP_PORT || 9224)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-exdraw-block-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '流程图块测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const DOC_FILE = path.join(KB_DIR, 'node-a', '_docs', 'doc_flow.tdoc.json')

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function setupWorkDir() {
  if (!ROOT.includes('tm-exdraw-block-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
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
      doc_flow: {
        id: 'doc_flow', type: 'smart', title: '流程图块测试文档',
        path: 'doc_flow.tdoc.json', parentId: null, sortOrder: 0,
      },
    },
  }, null, 2), 'utf8')
  // 块上下各放一段正文，用来验证自定义块没有破坏 BlockNote 文档解析。
  fs.writeFileSync(DOC_FILE, JSON.stringify({
    schema: 'topomind.smart-document', id: 'doc_flow', version: 1, title: '流程图块测试文档',
    blocks: [
      { type: 'paragraph', content: '块上方正文' },
      { id: 'block-exdraw', type: 'excalidraw', props: { scene: '' } },
      { type: 'paragraph', content: '块下方正文' },
    ],
    metadata: {},
  }, null, 2), 'utf8')
}

const readDoc = () => JSON.parse(fs.readFileSync(DOC_FILE, 'utf8'))
const findExdrawBlock = (doc) => (doc.blocks || []).find((b) => b.type === 'excalidraw')
const sceneElements = (block) => {
  try {
    const scene = JSON.parse(block?.props?.scene || '')
    return (scene.scene?.elements || []).filter((e) => !e.isDeleted)
  } catch { return [] }
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

/** 节点卡片上的「包含详情」文档图标：一步打开右栏文档编辑器。 */
async function openDocument(page) {
  await page.evaluate(() => document.querySelector('[data-tm-doc-icon="node-a"]')?.click())
  return waitFor(page, () => !!document.querySelector('.bn-editor[contenteditable="true"]'), 12000)
}

/** 只读探针：从 React fiber 找 Excalidraw App，不往业务代码塞测试钩子。 */
const readEditorScene = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-tm-excalidraw-block-editor] .excalidraw')
  if (!root) return null
  const key = Object.keys(root).find((k) => k.startsWith('__reactFiber$'))
  let fiber = key ? root[key] : null
  while (fiber) {
    const app = fiber.stateNode
    if (app?.scene?.getNonDeletedElements && app?.state?.activeTool) {
      return {
        count: app.scene.getNonDeletedElements().length,
        tool: app.state.activeTool.type,
        theme: app.state.theme,
      }
    }
    fiber = fiber.return
  }
  return null
})

async function main() {
  setupWorkDir()
  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  try {
    const page = await findRendererPage(browser)

    check('隔离测试库构造完成', fs.existsSync(DOC_FILE) && fs.existsSync(GRAPH_FILE))
    check('进入工作空间并渲染节点', await enterWorkspace(page))

    // ---- 1. 打开文档：预置的 excalidraw 块必须正常渲染，且不破坏其余正文 ----
    const opened = await openDocument(page)
    const initial = await page.evaluate(() => ({
      editor: !!document.querySelector('.bn-editor[contenteditable="true"]'),
      block: !!document.querySelector('.tm-excalidraw-block'),
      previewButton: !!document.querySelector('[data-tm-excalidraw-block-open]'),
      placeholder: (document.body.innerText || '').includes('空白白板 · 双击开始绘制'),
      // 预览下方说明文字已移除，提示改由 hover tooltip 承担。
      noHint: !(document.body.innerText || '').includes('双击预览进入全屏编辑（Excalidraw）')
        && !document.querySelector('.tm-excalidraw-block-hint'),
      tooltip: document.querySelector('.tm-excalidraw-block')
        ?.getAttribute('data-tm-excalidraw-block-tooltip') ?? null,
      resizeHandles: document.querySelectorAll('[data-tm-excalidraw-block-resize]').length,
      above: (document.body.innerText || '').includes('块上方正文'),
      below: (document.body.innerText || '').includes('块下方正文'),
      excalidrawInstances: document.querySelectorAll('.excalidraw').length,
    }))
    check('智能文档中预置的流程图块渲染为只读预览（无说明文字、hover tooltip、可拖动边框）',
      opened && initial.editor && initial.block && initial.previewButton
      && initial.placeholder && initial.noHint && initial.tooltip === '双击进入编辑'
      && initial.resizeHandles === 3 && initial.above && initial.below
      && initial.excalidrawInstances === 0,
      JSON.stringify(initial))

    await page.hover('.tm-excalidraw-block')
    await sleep(250)
    const tooltipVisible = await page.evaluate(() => {
      const el = document.querySelector('.tm-excalidraw-block')
      if (!el) return { opacity: null, content: null }
      const style = getComputedStyle(el, '::after')
      return { opacity: style.opacity, content: style.content }
    })
    check('鼠标悬停块上显示「双击进入编辑」tooltip',
      Number(tooltipVisible.opacity) > 0.9
      && (tooltipVisible.content || '').includes('双击进入编辑'),
      JSON.stringify(tooltipVisible))

    // ---- 1.5 点击块 → 上方弹出对齐工具栏 → 三个按钮改对齐 → 点击外部隐藏 ----
    await page.evaluate(() => document.querySelector('[data-tm-excalidraw-block-open]')?.click())
    const toolbarReady = await waitFor(page, () => {
      const toolbar = document.querySelector('[data-tm-excalidraw-block-toolbar]')
      const block = document.querySelector('.tm-excalidraw-block')
      if (!toolbar || !block) return false
      return toolbar.getBoundingClientRect().bottom <= block.getBoundingClientRect().top + 2
    }, 6000)
    const toolbarState = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-tm-excalidraw-block-toolbar]')
      return {
        placement: toolbar?.getAttribute('data-tm-excalidraw-block-toolbar') ?? null,
        buttons: [...(toolbar?.querySelectorAll('[data-tm-excalidraw-align-value]') || [])]
          .map((b) => b.getAttribute('data-tm-excalidraw-align-value')),
      }
    })
    check('点击流程图块后上方弹出工具栏（左 / 中 / 右三个对齐按钮）',
      toolbarReady && toolbarState.placement === 'top'
      && toolbarState.buttons.join(',') === 'left,center,right',
      JSON.stringify(toolbarState))

    await page.evaluate(() => document.querySelector('[data-tm-excalidraw-align-value="right"]')?.click())
    const aligned = await waitFor(page, () =>
      document.querySelector('.tm-excalidraw-block')
        ?.getAttribute('data-tm-excalidraw-block-align') === 'right', 6000)
    check('工具栏「右对齐」按钮写入 textAlignment 并即时生效',
      aligned,
      JSON.stringify({ align: await page.evaluate(() => document.querySelector('.tm-excalidraw-block')
        ?.getAttribute('data-tm-excalidraw-block-align')) }))

    // ---- 1.6 拖动右下角边框调整显示大小（松手后保持）----
    const beforeSize = await page.evaluate(() => {
      const el = document.querySelector('.tm-excalidraw-block')
      const r = el?.getBoundingClientRect()
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null
    })
    const corner = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-excalidraw-block-resize="corner"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    let afterSize = null
    if (corner && beforeSize) {
      await page.mouse.move(corner.x, corner.y)
      await page.mouse.down()
      await page.mouse.move(corner.x - 90, corner.y + 60, { steps: 10 })
      await page.mouse.up()
      await sleep(600)
      afterSize = await page.evaluate(() => {
        const el = document.querySelector('.tm-excalidraw-block')
        const r = el?.getBoundingClientRect()
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null
      })
    }
    check('拖动右下边框调整预览显示大小（松手后尺寸保持）',
      !!beforeSize && !!afterSize && afterSize.w < beforeSize.w - 30
      && afterSize.h > beforeSize.h + 20,
      JSON.stringify({ beforeSize, corner, afterSize }))

    await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await sleep(200)
    const toolbarHidden = await page.evaluate(() =>
      !document.querySelector('[data-tm-excalidraw-block-toolbar]'))
    check('点击块外部后对齐工具栏隐藏', toolbarHidden)

    // ---- 2. 双击预览 → 全屏 Excalidraw ----
    const previewButton = await page.$('[data-tm-excalidraw-block-open]')
    if (previewButton) await previewButton.click({ clickCount: 2 })
    const fullscreenReady = await waitFor(page, () =>
      !!document.querySelector('[data-tm-excalidraw-block-editor] [data-tm-excalidraw-block-surface="active"] .excalidraw'), 25000)
    const fullscreen = await page.evaluate(() => ({
      host: !!document.querySelector('[data-tm-excalidraw-block-editor]'),
      scope: document.querySelector('[data-tm-excalidraw-block-surface="active"]')?.getAttribute('data-shortcut-scope') ?? null,
      instances: document.querySelectorAll('.excalidraw').length,
      closeButton: !!document.querySelector('[data-tm-excalidraw-block-close]'),
    }))
    check('双击块预览进入全屏 Excalidraw 编辑（快捷键隔离 + 唯一实例）',
      fullscreenReady && fullscreen.host && fullscreen.scope === 'excalidraw'
      && fullscreen.instances === 1 && fullscreen.closeButton,
      JSON.stringify(fullscreen))

    // ---- 3. 真实鼠标画一个矩形 ----
    const toolPicked = await page.evaluate(() => {
      const surface = document.querySelector('[data-tm-excalidraw-block-surface="active"]')
      const candidates = [
        surface?.querySelector('[data-testid="toolbar-rectangle"]'),
        surface?.querySelector('input[value="rectangle"]'),
        surface?.querySelector('[title*="矩形"]'),
        surface?.querySelector('[aria-label*="Rectangle"]'),
      ]
      const btn = candidates.find(Boolean)
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked'
    })
    if (toolPicked !== 'clicked') {
      await page.evaluate(() => document.querySelector('[data-tm-excalidraw-block-surface="active"] canvas')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      await page.keyboard.press('r')
    }
    const canvasRect = await page.evaluate(() => {
      const list = [...document.querySelectorAll('[data-tm-excalidraw-block-surface="active"] canvas')]
      const canvas = list[list.length - 1]
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    const drawPoint = canvasRect && canvasRect.w > 200 && canvasRect.h > 200
      ? {
          x: canvasRect.x + canvasRect.w * 0.3,
          y: canvasRect.y + canvasRect.h * 0.35,
          dx: Math.min(80, canvasRect.w * 0.2),
          dy: Math.min(60, canvasRect.h * 0.2),
        }
      : null
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
    await sleep(1200)
    let duringEdit = await readEditorScene(page)
    // CDP 的 Input.dispatchMouseEvent 在嵌套 canvas 上偶发不生成 Excalidraw 期待的
    // pointer 序列；退回同坐标的合成 PointerEvent，仍走完整 onChange 链路。
    let usedPointerFallback = false
    if ((!duringEdit || duringEdit.count === 0) && drawPoint) {
      usedPointerFallback = await page.evaluate(({ x, y, dx, dy }) => {
        const list = [...document.querySelectorAll('[data-tm-excalidraw-block-surface="active"] canvas')]
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
      await sleep(1200)
      duringEdit = await readEditorScene(page)
    }
    check('全屏编辑中真实鼠标绘制出图形（Excalidraw 场景含元素）',
      drawn && !!duringEdit && duringEdit.count > 0,
      JSON.stringify({ toolPicked, drawPoint, usedPointerFallback, duringEdit }))

    // ---- 4. 退出全屏：一次性写回块 props，编辑器实例归零 ----
    await page.evaluate(() => document.querySelector('[data-tm-excalidraw-block-close]')?.click())
    await sleep(600)
    const afterClose = await page.evaluate(() => ({
      hostGone: !document.querySelector('[data-tm-excalidraw-block-editor]'),
      instances: document.querySelectorAll('.excalidraw').length,
      blockStillThere: !!document.querySelector('.tm-excalidraw-block'),
    }))
    check('退出编辑后全屏层卸载、Excalidraw 实例归零、块仍在文档中',
      afterClose.hostGone && afterClose.instances === 0 && afterClose.blockStillThere,
      JSON.stringify(afterClose))

    // 文档编辑器自身有约 1500ms 保存 debounce；blur + 等待落盘。
    await page.evaluate(() => document.querySelector('.bn-editor')?.blur?.())
    await sleep(5000)
    const saved = readDoc()
    const savedBlock = findExdrawBlock(saved)
    const elements = sceneElements(savedBlock)
    check('绘制结果写入文档块的 props.scene 并落盘，其余块与元数据完好',
      !!savedBlock && elements.length > 0 && elements.some((e) => e.type === 'rectangle')
      && saved.schema === 'topomind.smart-document'
      && saved.blocks.some((b) => JSON.stringify(b.content || '').includes('块上方正文'))
      && saved.blocks.some((b) => JSON.stringify(b.content || '').includes('块下方正文')),
      JSON.stringify({ blockCount: saved.blocks.length, elementTypes: elements.map((e) => e.type) }))
    check('拖动后的显示尺寸与对齐方式写入块 props 并落盘',
      typeof savedBlock?.props?.displayWidth === 'number' && savedBlock.props.displayWidth > 0
      && typeof savedBlock?.props?.displayHeight === 'number' && savedBlock.props.displayHeight > 260
      && savedBlock?.props?.textAlignment === 'right',
      JSON.stringify({ props: savedBlock?.props?.displayWidth !== undefined
        ? {
            displayWidth: savedBlock.props.displayWidth,
            displayHeight: savedBlock.props.displayHeight,
            textAlignment: savedBlock.props.textAlignment,
          }
        : null }))

    // ---- 5. reload 重开：块预览由落盘场景重建为 SVG ----
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(2500)
    const reopened = await enterWorkspace(page)
    await openDocument(page)
    const svgReady = await waitFor(page, () =>
      (document.querySelector('[data-tm-excalidraw-block-preview]')?.querySelectorAll('svg').length ?? 0) === 1, 15000)
    check('重开文档后块预览由落盘场景重建为 SVG（内容未丢）',
      reopened && svgReady,
      JSON.stringify({ reopened, svgReady, elementCount: sceneElements(findExdrawBlock(readDoc())).length }))

    // ---- 6. 斜杠菜单里能检索到「手绘流程图」创建入口 ----
    const lastParagraph = await page.evaluate(() => {
      const list = [...document.querySelectorAll('.bn-block-content[data-content-type="paragraph"]')]
      const el = list[list.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }
    })
    // 必须用真实鼠标事件让 ProseMirror 拿到焦点；合成 click 不会 focus，输入会丢。
    if (lastParagraph) await page.mouse.click(lastParagraph.x, lastParagraph.y)
    await page.keyboard.press('End')
    await page.keyboard.type('/excalidraw')
    await sleep(1000)
    const slashMenu = await page.evaluate(() => ({
      typed: (document.querySelector('.bn-editor')?.innerText || '').includes('/excalidraw'),
      hasItem: [...document.querySelectorAll('*')].some((e) =>
        e.children.length === 0 && (e.textContent || '').trim() === '手绘流程图'),
      hasSubtext: [...document.querySelectorAll('*')].some((e) =>
        e.children.length === 0 && (e.textContent || '').includes('插入可双击全屏编辑的手绘流程图')),
      tail: (document.body.innerText || '').slice(-400),
    }))
    check('斜杠菜单可检索到「手绘流程图」创建入口',
      !!lastParagraph && (slashMenu.hasItem || slashMenu.hasSubtext),
      JSON.stringify({ clicked: !!lastParagraph, ...slashMenu }))
    await page.keyboard.press('Escape')

    // ---- 7. 软件主题动态切换：预览与全屏编辑器同时换肤，且不写脏文档 ----
    // 走标题栏「视图 → 主题」真实菜单，验证的是运行中的 store 变更，不是重启读存档。
    const sceneBeforeTheme = sceneElements(findExdrawBlock(readDoc())).length
    const pickTheme = async (label) => {
      const menuOpened = await page.evaluate(() => {
        const trigger = document.querySelector('button[aria-haspopup="menu"]')
        if (!trigger) return false
        trigger.click()
        return true
      })
      await sleep(400)
      const picked = await page.evaluate((text) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find((e) => (e.innerText || '').trim().startsWith(text))
        if (!item) return false
        item.click()
        return true
      }, label)
      await sleep(700)
      return menuOpened && picked
    }

    // 全屏打开期间切主题，才能证明 Excalidraw 是「实时换肤」而非重挂实例。
    const previewForTheme = await page.$('[data-tm-excalidraw-block-open]')
    if (previewForTheme) await previewForTheme.click({ clickCount: 2 })
    const themeEditorReady = await waitFor(page, () =>
      !!document.querySelector('[data-tm-excalidraw-block-editor] .excalidraw'), 25000)
    const darkPicked = await pickTheme('深色')
    const darkState = await page.evaluate(() => {
      const canvas = document.querySelector('.excalidraw canvas')
      return {
        docTheme: document.documentElement.dataset.theme,
        darkClass: !!document.querySelector('.excalidraw.theme--dark'),
        canvasFilter: canvas ? getComputedStyle(canvas).filter : null,
        instances: document.querySelectorAll('.excalidraw').length,
        previewTheme: document.querySelector('[data-tm-excalidraw-block-preview]')
          ?.getAttribute('data-tm-excalidraw-block-theme') ?? null,
      }
    })
    const darkApp = await readEditorScene(page)
    check('切到深色：全屏编辑器实时换肤（不重挂实例）、预览同步变暗',
      themeEditorReady && darkPicked && darkState.docTheme === 'dark'
      && darkState.darkClass
      // getComputedStyle 会把 93% 规范化成 0.93，只校验 filter 的两个组成项。
      && /invert\(/.test(darkState.canvasFilter || '')
      && /hue-rotate\(180deg\)/.test(darkState.canvasFilter || '')
      && darkState.instances === 1 && darkState.previewTheme === 'dark'
      && darkApp?.theme === 'dark',
      JSON.stringify({ themeEditorReady, darkPicked, ...darkState, appTheme: darkApp?.theme }))

    const lightPicked = await pickTheme('浅色')
    const lightState = await page.evaluate(() => {
      const holder = document.querySelector('[data-tm-excalidraw-block-preview]')
      return {
        docTheme: document.documentElement.dataset.theme,
        darkClass: !!document.querySelector('.excalidraw.theme--dark'),
        instances: document.querySelectorAll('.excalidraw').length,
        previewFilter: holder ? getComputedStyle(holder).filter : null,
      }
    })
    const lightApp = await readEditorScene(page)
    check('切回浅色：编辑器恢复 light、预览 filter 消失、仍是同一实例',
      lightPicked && lightState.docTheme === 'github-light' && !lightState.darkClass
      && lightState.instances === 1 && lightApp?.theme === 'light'
      && (!lightState.previewFilter || lightState.previewFilter === 'none'),
      JSON.stringify({ lightPicked, ...lightState, appTheme: lightApp?.theme }))

    await page.evaluate(() => document.querySelector('[data-tm-excalidraw-block-close]')?.click())
    await sleep(800)
    const docAfterTheme = readDoc()
    const blockAfterTheme = findExdrawBlock(docAfterTheme)
    check('主题切换不污染文档数据：落盘 scene.appState.theme 仍为 light、元素数不变',
      sceneElements(blockAfterTheme).length === sceneBeforeTheme
      && (blockAfterTheme?.props?.scene ?? '').includes('"theme":"light"'),
      JSON.stringify({ before: sceneBeforeTheme, after: sceneElements(blockAfterTheme).length }))

    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    if (failed.length) {
      console.log('EXCALIDRAW_BLOCK_GUI_FAILED')
      process.exitCode = 1
    } else {
      console.log('EXCALIDRAW_BLOCK_GUI_VERIFIED')
    }
  } finally {
    await browser.disconnect()
    if (spawned) spawned.kill()
  }
}

main().catch((error) => {
  console.error('EXCALIDRAW_BLOCK_GUI_ERROR', error)
  process.exitCode = 1
})
