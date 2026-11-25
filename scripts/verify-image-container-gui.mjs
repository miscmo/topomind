/**
 * 图片容器 GUI 端到端回归。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-image-container-gui.mjs
 *
 * 独立临时工作区 / Electron profile / CDP 端口（默认 9231），不碰真实知识库。
 *
 * 覆盖：右键「新建图片容器」→ containerCard + .timg.json + tree.json 落盘
 *   → 菜单立即关闭（选图对话框不阻塞画布）→ 空态占位 → 模拟选图结果落盘
 *   → 双击进全屏显示大图 → 退出后节点预览 fill 铺满零空隙且图片真实解码
 *   → 节点尺寸按图片宽高比自适应（长边 480）并写回 _graph.json
 *   → 真实鼠标拖 resize 手柄后宽高比保持不变、图片仍贴合节点
 *   → 既有流程图 / 知识卡片容器入口仍在。
 *
 * 关于原生文件选择框：创建动作会 fire-and-forget 弹一个 Electron 原生对话框，
 * CDP 无法操作 OS 级窗口。测试不点它，而是把测试 PNG 写进节点 _docs/assets/
 * 并把 assets/ 相对引用写进载荷（等价于 importImageAsset 成功后的写盘结果），
 * 以此验证「展示成图片节点」的完整渲染 / 读盘链路；弹窗接线由 verify:critical
 * 第 70 组静态契约锁住。对话框随测试结束 kill Electron 一并关闭。
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_IMAGE_CONTAINER_CDP_PORT || 9231)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-image-container-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = '图片容器测试库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const ASSET_NAME = 'probe.png'
const PNG_WIDTH = 12
const PNG_HEIGHT = 8
/** 图片节点自适应后的逻辑尺寸：长边 480，比例严格等于 PNG_WIDTH/PNG_HEIGHT。 */
const FIT_WIDTH = 480
const FIT_HEIGHT = 320
/** 容器节点放宽后的 resize 上限；普通知识节点仍是 640×480。 */
const IMAGE_NODE_MAX_WIDTH = 1600
const IMAGE_NODE_MAX_HEIGHT = 1200

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readGraph = () => JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

/** 用 Node 内置 zlib 生成一张真实可解码的纯色 PNG，不引入第三方依赖 / 不入库二进制。 */
function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function makeTestPng() {
  const stride = PNG_WIDTH * 3 + 1
  const raw = Buffer.alloc(stride * PNG_HEIGHT)
  for (let y = 0; y < PNG_HEIGHT; y += 1) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < PNG_WIDTH; x += 1) {
      const o = y * stride + 1 + x * 3
      raw[o] = 220
      raw[o + 1] = 40
      raw[o + 2] = 60
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(PNG_WIDTH, 0)
  ihdr.writeUInt32BE(PNG_HEIGHT, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 2  // truecolor RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function setupWorkDir() {
  if (!ROOT.includes('tm-image-container-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  // 两个普通节点 + zoom=1：不触发 LOD 隐藏，画布可写，预览闸门必定放行。
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
  return waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 12000)
}

/** 在画布空白区派发右键菜单，返回菜单项文本；不点击，供先校验入口清单。 */
async function openPaneMenu(page, x = 760, y = 520) {
  await page.evaluate(({ x, y }) => {
    const pane = document.querySelector('.react-flow__pane')
    pane?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: x, clientY: y,
    }))
  }, { x, y })
  await sleep(350)
  return page.evaluate(() => [...document.querySelectorAll('[data-context-menu-item]')]
    .map((e) => (e.textContent || '').trim()))
}

async function clickMenuItem(page, label) {
  return page.evaluate((text) => {
    const item = [...document.querySelectorAll('[data-context-menu-item]')]
      .find((e) => (e.textContent || '').trim() === text)
    if (!item) return false
    item.click()
    return true
  }, label)
}

function readContainerMeta() {
  const graph = readGraph()
  const entry = Object.entries(graph.children || {}).find(([, v]) => v?.container?.type === 'image')
  return entry ? { cardId: entry[0], child: entry[1] } : null
}

function readPayload(meta) {
  if (!meta?.child?.container?.documentId) return null
  const docId = meta.child.container.documentId
  const docsDir = path.join(KB_DIR, meta.cardId, '_docs')
  const payloadPath = path.join(docsDir, `${docId}.timg.json`)
  const treePath = path.join(docsDir, 'tree.json')
  return {
    docId,
    docsDir,
    payloadPath,
    payload: fs.existsSync(payloadPath) ? JSON.parse(fs.readFileSync(payloadPath, 'utf8')) : null,
    tree: fs.existsSync(treePath) ? JSON.parse(fs.readFileSync(treePath, 'utf8')) : null,
  }
}

/** 等价「用户选完图片」：二进制进 _docs/assets/，载荷只留 assets/ 相对引用。 */
function writePickedImage(payload) {
  const assetsDir = path.join(payload.docsDir, 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  const assetPath = path.join(assetsDir, ASSET_NAME)
  fs.writeFileSync(assetPath, makeTestPng())
  const content = { ...payload.payload, src: `assets/${ASSET_NAME}`, alt: ASSET_NAME }
  fs.writeFileSync(payload.payloadPath, JSON.stringify(content, null, 2), 'utf8')
  return assetPath
}

/** 双击容器卡片：先合成事件，失败再用真实鼠标兜底（右栏浮层可能遮挡）。 */
async function openFullscreen(page) {
  const dispatched = await page.evaluate(() => {
    const card = document.querySelector('[data-tm-container-card]')
    if (!card) return false
    const r = card.getBoundingClientRect()
    card.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true,
      clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
    }))
    return true
  })
  if (await waitFor(page, () => !!document.querySelector('[data-tm-fullscreen-editor]'), 2500)) return dispatched
  const box = await page.evaluate(() => {
    const r = document.querySelector('[data-tm-container-card]')?.getBoundingClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  })
  if (box) await page.mouse.click(box.x, box.y, { clickCount: 2 })
  return dispatched
}

function readPreview() {
  return {
    src: document.querySelector('[data-tm-image-preview]')
      ?.getAttribute('data-tm-image-preview-src') ?? null,
    img: (() => {
      const el = document.querySelector('[data-tm-image-preview] img')
      if (!el) return null
      const holder = el.parentElement.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return {
        naturalWidth: el.naturalWidth,
        complete: el.complete,
        objectFit: getComputedStyle(el).objectFit,
        holderWidth: Math.round(holder.width * 100) / 100,
        holderHeight: Math.round(holder.height * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      }
    })(),
  }
}

/**
 * _graph.json 的 child 是「展平」结构：顶层 width/height 来自
 * data.collapsedWidth/collapsedHeight，expandedWidth/expandedHeight 单列。
 * buildMetaFromNodesEdges 里的 size:{width,height} 会在适配器序列化时被展平，
 * 磁盘上并不存在 child.size；读错字段会把成功的落盘误判成失败。
 */
function persistedSize(child) {
  if (!child) return { width: 0, height: 0 }
  return {
    width: Math.max(child.expandedWidth ?? 0, child.width ?? 0),
    height: Math.max(child.expandedHeight ?? 0, child.height ?? 0),
  }
}

/** 轮询 _graph.json，等图片节点的自适应尺寸落盘。 */
async function waitForNodeSize(width, height, timeout = 12000) {
  const end = Date.now() + timeout
  let node = null
  while (Date.now() < end) {
    const meta = readContainerMeta()
    node = meta?.child ?? null
    const size = persistedSize(node)
    if (size.width === width && size.height === height) {
      return { ok: true, value: size, node }
    }
    await sleep(200)
  }
  const size = persistedSize(node)
  return { ok: false, value: { width: size.width || null, height: size.height || null }, node }
}

/** 节点内图片与其 holder 的实测盒子；用来判断「四周零空隙」。 */
function measurePreviewBox() {
  const img = document.querySelector('[data-tm-image-preview] img')
  if (!img) return null
  const holder = img.parentElement.getBoundingClientRect()
  const r = img.getBoundingClientRect()
  return {
    imgW: r.width, imgH: r.height, holderW: holder.width, holderH: holder.height,
    objectFit: getComputedStyle(img).objectFit,
  }
}

/** 真实鼠标拖右下角手柄，验证 keepAspectRatio 与「图片恒贴合节点」。 */
async function resizeAndMeasure(page, settleMs = 1600) {
  const nodeId = readContainerMeta()?.cardId ?? null
  if (!nodeId) return { ok: false, reason: 'node id missing' }
  const beforeBox = await page.evaluate(measurePreviewBox)
  const before = persistedSize(readGraph().children?.[nodeId])
  const rect = await page.evaluate((id) => {
    const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  }, nodeId)
  if (!rect) return { ok: false, reason: 'node rect missing' }
  // 先 hover 再单击选中：拖到边框外时 hover 会消失，selected 不会，手柄才稳定。
  await page.mouse.move(rect.x, rect.y)
  await sleep(250)
  await page.mouse.click(rect.x, rect.y)
  await sleep(400)
  const handle = await page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    const list = [...(node?.querySelectorAll('.react-flow__resize-control') ?? [])]
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right, bottom: r.bottom, w: r.width, h: r.height }
      })
      .filter((h) => h.w > 0 && h.h > 0 && h.w <= 24 && h.h <= 24)
    list.sort((a, b) => (b.right + b.bottom) - (a.right + a.bottom))
    return list[0] ?? null
  }, nodeId)
  if (!handle) return { ok: false, reason: 'resize handle missing' }
  await page.mouse.move(handle.x, handle.y)
  await sleep(150)
  await page.mouse.down()
  await sleep(100)
  await page.mouse.move(handle.x + 110, handle.y + 75, { steps: 14 })
  await sleep(150)
  await page.mouse.up()
  await sleep(settleMs)

  // dimensions change → saveLater → IPC 落盘是异步链路，轮询等尺寸真的变大。
  let child = null
  for (let i = 0; i < 25; i += 1) {
    child = readGraph().children?.[nodeId] ?? null
    if (persistedSize(child).width > before.width + 20) break
    await sleep(300)
  }
  const after = persistedSize(child)
  const box = await page.evaluate(measurePreviewBox)
  return {
    ok: Boolean(box) && after.width > before.width + 20 && after.height > before.height + 10,
    before, after,
    width: after.width, height: after.height,
    ratio: after.height > 0 ? after.width / after.height : 0,
    grown: Boolean(box && beforeBox)
      && box.imgW > beforeBox.imgW + 20 && box.imgH > beforeBox.imgH + 10,
    filled: Boolean(box)
      && Math.abs(box.imgW - box.holderW) < 1 && Math.abs(box.imgH - box.holderH) < 1
      && box.objectFit === 'fill',
    beforeBox, box,
  }
}

async function main() {
  setupWorkDir()
  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  try {
    const page = await findRendererPage(browser)
    check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE) && Object.keys(readGraph().children).length === 2)
    check('进入工作空间并渲染普通节点', await enterWorkspace(page))

    // ---- 1. 菜单入口清单 ----
    const menuItems = await openPaneMenu(page)
    check('画布右键菜单同时提供三种容器入口，且「新建图片容器」在列',
      ['新建流程图容器', '新建知识卡片容器', '新建图片容器'].every((label) => menuItems.includes(label)),
      JSON.stringify(menuItems))

    // ---- 2. 创建：节点 + 载荷 + tree.json 落盘，菜单立即关闭 ----
    const clicked = await clickMenuItem(page, '新建图片容器')
    const created = await waitFor(page, () => !!document.querySelector('[data-tm-container-card]'), 15000)
    const menuClosed = await waitFor(page, () => !document.querySelector('[data-context-menu-item]'), 3000)
    check('右键「新建图片容器」创建出 containerCard，且选图弹窗不阻塞菜单关闭',
      clicked && created && menuClosed,
      JSON.stringify({ clicked, created, menuClosed }))
    // 原生对话框会抢一次 OS 焦点；把 renderer 拉回前台，后续 CDP 输入不受影响。
    try { await page.bringToFront() } catch { /* 某些平台不支持，忽略 */ }

    const meta = readContainerMeta()
    check('_graph.json 写入 kind=container 与 type=image 指针',
      !!meta && meta.child.kind === 'container' && meta.child.container?.type === 'image'
      && typeof meta.child.container?.documentId === 'string' && meta.child.container.documentId.length > 0,
      JSON.stringify(meta?.child ?? null))

    const payload = readPayload(meta)
    check('.timg.json 载荷与 tree.json 索引同步落盘（初始为空态）',
      !!payload?.payload && payload.payload.schema === 'topomind.image-document'
      && payload.payload.src === '' && payload.payload.fit === 'contain'
      && payload.tree?.documents?.[payload.docId]?.type === 'image',
      JSON.stringify({ path: payload?.payloadPath, treeKeys: Object.keys(payload?.tree?.documents ?? {}) }))

    const emptyState = await page.evaluate(() => ({
      text: document.querySelector('[data-tm-container-card]')?.innerText || '',
      hasImg: !!document.querySelector('[data-tm-image-preview] img'),
    }))
    check('尚未选图时节点显示空态占位，不渲染坏图',
      emptyState.text.includes('空白图片容器') && !emptyState.hasImg,
      JSON.stringify(emptyState))

    // ---- 3. 模拟选图完成：图片二进制 + assets/ 相对引用写盘 ----
    const assetPath = writePickedImage(payload)
    check('本地图片导入 _docs/assets/ 且载荷只存相对引用',
      fs.existsSync(assetPath) && fs.statSync(assetPath).size > 50
      && readPayload(meta).payload.src === `assets/${ASSET_NAME}`,
      JSON.stringify({ assetPath, size: fs.statSync(assetPath).size }))

    // ---- 4. 双击进全屏：大图真实解码、换图入口在位 ----
    const opened = await openFullscreen(page)
    const editorReady = await waitFor(page, () =>
      !!document.querySelector('[data-tm-image-editor] img[data-tm-image-editor-src]'), 12000)
    const editorState = await page.evaluate(() => {
      const img = document.querySelector('[data-tm-image-editor] img[data-tm-image-editor-src]')
      return {
        src: img?.getAttribute('data-tm-image-editor-src') ?? null,
        url: img?.currentSrc || img?.src || null,
        naturalWidth: img?.naturalWidth ?? 0,
        complete: img?.complete ?? false,
        chooseButton: !!document.querySelector('[data-tm-image-choose]'),
        excalidrawInstances: document.querySelectorAll('.excalidraw').length,
      }
    })
    check('双击进入全屏编辑器：大图可解码、含「选择图片…」入口、零 Excalidraw 实例',
      opened && editorReady && editorState.src === `assets/${ASSET_NAME}`
      && editorState.naturalWidth === PNG_WIDTH && editorState.complete
      && editorState.chooseButton && editorState.excalidrawInstances === 0,
      JSON.stringify({ opened, editorReady, ...editorState }))

    // ---- 5. 退出全屏：bumpRevision 触发节点重读，预览 fill 铺满零空隙 ----
    await page.evaluate(() => document.querySelector('[data-tm-fullscreen-close]')?.click())
    const closed = await waitFor(page, () => !document.querySelector('[data-tm-fullscreen-editor]'), 8000)
    const previewReady = await waitFor(page, () => {
      const img = document.querySelector('[data-tm-image-preview] img')
      return !!img && img.complete && img.naturalWidth > 0
    }, 12000)
    // 尺寸自适应是 img.onLoad → store update → 落盘的一条异步链路，等它收口。
    const fitted = await waitForNodeSize(FIT_WIDTH, FIT_HEIGHT, 12000)
    const preview = await page.evaluate(readPreview)
    const filled = !!preview.img
      && Math.abs(preview.img.width - preview.img.holderWidth) < 1
      && Math.abs(preview.img.height - preview.img.holderHeight) < 1
    check('退出全屏后节点预览重读磁盘：图片 fill 铺满容器节点、四周零空隙且真实解码',
      closed && previewReady && preview.src === `assets/${ASSET_NAME}`
      && preview.img?.objectFit === 'fill' && preview.img?.naturalWidth === PNG_WIDTH && filled,
      JSON.stringify({ closed, previewReady, ...preview }))

    // ---- 5b. 节点尺寸自适应图片比例，并写回 _graph.json ----
    const ratioOk = fitted.value.height > 0
      && Math.abs(fitted.value.width / fitted.value.height - PNG_WIDTH / PNG_HEIGHT) < 0.01
    check('节点尺寸自适应图片宽高比：长边 480 等比缩放并落盘 _graph.json',
      fitted.ok && fitted.value.width === FIT_WIDTH && fitted.value.height === FIT_HEIGHT
      && ratioOk && fitted.value.width <= IMAGE_NODE_MAX_WIDTH && fitted.value.height <= IMAGE_NODE_MAX_HEIGHT,
      JSON.stringify({ fitted, IMAGE_NODE_MAX_WIDTH, IMAGE_NODE_MAX_HEIGHT }))

    // ---- 5c. 拖边框后宽高比保持，图片与节点恒贴合 ----
    // 必须同时断言「尺寸真的变大」，否则没抓到手柄时原有 1.5 比例也会让断言恒真。
    const aspect = await resizeAndMeasure(page)
    check('拖动 resize 手柄后节点变大且仍锁定图片宽高比，预览始终零空隙',
      aspect.ok && aspect.grown && Math.abs(aspect.ratio - PNG_WIDTH / PNG_HEIGHT) < 0.02
      && aspect.filled && aspect.after.width <= IMAGE_NODE_MAX_WIDTH
      && aspect.after.height <= IMAGE_NODE_MAX_HEIGHT,
      JSON.stringify(aspect))

    // ---- 5d. 重开房间后用户手动调过的尺寸不能被自适应拉回默认 480 ----
    await enterWorkspace(page)
    const reopened = await waitFor(page, () => {
      const img = document.querySelector('[data-tm-image-preview] img')
      return !!img && img.complete && img.naturalWidth > 0
    }, 12000)
    await sleep(900) // 给 img.onLoad → 自适应 effect 留出触发窗口
    const reopenedSize = persistedSize(readContainerMeta()?.child)
    const reopenedBox = await page.evaluate(measurePreviewBox)
    check('重开房间后节点尺寸保持用户调整值，图片仍零空隙贴合',
      reopened && Math.abs(reopenedSize.width - aspect.after.width) < 2
      && Math.abs(reopenedSize.height - aspect.after.height) < 2
      && Math.abs(reopenedSize.width / reopenedSize.height - PNG_WIDTH / PNG_HEIGHT) < 0.02
      && Boolean(reopenedBox)
      && Math.abs(reopenedBox.imgW - reopenedBox.holderW) < 1
      && Math.abs(reopenedBox.imgH - reopenedBox.holderH) < 1
      && reopenedBox.objectFit === 'fill',
      JSON.stringify({ reopened, aspectAfter: aspect.after, reopenedSize, reopenedBox }))

    // ---- 6. 载荷未被全屏会话污染 ----
    const finalPayload = readPayload(meta).payload
    check('全屏查看 / 退出不改写载荷，图片引用与空态字段保持一致',
      finalPayload.src === `assets/${ASSET_NAME}` && finalPayload.schema === 'topomind.image-document'
      && finalPayload.fit === 'contain',
      JSON.stringify({ src: finalPayload.src, fit: finalPayload.fit }))

    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    if (failed.length) {
      console.log('IMAGE_CONTAINER_GUI_FAILED')
      process.exitCode = 1
    } else {
      console.log('IMAGE_CONTAINER_GUI_VERIFIED')
    }
  } finally {
    await browser.disconnect()
    if (spawned) spawned.kill()
  }
}

main().catch((error) => {
  console.error('IMAGE_CONTAINER_GUI_ERROR', error)
  process.exitCode = 1
})
