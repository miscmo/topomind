/**
 * 「节点关联已有文档」GUI 端到端回归用例。
 *
 * 用法（项目根目录执行）：
 *   node scripts/verify-linked-documents-gui.mjs
 *
 * 行为：
 *   - 默认连接 http://127.0.0.1:9236 上已有的 Electron 实例；端口不可达时，自行用
 *     隔离的 --user-data-dir 启动一个实例，跑完自动关闭。**绝不使用 9222**——那是
 *     WorkBuddy IDE 自身 Electron 的调试端口，误连会把整套断言跑在错误的 renderer 上。
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

const PORT = Number(process.env.TOPOMIND_CDP_PORT || 9236)
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
  // 物理存在但父房间 _graph.json 未登记：离散节点分组的夹具。
  writeDocs('stray-node', [{ id: 'doc_stray', title: '离散节点文档' }])
  // 连线树夹具：只给树根和三级节点挂文档，一级 A 自身无文档但连线后代有文档，
  // 用来验证「只列有文档的节点」+「仅路径容器」+ 逐层下钻（不动 edges / 节点数，
  // 免得影响阶段 K 的 LOD 覆盖率与深度断言）。
  writeDocs('lod-root', [{ id: 'doc_lod_root', title: 'LOD 树根文档' }])
  writeDocs('lod-g1', [{ id: 'doc_lod_leaf', title: 'LOD 三级文档' }])
  // 阶段 AB：让 node-a 同时是一个可进入的子房间。只加一份自己的 _graph.json，
  // 不改顶层节点数 / edges，阶段 K 的 LOD 覆盖率与深度断言不受影响。
  fs.writeFileSync(path.join(KB_DIR, 'node-a', '_graph.json'), JSON.stringify({
    children: { aa: { name: 'AA' }, ab: { name: 'AB' }, af: { name: 'AF' } },
    edges: [{ id: 'ab-e1', source: 'aa', target: 'ab', relation: 'subordinate', weight: 'main' }],
    zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')
}

async function cdpReachable() {
  try {
    const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch { return false }
}

async function connectOrLaunch() {
  if (await cdpReachable()) return { browser: null, spawned: null }
  // macOS 的 electron 包把可执行文件放在 Electron.app 内，且具体相对路径由
  // path.txt 给出；Linux/Windows 才是 dist/electron(.exe)。此前只按后者拼接，
  // 导致 darwin 上门禁必然报「找不到 electron 可执行文件」。
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
  delete env.ELECTRON_RUN_AS_NODE // 否则主进程会被当成纯 Node 启动
  // 关掉 Chromium 的后台节流：GUI 自动化里窗口被遮挡 / 失焦时 rAF 会被冻结，
  // 而 zoomTo 的 240ms 动画全靠 rAF 推进（滚轮走 d3-zoom 同步 transform 不受影响）。
  // 不关就会出现「缩放按钮连点全部无效、滚轮却生效」的假失败。
  const spawned = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'], {
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

/**
 * 右栏现在是覆盖画布右侧的浮层：被它遮住的节点无法用真实鼠标点中。
 * 需要「真实点击节点」的画布阶段先折叠右栏（画布宽度仍不变），阶段 V 前再展开。
 * 页面 reload 会重置 Zustand 内存态，重载后要重新调一次。
 */
async function setRightPanelCollapsed(page, want) {
  // 标题栏手动折叠按钮已移除：夹具改用全局 Ctrl+Tab 键盘入口切换显隐。
  const current = await page.evaluate(() => {
    const right = document.querySelector('.right-panel-container')
    return right ? getComputedStyle(right).display === 'none' : null
  })
  if (current === null || current === want) return
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Control')
  return want
    ? waitFor(page, () => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display === 'none'
    }, 6000)
    : waitFor(page, () => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display !== 'none'
    }, 6000)
}

/**
 * 左侧节点树是 absolute 浮层，默认展开会遮住画布左侧节点的真实点击。
 * 除阶段 AB（专门验证面板）外一律折叠；偏好写 localStorage，reload 后仍生效，
 * 但脚本仍在每次重载后显式校正一次，避免复用到旧 profile 的展开态。
 *
 * 左栏只有一个开关：NavRail 的竖 tab（点当前激活页 = 折叠，折叠后再点 = 展开）。
 * 折叠态面板完全不渲染，所以「没有 [data-tm-node-tree-panel]」就是折叠态。
 */
async function setNodeTreeCollapsed(page, want) {
  // 竖 tab 挂在全局导航栏里，被隐藏时先恢复（产品里已有的开关，不是左栏新入口）。
  await page.evaluate(() => {
    const rail = document.querySelector('[data-tm-nav-rail-root]')
    if (rail?.getAttribute('data-tm-nav-rail-visible') === 'false') {
      document.querySelector('button[aria-label="展开全局导航栏"]')?.click()
    }
  })
  const end = Date.now() + 6000
  while (Date.now() < end) {
    const ok = await page.evaluate((wantCollapsed) => {
      // 应用还没渲染完时，不能把「没有面板」误判成折叠态。
      if (!document.querySelector('[data-tm-nav-rail-root]')) return false
      const isCollapsed = !document.querySelector('[data-tm-node-tree-panel]')
      if (isCollapsed === wantCollapsed) return true
      document.querySelector('[data-tm-left-dock-active="true"]')?.click()
      return false
    }, want)
    if (ok) return true
    await sleep(200)
  }
  return false
}

/**
 * 【2026-11-25】图型 / 永久层数 / LOD 模式 / 置顶等视图控件已迁入左栏「画布设置」页。
 * 左栏是 absolute 浮层，长时间展开会盖住画布左侧节点，因此只在读写控件的那一小段
 * 打开，用完立刻切回节点结构页并收起：activePanelId 不漂移，画布几何与其它阶段不变。
 */
async function openCanvasSettings(page) {
  await page.evaluate(() => {
    const rail = document.querySelector('[data-tm-nav-rail-root]')
    if (rail?.getAttribute('data-tm-nav-rail-visible') === 'false') {
      document.querySelector('button[aria-label="展开全局导航栏"]')?.click()
    }
  })
  await waitFor(page, () => !!document.querySelector('[data-tm-left-dock-tab="canvasSettings"]'))
  await page.evaluate(() => {
    if (!document.querySelector('[data-tm-left-dock-panel="canvasSettings"]')) {
      document.querySelector('[data-tm-left-dock-tab="canvasSettings"]')?.click()
    }
  })
  await waitFor(page, () => !!document.querySelector('[data-tm-canvas-view-settings]'))
}

async function closeCanvasSettings(page) {
  // 先换页到节点结构（换页会自动展开），再按唯一开关收起。
  await page.evaluate(() => document.querySelector('[data-tm-left-dock-tab="tree"]')?.click())
  await waitFor(page, () => !!document.querySelector('[data-tm-left-dock-panel="tree"]'))
  await setNodeTreeCollapsed(page, true)
}

async function withCanvasSettings(page, fn) {
  await openCanvasSettings(page)
  try { return await fn() } finally { await closeCanvasSettings(page) }
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

// 左下角比例尺 / 步进缩放 / 复位按钮与缩略图已于 2026-11-24 下线。
// 精确设置比例改用只读提示条下方的缩放滑动条；滑块与提示条同进同出，
// 100% 时提示条不显示，需要先滚轮缩小一格让它出现。
async function setZoomPercent(page, percent) {
  const hasSlider = await page.evaluate(() =>
    !!document.querySelector('[data-tm-canvas-zoom-slider-input]'))
  if (!hasSlider && percent < 100) {
    await wheelOnPane(page, 220)
    await waitFor(page, () => !!document.querySelector('[data-tm-canvas-zoom-slider-input]'), 6000)
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
  // 诊断用：块侧栏菜单是 portal 浮层，坐标断言对视口高度敏感。允许用
  // TOPOMIND_GUI_VIEWPORT=1600x1000 之类复跑，判定失败是布局/坐标依赖还是业务回归。
  // 默认仍是历史基线 1400x900，未指定时行为完全不变。
  const [vw, vh] = (process.env.TOPOMIND_GUI_VIEWPORT || '1400x900').split('x').map(Number)
  await page.setViewport({ width: vw, height: vh })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    // Electron profile 固定复用，清掉上一轮留下的节点树展开态，保证「默认全部折叠」可测。
    localStorage.removeItem('topomind_node_tree_expanded_v2')
  }, WORKDIR)
  // 【阶段 W】reload 会重走一遍启动：setup 视图下 currentWorkDir 仍为 null，
  // 自动恢复是异步 IPC。常驻的全局弹窗若此时就加载统一树 root 层，logger 会打
  // 「未选择工作目录」。在新文档创建前挂钩 console.error，精确捕获这类误调用。
  await page.evaluateOnNewDocument(() => {
    const buffer = []
    Object.defineProperty(window, '__tmStartupConsoleErrors', { value: buffer })
    const original = console.error.bind(console)
    console.error = (...args) => {
      try {
        buffer.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '))
      } catch { /* 收集器绝不能影响业务 */ }
      original(...args)
    }
  })
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  const startupErrors = await page.evaluate(() => window.__tmStartupConsoleErrors || [])
  check('【阶段 W】启动期不发起统一树查询（未选择工作目录时无误调用）',
    !startupErrors.some((m) => m.includes('Store.listUnifiedTreeLevel') || m.includes('未选择工作目录')),
    JSON.stringify(startupErrors.filter((m) => m.includes('统一树') || m.includes('工作目录')).slice(0, 2)))
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('*')].filter((e) =>
      e.children.length === 0 && (e.textContent || '').includes(name))
    if (els.length) els[0].parentElement?.click()
  }, KB_NAME)
  const workspaceReady = await waitFor(page, () =>
    !!document.querySelector('.react-flow__node[data-id="node-a"]'), 10000)
  await setNodeTreeCollapsed(page, true)
  return workspaceReady
}

/**
 * Electron 刚被拉起时 CDP 已可连接，但 renderer 的 main frame 可能还没 attach，
 * 此时访问 page.url() 会抛 "Requesting main frame too early!"。轮询到页面就绪为止。
 */
async function findRendererPage(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    let pages = []
    try {
      pages = await browser.pages()
    } catch (e) {
      lastError = e
    }
    for (const candidate of pages) {
      try {
        if (candidate.url().includes('index.html')) return candidate
      } catch (e) {
        lastError = e
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('找不到 renderer 页面' + (lastError ? ': ' + lastError.message : ''))
}

async function main() {
  setupWorkDir()
  const { spawned } = await connectOrLaunch()
  // BlockNote 编辑器 focus / scrollIntoView 偶发 CDP 长调用，默认 180s 会把整轮 GUI 打断。
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  try {
    const page = await findRendererPage(browser)

    check('隔离测试库构造完成', fs.existsSync(DOC_A) && fs.existsSync(DOC_B))
    check('进入工作空间并渲染两个节点', await enterWorkspace(page))

    // ===== 阶段 AB：左侧节点树（浮层 / 结构 / 搜索 / 拖动排序 / 子房间按需加载） =====
    await setNodeTreeCollapsed(page, false)
    const panelAB = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-node-tree-panel]')
      if (!el) return null
      return {
        collapsed: el.getAttribute('data-tm-node-tree-collapsed'),
        total: Number(el.getAttribute('data-tm-node-tree-total') || '0'),
        loadedRooms: Number(el.getAttribute('data-tm-node-tree-loaded-rooms') || '0'),
        position: getComputedStyle(el).position,
        background: getComputedStyle(el).backgroundColor,
        expandedCount: Number(el.getAttribute('data-tm-node-tree-expanded-count') || '0'),
        width: Number(el.getAttribute('data-tm-node-tree-width') || '0'),
      }
    })
    const opaqueAB = (color) => !!color && color !== 'transparent'
      && !/rgba\([^)]*,\s*0\s*\)$/.test(color)
    check('【阶段 AB】absolute 浮层 / 背景不透明 / 默认不加载子房间',
      panelAB?.collapsed === 'false' && panelAB?.position === 'absolute'
      && panelAB?.total === 8 && panelAB?.loadedRooms === 0
      && opaqueAB(panelAB?.background) && panelAB?.width === 280,
      JSON.stringify(panelAB))

    const readRowsAB = () => page.evaluate(() =>
      [...document.querySelectorAll('[data-tm-node-tree-row]')].map((el) => ({
        id: el.getAttribute('data-tm-node-tree-id') || '',
        origin: el.getAttribute('data-tm-node-tree-origin') || '',
        sortable: el.getAttribute('data-tm-node-tree-sortable'),
        hasRoom: el.getAttribute('data-tm-node-tree-has-room'),
        roomLoaded: el.getAttribute('data-tm-node-tree-room-loaded'),
        hasChildren: el.getAttribute('data-tm-node-tree-has-children'),
        expanded: el.getAttribute('data-tm-node-tree-expanded'),
        lazy: el.getAttribute('data-tm-node-tree-lazy'),
        depth: Number(el.getAttribute('data-tm-node-tree-depth') || '0'),
      })))
    let rowsAB = await readRowsAB()
    const rowOfAB = (id) => rowsAB.find((row) => row.id === id)
    check('【阶段 AB】默认全部折叠：只显示房间根第一层，子节点未入 DOM',
      rowsAB[0]?.origin === 'room-root' && rowsAB[0]?.expanded === 'true'
      && rowsAB.every((row) => row.depth <= 1)
      && rowOfAB('lod-root')?.hasChildren === 'true'
      && rowOfAB('lod-root')?.expanded === 'false'
      && rowOfAB('lod-root')?.lazy === 'true'
      && !rowOfAB('lod-c1') && !rowOfAB('lod-g1')
      && panelAB?.expandedCount === 1,
      JSON.stringify({ rows: rowsAB, expandedCount: panelAB?.expandedCount }))

    // 逐层懒加载：只展开 lod-root，长出 c1/c2，三级 g1 仍不构造。
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-tm-node-tree-row]')]
        .find((el) => el.getAttribute('data-tm-node-tree-id') === 'lod-root')
      row?.querySelector('[data-tm-node-tree-chevron]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    rowsAB = await readRowsAB()
    check('【阶段 AB】单层展开只长出直接子节点，更深一层仍懒加载',
      !!rowOfAB('lod-c1') && !!rowOfAB('lod-c2') && !rowOfAB('lod-g1')
      && rowOfAB('lod-root')?.expanded === 'true'
      && rowOfAB('lod-c1')?.expanded === 'false',
      JSON.stringify(rowsAB.slice(0, 8)))

    // 结构与拖动断言需要完整视图：用面板自带的「展开全部」。
    await page.evaluate(() => {
      document.querySelector('[data-tm-node-tree-expand-all]')?.click()
    })
    await waitFor(page, () =>
      !!document.querySelector('[data-tm-node-tree-row][data-tm-node-tree-id="lod-g1"]'), 6000)
    rowsAB = await readRowsAB()
    check('【阶段 AB】顶层是房间虚拟根，从属树按深度逐层展开',
      rowsAB[0]?.origin === 'room-root'
      && rowOfAB('lod-root')?.origin === 'subordinate'
      && rowOfAB('lod-c1')?.depth === 2 && rowOfAB('lod-c2')?.depth === 2
      && rowOfAB('lod-g1')?.depth === 3,
      JSON.stringify(rowsAB.slice(0, 8)))
    const freeIdsAB = rowsAB.filter((row) => row.origin === 'free').map((row) => row.id)
    const tailIdsAB = rowsAB.slice(-4).map((row) => row.id)
    check('【阶段 AB】游离节点恒在末尾、带标记且不可自定义排序',
      freeIdsAB.length === 4
      && freeIdsAB.every((id) => rowOfAB(id)?.sortable === 'false')
      && freeIdsAB.every((id) => tailIdsAB.includes(id)),
      JSON.stringify({ freeIdsAB, tailIdsAB }))
    check('【阶段 AB】可进入房间的节点默认折叠（还没读子房间 meta）',
      rowOfAB('node-a')?.hasRoom === 'true' && rowOfAB('node-a')?.roomLoaded === 'false',
      JSON.stringify(rowOfAB('node-a')))

    const canvasRectAB = () => page.evaluate(() => {
      const r = document.querySelector('#graph-panel')?.getBoundingClientRect()
      const s = document.querySelector('.react-flow__panel.top.left')?.getBoundingClientRect()
      return {
        rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        status: s ? { left: Math.round(s.left), width: Math.round(s.width) } : null,
      }
    })
    // 左栏展开时状态抽屉通过 CSS 变量让位；折叠后回到原位。
    await waitFor(page, () => {
      const s = document.querySelector('.react-flow__panel.top.left')?.getBoundingClientRect()
      return !!s && s.left >= 280
    }, 6000)
    const layoutOpenAB = await canvasRectAB()
    await setNodeTreeCollapsed(page, true)
    // 导航栏现在全局常驻（48px），折叠后 top-left 控件回到「rail 让位基线」，
    // 不再是旧版的 12px 原点；位置本身仍由 CSS 变量驱动，画布几何不变。
    await waitFor(page, () => {
      const s = document.querySelector('.react-flow__panel.top.left')?.getBoundingClientRect()
      return !!s && s.left >= 48 && s.left < 80
    }, 6000)
    const layoutFoldedAB = await canvasRectAB()
    // 折叠态面板完全不渲染；唯一开关是全局导航栏里激活的竖 tab。
    const foldedEntryAB = await page.evaluate(() => {
      const tab = document.querySelector('[data-tm-left-dock-active="true"]')
      return {
        panelExists: !!document.querySelector('[data-tm-node-tree-panel]'),
        tabVisible: !!tab && tab.getBoundingClientRect().width > 0,
      }
    })
    check('【阶段 AB】折叠态不渲染面板，唯一开关是全局导航栏 tab',
      !foldedEntryAB.panelExists && foldedEntryAB.tabVisible,
      JSON.stringify(foldedEntryAB))

    // 走真实用户路径：点同一个 tab 从折叠态重新展开。
    await setNodeTreeCollapsed(page, false)
    await waitFor(page, () => {
      const s = document.querySelector('.react-flow__panel.top.left')?.getBoundingClientRect()
      return !!s && s.left >= 280
    }, 6000)
    check('【阶段 AB】竖 tab 能从折叠态重新展开节点树',
      await waitFor(page, () => document.querySelector('[data-tm-node-tree-panel]')
        ?.getAttribute('data-tm-node-tree-collapsed') === 'false', 6000))
    const layoutReopenAB = await canvasRectAB()
    const rectOpenAB = layoutOpenAB.rect
    const rectFoldedAB = layoutFoldedAB.rect
    const rectReopenAB = layoutReopenAB.rect
    check('【阶段 AB】展开/折叠对画布尺寸完全无感知',
      !!rectOpenAB && JSON.stringify(rectOpenAB) === JSON.stringify(rectFoldedAB)
      && JSON.stringify(rectOpenAB) === JSON.stringify(rectReopenAB),
      JSON.stringify({ rectOpenAB, rectFoldedAB, rectReopenAB }))
    check('【阶段 AB】面板展开时状态抽屉挤到右侧，折叠后回原位且宽度不变',
      !!layoutOpenAB.status && layoutOpenAB.status.left >= 280
      && !!layoutFoldedAB.status && layoutFoldedAB.status.left >= 48 && layoutFoldedAB.status.left < 80
      && layoutReopenAB.status?.left === layoutOpenAB.status.left
      && layoutOpenAB.status.width === layoutFoldedAB.status?.width,
      JSON.stringify({ open: layoutOpenAB.status, folded: layoutFoldedAB.status, reopen: layoutReopenAB.status }))
    rowsAB = await readRowsAB()

    const typeSearchAB = (value) => page.evaluate((v) => {
      const input = document.querySelector('[data-tm-node-tree-search]')
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await typeSearchAB('LOD 三级')
    check('【阶段 AB】搜索命中时切成平铺结果', await waitFor(page, () =>
      [...document.querySelectorAll('[data-tm-node-tree-hit]')]
        .some((el) => (el.getAttribute('data-tm-node-tree-key') || '').includes(':lod-g1')), 6000))
    await typeSearchAB('')
    check('【阶段 AB】清空搜索后恢复整棵树', await waitFor(page, () =>
      !document.querySelector('[data-tm-node-tree-hit]')
      && !!document.querySelector('[data-tm-node-tree-row]'), 6000))

    const roomChevronAB = await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-tm-node-tree-row]')]
        .find((el) => el.getAttribute('data-tm-node-tree-id') === 'node-a')
      const btn = row?.querySelector('[data-tm-node-tree-chevron]')
      if (!btn) return false
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return true
    })
    check('【阶段 AB】点击房间箭头才按需加载子房间', roomChevronAB
      && await waitFor(page, () => Number(document.querySelector('[data-tm-node-tree-panel]')
        ?.getAttribute('data-tm-node-tree-loaded-rooms') || '0') >= 1, 8000))
    // 子房间刚加载，其节点默认折叠（懒加载）；再点「展开全部」才能验房间子层级。
    await page.evaluate(() => {
      document.querySelector('[data-tm-node-tree-expand-all]')?.click()
    })
    await waitFor(page, () =>
      !!document.querySelector('[data-tm-node-tree-row][data-tm-node-tree-id="ab"]'), 6000)
    rowsAB = await readRowsAB()
    const nodeAIndexAB = rowsAB.findIndex((row) => row.id === 'node-a')
    check('【阶段 AB】房间子节点默认第一、AA 的子节点挂 AA 下、房间游离在末尾',
      rowsAB[nodeAIndexAB + 1]?.id === 'aa'
      && rowsAB[nodeAIndexAB + 1]?.origin === 'room-child'
      && rowsAB[nodeAIndexAB + 2]?.id === 'ab'
      && rowsAB[nodeAIndexAB + 2]?.sortable === 'false'
      && rowsAB[nodeAIndexAB + 3]?.id === 'af'
      && rowsAB[nodeAIndexAB + 3]?.origin === 'free',
      JSON.stringify(rowsAB.slice(nodeAIndexAB, nodeAIndexAB + 5)))

    const coordsBeforeAB = readGraph().children || {}
    await page.evaluate(() => {
      const dt = new DataTransfer()
      const rows = [...document.querySelectorAll('[data-tm-node-tree-row]')]
      const src = rows.find((el) => el.getAttribute('data-tm-node-tree-id') === 'lod-c1')
      const dst = rows.find((el) => el.getAttribute('data-tm-node-tree-id') === 'lod-c2')
      if (!src || !dst) return
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    let orderWrittenAB = false
    for (let i = 0; i < 30 && !orderWrittenAB; i += 1) {
      const children = readGraph().children || {}
      orderWrittenAB = children['lod-c2']?.treeOrder === 0 && children['lod-c1']?.treeOrder === 1
      if (!orderWrittenAB) await sleep(150)
    }
    check('【阶段 AB】同父拖动排序写入 treeOrder 并后台落盘', orderWrittenAB,
      JSON.stringify({ c1: readGraph().children?.['lod-c1'], c2: readGraph().children?.['lod-c2'] }))
    const coordsAfterAB = readGraph().children || {}
    check('【阶段 AB】排序只写 treeOrder，绝不改画布坐标',
      coordsBeforeAB['lod-c1']?.x === coordsAfterAB['lod-c1']?.x
      && coordsBeforeAB['lod-c1']?.y === coordsAfterAB['lod-c1']?.y
      && coordsBeforeAB['lod-c2']?.x === coordsAfterAB['lod-c2']?.x
      && coordsBeforeAB['lod-c2']?.y === coordsAfterAB['lod-c2']?.y,
      JSON.stringify({ before: [coordsBeforeAB['lod-c1'], coordsBeforeAB['lod-c2']],
        after: [coordsAfterAB['lod-c1'], coordsAfterAB['lod-c2']] }))
    // 展开态记忆：折叠 lod-root → 收起/重开面板 → 仍折叠，且已按房间写进 localStorage。
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-tm-node-tree-row]')]
        .find((el) => el.getAttribute('data-tm-node-tree-id') === 'lod-root')
      row?.querySelector('[data-tm-node-tree-chevron]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await setNodeTreeCollapsed(page, true)
    await setNodeTreeCollapsed(page, false)
    const persistedAB = await page.evaluate(() => {
      let keys = []
      try { keys = Object.values(JSON.parse(localStorage.getItem('topomind_node_tree_expanded_v2') || '{}')).flat() } catch { /* 忽略脏值 */ }
      return {
        expanded: [...document.querySelectorAll('[data-tm-node-tree-row]')]
          .find((el) => el.getAttribute('data-tm-node-tree-id') === 'lod-root')
          ?.getAttribute('data-tm-node-tree-expanded'),
        rootKey: document.querySelector('[data-tm-node-tree-panel]')
          ?.getAttribute('data-tm-node-tree-root-key') || '',
        keys: keys.map(String),
      }
    })
    check('【阶段 AB】展开状态按房间记忆（重开面板仍保留并写入 localStorage）',
      persistedAB.expanded === 'false'
      && persistedAB.keys.includes(persistedAB.rootKey)
      && !persistedAB.keys.some((key) => key.endsWith(':lod-root')),
      JSON.stringify(persistedAB))

    // 后续阶段要真实点击画布左侧节点，左栏保持折叠（画布无感知，尺寸已验证不变）。
    await setNodeTreeCollapsed(page, true)

    // ===== 阶段 Z：双击关联连线编辑自定义关系名（轻量浮层贴在双击处） =====
    // 直接在 lod-e4 的 SVG 组上派发 dblclick，避开视口/LOD 命中误差；验浮层锚点、
    // 线上标签与后台落盘后「恢复默认名」把夹具还原，不影响后面「关联边恒显示
    // 全局关系名」的既有断言。
    const edgeReadyZ = await waitFor(page, () =>
      !!document.querySelector('.react-flow__edge[data-id="lod-e4"]'), 8000)
    check('【阶段 Z】关联连线 lod-e4 已渲染', edgeReadyZ)
    if (edgeReadyZ) {
      const typeLabelZ = async (value) => {
        await page.evaluate((v) => {
          const input = document.querySelector('[data-tm-edge-relation-label-input]')
          if (!input) return
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, v)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }, value)
        await sleep(60)
        await page.evaluate(() => document.querySelector('[data-tm-edge-relation-label-input]')?.focus())
        await page.keyboard.press('Enter')
      }
      const popupZ = await page.evaluate(() => {
        const edge = document.querySelector('.react-flow__edge[data-id="lod-e4"]')
        if (!edge) return null
        const x = 412
        const y = 468
        edge.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
        }))
        return { x, y }
      })
      check('【阶段 Z】双击连线在双击处打开轻量关系编辑器', popupZ !== null
        && await waitFor(page, () => !!document.querySelector('[data-tm-edge-relation-editor]'), 5000))
      check('【阶段 Z】编辑器锚点 = 双击坐标、无全屏遮罩、尺寸轻量', await page.evaluate((p) => {
        const el = document.querySelector('[data-tm-edge-relation-editor]')
        if (!el || !p) return false
        const r = el.getBoundingClientRect()
        return el.getAttribute('data-tm-edge-relation-inline') === 'true'
          && Number(el.getAttribute('data-tm-edge-relation-anchor-x')) === p.x
          && Number(el.getAttribute('data-tm-edge-relation-anchor-y')) === p.y
          && r.left >= 0 && r.top >= 0
          && r.left <= window.innerWidth && r.top <= window.innerHeight
          && r.width < 300 && r.height < 300
          && !document.querySelector('[data-tm-edge-relation-picker]')
      }, popupZ))

      await typeLabelZ('前置知识')
      check('【阶段 Z】Enter 保存后浮层关闭', await waitFor(page, () =>
        !document.querySelector('[data-tm-edge-relation-editor]'), 5000))
      check('【阶段 Z】关联边线上标签显示自定义关系名', await page.evaluate(() =>
        [...document.querySelectorAll('[data-tm-edge-relation-label="related"]')]
          .some((el) => (el.textContent || '').trim() === '前置知识'
            && el.getAttribute('data-tm-edge-relation-mandatory') === 'true')))

      let savedZ = false
      for (let i = 0; i < 30 && !savedZ; i += 1) {
        const g = readGraph()
        savedZ = (g.edges || []).some((e) => e.id === 'lod-e4' && e.relationLabel === '前置知识')
        if (!savedZ) await sleep(150)
      }
      check('【阶段 Z】后台保存把自定义关系名写进 _graph.json', savedZ,
        JSON.stringify((readGraph().edges || []).map((e) => ({ id: e.id, relationLabel: e.relationLabel }))))

      // 还原夹具：恢复默认名 → 字段从磁盘删除，后续全局改名断言不受影响。
      await page.evaluate(() => {
        const edge = document.querySelector('.react-flow__edge[data-id="lod-e4"]')
        edge?.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, clientX: 412, clientY: 468,
        }))
      })
      const resetReadyZ = await waitFor(page, () => !!document.querySelector('[data-tm-edge-relation-label-reset]'), 5000)
      check('【阶段 Z】有自定义名时提供「恢复默认名」', resetReadyZ)
      if (resetReadyZ) {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-tm-edge-relation-label-reset]')
          btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        })
        let clearedZ = false
        for (let i = 0; i < 30 && !clearedZ; i += 1) {
          const g = readGraph()
          clearedZ = !(g.edges || []).some((e) => e.id === 'lod-e4' && e.relationLabel)
          if (!clearedZ) await sleep(150)
        }
        check('【阶段 Z】恢复默认名后自定义字段从磁盘删除', clearedZ
          && await page.evaluate(() => !document.querySelector('[data-tm-edge-relation-editor]')))
      }
    }

    // ===== 阶段 AA：连线工具栏下拉菜单层级（两端锚点不得穿透菜单面板） =====
    // 静态工具栏 z=10 让锚点优先抓指针；关系菜单 / 样式面板展开时必须把整个工具栏
    // 提到 20（> 锚点 11、弯曲手柄 12），否则 absolute 面板覆盖到手柄时会被「穿透」。
    const toolbarZAA = () => page.evaluate(() => {
      const el = document.querySelector('[data-edge-toolbar-anchor]')
      return el ? Number(getComputedStyle(el).zIndex) : null
    })
    const selectedAA = await page.evaluate(() => {
      const edge = document.querySelector('.react-flow__edge[data-id="lod-e4"]')
      if (!edge) return false
      edge.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0, clientX: 412, clientY: 468,
      }))
      return true
    })
    check('【阶段 AA】可程序化选中关联连线', selectedAA
      && await waitFor(page, () => !!document.querySelector('[data-edge-toolbar-anchor]'), 5000))
    check('【阶段 AA】静态工具栏层级 10（锚点仍优先抓指针）', (await toolbarZAA()) === 10,
      String(await toolbarZAA()))
    const menuOpenAA = await page.evaluate(() => {
      const trigger = document.querySelector('[data-tm-edge-relation-trigger]')
      if (!trigger) return false
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      return true
    })
    check('【阶段 AA】展开连线关系下拉菜单', menuOpenAA
      && await waitFor(page, () => !!document.querySelector('[data-tm-edge-relation-menu]'), 5000))
    check('【阶段 AA】菜单展开后工具栏提到 20，高于锚点 11 / 弯曲 12',
      await waitFor(page, () => {
        const el = document.querySelector('[data-edge-toolbar-anchor]')
        return !!el && Number(getComputedStyle(el).zIndex) === 20
      }, 5000), String(await toolbarZAA()))
    const aaHit = await page.evaluate(() => {
      const menu = document.querySelector('[data-tm-edge-relation-menu]')
      if (!menu) return { ok: false, diag: 'no menu' }
      const r = menu.getBoundingClientRect()
      // 左上状态面板 / 右栏等浮层在 renderer 层叠上下文之上，会参与 hit-test；
      // 临时让它们不吃指针，才能单独比较「菜单 vs 锚点手柄」的层叠顺序。
      const blockers = [...document.querySelectorAll('.react-flow__panel, .right-panel-container')]
      const saved = blockers.map((el) => el.style.pointerEvents)
      blockers.forEach((el) => { el.style.pointerEvents = 'none' })
      let diag = []
      try {
        // 只检查「手柄中心确实落在菜单矩形内」的真正覆盖：矩形擦边相交时中心
        // 仍在菜单外，命中到手柄是正常的，不该算穿透。
        diag = [...document.querySelectorAll('[data-anchor-side]')].map((h) => {
          const a = h.getBoundingClientRect()
          const cx = (a.left + a.right) / 2
          const cy = (a.top + a.bottom) / 2
          const covered = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
          const stack = covered ? [...document.elementsFromPoint(cx, cy)] : []
          return {
            side: h.getAttribute('data-anchor-side'),
            covered,
            menuIndex: stack.indexOf(menu),
            handleIndex: stack.indexOf(h),
            top: stack[0] ? stack[0].tagName + '.' + String(stack[0].className ?? '').slice(0, 40) : '',
          }
        })
      } finally {
        blockers.forEach((el, i) => { el.style.pointerEvents = saved[i] })
      }
      // 不截断 stack：顶层浮层的祖先链很长，菜单 / 手柄可能排在很后面。
      return {
        ok: diag.filter((d) => d.covered).every((d) =>
          d.menuIndex >= 0 && (d.handleIndex < 0 || d.menuIndex < d.handleIndex)),
        diag,
      }
    })
    check('【阶段 AA】菜单覆盖锚点时命中优先于锚点手柄（不穿透）', aaHit.ok,
      JSON.stringify(aaHit.diag))
    await page.evaluate(() => {
      document.querySelector('[data-tm-edge-relation-trigger]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    check('【阶段 AA】收起菜单后层级回落到 10', await waitFor(page, () => {
      const el = document.querySelector('[data-edge-toolbar-anchor]')
      return !!el && Number(getComputedStyle(el).zIndex) === 10
        && !document.querySelector('[data-tm-edge-relation-menu]')
    }, 5000), String(await toolbarZAA()))
    // 清掉连线选中，避免影响后续阶段 A 的右键菜单 / 右栏状态
    await page.evaluate(() => {
      document.querySelector('.react-flow__pane')?.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0, clientX: 700, clientY: 300,
      }))
    })
    // 这是真实 DOM 事件，会按新交互规则自动折叠右栏；后续关联视图用例需要展开基线。
    await setRightPanelCollapsed(page, false)

    // ---- 阶段 A / T：统一树按需加载 + 文档树路径 + 上限 8 ----
    check('右键菜单含「关联已有文档…」', await openLinkDialog(page) &&
      await page.evaluate(() => (document.body.innerText || '').includes('关联已有文档')))

    const treeRead = () => page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return {
        levels: Number(dlg?.getAttribute('data-tm-link-document-levels') || '0'),
        searching: dlg?.getAttribute('data-tm-link-document-search') === 'true',
        rows: [...(dlg?.querySelectorAll('[data-tm-unified-tree-node]') ?? [])].map((el) => ({
          kind: el.getAttribute('data-tm-unified-tree-node') || '',
          text: el.innerText || '',
          depth: Number(el.getAttribute('data-tm-unified-tree-depth') || '0'),
          origin: el.getAttribute('data-tm-unified-tree-origin') || '',
          hasDocs: el.getAttribute('data-tm-unified-tree-has-docs') || '',
        })),
        docs: [...(dlg?.querySelectorAll('[data-tm-link-document-id]') ?? [])].map((el) => ({
          docId: el.getAttribute('data-tm-link-document-id') || '',
          path: el.getAttribute('data-tm-link-document-path') || '',
          text: el.innerText || '',
        })),
      }
    })
    // 第一个按钮是展开箭头：对 card / group / document 都只展开，不会误勾选文档。
    const expandTreeNode = (label) => page.evaluate((text) => {
      const dlg = document.querySelector('[role="dialog"]')
      const row = [...(dlg?.querySelectorAll('[data-tm-unified-tree-node]') ?? [])]
        .find((el) => (el.innerText || '').split('\n')[0].trim() === text)
      const button = row?.querySelector('button')
      button?.click()
      return !!button
    }, label)

    // 根层按层查询是异步 IPC：等树真正渲染出行，再断言默认视图。
    await waitFor(page, () => Number(document.querySelector('[role="dialog"] [data-tm-unified-tree-rows]')?.getAttribute('data-tm-unified-tree-rows') || '0') > 0, 8000)
    const initialTree = await treeRead()
    check('【阶段 T】对话框默认只加载顶层根（1 层、不平铺文档）',
      initialTree.levels === 1 && initialTree.rows.length >= 2 &&
      initialTree.rows.every((r) => r.kind !== 'document') && initialTree.docs.length === 0,
      JSON.stringify({ levels: initialTree.levels, rows: initialTree.rows.length, docs: initialTree.docs.length }))
    check('【阶段 T】顶层含知识库与离散节点分组',
      initialTree.rows.some((r) => r.text.includes(KB_NAME)) &&
      initialTree.rows.some((r) => r.text.includes('离散节点')),
      JSON.stringify(initialTree.rows.map((r) => r.text.split('\n')[0])))

    check('【阶段 T】展开知识库才加载第 2 层', await expandTreeNode(KB_NAME) &&
      await waitFor(page, () => Number(document.querySelector('[role="dialog"]')?.getAttribute('data-tm-link-document-levels') || '0') === 2, 6000))
    const kbTree = await treeRead()
    const level2 = kbTree.rows.filter((r) => r.depth === 1 && r.kind === 'card')
    // ---- 阶段 U：只列有文档的节点 + 连线树逐层下钻 + 房间/从属/仅路径来源区分 ----
    check('【阶段 U】第 2 层只列出有文档的节点（空节点全部剪掉）',
      level2.length === 3 &&
      ['节点 A', '节点 B', 'LOD 树根'].every((name) =>
        level2.some((r) => r.text.split('\n')[0].trim() === name)) &&
      level2.every((r) => r.hasDocs === 'true') &&
      !kbTree.rows.some((r) => /LOD 一级 B|LOD 三级|LOD 游离|stray-node/.test(r.text)),
      JSON.stringify(level2.map((r) => `${r.text.split('\n')[0]}:${r.origin}:${r.hasDocs}`)))
    const originLabels = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')
    check('【阶段 U】房间与从属两种来源在树里可区分',
      level2.some((r) => r.origin === 'room') && level2.some((r) => r.origin === 'subordinate') &&
      originLabels.includes('从属') && originLabels.includes('房间'),
      JSON.stringify(level2.map((r) => r.origin)))
    check('【阶段 U】展开连线树根才加载下一层（不一次性平铺连线子节点）',
      await expandTreeNode('LOD 树根') &&
      await waitFor(page, () => [...document.querySelectorAll('[role="dialog"] [data-tm-unified-tree-node="card"]')]
        .some((el) => (el.innerText || '').split('\n')[0].trim() === 'LOD 一级 A'), 6000))
    const bridgeTree = await treeRead()
    const bridgeRow = bridgeTree.rows.find((r) => r.text.split('\n')[0].trim() === 'LOD 一级 A')
    check('【阶段 U】自身无文档、仅靠连线后代保留的容器标「仅路径」且仍可展开',
      bridgeRow?.depth === 2 && bridgeRow.origin === 'path' && bridgeRow.hasDocs === 'false' &&
      bridgeTree.rows.some((r) => r.text.includes('仅路径')),
      JSON.stringify(bridgeRow))
    check('【阶段 U】无文档的连线兄弟节点仍不列出',
      !bridgeTree.rows.some((r) => r.text.includes('LOD 一级 B')),
      JSON.stringify(bridgeTree.rows.map((r) => r.text.split('\n')[0])))
    check('【阶段 U】展开仅路径容器才到达真正挂文档的连线叶子',
      await expandTreeNode('LOD 一级 A') &&
      await waitFor(page, () => [...document.querySelectorAll('[role="dialog"] [data-tm-unified-tree-node="card"]')]
        .some((el) => (el.innerText || '').split('\n')[0].trim() === 'LOD 三级'), 6000))
    const leafTree = await treeRead()
    const leafRow = leafTree.rows.find((r) => r.text.split('\n')[0].trim() === 'LOD 三级')
    check('【阶段 U】连线叶子是更深一层的从属行且自身有文档',
      leafRow?.depth === 3 && leafRow.origin === 'subordinate' && leafRow.hasDocs === 'true',
      JSON.stringify(leafRow))
    check('【阶段 T】离散节点分组展开后列出未登记节点', await expandTreeNode('离散节点') &&
      await waitFor(page, () => [...document.querySelectorAll('[role="dialog"] [data-tm-unified-tree-orphan="true"]')]
        .some((el) => (el.innerText || '').includes('stray-node')), 6000))

    check('【阶段 T】展开节点 B 才加载第 3 层文档', await expandTreeNode('节点 B') &&
      await waitFor(page, () => [...document.querySelectorAll('[role="dialog"] [data-tm-link-document-id]')].length >= 9, 6000))
    const nodeTree = await treeRead()
    check('对话框列出候选文档与面包屑', nodeTree.docs.length >= 9 &&
      nodeTree.docs.some((r) => r.text.includes(LINK_TITLE)) &&
      nodeTree.docs.some((r) => r.text.includes('测试库 / 节点 B')),
      `${nodeTree.docs.length} 个候选 / ${nodeTree.levels} 层`)

    check('【阶段 T】文档树逐层展开到同名文档', await expandTreeNode('需求分组') &&
      await waitFor(page, () => [...document.querySelectorAll('[role="dialog"] [data-tm-unified-tree-node]')]
        .some((el) => (el.innerText || '').split('\n')[0].trim() === '子分组'), 6000) &&
      await expandTreeNode('子分组') &&
      await waitFor(page, () => !!document.querySelector('[role="dialog"] [data-tm-link-document-id="doc_nested"]'), 6000))
    const candidateRows = (await treeRead()).docs
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
    await sleep(650)
    const byPath = await page.evaluate(() => [
      ...(document.querySelector('[role="dialog"]')?.querySelectorAll('[data-tm-link-document-id]') ?? []),
    ].map((b) => b.getAttribute('data-tm-link-document-id') || ''))
    check('可按节点内文档路径检索候选',
      byPath.includes('doc_nested') && !byPath.includes('doc_b') && !byPath.includes('doc_group'),
      JSON.stringify(byPath))
    check('【阶段 T】输入搜索才切换为跨层结果（默认仍是树）',
      (await treeRead()).searching === true && byPath.length > 0)
    await setDialogQuery('')
    await sleep(450)

    // 清空 query 回到树浏览，展开状态保留；点所有可见文档行验证 8 篇上限。
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      ;[...dlg.querySelectorAll('[data-tm-link-document-id]')].forEach((el) => {
        const button = el.matches('button') ? el : el.querySelectorAll('button')[1]
        button?.click()
      })
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

    // ---- 阶段 B：搜索直达 + 保存 1 篇关联 ----
    await openLinkDialog(page)
    await setDialogQuery(LINK_TITLE)
    await waitFor(page, () => !!document.querySelector('[role="dialog"] [data-tm-link-document-id="doc_b"]'), 6000)
    await page.evaluate(() => {
      document.querySelector('[role="dialog"] [data-tm-link-document-id="doc_b"]')?.click()
    })
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
    // 先折叠右栏，验证「点击卡片上的关联图标」本身就能把右栏打开。
    await setRightPanelCollapsed(page, true)
    const collapsedBeforeBadgeC = await page.evaluate(() => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display === 'none'
    })
    check('【阶段 C】关联图标点击前右栏已折叠', collapsedBeforeBadgeC)

    const badge = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('篇关联文档'))
      return { exists: !!b, title: b?.getAttribute('title') || '' }
    })
    check('节点标题前出现可点击链环语义标记', badge.exists && badge.title.includes('1 篇'), badge.title)
    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('title') || '').includes('篇关联文档'))?.click())
    await sleep(1500)
    const badgeExpandedC = await waitFor(page, () => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display !== 'none'
    }, 6000)
    check('【阶段 C】点击关联文档图标自动展开右栏', badgeExpandedC)
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

    // ===== 阶段 AC：右侧列表统一视觉语言（标题条 / 紧凑双行 / 语义图标 / 纯色不透明） =====
    const ac = await page.evaluate(() => {
      const rail = [...document.querySelectorAll('button[aria-label]')]
        .filter((b) => ['文档', '附件', '引用关系'].includes(b.getAttribute('aria-label') || ''))
        .map((b) => ({
          label: b.getAttribute('aria-label'),
          text: (b.textContent || '').trim(),
          svg: b.querySelectorAll('svg').length,
        }))
      const header = [...document.querySelectorAll('div')].find((el) =>
        typeof el.className === 'string' && el.className.includes('h-10')
        && (el.textContent || '').includes('关联文档') && el.querySelector('button')) || null
      const rows = [...document.querySelectorAll('button[title="移除关联"]')]
        .map((b) => b.closest('div.group')).filter(Boolean)
      const rowInfo = rows.map((row) => {
        const spans = [...row.querySelectorAll('span')]
        // 第二行容器自身也以「来源：」开头，必须按小字号锁定真正的元信息 span。
        const meta = spans.find((s) => (s.textContent || '').trim().startsWith('来源：')
          && s.className.includes('text-[10px]'))
        const title = spans.find((s) => typeof s.className === 'string'
          && s.className.includes('text-[12px]') && (s.textContent || '').trim())
        const cs = getComputedStyle(row)
        const metaTop = meta ? meta.getBoundingClientRect().top : -1
        const titleTop = title ? title.getBoundingClientRect().top : -1
        return {
          height: Math.round(row.getBoundingClientRect().height),
          radius: parseFloat(cs.borderTopLeftRadius) || 0,
          svg: row.querySelectorAll('svg').length,
          metaFound: !!meta, titleFound: !!title,
          // 真正的「第二行」：小字号元信息必须渲染在标题的下方，而不是与标题同行或同一元素。
          metaSeparate: !!meta && !!title && meta !== title
            && meta.className.includes('text-[10px]') && metaTop > titleTop + 2,
          emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(row.textContent || ''),
        }
      })
      const bg = [...document.querySelectorAll('aside, #detail-panel')].map((el) => {
        const cs = getComputedStyle(el)
        return { image: cs.backgroundImage, color: cs.backgroundColor }
      })
      // 只否决列表行祖先链上的旧 surface→bg 竖向渐变；编辑器主体自带渐变不属本契约。
      const legacyGradients = (() => {
        const hits = []
        let el = rows[0] || null
        while (el) {
          const cls = typeof el.className === 'string' ? el.className : ''
          if (cls.includes('bg-gradient-to-b') && cls.includes('from-[var(--color-surface)]')
            && cls.includes('to-[var(--color-bg)]')) hits.push(el.tagName)
          el = el.parentElement
        }
        return hits
      })()
      const footer = [...document.querySelectorAll('div')].find((el) =>
        el.children.length === 0 && (el.textContent || '').includes('最多关联 8 篇'))
      return {
        rail,
        header: header ? {
          height: Math.round(header.getBoundingClientRect().height),
          border: getComputedStyle(header).borderBottomWidth,
          count: /\d+\s*\/\s*8/.test(header.textContent || ''),
          add: [...header.querySelectorAll('button')].some((b) => (b.textContent || '').includes('添加')),
        } : null,
        rowInfo, bg, legacyGradients, footer: !!footer,
      }
    })
    check('【阶段 AC】rail 三个页签改为语义图标且保留原 aria-label',
      ['文档', '附件', '引用关系'].every((label) => ac.rail.some((r) => r.label === label))
      && ac.rail.every((r) => r.svg > 0 && r.text === ''),
      JSON.stringify(ac.rail))
    check('【阶段 AC】列表有细边框标题条（40px / 计数 / 添加按钮）',
      !!ac.header && ac.header.height >= 36 && ac.header.height <= 44
      && ac.header.border !== '0px' && ac.header.count && ac.header.add,
      JSON.stringify(ac.header))
    check('【阶段 AC】关联行紧凑圆角、来源独占第二行、无 emoji',
      ac.rowInfo.length > 0 && ac.rowInfo.every((r) =>
        r.height >= 26 && r.height <= 52 && r.radius >= 4 && r.svg > 0
        && r.metaSeparate && !r.emoji),
      JSON.stringify(ac.rowInfo))
    check('【阶段 AC】侧栏 / 详情区为纯色不透明背景且无旧渐变',
      ac.bg.length > 0 && ac.bg.every((b) => b.image === 'none')
      && ac.bg.some((b) => b.color !== 'rgba(0, 0, 0, 0)')
      && ac.legacyGradients.length === 0,
      JSON.stringify({ bg: ac.bg, legacyGradients: ac.legacyGradients }))
    check('【阶段 AC】底部轻量说明与左侧节点树同款',
      ac.footer, JSON.stringify({ footer: ac.footer }))

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
    await waitFor(page, () => Number(document.querySelector('[data-tm-doc-link-picker] [data-tm-unified-tree-rows]')?.getAttribute('data-tm-unified-tree-rows') || '0') > 0, 8000)
    const pickerInitial = await page.evaluate(() => {
      const p = document.querySelector('[data-tm-doc-link-picker]')
      return {
        levels: Number(p?.getAttribute('data-tm-doc-link-levels') || '0'),
        docs: p?.querySelectorAll('[data-tm-doc-link-item]').length ?? 0,
        rows: p?.querySelectorAll('[data-tm-unified-tree-node]').length ?? 0,
      }
    })
    check('【阶段 T】编辑器选择器同样默认只加载顶层根',
      pickerInitial.levels === 1 && pickerInitial.docs === 0 && pickerInitial.rows >= 2,
      JSON.stringify(pickerInitial))
    // 输入搜索才跨层检索（派生索引），结果行与旧契约保持同款诊断属性。
    await page.evaluate((title) => {
      const input = document.querySelector('[data-tm-doc-link-picker] input')
      if (!input) return
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, title)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, LINK_TITLE)
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
    // 【三边栏改造 2026-11-25】样式 / 连线关系已从全局设置页与右栏整体迁入
    // 画布页左栏「画布设置」页；这里先确认旧入口确已移除，再回画布打开新入口。
    await page.evaluate(() => document.querySelector('[data-tm-nav-item="settings"]')?.click())
    await sleep(650)
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

    await page.evaluate(() => document.querySelector('[data-tm-tab-bar] [role="tab"]')?.click())
    await sleep(400)
    await openCanvasSettings(page)
    await page.evaluate(() => {
      // 全局设置页现在只剩引导；真正的 StyleSection 在左栏画布设置的样式分区里。
      const root = document.querySelector('[data-tm-canvas-settings-panel]')
      const group = root?.querySelector('[role="radiogroup"][aria-label="样式面板分区"]')
      const button = Array.from(group?.querySelectorAll('button') ?? [])
        .find((item) => item.textContent?.trim() === '连线关系')
      button?.click()
    })
    check('左栏画布设置「连线关系」管理面板可打开', await waitFor(page, () =>
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
    // 用完立刻切回节点结构页并收起左栏，避免 absolute 浮层盖住后续 LOD 阶段的画布节点。
    await closeCanvasSettings(page)

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
      const attr = (name) => Number(el?.getAttribute(name) ?? '0')
      return {
        ids: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')),
        active: el?.getAttribute('data-tm-lod-active'),
        visibleCount: attr('data-tm-lod-visible-count'),
        totalNodes: attr('data-tm-lod-total-nodes'),
        treeMaxDepth: attr('data-tm-lod-tree-max-depth'),
        visibleDepthLevels: attr('data-tm-lod-visible-depth-levels'),
        collapsedTotal: attr('data-tm-lod-collapsed-total'),
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
    // 【诊断文案收口 2026-11-25】「树覆盖 50% / 隐藏 N 节点」的可见行已移除，
    // 同一份事实改由 [data-tm-lod-control] 的语义属性直读（LodControl.tsx 仍是唯一真源）。
    check('控件以语义属性暴露节点总数 / 可见数 / 隐藏数 / 树最大深度',
      lodSmall.totalNodes === 8 && lodSmall.treeMaxDepth === 3
      && lodSmall.visibleCount > 1 && lodSmall.visibleCount < lodSmall.totalNodes
      && lodSmall.totalNodes - lodSmall.visibleCount > 0
      && lodSmall.visibleDepthLevels >= 1,
      JSON.stringify({ total: lodSmall.totalNodes, visible: lodSmall.visibleCount,
        hidden: lodSmall.totalNodes - lodSmall.visibleCount, maxDepth: lodSmall.treeMaxDepth,
        levels: lodSmall.visibleDepthLevels }))

    // 【P0 方向铁律，2026-11-09】用户报「缩小的时候树的主干先消失」。
    // 逐深度「可见/总数」的可见行已收口为一行选中节点深度，事实改由语义属性直读。
    const depthPanel = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-depth-panel]')
      const control = document.querySelector('[data-tm-lod-control]')
      return {
        exists: !!el,
        maxDepth: el?.getAttribute('data-tm-lod-tree-max-depth') || '',
        selectedDepth: el?.getAttribute('data-tm-lod-selected-depth') || '',
        controlMaxDepth: control?.getAttribute('data-tm-lod-tree-max-depth') || '',
        visibleDepthLevels: control?.getAttribute('data-tm-lod-visible-depth-levels') || '',
        visibleCount: control?.getAttribute('data-tm-lod-visible-count') || '',
        text: el?.textContent || '',
      }
    })
    check('层级诊断属性挂在状态面板与根节点（最大深度 / 可见层数 / 选中深度）',
      depthPanel.exists && depthPanel.maxDepth === '3' && depthPanel.controlMaxDepth === '3'
      && Number(depthPanel.visibleDepthLevels) >= 2 && Number(depthPanel.visibleCount) > 0
      && (depthPanel.text.includes('选中节点深度') || depthPanel.text.includes('点选节点查看深度')),
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
    // 逐深度 DOM 行收口后，用「可见节点数首次下降」定位渐隐起点，
    // 再断言该格树根仍在、父子链完整（chainIntact 才是真正不变量）。
    const deepCollapseIndex = visibleCounts.findIndex((count, i) => i > 0 && count < visibleCounts[0])
    check('开始渐隐后树根仍可见、且该格没有父子断链',
      deepCollapseIndex >= 0 && !!chainSteps[deepCollapseIndex]
      && chainSteps[deepCollapseIndex].includes('lod-root')
      && chainIntact(chainSteps[deepCollapseIndex]),
      JSON.stringify({ deepCollapseIndex, count: visibleCounts[deepCollapseIndex],
        ids: chainSteps[deepCollapseIndex] }))
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

    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-mode="off"]')?.click()))
    await sleep(250)
    check('关闭 LOD 后全部节点回来', await page.evaluate(() =>
      !!document.querySelector('.react-flow__node[data-id="node-a"]')
      && document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-active') === 'false'))

    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-mode="auto"]')?.click()))
    await sleep(250)
    check('切回自动档重新按连续阈值收起边缘节点', await page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      return el?.getAttribute('data-tm-lod-active') === 'true'
        && Number(el?.getAttribute('data-tm-lod-visible-count') ?? '99') < 8
    }))

    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-mode="force"]')?.click()))
    await sleep(250)
    check('强制模式状态为 forced', await page.evaluate(() =>
      document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-reason') === 'forced'))
    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-mode="auto"]')?.click()))

    // 缩小视图现在是只读态：后续图型 / 滑条阶段必须在 100% 下开始，
    // 否则 profile 会停在 52% 只读档并连锁污染缩放滑动条的显隐判定。
    // 恢复入口已统一为中间只读提示条的「恢复 100%」。
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    // 右栏浮层会盖住画布右侧，后续「真实点击节点」的用例先在折叠态跑；
    // 画布宽度恒定不变，折叠只影响遮挡，不影响任何布局断言。
    await setRightPanelCollapsed(page, true)

    // ===== 阶段 L：房间级图型分类（P3-A） =====
    // 图型存全局 _config.json 的 roomProfiles；验证写盘 / 刷新恢复 / LOD 定制 /
    // 用户手动模式压过图型，以及新字段不挤掉既有配置。
    const configPathL = path.join(WORKDIR, '_config.json')
    const profileState = () => withCanvasSettings(page, () => page.evaluate(() => {
      const panel = document.querySelector('[data-tm-lod-control]')
      const view = document.querySelector('[data-tm-canvas-view-settings]')
      return {
        value: document.querySelector('[data-tm-graph-profile-select]')?.value || '',
        options: [...document.querySelectorAll('[data-tm-graph-profile-select] option')].map((o) => o.value),
        effective: document.querySelector('[data-tm-graph-profile-effective]')?.getAttribute('data-tm-graph-profile-effective') || '',
        id: panel?.getAttribute('data-tm-graph-profile-id') || '',
        reason: panel?.getAttribute('data-tm-lod-reason') || '',
        active: panel?.getAttribute('data-tm-lod-active') || '',
        policySource: panel?.getAttribute('data-tm-lod-policy-source') || '',
        effectiveMode: panel?.getAttribute('data-tm-lod-effective-mode') || '',
        text: (view?.textContent || '').replace(/\s+/g, ' '),
        nodeA: !!document.querySelector('.react-flow__node[data-id="node-a"]'),
      }
    }))
    const initialProfile = await profileState()
    check('画布控件提供 4 种图型且旧房间默认自动识别',
      initialProfile.value === 'auto' && initialProfile.id === 'auto'
      && initialProfile.options.join(',') === 'auto,tree,flow,network',
      JSON.stringify({ value: initialProfile.value, options: initialProfile.options }))
    check('自动识别给出可解释的建议图型',
      initialProfile.effective === 'network' && initialProfile.text.includes('自动识别'),
      JSON.stringify({ effective: initialProfile.effective, text: initialProfile.text.slice(0, 80) }))

    await withCanvasSettings(page, () => page.select('[data-tm-graph-profile-select]', 'flow'))
    await sleep(350)
    const flowState = await profileState()
    // 「显示全部节点」以 LOD 可见集合为准：视口外的节点本来就不该被
    // onlyRenderVisibleElements 渲染，用 DOM 节点数判定会把视口裁剪误判成 LOD 回归。
    const flowVisibleCount = await page.evaluate(() =>
      Number(document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-visible-count') ?? '0'))
    check('流程图图型自动关闭语义缩放并显示全部节点',
      flowState.value === 'flow' && flowState.reason === 'off' && flowState.active === 'false'
      && flowState.policySource === 'profile' && flowVisibleCount === 8,
      JSON.stringify({ value: flowState.value, reason: flowState.reason, active: flowState.active,
        policySource: flowState.policySource, visibleCount: flowVisibleCount }))

    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-mode="force"]')?.click()))
    await sleep(250)
    const forcedState = await profileState()
    check('用户「强制」压过流程图的关闭策略',
      forcedState.reason === 'forced' && forcedState.policySource === 'user'
      && forcedState.effectiveMode === 'force',
      JSON.stringify({ reason: forcedState.reason, source: forcedState.policySource }))
    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-mode="auto"]')?.click()))
    await sleep(250)
    const backState = await profileState()
    check('切回自动后图型重新接管', backState.reason === 'off' && backState.policySource === 'profile',
      JSON.stringify({ reason: backState.reason, source: backState.policySource }))

    await withCanvasSettings(page, () => page.select('[data-tm-graph-profile-select]', 'tree'))
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
    const reloadedControl = await waitFor(page, () =>
      !!document.querySelector('[data-tm-lod-control]'), 15000)
    const reloadedViewControl = await withCanvasSettings(page, () => page.evaluate(() =>
      !!document.querySelector('[data-tm-graph-profile-select]')))
    check('重载后画布与镜头控件恢复', reloadedControl && reloadedViewControl)
    // reload 重置了右栏折叠态（Zustand 内存态），重新折叠以继续真实点击画布。
    await setRightPanelCollapsed(page, true)
    await setNodeTreeCollapsed(page, true)
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

    // 阶段 M（知识库总览覆盖层）已随功能整体移除；房间跳转走标题面包屑 / 最近打开。

    // ===== 阶段 N：比例规则（100% 上限 / 5% 下限 / 中间提示条恢复 / 滚轮缓动 / 渐隐渐出） =====
    // 左下角比例尺、步进按钮、复位按钮与缩略图已下线；比例读数取画布容器语义属性。
    const zoomPercent = () => page.evaluate(() =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') || '')
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
    // 左下角控件下线后的单一读数：画布容器比例 + 中间只读提示条 / 恢复按钮 / 滑块。
    const canvasZoomRead = () => page.evaluate(() => {
      const canvas = document.querySelector('[data-tm-canvas-zoom-percent]')
      const banner = document.querySelector('[data-tm-canvas-readonly-banner]')
      const restore = document.querySelector('[data-tm-canvas-readonly-restore]')
      const slider = document.querySelector('[data-tm-canvas-zoom-slider]')
      const percent = canvas?.getAttribute('data-tm-canvas-zoom-percent') ?? ''
      return {
        percent,
        atMax: percent === '100%' ? 'true' : 'false',
        banner: !!banner,
        restore: !!restore,
        slider: !!slider,
      }
    })
    // 100% 时提示条不显示，恢复按钮自然缺席；这里只确认常规比例读数。
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    check('画布默认处于 100% 常规阅读比例', await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000),
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
    // 【2026-11-10】100% 已是放大上限：滚轮往上推也不能越过它。
    const atReferenceControl = await canvasZoomRead()
    check('100% 常规比例下只读提示条 / 恢复按钮 / 缩放滑块全部隐藏',
      atReferenceControl.percent === '100%' && atReferenceControl.atMax === 'true'
      && !atReferenceControl.banner && !atReferenceControl.restore && !atReferenceControl.slider,
      JSON.stringify(atReferenceControl))
    await page.mouse.move(500, 750)
    await wheelOnPane(page, -220)
    await sleep(400)
    check('滚轮上推被锁在 100% 上限（再放大没有意义）', await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000),
      await zoomPercent())
    check('100% 上限处语义缩放恒等（不虚胖、不补偿、细节完整）', await page.evaluate(() => {
      const scope = document.querySelector('[data-shortcut-scope="canvas"]')
      if (!scope) return false
      const comp = Number(getComputedStyle(scope).getPropertyValue('--tm-glyph-comp') || '0')
      const alpha = Number(getComputedStyle(scope).getPropertyValue('--tm-detail-alpha') || '0')
      return Math.abs(comp - 1) < 0.02 && alpha === 1
    }), JSON.stringify(await semanticZoomRead()))
    // 【2026-11-11 两段镜头】用中间缩放滑块直接落到 20% 渐隐终点（步进按钮已下线），
    // 在这里做全部 LOD / 只读 / 字形断言。
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    await setZoomPercent(page, 20)
    check('缩放滑块落到 20% 渐隐终点', await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '20%', 8000),
      await zoomPercent())
    read30 = await semanticZoomRead()

    // 【画布只读，2026-11-11】缩小 + 有隐藏节点时整张画布禁写，恢复 100% 才解锁。
    const readOnlyRead = () => withCanvasSettings(page, () => page.evaluate(() => {
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
    }))
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
        // 逐深度 DOM 行已移除，改由真实可见节点 id 证明「树根 + 全部一级主干」仍在。
        visibleIds: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id') || ''),
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
      && ['lod-root', 'lod-c1', 'lod-c2'].every((id) => collapse30.visibleIds.includes(id)),
      JSON.stringify(collapse30))
    check('20% 折叠计数守恒，徽标只挂可见骨架且完全显现、不吃鼠标事件',
      collapse30.total + collapse30.free === 8 - collapse30.visibleCount
      && collapse30.badges.length === collapse30.holders && collapse30.badges.length > 0
      && collapse30.badges.every((b) => b.visible && b.count > 0 && b.text === `+${b.count}`
        && b.opacity >= 0.99 && b.pointerEvents === 'none'),
      JSON.stringify(collapse30))

    // 【自定义永久显示层数，2026-11-11】面板随时改：1 层 → 3 层 → 2 层，
    // 20% 渐隐端点必须立即跟着变，并把偏好写进 localStorage（不用刷新 / 换房间）。
    const depthPanelRead = () => withCanvasSettings(page, () => page.evaluate(() => {
      const el = document.querySelector('[data-tm-lod-control]')
      const select = document.querySelector('[data-tm-lod-preserved-depth-select]')
      return {
        preserved: Number(el?.getAttribute('data-tm-lod-preserved-depth') ?? '0'),
        selectValue: select?.value ?? '',
        visibleCount: Number(el?.getAttribute('data-tm-lod-visible-count') ?? '0'),
        visibleIds: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id') || ''),
        stored: localStorage.getItem('topomind_semantic_lod_preferences_v1') || '',
      }
    }))
    const initialDepth = await depthPanelRead()
    check('左侧状态面板默认「永久显示 2 层」，下拉值与生效值一致',
      initialDepth.preserved === 2 && initialDepth.selectValue === '2',
      JSON.stringify(initialDepth))
    await withCanvasSettings(page, () => page.select('[data-tm-lod-preserved-depth-select]', '1'))
    const oneLevel = await waitFor(page, () =>
      document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-preserved-depth') === '1'
      && document.querySelector('[data-tm-lod-control]')?.getAttribute('data-tm-lod-visible-count') === '1', 8000)
    check('改成 1 层后立即只剩树根（随时变更、无需刷新）', oneLevel,
      JSON.stringify(await depthPanelRead()))
    await withCanvasSettings(page, () => page.select('[data-tm-lod-preserved-depth-select]', '3'))
    const threeLevels = await waitFor(page, () => {
      const el = document.querySelector('[data-tm-lod-control]')
      // depth 3 夹具节点是 lod-g1；逐深度 DOM 行收口后用真实可见节点证明第 3 层已常驻。
      const deepVisible = !!document.querySelector('.react-flow__node[data-id="lod-g1"]')
      return el?.getAttribute('data-tm-lod-preserved-depth') === '3'
        && el?.getAttribute('data-tm-lod-visible-count') === '4'
        && deepVisible
    }, 8000)
    check('改成 3 层后 depth 3 也永久显示（层数优先于碰撞抽稀）', threeLevels,
      JSON.stringify(await depthPanelRead()))
    await withCanvasSettings(page, () => page.select('[data-tm-lod-preserved-depth-select]', '2'))
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
    const atFloorControl = await canvasZoomRead()
    check('20% 渐隐终点：提示条 / 恢复按钮 / 滑块同源出现，比例读作 20%',
      atFloorControl.percent === '20%' && atFloorControl.atMax === 'false'
      && atFloorControl.banner && atFloorControl.restore && atFloorControl.slider,
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
    // 节点与间距同比例缩小。步进按钮已下线，改用滑块逐档逼近 5% 并验证下界钳制。
    const compactSteps = []
    for (const target of [18, 15, 12, 10, 8, 6, 5, 5]) {
      await setZoomPercent(page, target)
      await sleep(120)
      compactSteps.push(Number((await zoomPercent()).replace('%', '')))
    }
    check('继续缩小被锁在 5% 下限（最小比例可以到 5%）', await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '5%', 8000),
      JSON.stringify({ percent: await zoomPercent(), steps: compactSteps }))
    const read5 = await semanticZoomRead()
    const compactState = await withCanvasSettings(page, () => page.evaluate(() => {
      const control = document.querySelector('[data-tm-lod-control]')
      const scope = document.querySelector('[data-shortcut-scope="canvas"]')

      return {
        visibleCount: Number(control?.getAttribute('data-tm-lod-visible-count') ?? '0'),
        visibleDepthLevels: Number(control?.getAttribute('data-tm-lod-visible-depth-levels') ?? '0'),
        compact: control?.getAttribute('data-tm-lod-compact') ?? '',
        compactHint: !!document.querySelector('[data-tm-lod-compact-hint]'),
        canvasCompact: scope?.getAttribute('data-tm-canvas-compact') ?? '',
        readOnly: scope?.getAttribute('data-tm-canvas-readonly') ?? '',

      }
    }))
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
    check('5% 紧凑镜头：面板与容器同源提示，滑块停在 5% 下端点',
      compactState.compact === 'true' && compactState.canvasCompact === 'true'
      && compactState.compactHint && compactSteps.at(-1) === 5,
      JSON.stringify({ compactSteps, compactState }))
    // 从 5% 紧凑远景用中间只读提示条的「恢复 100%」回到常规比例：
    // 必须真的改比例，且保持平移中心不变。
    const centerBeforeReset = await viewportCenterFlow()
    const restoreRect = await page.evaluate(() => {
      const el = document.querySelector('[data-tm-canvas-readonly-restore]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }
    })
    const restoreHittable = restoreRect
      ? await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return !!el?.closest('[data-tm-canvas-readonly-restore]')
      }, restoreRect)
      : false
    check('中间提示条的恢复按钮真实可见且可命中（非 pointer-events:none）',
      !!restoreRect && restoreRect.width > 10 && restoreRect.height > 10 && restoreHittable,
      JSON.stringify({ restoreRect, restoreHittable }))
    if (restoreRect) await page.mouse.click(restoreRect.x, restoreRect.y)
    check('5% 紧凑远景可一键恢复到 100%（中间提示条，真实鼠标点击）', await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000),
      await zoomPercent())
    await sleep(300)
    const centerAfterReset = await viewportCenterFlow()
    check('一键重置只改比例、不平移视野（视口中心 flow 坐标不变）',
      !!centerBeforeReset && !!centerAfterReset
      && Math.abs(centerBeforeReset.flowX - centerAfterReset.flowX) < 2
      && Math.abs(centerBeforeReset.flowY - centerAfterReset.flowY) < 2
      && Math.abs(centerAfterReset.zoom - 0.65) < 0.02,
      JSON.stringify({ centerBeforeReset, centerAfterReset }))
    const editable100 = await readOnlyRead()
    check('恢复 100% 后只读解除（提示条 / 滑块 / 恢复按钮一起消失，画布重新可编辑）',
      editable100.scope === 'false' && editable100.control === 'false'
      && !editable100.banner && !editable100.panelRow && !editable100.restore
      && (await zoomPercent()) === '100%',
      JSON.stringify({ editable100, percent: await zoomPercent() }))
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
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    check('滚轮缩放后仍可一键回到 100%', await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000))

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
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    await page.mouse.click(500, 800)
    await sleep(250)
    // 阶段 O 的搜索 / 滚轮可能把视口留在远处：onlyRenderVisibleElements 会把夹具
    // 节点裁掉。先用搜索把视野带回 LOD 夹具（顺带 revealNode），再做多选。
    // waitFor 会把这个函数序列化到浏览器上下文执行，里面不能再引用 page。
    const lodFixtureVisible = () =>
      ['lod-c1', 'lod-c2'].every((id) => !!document.querySelector(`.react-flow__node[data-id="${id}"]`))
    if (!await waitFor(page, lodFixtureVisible, 2500)) {
      await page.keyboard.down('Control')
      await page.keyboard.press('f')
      await page.keyboard.up('Control')
      await waitFor(page, () => !!document.querySelector('input[placeholder="搜索画布中的节点..."]'), 5000)
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder="搜索画布中的节点..."]')
        if (!input) return
        input.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'LOD 一级 A')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await sleep(450)
      await page.keyboard.press('Enter')
      await waitFor(page, lodFixtureVisible, 8000)
    }
    const mirrorDiag = await page.evaluate(() => {
      const control = document.querySelector('[data-tm-lod-control]')
      return {
        tier: control?.getAttribute('data-tm-lod-tier'),
        active: control?.getAttribute('data-tm-lod-active'),
        visibleCount: control?.getAttribute('data-tm-lod-visible-count'),
        zoom: document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent'),

        nodeIds: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')),
        edgeCount: document.querySelectorAll('.react-flow__edge').length,
        transform: document.querySelector('.react-flow__viewport')?.style.transform,
        readOnly: document.querySelector('[data-shortcut-scope="canvas"]')?.getAttribute('data-tm-canvas-readonly'),
      }
    })
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
    }, 6000), JSON.stringify({ beforeMirror, diag: mirrorDiag }))

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
    // 翻转菜单的点击把鼠标留在浮层上，滚轮会被浮层的 nowheel 吃掉；先移回画布空白区。
    await page.mouse.move(500, 750)
    await wheelOnPane(page, 220)
    const mirrorReadonly = await waitFor(page, () =>
      document.querySelector('[data-shortcut-scope="canvas"]')?.getAttribute('data-tm-canvas-readonly') === 'true', 8000)
    const menuWhileReadOnly = await page.evaluate(() =>
      !!document.querySelector('[data-tm-selection-mirror-menu]'))
    check('缩小进入只读时多选菜单收起（位置失真时禁止翻转）',
      mirrorReadonly && !menuWhileReadOnly,
      JSON.stringify({ mirrorReadonly, menuWhileReadOnly, percent: await zoomPercent() }))
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    check('恢复 100% 后菜单重新出现（选中态保留）', await waitFor(page, () =>
      document.querySelector('[data-tm-selection-mirror-menu]')?.getAttribute('data-tm-selection-mirror-count') === '2', 6000))
    await page.mouse.click(500, 800)
    check('取消多选后菜单收起', await waitFor(page, () =>
      !document.querySelector('[data-tm-selection-mirror-menu]'), 4000))

    // ===== pin 夹具（画布全宽后移到视口复位的位置） =====
    // 连续缩放的 pan 漂移会把节点推出 onlyRenderVisibleElements 视口；总览 / 多选
    // 之后视口已复位、8 个夹具节点都在 DOM，这里才能做「真实点击选中」断言。
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="lod-root"]'), 6000)
    let rootSelected = false
    try {
      await page.click('.react-flow__node[data-id="lod-root"]', { timeout: 4000 })
      rootSelected = await waitFor(page, () =>
        !!document.querySelector('.react-flow__node.selected[data-id="lod-root"]'), 4000)
    } catch { rootSelected = false }
    check('树根节点仍可真实点击选中', rootSelected)
    check('选中节点后置顶按钮可用', await withCanvasSettings(page, () => page.evaluate(() =>
      !document.querySelector('[data-tm-lod-pin-toggle]')?.disabled)))
    const selectedDepthOk = await waitFor(page, () => {
      const el = document.querySelector('[data-tm-lod-depth-panel]')
      // 诊断明细收口后正文只剩「选中节点深度 N」，节点类型在 selected-kind 属性里。
      return el?.getAttribute('data-tm-lod-selected-depth') === '1'
        && el?.getAttribute('data-tm-lod-selected-kind') === 'root'
        && (el?.textContent || '').includes('选中节点深度 1')
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
    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-pin-toggle]')?.click()))
    await sleep(250)
    const pinState = await withCanvasSettings(page, () => page.evaluate(() => ({
      stored: localStorage.getItem('topomind_semantic_lod_preferences_v1') || '',
      label: document.querySelector('[data-tm-lod-pin-toggle]')?.textContent?.trim() || '',
      count: document.querySelector('[data-tm-lod-pinned-count]')?.textContent?.trim() || '',
      hasClear: !!document.querySelector('[data-tm-lod-pin-clear]'),
    })))
    check('置顶选中节点写进本机偏好且控件回显',
      pinState.stored.includes('lod-root') && pinState.label.includes('取消置顶')
        && pinState.count === '1' && pinState.hasClear,
      JSON.stringify(pinState))
    await withCanvasSettings(page, () => page.evaluate(() => document.querySelector('[data-tm-lod-pin-clear]')?.click()))
    await sleep(250)
    check('清除置顶后偏好不再含该节点', await page.evaluate(() =>
      !(localStorage.getItem('topomind_semantic_lod_preferences_v1') || '').includes('lod-root')))
    // 恢复无选中态，避免影响后面的状态抽屉 / 选中子树 / 阶段 V。
    await page.mouse.click(500, 800)

    // ===== 阶段 Q：画布状态抽屉（房间路径 / 最近打开 / 镜头状态融合） =====
    // 不假设 localStorage 里的持久化初值：所有断言都读「点击前后」的相对变化。
    const statusRead = () => page.evaluate(() => {
      const drawer = document.querySelector('[data-tm-canvas-status-drawer]')
      const sections = {}
      document.querySelectorAll('[data-tm-status-section]').forEach((el) => {
        sections[el.getAttribute('data-tm-status-section')] = el.getAttribute('data-tm-status-section-open')
      })
      return {
        open: drawer?.getAttribute('data-tm-canvas-status-open') || '',
        width: Math.round(drawer?.getBoundingClientRect().width || 0),
        sections,
        pathFull: document.querySelector('[data-tm-canvas-status-title]')?.getAttribute('data-tm-room-path-full') || '',
        oldBreadcrumb: !!document.querySelector('#breadcrumb'),
        controlCount: document.querySelectorAll('[data-tm-lod-control]').length,
        pathList: !!document.querySelector('[data-tm-room-path-list]'),
        diagnosticsDom: !!document.querySelector('[data-tm-lod-depth-panel]'),
      }
    })
    let status0 = await statusRead()
    if (status0.open !== 'true') {
      await page.evaluate(() => document.querySelector('[data-tm-canvas-status-toggle]')?.click())
      await sleep(250)
      status0 = await statusRead()
    }
    check('画布状态抽屉：三块 UI 融合成单一面板、旧面包屑悬浮层已移除',
      status0.controlCount === 1 && !status0.oldBreadcrumb && status0.open === 'true'
      && status0.pathFull.length > 0 && status0.pathList,
      JSON.stringify(status0))

    await page.evaluate(() => document.querySelector('[data-tm-status-section-toggle="recent"]')?.click())
    await sleep(220)
    const statusRecent = await statusRead()
    check('画布状态抽屉：功能区可独立展开折叠（最近打开）',
      statusRecent.sections.recent !== status0.sections.recent
      && ['path', 'view', 'details'].every((id) => statusRecent.sections[id] === status0.sections[id]),
      JSON.stringify({ before: status0.sections, after: statusRecent.sections }))

    // 抽屉已收口为「最近打开」单分区 + 横向滚动面包屑，不再有 path / view / details
    // 三个可折叠分区：完整路径改为面包屑内部横向滚动读取，语义仍是「不撑宽面板、不影响其它分区」。
    const pathScroll = await page.evaluate(() => {
      const list = document.querySelector('[data-tm-room-path-list]')
      if (!list) return null
      list.scrollLeft = list.scrollWidth
      return { count: Number(list.getAttribute('data-tm-room-path-count') ?? '0'),
        overflowX: getComputedStyle(list).overflowX,
        width: Math.round(list.getBoundingClientRect().width) }
    })
    await sleep(220)
    const statusPath = await statusRead()
    check('画布状态抽屉：面包屑横向滚动读完整路径不撑宽面板，且不影响其它分区',
      statusPath.width === statusRecent.width && statusPath.width > 0
      && !!pathScroll && pathScroll.count > 0 && pathScroll.overflowX === 'auto'
      && pathScroll.width <= statusPath.width
      && statusPath.sections.recent === statusRecent.sections.recent,
      JSON.stringify({ width: [statusRecent.width, statusPath.width], sections: statusPath.sections, pathScroll }))

    const statusStored = await page.evaluate(() => localStorage.getItem('topomind_canvas_status_v1') || '')
    check('画布状态抽屉：整体与分区折叠状态持久化',
      /"drawerOpen"/.test(statusStored) && /"sections"/.test(statusStored),
      statusStored.slice(0, 140))

    await page.evaluate(() => document.querySelector('[data-tm-canvas-status-toggle]')?.click())
    await sleep(250)
    const statusCollapsed = await statusRead()
    check('画布状态抽屉：整体折叠成标题栏但诊断 DOM 常驻',
      statusCollapsed.open === 'false' && statusCollapsed.controlCount === 1 && statusCollapsed.diagnosticsDom,
      JSON.stringify(statusCollapsed))
    await page.evaluate(() => document.querySelector('[data-tm-canvas-status-toggle]')?.click())
    await sleep(250)
    check('画布状态抽屉：再次点击恢复展开', (await statusRead()).open === 'true')

    // ===== 阶段 R：选中子树（单选根 / 整树 / 幂等 / 右键入口） =====
    // 阶段 P/Q 可能把视口留在远处：用搜索把树根带回视野，顺带完成「单选一个节点」。
    const searchNode = async (keyword) => {
      await page.keyboard.down('Control')
      await page.keyboard.press('f')
      await page.keyboard.up('Control')
      await waitFor(page, () => !!document.querySelector('input[placeholder="搜索画布中的节点..."]'), 5000)
      await page.evaluate((text) => {
        const input = document.querySelector('input[placeholder="搜索画布中的节点..."]')
        if (!input) return
        input.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, keyword)
      await sleep(450)
      await page.keyboard.press('Enter')
    }
    const selectionIds = () => page.evaluate(() =>
      (document.querySelector('[data-tm-selection-menu]')?.getAttribute('data-tm-selection-ids') || '')
        .split('|').filter(Boolean).sort().join('|'))
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    await waitFor(page, () =>
      document.querySelector('[data-shortcut-scope="canvas"]')?.getAttribute('data-tm-canvas-readonly') === 'false', 8000)
    await page.mouse.click(500, 800)
    await sleep(200)
    await searchNode('LOD 树根')
    const singleMenu = await waitFor(page, () =>
      document.querySelector('[data-tm-selection-menu]')?.getAttribute('data-tm-selection-count') === '1'
      && !!document.querySelector('[data-tm-selection-subtree]')
      && !document.querySelector('[data-tm-selection-mirror-menu]'), 8000)
    check('选中子树：单选节点也出现选中操作菜单（镜像区仍要求多选）', singleMenu,
      JSON.stringify(await selectionIds()))

    await page.evaluate(() => document.querySelector('[data-tm-selection-subtree]')?.click())
    // ids 与 count 必须在同一帧一起满足：菜单会随 React 重渲染瞬时卸载，分两次 CDP 读取会偶发读到空值。
    const subtreeDone = await waitFor(page, () => {
      const menu = document.querySelector('[data-tm-selection-menu]')
      const ids = (menu?.getAttribute('data-tm-selection-ids') || '')
        .split('|').filter(Boolean).sort().join('|')
      return ids === 'lod-c1|lod-c2|lod-g1|lod-root'
        && menu?.getAttribute('data-tm-selection-count') === '4'
    }, 6000)
    const domSelected = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.getAttribute('data-id')))
    const subtreeCount = await page.evaluate(() =>
      document.querySelector('[data-tm-selection-menu]')?.getAttribute('data-tm-selection-count'))
    check('选中子树：整棵从属树被选中，related / 游离 / 其它节点不入',
      subtreeDone && domSelected.includes('lod-root')
      && domSelected.every((id) => ['lod-root', 'lod-c1', 'lod-c2', 'lod-g1'].includes(id)),
      JSON.stringify({ domSelected, subtreeCount, ids: await selectionIds() }))

    await page.evaluate(() => document.querySelector('[data-tm-selection-subtree]')?.click())
    await sleep(300)
    check('选中子树：再次点击幂等，且多选镜像区随选区出现', await waitFor(page, () =>
      document.querySelector('[data-tm-selection-mirror-menu]')?.getAttribute('data-tm-selection-mirror-count') === '4'
      && document.querySelector('[data-tm-selection-menu]')?.getAttribute('data-tm-selection-count') === '4', 6000),
      JSON.stringify(await selectionIds()))

    await searchNode('LOD 一级 A')
    await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="lod-c1"]'), 8000)
    await openNodeMenu(page, 'lod-c1')
    const ctxItem = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-context-menu-item]')]
        .find((b) => (b.textContent || '').trim() === '选中子树')
      btn?.click()
      return !!btn
    })
    check('选中子树：右键菜单以该节点为根（不含父节点）',
      ctxItem && await waitFor(page, () =>
        (document.querySelector('[data-tm-selection-menu]')?.getAttribute('data-tm-selection-ids') || '')
          .split('|').filter(Boolean).sort().join('|') === 'lod-c1|lod-g1', 6000),
      JSON.stringify(await selectionIds()))

    // ===== 阶段 S：只读提示条下方的缩放滑动条（显隐同源 / 拖动即时改比例） =====
    const zoomReadout = () => page.evaluate(() =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') || '')
    await page.evaluate(() => document.querySelector('[data-tm-canvas-readonly-restore]')?.click())
    await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '100%', 8000)
    check('缩放滑动条：100% 时与只读提示条一起隐藏', await waitFor(page, () =>
      !document.querySelector('[data-tm-canvas-readonly-banner]')
      && !document.querySelector('[data-tm-canvas-zoom-slider]'), 6000))

    await wheelOnPane(page, 220)
    const sliderAttached = await waitFor(page, () => {
      const banner = document.querySelector('[data-tm-canvas-readonly-banner]')
      const slider = document.querySelector('[data-tm-canvas-zoom-slider]')
      if (!banner || !slider || banner.nextElementSibling !== slider) return false
      return slider.getBoundingClientRect().top >= banner.getBoundingClientRect().bottom
    }, 8000)
    check('缩放滑动条：缩小后与提示条同时出现，且紧贴其下方', sliderAttached)
    // 滚轮缩放走 rAF 逐帧缓动（约 240ms）：滑块出现时动画可能仍在跑，
    // 此时写入 60% 会被后续帧覆盖（实测回落到 57%）。先等比例稳定再拖滑块。
    await sleep(550)

    const sliderRange = await page.evaluate(() => {
      const input = document.querySelector('[data-tm-canvas-zoom-slider-input]')
      return input ? { min: input.min, max: input.max, step: input.step } : null
    })
    check('缩放滑动条：范围 5%~100%、步进 1%',
      sliderRange?.min === '5' && sliderRange.max === '100' && sliderRange.step === '1',
      JSON.stringify(sliderRange))

    await page.evaluate(() => {
      const input = document.querySelector('[data-tm-canvas-zoom-slider-input]')
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '60')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const atSixty = await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-slider]')?.getAttribute('data-tm-canvas-zoom-slider-value') === '60'
      && document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '60%', 8000)
    check('缩放滑动条：拖到 60% 即时改变画布比例', atSixty, await zoomReadout())

    await page.evaluate(() => document.querySelector('[data-tm-canvas-zoom-slider-input]')?.focus())
    await page.keyboard.press('Home')
    const atFive = await waitFor(page, () =>
      document.querySelector('[data-tm-canvas-zoom-slider]')?.getAttribute('data-tm-canvas-zoom-slider-value') === '5'
      && document.querySelector('[data-tm-canvas-zoom-percent]')?.getAttribute('data-tm-canvas-zoom-percent') === '5%', 8000)
    check('缩放滑动条：键盘拖到 5% 下端点', atFive, await zoomReadout())

    await page.keyboard.press('End')
    const restoredBySlider = await waitFor(page, () =>
      !document.querySelector('[data-tm-canvas-readonly-banner]')
      && !document.querySelector('[data-tm-canvas-zoom-slider]')
      && document.querySelector('[data-shortcut-scope="canvas"]')?.getAttribute('data-tm-canvas-readonly') === 'false', 8000)
    check('缩放滑动条：回到 100% 时与提示条一起隐藏并解除只读', restoredBySlider, await zoomReadout())

    // 阶段 V 的基线必须是右栏展开态：先恢复，再由阶段 V 自己折叠/展开往返。
    await setRightPanelCollapsed(page, false)

    // ===== 阶段 V：右栏是画布浮层，折叠/展开不得改变任何画布布局 =====
    const layoutSnapshot = () => page.evaluate(() => {
      const rectOf = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
      }
      const app = document.querySelector('#app-layout')
      const graph = document.querySelector('#graph-panel')
      const canvas = document.querySelector('[data-shortcut-scope="canvas"]')
      const right = document.querySelector('.right-panel-container')
      const panels = [...document.querySelectorAll('.react-flow__panel')]
        .map((el) => ({ key: String(el.className), rect: rectOf(el) }))
        .sort((a, b) => a.key.localeCompare(b.key))

      return {
        app: rectOf(app),
        graph: rectOf(graph),
        canvas: [canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0],
        panels,
        viewport: null,
        right: rectOf(right),
        rightVisible: !!right && getComputedStyle(right).display !== 'none',
        rightPosition: right ? getComputedStyle(right).position : '',
        graphPosition: graph ? getComputedStyle(graph).position : '',
        overlay: right?.getAttribute('data-tm-right-panel-overlay') || '',
      }
    })
    // 画布几何 = 画布容器 / React Flow 容器 / 全部 Panel，逐像素比对。
    const canvasGeometry = (s) => JSON.stringify({
      app: s.app, graph: s.graph, canvas: s.canvas, panels: s.panels, viewport: s.viewport,
    })
    const toggleRightPanel = async () => {
      const clicked = await page.evaluate(() => {
        const button = document.querySelector('button[aria-label="折叠右侧面板"]')
          || document.querySelector('button[aria-label="展开右侧面板"]')
        if (!button) return false
        button.click()
        return true
      })
      if (clicked) return true
      // 标题栏手动按钮已移除，统一走全局 Ctrl+Tab 键盘入口。
      await page.keyboard.down('Control')
      await page.keyboard.press('Tab')
      await page.keyboard.up('Control')
      return true
    }

    const baseLayout = await layoutSnapshot()
    check('【阶段 V】画布绝对铺满、右栏为贴右浮层（不参与 flex 挤压）',
      baseLayout.graphPosition === 'absolute' && baseLayout.rightPosition === 'absolute'
      && !!baseLayout.graph && !!baseLayout.app && baseLayout.graph[2] === baseLayout.app[2]
      && baseLayout.rightVisible && baseLayout.overlay === 'true',
      JSON.stringify({ graph: baseLayout.graph, app: baseLayout.app, right: baseLayout.right, overlay: baseLayout.overlay }))

    await toggleRightPanel()
    const collapsedOk = await waitFor(page, () => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display === 'none'
    }, 8000)
    const collapsedLayout = await layoutSnapshot()
    check('【阶段 V】折叠右栏后画布尺寸与全部 Panel 定位均不变',
      collapsedOk && canvasGeometry(baseLayout) === canvasGeometry(collapsedLayout),
      JSON.stringify({
        base: { graph: baseLayout.graph, panels: baseLayout.panels.length, viewport: baseLayout.viewport },
        after: { graph: collapsedLayout.graph, panels: collapsedLayout.panels.length, viewport: collapsedLayout.viewport },
      }))

    await toggleRightPanel()
    const expandedOk = await waitFor(page, () => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display !== 'none'
    }, 8000)
    const expandedLayout = await layoutSnapshot()
    check('【阶段 V】再次展开后画布仍与基线逐像素一致',
      expandedOk && canvasGeometry(baseLayout) === canvasGeometry(expandedLayout),
      JSON.stringify({
        base: { graph: baseLayout.graph, panels: baseLayout.panels.length, viewport: baseLayout.viewport },
        after: { graph: expandedLayout.graph, panels: expandedLayout.panels.length, viewport: expandedLayout.viewport },
      }))

    const viewportStable = baseLayout.canvas[0] > 0
      && baseLayout.canvas[0] === collapsedLayout.canvas[0]
      && baseLayout.canvas[0] === expandedLayout.canvas[0]
    check('【阶段 V】画布尺寸读数稳定', viewportStable,
      JSON.stringify({ canvas: baseLayout.canvas, collapsed: collapsedLayout.canvas, expanded: expandedLayout.canvas }))

    check('【阶段 V】折叠/展开确实只切换右栏显隐，右栏本身尺寸不变',
      baseLayout.rightVisible && !collapsedLayout.rightVisible && expandedLayout.rightVisible
      && JSON.stringify(baseLayout.right) === JSON.stringify(expandedLayout.right),
      JSON.stringify({ base: baseLayout.right, collapsed: collapsedLayout.right, expanded: expandedLayout.right }))

    // ===== 阶段 W：右栏自动显隐 + pin 固定（点击有文档节点展开 / 空白与无文档节点折叠） =====
    // 「详情/样式」分段控件已移除：右栏恒为详情，样式设置迁入设置页。
    await setRightPanelCollapsed(page, false)
    await waitFor(page, () => !!document.querySelector('[data-tm-right-panel-pin]'), 6000)

    const pinPlacementW = await page.evaluate(() => {
      const fullscreen = document.querySelector('button[aria-label="最大化面板"], button[aria-label="还原面板"]')
      const rail = fullscreen?.parentElement
      const labels = [...(rail?.querySelectorAll('button') ?? [])]
        .map((b) => b.getAttribute('aria-label') || '')
      return {
        labels,
        fullscreenIndex: labels.findIndex((l) => l === '最大化面板' || l === '还原面板'),
        pinIndex: labels.findIndex((l) => l === '固定右侧面板' || l === '取消固定右侧面板'),
        pins: document.querySelectorAll('[data-tm-right-panel-pin]').length,
      }
    })
    check('【阶段 W】pin 按钮在全屏按钮正下方且唯一',
      pinPlacementW.fullscreenIndex >= 0
      && pinPlacementW.pinIndex === pinPlacementW.fullscreenIndex + 1
      && pinPlacementW.pins === 1,
      JSON.stringify(pinPlacementW))

    const rightPanelVisibleW = () => page.evaluate(() => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display !== 'none'
    })
    const clickPaneW = () => page.evaluate(() => {
      const pane = document.querySelector('.react-flow__pane')
      if (!pane) return false
      const r = pane.getBoundingClientRect()
      pane.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 20),
      }))
      return true
    })
    const clickNodeW = (id) => page.evaluate((nodeId) => {
      const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
      if (!node) return false
      const r = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
      }))
      return true
    }, id)
    const clickDocIconW = (id) => page.evaluate((nodeId) => {
      const button = document.querySelector(`.react-flow__node[data-id="${nodeId}"] [data-tm-doc-icon="${nodeId}"]`)
      if (!button) return false
      button.click()
      return true
    }, id)
    const waitPanelW = async (visible) => {
      const end = Date.now() + 6000
      while (Date.now() < end) {
        const ok = await page.evaluate((wantVisible) => {
          const right = document.querySelector('.right-panel-container')
          return !!right && (getComputedStyle(right).display !== 'none') === wantVisible
        }, visible)
        if (ok) return true
        await sleep(200)
      }
      return false
    }

    check('【阶段 W】点击空白画布自动折叠右栏',
      await clickPaneW() && await waitPanelW(false),
      JSON.stringify({ visible: await rightPanelVisibleW() }))

    await clickNodeW('node-a')
    await sleep(450)
    check('【阶段 W】单击有文档节点只选中，不自动展开右栏',
      !await rightPanelVisibleW(),
      JSON.stringify({ visible: await rightPanelVisibleW() }))

    check('【阶段 W】点击本节点文档图标展开右栏',
      await clickDocIconW('node-a') && await waitPanelW(true),
      JSON.stringify({ visible: await rightPanelVisibleW() }))

    check('【阶段 W】无文档节点不渲染文档图标',
      await page.evaluate(() =>
        !document.querySelector('.react-flow__node[data-id="lod-c1"] [data-tm-doc-icon]')))

    check('【阶段 W】点击空白画布折叠后，文档图标可再次展开',
      await clickPaneW() && await waitPanelW(false)
      && await clickDocIconW('node-a') && await waitPanelW(true),
      JSON.stringify({ visible: await rightPanelVisibleW() }))

    // 回归真实鼠标「第一次只选中」：hover 微布局变化会让 mouseup 落到节点本体，
    // click 因此被重定向。动作必须在 pointerdown 就完成，不能等 click。
    await clickPaneW()
    await waitPanelW(false)
    const pointerDownHitW = await page.evaluate(() => {
      const button = document.querySelector('.react-flow__node[data-id="node-a"] [data-tm-doc-icon="node-a"]')
      if (!button) return false
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        isPrimary: true, pointerType: 'mouse',
      }))
      return true
    })
    await clickNodeW('node-a')
    check('【阶段 W】pointerdown 即展开，click 被重定向到节点也不丢失首次点击',
      pointerDownHitW && await waitPanelW(true),
      JSON.stringify({ pointerDownHitW, visible: await rightPanelVisibleW() }))

    const pinClickedW = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="固定右侧面板"]')
      button?.click()
      return !!button
    })
    const pinnedW = await waitFor(page, () =>
      document.querySelector('.right-panel-container')?.getAttribute('data-tm-right-panel-pinned') === 'true', 6000)
    check('【阶段 W】点击 pin 后面板进入固定展开态', pinClickedW && pinnedW && await rightPanelVisibleW(),
      JSON.stringify({ pinClickedW, pinnedW }))

    await clickNodeW('lod-c1')
    await sleep(200)
    const stillOpenAfterNoDocW = await rightPanelVisibleW()
    check('【阶段 W】pin 后单击节点不折叠右栏', stillOpenAfterNoDocW,
      JSON.stringify({ visible: stillOpenAfterNoDocW }))

    await clickPaneW()
    await sleep(200)
    const stillOpenAfterPaneW = await rightPanelVisibleW()
    check('【阶段 W】pin 后点击空白画布不再自动折叠', stillOpenAfterPaneW,
      JSON.stringify({ visible: stillOpenAfterPaneW }))

    // 界面已无手动按钮，改用 Ctrl+Tab 键盘入口验证 pin 的短路保护。
    await page.keyboard.down('Control')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Control')
    await sleep(200)
    const stillOpenAfterManualW = await rightPanelVisibleW()
    check('【阶段 W】pin 后键盘折叠入口也被挡住',
      stillOpenAfterManualW,
      JSON.stringify({ visible: stillOpenAfterManualW }))

    const unpinClickedW = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="取消固定右侧面板"]')
      button?.click()
      return !!button
    })
    const unpinnedW = await waitFor(page, () =>
      document.querySelector('.right-panel-container')?.getAttribute('data-tm-right-panel-pinned') === 'false', 6000)
    check('【阶段 W】再次点击 pin 可取消固定', unpinClickedW && unpinnedW && await rightPanelVisibleW(),
      JSON.stringify({ unpinClickedW, unpinnedW }))

    check('【阶段 W】取消 pin 后自动折叠恢复',
      await clickPaneW() && await waitPanelW(false),
      JSON.stringify({ visible: await rightPanelVisibleW() }))

    // ===== 阶段 X：新建节点即时呈现（同步插入内存 + 后台合并落盘） =====
    // 旧实现为 1 个新节点会重载整房间，节点多时点击后要等半秒。这里从「点下菜单项」
    // 到「新节点 DOM 出现」在页面内用 MutationObserver 计时，避免 CDP 往返误差。
    const paneSpot = await page.evaluate(() => {
      const candidates = [[500, 500], [430, 430], [600, 560], [360, 640], [700, 300]]
      for (const [x, y] of candidates) {
        const el = document.elementFromPoint(x, y)
        const pane = el?.closest?.('.react-flow__pane')
          || (el?.classList?.contains('react-flow__pane') ? el : null)
        if (!pane) continue
        pane.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: x, clientY: y,
        }))
        return { x, y }
      }
      return null
    })
    check('【阶段 X】画布空白处可打开新建节点菜单', !!paneSpot
      && await waitFor(page, () => [...document.querySelectorAll('button')]
        .some((b) => (b.textContent || '').trim().startsWith('新建节点')), 5000),
      JSON.stringify(paneSpot))

    const createTiming = await page.evaluate(() => new Promise((resolve) => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').trim().startsWith('新建节点'))
      if (!btn) return resolve({ ms: -1, id: null, reason: 'menu-missing' })
      const start = performance.now()
      let settled = false
      let timer = null
      let obs = null
      const finish = (id) => {
        if (settled) return
        settled = true
        if (obs) obs.disconnect()
        if (timer) clearTimeout(timer)
        resolve({ ms: Math.round(performance.now() - start), id })
      }
      obs = new MutationObserver(() => {
        const el = document.querySelector('.react-flow__node[data-id^="card-"]')
        if (el) finish(el.getAttribute('data-id'))
      })
      obs.observe(document.querySelector('.react-flow') || document.body, { childList: true, subtree: true })
      timer = setTimeout(() => finish(null), 3000)
      btn.click()
    }))
    check('【阶段 X】点击新建节点后同帧出现（不等待整房间重载）',
      !!createTiming.id && createTiming.ms >= 0 && createTiming.ms < 250,
      JSON.stringify(createTiming))

    // 保存协调器 delayMs=300；后台写盘不阻塞上面的 UI 计时。
    let createdOnDisk = false
    for (let i = 0; i < 30 && !createdOnDisk; i += 1) {
      createdOnDisk = !!(readGraph().children || {})[createTiming.id]
      if (!createdOnDisk) await sleep(150)
    }
    const childrenAfterCreate = readGraph().children || {}
    check('【阶段 X】后台合并保存把新节点写进父 _graph.json', createdOnDisk,
      JSON.stringify({ id: createTiming.id, keys: Object.keys(childrenAfterCreate).slice(-3) }))
    check('【阶段 X】后台保存未覆盖既有节点',
      childrenAfterCreate['node-a']?.name === '节点 A' && childrenAfterCreate['node-b']?.name === '节点 B')

    // ===== 阶段 Y：删除节点即时消失（局部 IO + 同步内存删除 + 后台合并落盘） =====
    // 旧实现删 1 个节点会 saveNow 全量写盘 + loadRoom 重扫整房间，约半秒后才更新 UI。
    // 这里从「点下确认框的确定」到「节点 DOM 消失」在页面内用 MutationObserver 计时。
    // 目标选 lod-root：它有物理目录 / 文档，且带 2 条 subordinate 边，可一并验关联边裁剪。
    // 菜单项文案带快捷键后缀（「删除节点Backspace」），必须 startsWith；
    // 用真实鼠标右键而非合成事件，确保 React Flow 走 onNodeContextMenu（node 菜单）。
    const deleteNodeRect = await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node[data-id="lod-root"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + Math.min(30, r.width / 2)), y: Math.round(r.y + Math.min(20, r.height / 2)) }
    })
    check('【阶段 Y】可在画布上定位待删除节点', !!deleteNodeRect, JSON.stringify(deleteNodeRect))
    if (deleteNodeRect) await page.mouse.click(deleteNodeRect.x, deleteNodeRect.y, { button: 'right' })
    const deleteMenuReady = await waitFor(page, () => [...document.querySelectorAll('button')]
      .some((b) => (b.textContent || '').trim().startsWith('删除节点')), 5000)
    check('【阶段 Y】节点右键菜单含「删除节点」', deleteMenuReady,
      JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')]
        .map((b) => (b.textContent || '').trim()).filter(Boolean).slice(-12))))

    const deleteTiming = await page.evaluate((id) => new Promise((resolve) => {
      const selector = `.react-flow__node[data-id="${id}"]`
      let settled = false
      let obs = null
      let timer = null
      const finish = (result) => {
        if (settled) return
        settled = true
        if (obs) obs.disconnect()
        if (timer) clearTimeout(timer)
        resolve(result)
      }
      const menuBtn = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').trim().startsWith('删除节点'))
      if (!menuBtn) return finish({ ms: -1, reason: 'menu-missing' })
      menuBtn.click()
      setTimeout(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const okBtn = dlg && [...dlg.querySelectorAll('button')]
          .find((b) => (b.textContent || '').trim() === '确定')
        if (!okBtn) return finish({ ms: -1, reason: 'confirm-missing' })
        const start = performance.now()
        const done = () => finish({ ms: Math.round(performance.now() - start), reason: 'removed' })
        obs = new MutationObserver(() => {
          if (!document.querySelector(selector)) done()
        })
        obs.observe(document.querySelector('.react-flow') || document.body,
          { childList: true, subtree: true })
        timer = setTimeout(() => finish({ ms: -1, reason: 'timeout' }), 3000)
        okBtn.click()
        if (!document.querySelector(selector)) done()
      }, 300)
    }), 'lod-root')
    check('【阶段 Y】确认删除后节点同帧消失（不等待整房间重载）',
      deleteTiming.reason === 'removed' && deleteTiming.ms >= 0 && deleteTiming.ms < 250,
      JSON.stringify(deleteTiming))
    check('【阶段 Y】删除后节点不再出现在 DOM', await page.evaluate(() =>
      !document.querySelector('.react-flow__node[data-id="lod-root"]')))

    let deletedOnDisk = false
    for (let i = 0; i < 30 && !deletedOnDisk; i += 1) {
      deletedOnDisk = !(readGraph().children || {})['lod-root']
      if (!deletedOnDisk) await sleep(150)
    }
    const graphAfterDelete = readGraph()
    const edgesAfterDelete = graphAfterDelete.edges || []
    check('【阶段 Y】后台合并保存把节点从 _graph.json 移除', deletedOnDisk,
      JSON.stringify(Object.keys(graphAfterDelete.children || {})))
    check('【阶段 Y】关联边被裁、无关边保留',
      !edgesAfterDelete.some((e) => e.source === 'lod-root' || e.target === 'lod-root')
      && edgesAfterDelete.some((e) => e.id === 'lod-e3')
      && edgesAfterDelete.some((e) => e.id === 'lod-e4'),
      JSON.stringify(edgesAfterDelete.map((e) => e.id)))
    check('【阶段 Y】未删的既有节点仍在',
      (graphAfterDelete.children || {})['node-a']?.name === '节点 A'
      && (graphAfterDelete.children || {})['node-b']?.name === '节点 B')

    const trashDirY = path.join(WORKDIR, '.trash', 'kbs')
    const trashItemsY = fs.existsSync(trashDirY) ? fs.readdirSync(trashDirY) : []
    const trashMetaY = trashItemsY.filter((n) => n.endsWith('.trash.json')).map((n) => {
      try { return JSON.parse(fs.readFileSync(path.join(trashDirY, n), 'utf8')) } catch { return {} }
    })
    check('【阶段 Y】被删目录移入回收站且带原节点名',
      trashItemsY.some((n) => n.includes('lod-root') && !n.endsWith('.trash.json'))
      && trashMetaY.some((m) => m.label === 'LOD 树根'),
      JSON.stringify({ items: trashItemsY.slice(0, 4), labels: trashMetaY.map((m) => m.label) }))

    // ===== 阶段 Z：块编辑菜单缩进 / 对齐平铺为一级按钮（不再进二级菜单） =====
    await setNodeTreeCollapsed(page, true)
    await setRightPanelCollapsed(page, true)
    // 右栏现在只由文档图标显式展开，单击节点不再触发。
    const iconClickedZ = await page.evaluate(() => {
      const button = document.querySelector('.react-flow__node[data-id="node-a"] [data-tm-doc-icon]')
      if (!button) return false
      button.click()
      return true
    })
    const editorReadyZ = await waitFor(page, () => !!document.querySelector('.bn-editor'), 10000)
    const diagZ = await page.evaluate(() => ({
      panelVisible: (() => {
        const right = document.querySelector('.right-panel-container')
        return !!right && getComputedStyle(right).display !== 'none'
      })(),
      panelText: (document.querySelector('.right-panel-container')?.innerText || '').slice(0, 120),
      tabButtons: [...document.querySelectorAll('button')]
        .map((b) => b.textContent?.trim())
        .filter((t) => t === '文档' || t === '附件' || t === '引用关系')
        .slice(0, 6),
    }))
    check('【阶段 Z】点击文档图标可打开右栏编辑器', iconClickedZ && editorReadyZ,
      JSON.stringify({ iconClickedZ, editorReadyZ, ...diagZ }))
    const blockBoxZ = await page.evaluate(() => {
      const el = document.querySelector('.bn-block-content')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }
    })
    if (blockBoxZ) await page.mouse.move(blockBoxZ.x, blockBoxZ.y)
    check('【阶段 Z】块拖拽手柄可定位',
      await waitFor(page, () => !!document.querySelector('[data-test="dragHandle"]'), 8000))
    await page.evaluate(() => {
      const svg = document.querySelector('[data-test="dragHandle"]')
      const btn = svg?.closest('button')
      if (btn) btn.click()
    })
    const menuOpenZ = await waitFor(page, () => !!document.querySelector('[data-tm-block-menu-action]'), 6000)
    const oldTriggerZ = await page.evaluate(() => [...document.querySelectorAll('.tm-smart-block-menu__row')]
      .some((el) => (el.textContent || '').includes('缩进和对齐')))
    check('【阶段 Z】块菜单直接打开且无「缩进和对齐」二级入口', menuOpenZ && !oldTriggerZ,
      JSON.stringify({ menuOpenZ, oldTriggerZ }))
    const actionsZ = await page.evaluate(() => [...document.querySelectorAll('[data-tm-block-menu-action]')]
      .map((el) => ({
        action: el.getAttribute('data-tm-block-menu-action'),
        label: el.getAttribute('aria-label'),
        title: el.querySelector('.tm-smart-block-menu__tile-fill')?.getAttribute('title'),
        text: el.textContent?.trim(),
        icon: !!el.querySelector('svg'),
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
      })))
    check('【阶段 Z】缩进两个 + 对齐三个纯图标按钮平铺在一级菜单',
      actionsZ.length === 5
      && actionsZ.map((a) => a.action).join(',') === 'unnest,nest,align-left,align-center,align-right'
      && actionsZ.map((a) => a.label).join(',') === '减少缩进,增加缩进,左对齐,居中,右对齐'
      && actionsZ.every((a) => a.icon && a.text === '' && a.title === a.label
        && a.width <= 40 && a.height <= 40),
      JSON.stringify(actionsZ))
    await page.evaluate(() => document.querySelector('[data-tm-block-menu-action="align-center"]')?.click())
    const alignedZ = await waitFor(page, () =>
      !!document.querySelector('.bn-block-content[data-text-alignment="center"]'), 5000)
    const menuClosedZ = await page.evaluate(() => !document.querySelector('[data-tm-block-menu-action]'))
    check('【阶段 Z】点击居中立即写入块并关闭菜单', alignedZ && menuClosedZ,
      JSON.stringify({ alignedZ, menuClosedZ }))

    // ===== 阶段 AA：双击节点标题重命名，第一下单击不得展开右栏盖住节点 =====
    await setRightPanelCollapsed(page, true)
    const titleSelectorAA = '.react-flow__node[data-id="node-a"] [title="双击编辑标题"]'
    let titleReadyAA = await waitFor(page, () =>
      !!document.querySelector('.react-flow__node[data-id="node-a"] [title="双击编辑标题"]'), 5000)
    if (!titleReadyAA) {
      // 兜底：若上一阶段的选中态被编辑器抢走，先单击选中（合成事件 detail=0）。
      await page.evaluate(() => {
        const node = document.querySelector('.react-flow__node[data-id="node-a"]')
        if (!node) return
        const r = node.getBoundingClientRect()
        node.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, button: 0, buttons: 1,
          clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
        }))
      })
      titleReadyAA = await waitFor(page, () =>
        !!document.querySelector('.react-flow__node[data-id="node-a"] [title="双击编辑标题"]'), 5000)
    }
    const titleBoxAA = await page.evaluate((selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    }, titleSelectorAA)
    let editingAA = false
    if (titleBoxAA) {
      // 真实双击：单击/双击现在都不碰右栏，不需要任何时间间隔技巧。
      await page.mouse.click(titleBoxAA.x, titleBoxAA.y, { clickCount: 2, delay: 90 })
      editingAA = await waitFor(page, () =>
        !!document.querySelector('.react-flow__node[data-id="node-a"] input'), 5000)
    }
    const panelVisibleAA = await page.evaluate(() => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display !== 'none'
    })
    check('【阶段 AA】双击标题进入重命名且右栏保持折叠',
      titleReadyAA && editingAA && !panelVisibleAA,
      JSON.stringify({ titleReadyAA, editingAA, panelVisibleAA }))
    await page.keyboard.press('Escape')

    const docIconOpenedAA = await page.evaluate(() => {
      const button = document.querySelector('.react-flow__node[data-id="node-a"] [data-tm-doc-icon]')
      if (!button) return false
      button.click()
      return true
    })
    const panelAfterIconAA = await waitFor(page, () => {
      const right = document.querySelector('.right-panel-container')
      return !!right && getComputedStyle(right).display !== 'none'
    }, 6000)
    const ownDocShownAA = await page.evaluate(() =>
      (document.querySelector('.right-panel-container')?.innerText || '').includes('A 自身文档'))
    check('【阶段 AA】点击文档图标展开右栏并显示本节点文档',
      docIconOpenedAA && panelAfterIconAA && ownDocShownAA,
      JSON.stringify({ docIconOpenedAA, panelAfterIconAA, ownDocShownAA }))

    // ===== 阶段 AC：节点锁定在整个知识库内有效，切房间后仍显示原节点文档 =====
    const lockClickedAC = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="锁定当前节点"]')
      btn?.click()
      return !!btn
    })
    const lockedAC = await waitFor(page, () =>
      !!document.querySelector('button[aria-label="解锁节点"]'), 6000)
    check('【阶段 AC】可锁定当前节点', lockClickedAC && lockedAC,
      JSON.stringify({ lockClickedAC, lockedAC }))

    await openNodeMenu(page, 'node-a')
    const enterClickedAC = await page.evaluate(() => {
      const items = [...document.querySelectorAll('button,[role="menuitem"]')]
      const item = items.find((el) => (el.textContent || '').trim().startsWith('进入节点'))
      item?.click()
      return !!item
    })
    const roomSwitchedAC = await waitFor(page, () =>
      !!document.querySelector('.react-flow__node[data-id="aa"]'), 10000)
    check('【阶段 AC】已进入房间 A 的子房间 B', enterClickedAC && roomSwitchedAC,
      JSON.stringify({ enterClickedAC, roomSwitchedAC }))

    await sleep(700)
    const lockedStateAC = await page.evaluate(() => {
      const right = document.querySelector('.right-panel-container')
      return {
        visible: !!right && getComputedStyle(right).display !== 'none',
        text: (right?.innerText || '').slice(0, 160),
        empty: (right?.innerText || '').includes('选择一个节点查看详情'),
        unlock: !!document.querySelector('button[aria-label="解锁节点"]'),
      }
    })
    check('【阶段 AC】切到别的房间仍显示锁定节点文档且可解锁',
      lockedStateAC.visible && lockedStateAC.text.includes('A 自身文档')
      && !lockedStateAC.empty && lockedStateAC.unlock,
      JSON.stringify(lockedStateAC))

    const unlockClickedAC = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="解锁节点"]')
      btn?.click()
      return !!btn
    })
    // 解锁后当前房间没有选中节点，右栏进空状态；空状态不渲染「锁定当前节点」按钮，
    // 因此以「解锁按钮消失」作为解除依据。
    const unlockedAC = await waitFor(page, () =>
      !document.querySelector('button[aria-label="解锁节点"]'), 6000)
    const emptyAfterUnlockAC = await waitFor(page, () =>
      (document.querySelector('.right-panel-container')?.innerText || '').includes('选择一个节点查看详情'), 6000)
    check('【阶段 AC】解锁后右栏恢复跟随当前房间选中',
      unlockClickedAC && unlockedAC && emptyAfterUnlockAC,
      JSON.stringify({ unlockClickedAC, unlockedAC, emptyAfterUnlockAC }))

    // ===== 阶段 AD：首块 H1 顶部留白不被光标定位滚动吃掉 =====
    // Node 侧把 doc_a 重写成「首块 H1 + 大量正文」的可滚动文档，reload 后打开，
    // 光标从文末 Ctrl+Home 回首块：修复前 scrollTop 停在 30、H1 距容器顶 0（字顶被切），
    // 修复后选区归零、H1 距容器顶回到 30（24px 留白完整）。
    const longBlocksAD = [
      { id: 'h1-first-ad', type: 'heading', props: { level: 1 }, content: '首块 H1 顶部留白测试' },
      ...Array.from({ length: 30 }, (_, i) => ({ id: `ad-p-${i}`, type: 'paragraph', content: `正文第 ${i + 1} 段 ` + '填充文本 '.repeat(20) })),
      { id: 'h1-last-ad', type: 'heading', props: { level: 1 }, content: '文末 H1' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `ad-z-${i}`, type: 'paragraph', content: `结尾 ${i}` })),
    ]
    fs.writeFileSync(DOC_A, JSON.stringify({
      schema: 'topomind.smart-document', id: 'doc_a', version: 1,
      title: OWN_TITLE, blocks: longBlocksAD, metadata: {},
    }, null, 2), 'utf8')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(2200)
    await page.evaluate((name) => {
      const els = [...document.querySelectorAll('*')].filter((e) =>
        e.children.length === 0 && (e.textContent || '').includes(name))
      if (els.length) els[0].parentElement?.click()
    }, KB_NAME)
    const workspaceReadyAD = await waitFor(page, () =>
      !!document.querySelector('.react-flow__node[data-id="node-a"]'), 12000)
    await setNodeTreeCollapsed(page, true)
    // 点文档图标显式展开右栏并打开本节点文档
    await page.evaluate(() => {
      const icon = document.querySelector('.react-flow__node[data-id="node-a"] [data-tm-doc-icon]')
      if (!icon) return
      icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
      icon.click()
    })
    const editorReadyAD = await waitFor(page, () => !!document.querySelector('.bn-editor h1'), 12000)
    await sleep(500)

    const measureTopAD = () => page.evaluate(() => {
      const sc = document.querySelector('.tm-smart-editor-scroll')
      const ed = document.querySelector('.bn-editor')
      const h1 = ed?.querySelector('h1')
      if (!sc || !ed || !h1) return null
      const scTop = sc.getBoundingClientRect().top
      const h1Top = h1.getBoundingClientRect().top
      return {
        scrollTop: Math.round(sc.scrollTop),
        scrollHeight: sc.scrollHeight,
        clientHeight: sc.clientHeight,
        h1FromScrollerTop: Math.round(h1Top - scTop),
        editorPadTop: parseFloat(getComputedStyle(ed).paddingTop),
      }
    })
    const beforeScrollAD = await measureTopAD()
    // 滚到底部并点末尾段，让光标离开首块
    await page.evaluate(() => {
      const sc = document.querySelector('.tm-smart-editor-scroll')
      if (sc) sc.scrollTop = sc.scrollHeight
    })
    await sleep(300)
    const bottomPointAD = await page.evaluate(() => {
      const els = document.querySelectorAll('.bn-editor .bn-inline-content')
      const el = els[els.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }
    })
    if (bottomPointAD) await page.mouse.click(bottomPointAD.x, bottomPointAD.y)
    await sleep(300)
    const atBottomAD = await measureTopAD()
    // Ctrl+Home 把光标移回首块 H1
    await page.keyboard.down('Control')
    await page.keyboard.press('Home')
    await page.keyboard.up('Control')
    await sleep(500)
    const afterHomeAD = await measureTopAD()

    check('【阶段 AD】可滚动长文档光标回首块后顶部留白完整（字顶不被切）',
      workspaceReadyAD && editorReadyAD
      && beforeScrollAD && beforeScrollAD.scrollHeight > beforeScrollAD.clientHeight
      && atBottomAD && atBottomAD.scrollTop > 100
      && afterHomeAD && afterHomeAD.scrollTop === 0
      && afterHomeAD.h1FromScrollerTop >= 24
      && afterHomeAD.editorPadTop === 24,
      JSON.stringify({ workspaceReadyAD, editorReadyAD, beforeScrollAD, atBottomAD, afterHomeAD }))

    // ===== 阶段 AE：块编辑侧栏不得压在层级面包屑栏 / 面包屑下拉上 =====
    // 侧栏是 portal 到 body 的浮层，不受正文滚动容器裁剪。贴顶块的侧栏或展开菜单
    // 一旦越过正文上边界，必须被越界守卫隐藏；面包屑下拉展开期间整条侧栏也要让位，
    // 既不能视觉穿透，也不能接收鼠标事件。
    await page.evaluate(() => {
      const sc = document.querySelector('.tm-smart-editor-scroll')
      if (sc) sc.scrollTop = 0
    })
    await sleep(200)
    const firstH1PointAE = await page.evaluate(() => {
      const h1 = document.querySelector('.bn-editor h1')
      if (!h1) return null
      const r = h1.getBoundingClientRect()
      return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }
    })
    if (firstH1PointAE) await page.mouse.move(firstH1PointAE.x, firstH1PointAE.y)
    let handlePointAE = null
    for (let i = 0; i < 24 && !handlePointAE; i++) {
      handlePointAE = await page.evaluate(() => {
        const b = document.querySelector('.tm-smart-side-menu-hit-area .bn-button[draggable="true"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
      })
      if (!handlePointAE) await sleep(250)
    }
    if (handlePointAE) await page.mouse.click(handlePointAE.x, handlePointAE.y)
    await sleep(350)

    const boundStateAE = await page.evaluate(() => {
      const sc = document.querySelector('.tm-smart-editor-scroll')
      const area = document.querySelector('.tm-smart-side-menu-hit-area')
      const menu = document.querySelector('.tm-smart-block-menu')
      if (!sc || !area) return null
      const scTop = sc.getBoundingClientRect().top
      const menuTop = menu ? menu.getBoundingClientRect().top : null
      const style = getComputedStyle(area)
      return {
        scTop: Math.round(scTop),
        menuTop: menuTop == null ? null : Math.round(menuTop),
        hasMenu: !!menu,
        outsideFlag: area.getAttribute('data-tm-side-menu-outside') === 'true',
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
      }
    })
    const menuCrossesTopAE = !!boundStateAE && boundStateAE.menuTop != null
      && boundStateAE.menuTop < boundStateAE.scTop - 1
    // 越界守卫生效对象只有侧栏手柄（＋/⠿），不是展开的块菜单。贴顶块的手柄
    // 本身仍在正文区内，必须正常显示；菜单向上 flip 越过顶部是正常弹层行为，
    // 也不能被当成越界隐藏（否则就是用户反馈的「菜单一闪而过」）。
    check('【阶段 AE】贴顶块手柄不误隐藏，菜单向上 flip 越过顶部仍稳定可交互',
      !!handlePointAE && !!boundStateAE && !!boundStateAE.hasMenu
      && !boundStateAE.outsideFlag
      && boundStateAE.visibility === 'visible' && boundStateAE.pointerEvents === 'auto',
      JSON.stringify({ handlePointAE, boundStateAE, menuCrossesTopAE }))

    // 复用这个已经向上 flip、menuTop 越过 scrollerTop 的菜单，连续采样确认它
    // 稳定存在（旧实现会在此后 150ms 把菜单隐藏＝一闪而过）。
    const flipSamplesAE = []
    for (let i = 0; i < 12; i++) {
      flipSamplesAE.push(await page.evaluate(() => {
        const menu = document.querySelector('.tm-smart-block-menu')
        const area = document.querySelector('.tm-smart-side-menu-hit-area')
        const sc = document.querySelector('.tm-smart-editor-scroll')
        return {
          menu: !!menu,
          menuTop: menu ? Math.round(menu.getBoundingClientRect().top) : null,
          menuVis: menu ? getComputedStyle(menu).visibility : null,
          outside: area?.getAttribute('data-tm-side-menu-outside') ?? null,
          scTop: sc ? Math.round(sc.getBoundingClientRect().top) : null,
        }
      }))
      await sleep(90)
    }
    // 真正要防的回归是「菜单一闪而过 / 位置反复跳」；menuTop 是否越过 scrollerTop
    // 取决于三边栏下的绝对坐标，属于布局相关事实，不能当硬断言（2026-11-25 口径）。
    check('【阶段 AE】块菜单展开后持续稳定可交互，不一闪而过',
      boundStateAE?.hasMenu === true
      && flipSamplesAE.every((s) => s.menu && s.menuVis === 'visible' && s.outside !== 'true')
      && new Set(flipSamplesAE.map((s) => s.menuTop)).size === 1,
      JSON.stringify({ menuCrossesTopAE, scTop: flipSamplesAE[0]?.scTop,
        menuTops: [...new Set(flipSamplesAE.map((s) => s.menuTop))],
        outsideFlags: [...new Set(flipSamplesAE.map((s) => s.outside))] }))

    const crumbClickedAE = await page.evaluate(() => {
      const crumb = document.querySelector('[data-tm-document-breadcrumb]')
      const button = crumb?.querySelector('button')
      if (!button) return false
      button.click()
      return true
    })
    const dropdownReadyAE = await waitFor(page, () =>
      !!document.querySelector('[data-tm-breadcrumb-dropdown]'), 6000)
    await sleep(250)
    const hiddenStateAE = await page.evaluate(() => {
      const crumb = document.querySelector('[data-tm-document-breadcrumb]')
      const area = document.querySelector('.tm-smart-side-menu-hit-area')
      const menu = document.querySelector('.tm-smart-block-menu')
      const areaStyle = area ? getComputedStyle(area) : null
      const menuStyle = menu ? getComputedStyle(menu) : null
      return {
        openFlag: crumb?.getAttribute('data-tm-breadcrumb-dropdown-open') ?? null,
        hasArea: !!area,
        areaVisibility: areaStyle?.visibility ?? null,
        areaPointerEvents: areaStyle?.pointerEvents ?? null,
        menuVisibility: menuStyle?.visibility ?? null,
        menuPointerEvents: menuStyle?.pointerEvents ?? null,
      }
    })
    check('【阶段 AE】面包屑下拉展开时块侧栏与菜单完全让位且鼠标不可达',
      crumbClickedAE && dropdownReadyAE && hiddenStateAE.openFlag === 'true'
      && hiddenStateAE.hasArea
      && hiddenStateAE.areaVisibility === 'hidden' && hiddenStateAE.areaPointerEvents === 'none'
      && (hiddenStateAE.menuVisibility === null || hiddenStateAE.menuVisibility === 'hidden')
      && (hiddenStateAE.menuPointerEvents === null || hiddenStateAE.menuPointerEvents === 'none'),
      JSON.stringify({ crumbClickedAE, dropdownReadyAE, hiddenStateAE }))

    await page.evaluate(() => {
      const crumb = document.querySelector('[data-tm-document-breadcrumb]')
      crumb?.querySelector('button')?.click()
    })
    await sleep(250)
    // 再点正文让块菜单收起、侧栏回到正文区内：守卫用标记保留 DOM，
    // 越界条件消失后必须恢复可见可点，不能永久隐藏整条侧栏。
    const bodyPointAE = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-editor .bn-inline-content')]
        .find((node) => (node.textContent || '').includes('正文第 1 段'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }
    })
    if (bodyPointAE) await page.mouse.click(bodyPointAE.x, bodyPointAE.y)
    await sleep(350)
    const restoredAE = await page.evaluate(() => {
      const crumb = document.querySelector('[data-tm-document-breadcrumb]')
      const area = document.querySelector('.tm-smart-side-menu-hit-area')
      return {
        openFlag: crumb?.getAttribute('data-tm-breadcrumb-dropdown-open') ?? null,
        outsideFlag: area?.getAttribute('data-tm-side-menu-outside') ?? null,
        visibility: area ? getComputedStyle(area).visibility : null,
        pointerEvents: area ? getComputedStyle(area).pointerEvents : null,
      }
    })
    check('【阶段 AE】面包屑下拉关闭且菜单收起后块侧栏恢复可交互',
      restoredAE.openFlag === 'false' && !!bodyPointAE
      // 点正文后 BlockNote 可能直接卸载侧栏（visibility=null），也是「已恢复」。
      && (restoredAE.visibility === null
        || (restoredAE.outsideFlag !== 'true'
          && restoredAE.visibility === 'visible' && restoredAE.pointerEvents === 'auto')),
      JSON.stringify({ bodyPointAE, restoredAE }))

    // 直接兜住用户反馈的回归：正常（非贴顶）块点击手柄必须能弹出菜单。
    const normalPointAE = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-editor .bn-inline-content')]
        .find((node) => (node.textContent || '').includes('正文第 2 段'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }
    })
    if (normalPointAE) {
      // 上一段「面包屑下拉开→关」可能把 H1 的块菜单留在展开态：侧栏手柄会钉在
      // 旧块（实测 y≈199 而目标块 y≈436），直接点击只会把它关掉。先点目标块收起，
      // 再真实移动鼠标让手柄跟随过来，并以「手柄 y 贴近目标块」作为落位判据。
      await page.mouse.click(normalPointAE.x, normalPointAE.y)
      await sleep(200)
      await page.mouse.move(normalPointAE.x - 24, normalPointAE.y)
      await page.mouse.move(normalPointAE.x, normalPointAE.y)
    }
    let normalHandleAE = null
    for (let i = 0; i < 24 && !normalHandleAE; i += 1) {
      normalHandleAE = await page.evaluate((targetY) => {
        const b = document.querySelector('.tm-smart-side-menu-hit-area .bn-button[draggable="true"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        if (r.width <= 0 || Math.abs(r.top + r.height / 2 - targetY) > 120) return null
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }, normalPointAE?.y ?? 0)
      if (!normalHandleAE) {
        await page.mouse.move(normalPointAE?.x ?? 0, normalPointAE?.y ?? 0)
        await sleep(250)
      }
    }
    if (normalHandleAE) await page.mouse.click(normalHandleAE.x, normalHandleAE.y)
    await sleep(350)
    if (normalHandleAE && !(await page.evaluate(() => !!document.querySelector('.tm-smart-block-menu')))) {
      // 首次点击若只是收起了残留菜单，再点一次才真正展开当前块的菜单。
      await page.mouse.click(normalHandleAE.x, normalHandleAE.y)
      await sleep(350)
    }
    const normalMenuAE = await page.evaluate(() => {
      const menu = document.querySelector('.tm-smart-block-menu')
      const area = document.querySelector('.tm-smart-side-menu-hit-area')
      return {
        hasMenu: !!menu,
        menuVisibility: menu ? getComputedStyle(menu).visibility : null,
        areaVisibility: area ? getComputedStyle(area).visibility : null,
        outsideFlag: area?.getAttribute('data-tm-side-menu-outside') ?? null,
      }
    })
    // 命中区里可能同时挂着多个块的按钮，querySelector 拿到的第一个未必属于当前块，
    // 因此不以手柄坐标做硬断言：真正的不变量是「正常块能打开菜单、侧栏可见且未被误判越界」。
    check('【阶段 AE】正常块点击后块菜单可用，侧栏未被误判越界',
      !!normalPointAE
      && normalMenuAE.hasMenu && normalMenuAE.menuVisibility === 'visible'
      && normalMenuAE.areaVisibility === 'visible'
      && normalMenuAE.outsideFlag !== 'true',
      JSON.stringify({ normalPointAE, normalHandleAE, normalMenuAE }))

    // 用户反馈的完整路径：面包屑下拉开 → 关 → 再点块手柄，菜单一闪而过。
    const reopenCrumbAE = await page.evaluate(() => {
      const crumb = document.querySelector('[data-tm-document-breadcrumb]')
      const button = crumb?.querySelector('button')
      if (!button) return false
      button.click()
      return true
    })
    await sleep(250)
    // 真实鼠标点正文，走面包屑的 handleClickOutside 关闭下拉
    const closePointAE = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-editor .bn-inline-content')]
        .find((node) => (node.textContent || '').includes('正文第 3 段'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }
    })
    if (closePointAE) await page.mouse.click(closePointAE.x, closePointAE.y)
    await sleep(300)
    const closedFlagAE = await page.evaluate(() =>
      document.querySelector('[data-tm-document-breadcrumb]')?.getAttribute('data-tm-breadcrumb-dropdown-open') ?? null)

    const block4PointAE = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-editor .bn-inline-content')]
        .find((node) => (node.textContent || '').includes('正文第 4 段'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }
    })
    if (block4PointAE) await page.mouse.move(block4PointAE.x, block4PointAE.y)
    let handle4AE = null
    for (let i = 0; i < 24 && !handle4AE; i++) {
      handle4AE = await page.evaluate(() => {
        const b = document.querySelector('.tm-smart-side-menu-hit-area .bn-button[draggable="true"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
      })
      if (!handle4AE) await sleep(250)
    }
    if (handle4AE) await page.mouse.click(handle4AE.x, handle4AE.y)
    const samplesAfterCrumbAE = []
    for (let i = 0; i < 12; i++) {
      samplesAfterCrumbAE.push(await page.evaluate(() => {
        const menu = document.querySelector('.tm-smart-block-menu')
        const area = document.querySelector('.tm-smart-side-menu-hit-area')
        const sc = document.querySelector('.tm-smart-editor-scroll')
        return {
          menu: !!menu,
          menuVis: menu ? getComputedStyle(menu).visibility : null,
          menuTop: menu ? Math.round(menu.getBoundingClientRect().top) : null,
          areaVis: area ? getComputedStyle(area).visibility : null,
          outside: area?.getAttribute('data-tm-side-menu-outside') ?? null,
          crumbOpen: document.querySelector('[data-tm-document-breadcrumb]')?.getAttribute('data-tm-breadcrumb-dropdown-open') ?? null,
          scTop: sc ? Math.round(sc.getBoundingClientRect().top) : null,
        }
      }))
      await sleep(100)
    }
    check('【阶段 AE】面包屑下拉开→关后块菜单不会一闪而过',
      reopenCrumbAE && closedFlagAE === 'false' && !!block4PointAE && !!handle4AE
      && samplesAfterCrumbAE.slice(-4).every((s) =>
        s.menu && s.menuVis === 'visible' && s.areaVis === 'visible' && s.outside !== 'true'),
      JSON.stringify({ reopenCrumbAE, closedFlagAE, block4PointAE, handle4AE, samplesAfterCrumbAE }))

    // 更短的操作间隔：下拉仍开着时直接点手柄位置（点击先关下拉、落到正文），
    // 紧接着再点手柄。逐帧复算必须让隐藏状态在这一帧内恢复。
    const quickOpenAE = await page.evaluate(() => {
      const crumb = document.querySelector('[data-tm-document-breadcrumb]')
      const button = crumb?.querySelector('button')
      if (!button) return false
      button.click()
      return true
    })
    await sleep(180)
    if (handle4AE) await page.mouse.click(handle4AE.x, handle4AE.y)
    await sleep(150)
    const quickClosedAE = await page.evaluate(() =>
      document.querySelector('[data-tm-document-breadcrumb]')?.getAttribute('data-tm-breadcrumb-dropdown-open') === 'false')
    if (block4PointAE) await page.mouse.move(block4PointAE.x, block4PointAE.y)
    await sleep(180)
    let quickHandleAE = null
    for (let i = 0; i < 24 && !quickHandleAE; i++) {
      quickHandleAE = await page.evaluate(() => {
        const b = document.querySelector('.tm-smart-side-menu-hit-area .bn-button[draggable="true"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
      })
      if (!quickHandleAE) await sleep(200)
    }
    if (quickHandleAE) await page.mouse.click(quickHandleAE.x, quickHandleAE.y)
    await sleep(400)
    const quickMenuAE = await page.evaluate(() => {
      const menu = document.querySelector('.tm-smart-block-menu')
      const area = document.querySelector('.tm-smart-side-menu-hit-area')
      return {
        menu: !!menu,
        menuVis: menu ? getComputedStyle(menu).visibility : null,
        areaVis: area ? getComputedStyle(area).visibility : null,
        outside: area?.getAttribute('data-tm-side-menu-outside') ?? null,
        crumbOpen: document.querySelector('[data-tm-document-breadcrumb]')?.getAttribute('data-tm-breadcrumb-dropdown-open') ?? null,
      }
    })
    check('【阶段 AE】短间隔连续操作后块菜单仍稳定显示（隐藏状态不粘滞）',
      quickOpenAE && quickClosedAE && !!quickHandleAE
      && quickMenuAE.menu && quickMenuAE.menuVis === 'visible'
      && quickMenuAE.areaVis === 'visible' && quickMenuAE.outside !== 'true',
      JSON.stringify({ quickOpenAE, quickClosedAE, quickHandleAE, quickMenuAE }))
    // ===== 阶段 AF：全局导航层（2026-11-21）=====
    // 与前面所有阶段共用同一 Electron 实例；只读 DOM 与偏好，不改知识库数据。
    const shotDirAF = path.join(process.cwd(), 'outputs', 'nav-rail-preview')
    fs.mkdirSync(shotDirAF, { recursive: true })
    const rectAF = () => page.evaluate(() => {
      const g = document.querySelector('#graph-panel')
      const a = document.querySelector('#app-layout')
      if (!g || !a) return null
      const gr = g.getBoundingClientRect()
      const ar = a.getBoundingClientRect()
      return { graph: [Math.round(gr.width), Math.round(gr.height)], app: [Math.round(ar.width), Math.round(ar.height)] }
    })
    const beforeAF = await rectAF()
    check('【阶段 AF】画布绝对铺满 app-layout，导航层不改变画布尺寸',
      !!beforeAF && beforeAF.graph[0] === beforeAF.app[0] && beforeAF.graph[1] === beforeAF.app[1],
      JSON.stringify(beforeAF))

    await page.evaluate(() => (() => { const r = document.querySelector('[data-tm-nav-rail-root]'); if (r?.getAttribute('data-tm-nav-rail-visible') === 'false') document.querySelector('button[aria-label="展开全局导航栏"]')?.click() })())
    await sleep(350)
    const navItemsAF = await page.evaluate(() =>
      [...document.querySelectorAll('[data-tm-nav-item]')].map((el) => el.getAttribute('data-tm-nav-item')))
    check('【阶段 AF】宿主与插件导航项都已渲染，笔记库 / 专注模式入口已移除',
      ['home', 'settings', 'learning.statistics', 'monitor.logs'].every((id) => navItemsAF.includes(id))
      && !navItemsAF.includes('library') && !navItemsAF.includes('focus'),
      JSON.stringify(navItemsAF))

    const panelAF = await page.evaluate(() => ({
      panels: document.querySelectorAll('[data-tm-nav-panel]').length,
      graph: (() => { const r = document.querySelector('#graph-panel')?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null })(),
      app: (() => { const r = document.querySelector('#app-layout')?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null })(),
    }))
    check('【阶段 AF】导航层只剩单层导航，无二级面板且画布几何逐像素不变',
      panelAF.panels === 0 && !!panelAF.graph && !!panelAF.app
      && panelAF.graph[0] === panelAF.app[0] && panelAF.graph[1] === panelAF.app[1],
    JSON.stringify(panelAF))

    await page.evaluate(() => document.querySelector('[data-tm-nav-item="settings"]')?.click())
    await sleep(800)
    const settingsAF = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('h1')].map((h) => (h.textContent || '').trim()),
      left: Math.round(document.querySelector('[data-tm-app-view="secondary"]')?.getBoundingClientRect().left ?? -1),
      docked: document.documentElement.dataset.tmNavRailDocked,
    }))
    check('【阶段 AF】设置页可达，非画布视图为常驻导航栏让位',
      settingsAF.titles.includes('设置') && settingsAF.left >= 40 && settingsAF.docked === 'true',
      JSON.stringify(settingsAF))
    await page.screenshot({ path: path.join(shotDirAF, '01-settings.png') })

    await page.evaluate(() => document.querySelector('[data-tm-nav-item="home"]')?.click())
    await sleep(700)
    await page.screenshot({ path: path.join(shotDirAF, '02-home.png') })

    // 从首页知识库总览打开画布，替代原先的笔记库二级面板入口。
    await page.evaluate(() => document.querySelector('[aria-label^="打开知识库 "]')?.click())
    await sleep(1000)
    // 确保导航栏可见，拍「导航展开态」。
    await page.evaluate(() => (() => { const r = document.querySelector('[data-tm-nav-rail-root]'); if (r?.getAttribute('data-tm-nav-rail-visible') === 'false') document.querySelector('button[aria-label="展开全局导航栏"]')?.click() })())
    await sleep(350)
    await page.screenshot({ path: path.join(shotDirAF, '03-canvas.png') })

    // 鼠标移回画布中部触发导航层收起，拍「默认画布态」：只留 6px 边缘条。
    await page.mouse.move(700, 500)
    await sleep(600)
    const defaultAF = await page.evaluate(() => {
      const rail = document.querySelector('[data-tm-nav-rail-root]')
      const drawer = document.querySelector('[data-tm-canvas-status-drawer]')
      const graph = document.querySelector('#graph-panel')?.getBoundingClientRect()
      return {
        edge: rail?.getAttribute('data-tm-nav-rail-edge') ?? null,
        railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
        drawerLeft: drawer ? Math.round(drawer.getBoundingClientRect().left) : null,
        graphWidth: graph ? Math.round(graph.width) : null,
        open: document.documentElement.dataset.tmNavRailOpen ?? null,
      }
    })
    check('【阶段 AF】画布页导航栏默认显示且为覆盖浮层，画布宽度恒定、状态抽屉让位',
      defaultAF.edge === 'false' && defaultAF.railWidth !== null && defaultAF.railWidth >= 40
      && defaultAF.drawerLeft !== null && defaultAF.drawerLeft >= 48
      && defaultAF.graphWidth === beforeAF?.app?.[0],
    JSON.stringify(defaultAF))
    await page.screenshot({ path: path.join(shotDirAF, '04-canvas-default.png') })

    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    await page.keyboard.down('Control')
    await page.keyboard.down('Shift')
    await page.keyboard.press('f')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Control')
    await sleep(350)
    const immersiveAF = await page.evaluate(() => ({
      mode: document.documentElement.dataset.tmImmersive ?? null,
      rail: !!document.querySelector('[data-tm-nav-rail-root]'),
      panels: document.querySelectorAll('[data-tm-nav-panel]').length,
    }))
    check('【阶段 AF】专注模式已移除，快捷键不再产生沉浸态也不改动导航栏',
      immersiveAF.mode === null && immersiveAF.rail && immersiveAF.panels === 0,
    JSON.stringify(immersiveAF))
    console.log(`[nav-rail preview] ${shotDirAF}`)

    // ===== 阶段 AI：标题栏控制区重构（2026-11-21）+ 学习时长迁入导航（2026-11-25）=====
    const chromeAI = await page.evaluate(() => {
      const title = document.querySelector('[data-tm-titlebar-unfocused]')
      const zone = document.querySelector('[data-tm-tab-zone]')
      return {
        hasLogo: !!title?.querySelector('img[alt="Logo"]'),
        hasToggle: !!document.querySelector('[data-tm-nav-rail-toggle]'),
        hasHamburger: !!document.querySelector('nav[aria-label="应用菜单"] button[aria-label="应用菜单"]'),
        noTitlebarWidget: !document.querySelector('[data-tm-titlebar-widget]')
          && !document.querySelector('[data-tm-learning-duration]'),
        hasTabZone: !!zone,
        learningDial: !!document.querySelector('[data-tm-nav-item="learning.statistics"] [data-tm-learning-dial]'),
        noManualRightPanel: !document.querySelector('button[aria-label="折叠右侧面板"]')
          && !document.querySelector('button[aria-label="展开右侧面板"]')
          && !document.querySelector('[aria-label="右侧面板分区"]'),
        focusAutoHide: !!document.querySelector('[data-tm-right-panel-focus-auto-hide]'),
      }
    })
    check('【阶段 AI】标题栏无软件图标、保留汉堡与全局导航开关，学习计时已迁入导航表盘，右栏手动控件已移除',
      !chromeAI.hasLogo && chromeAI.hasToggle && chromeAI.hasHamburger && chromeAI.noTitlebarWidget
      && chromeAI.hasTabZone && chromeAI.learningDial
      && chromeAI.noManualRightPanel && chromeAI.focusAutoHide,
      JSON.stringify(chromeAI))

    // 全局开关在画布页也必须生效
    await page.evaluate(() => document.querySelector('[data-tm-nav-rail-toggle]')?.click())
    await sleep(320)
    const railHiddenAI = await page.evaluate(() => ({
      visible: document.querySelector('[data-tm-nav-rail-root]')?.getAttribute('data-tm-nav-rail-visible') ?? null,
      width: Math.round(document.querySelector('[data-tm-nav-rail-root]')?.getBoundingClientRect().width ?? -1),
      graphWidth: Math.round(document.querySelector('#graph-panel')?.getBoundingClientRect().width ?? -1),
    }))
    check('【阶段 AI】画布页点击全局开关即可隐藏导航栏，画布宽度恒定',
      railHiddenAI.visible === 'false' && railHiddenAI.width === 0
      && railHiddenAI.graphWidth === beforeAF?.app?.[0],
      JSON.stringify(railHiddenAI))
    await page.screenshot({ path: path.join(shotDirAF, '12-titlebar-rail-hidden.png') })

    await page.evaluate(() => document.querySelector('[data-tm-nav-rail-toggle]')?.click())
    await sleep(320)
    const railRestoredAI = await page.evaluate(() =>
      document.querySelector('[data-tm-nav-rail-root]')?.getAttribute('data-tm-nav-rail-visible') ?? null)
    check('【阶段 AI】再次点击全局开关恢复导航栏', railRestoredAI === 'true', JSON.stringify({ railRestoredAI }))

    // 系统页同样受全局开关控制；画布相关配置已迁入左栏「画布设置」页，
    // 设置页只保留一条引导说明，样式面板本体回到画布页验证。
    await page.evaluate(() => document.querySelector('[data-tm-nav-item="settings"]')?.click())
    await sleep(650)
    const settingsAI = await page.evaluate(() => {
      const secondary = document.querySelector('[data-tm-app-view="secondary"]')
      const text = secondary?.textContent ?? ''
      return {
        guide: text.includes('画布设置'),
        noStylePanel: !document.querySelector('[data-tm-settings-style]'),
        crashed: text.includes('二级视图页面加载失败') || text.includes('Missing GraphStoreProvider'),
        hasTitle: !!secondary?.querySelector('h1'),
        railVisible: document.querySelector('[data-tm-nav-rail-root]')?.getAttribute('data-tm-nav-rail-visible') ?? null,
        docked: document.documentElement.dataset.tmNavRailDocked ?? null,
      }
    })
    check('【阶段 AI】设置页正常渲染，未触发 ErrorBoundary / GraphStore 崩溃',
      !settingsAI.crashed && settingsAI.hasTitle,
      JSON.stringify(settingsAI))
    check('【阶段 AI】设置页只留画布设置引导，导航栏在系统页仍受同一开关控制',
      settingsAI.guide && settingsAI.noStylePanel && settingsAI.railVisible === 'true' && settingsAI.docked === 'true',
      JSON.stringify(settingsAI))
    await page.screenshot({ path: path.join(shotDirAF, '13-titlebar-settings-style.png') })
    await page.evaluate(() => document.querySelector('[data-tm-tab-bar] [role="tab"]')?.click())
    await sleep(400)
    // 样式面板本体现在住在左栏画布设置页：打开后必须真渲染且不崩溃。
    const canvasStyleAI = await withCanvasSettings(page, () => page.evaluate(() => ({
      styleSection: !!document.querySelector('[data-tm-canvas-settings-style] [aria-label="样式面板分区"]'),
      crashed: (document.body.textContent ?? '').includes('二级视图页面加载失败'),
    })))
    check('【阶段 AI】节点与连线样式面板在左栏画布设置页正常渲染',
      canvasStyleAI.styleSection && !canvasStyleAI.crashed,
      JSON.stringify(canvasStyleAI))


    // ===== 阶段 AG：统一控件契约的运行时证据（2026-11-21）=====
    // 静态门禁只能证明「源码写了 .tm-*」，这里实测 CSS 真的生效：
    // 同类控件圆角一致、图标尺寸一致，且画布几何仍未被改变。
    await page.evaluate(() => {
      const drawer = document.querySelector('[data-tm-canvas-status-drawer]')
      if (drawer?.getAttribute('data-tm-canvas-status-open') !== 'true') {
        document.querySelector('[data-tm-canvas-status-toggle]')?.click()
      }
    })
    await sleep(400)
    const controlsAG = await withCanvasSettings(page, () => page.evaluate(() => {
      const toggle = document.querySelector('[data-tm-canvas-status-toggle]')
      const pin = document.querySelector('[data-tm-lod-pin-toggle]')
      const select = document.querySelector('[data-tm-graph-profile-select]')
      const radius = (el) => el ? getComputedStyle(el).borderRadius : null
      const graph = document.querySelector('#graph-panel')?.getBoundingClientRect()
      return {
        toggleHasTm: toggle?.className.includes('tm-icon-btn') ?? false,
        pinHasTm: pin?.className.includes('tm-btn') ?? false,
        selectHasTm: select?.className.includes('tm-select') ?? false,
        toggleRadius: radius(toggle),
        selectRadius: radius(select),
        iconWidth: (() => { const i = pin?.querySelector('svg'); return i ? Math.round(i.getBoundingClientRect().width) : null })(),
        graphWidth: graph ? Math.round(graph.width) : null,
      }
    }))
    check('【阶段 AG】画布控件已套用统一 .tm-* 类，圆角/图标尺寸一致且画布宽度不变',
      controlsAG.toggleHasTm && controlsAG.pinHasTm && controlsAG.selectHasTm
      && !!controlsAG.toggleRadius && controlsAG.toggleRadius === controlsAG.selectRadius
      && controlsAG.iconWidth === 12 && controlsAG.graphWidth === beforeAF?.app?.[0],
    JSON.stringify(controlsAG))
    await page.screenshot({ path: path.join(shotDirAF, '05-controls-unified.png') })

    // ===== 阶段 AH：横向知识库 tab 栏（2026-11-21）=====
    // 静态门禁只能证明源码结构，这里实测：顶栏仍是 32px 且画布几何/起点不变、
    // tab 一步直达、系统页不占 tab、拖拽安全带恒在、视觉契约真的生效。
    await page.evaluate(() => {
      const drawer = document.querySelector('[data-tm-canvas-status-drawer]')
      if (drawer?.getAttribute('data-tm-canvas-status-open') === 'true') {
        document.querySelector('[data-tm-canvas-status-toggle]')?.click()
      }
    })
    await page.mouse.move(700, 500)
    await sleep(450)

    const geoAH = await page.evaluate(() => {
      const graph = document.querySelector('#graph-panel')?.getBoundingClientRect()
      const app = document.querySelector('#app-layout')?.getBoundingClientRect()
      const title = document.querySelector('[data-tm-titlebar-unfocused]')?.getBoundingClientRect()
      const gutter = document.querySelector('[data-tm-tab-drag-gutter]')?.getBoundingClientRect()
      const bar = document.querySelector('[data-tm-tab-bar]')?.getBoundingClientRect()
      return {
        graph: graph ? [Math.round(graph.width), Math.round(graph.height)] : null,
        app: app ? [Math.round(app.width), Math.round(app.height)] : null,
        graphTop: graph ? Math.round(graph.top) : null,
        titleHeight: title ? Math.round(title.height) : null,
        gutter: gutter ? Math.round(gutter.width) : null,
        barWidth: bar ? Math.round(bar.width) : null,
        tabCount: document.querySelectorAll('[data-tm-tab-bar] [role="tab"]').length,
        selected: document.querySelectorAll('[data-tm-tab-bar] [role="tab"][aria-selected="true"]').length,
        tablist: !!document.querySelector('[data-tm-tab-bar] [role="tablist"]'),
      }
    })
    check('【阶段 AH】32px 顶栏仍是唯一占流兄弟，画布宽高与起点完全不变',
      !!geoAH.graph && !!geoAH.app && geoAH.graph[0] === geoAH.app[0] && geoAH.graph[1] === geoAH.app[1]
      && geoAH.titleHeight === 32 && geoAH.graphTop === 32
      && geoAH.graph[0] === beforeAF?.app?.[0]
      && geoAH.gutter !== null && geoAH.gutter >= 80
      && geoAH.tablist && geoAH.tabCount >= 1 && geoAH.selected === 1,
      JSON.stringify(geoAH))

    const styleAH = await page.evaluate(() => {
      const barEl = document.querySelector('[data-tm-tab-bar]')
      const stripEl = document.querySelector('[data-tm-tab-bar] [role="tablist"]')
      const titleEl = document.querySelector('[data-tm-titlebar-unfocused]')
      const active = document.querySelector('[data-tm-tab-bar] [role="tab"][aria-selected="true"]')
      const cs = active ? getComputedStyle(active) : null
      const seam = active ? getComputedStyle(active, '::after') : null
      const icon = active?.querySelector('svg')
      const graph = document.querySelector('#graph-panel')
      return {
        hasTmTab: active?.className.includes('tm-tab') ?? false,
        height: active ? Math.round(active.getBoundingClientRect().height) : null,
        topLeftRadius: cs?.borderTopLeftRadius ?? null,
        bottomLeftRadius: cs?.borderBottomLeftRadius ?? null,
        bg: cs?.backgroundColor ?? null,
        graphBg: graph ? getComputedStyle(graph).backgroundColor : null,
        titlebarBg: titleEl ? getComputedStyle(titleEl).backgroundColor : null,
        seamHeight: seam?.height ?? null,
        seamBg: seam?.backgroundColor ?? null,
        iconWidth: icon ? Math.round(icon.getBoundingClientRect().width) : null,
        noDrag: barEl?.style.webkitAppRegion ?? null,
        zone: !!document.querySelector('[data-tm-tab-zone]'),
        activeView: titleEl?.getAttribute('data-tm-active-view') ?? null,
        hasPlus: !!document.querySelector('[data-tm-tab-bar] [aria-label="打开知识库"]'),
        tabWidthVar: stripEl ? getComputedStyle(stripEl).getPropertyValue('--tab-current-width').trim() : null,
      }
    })
    check('【阶段 AH】活跃 tab 为 Π 形连体：26px、下方直角、底色与画布一致、底缝盖住 border-b',
      styleAH.hasTmTab && styleAH.height === 26
      && Number.parseFloat(styleAH.topLeftRadius) > 0
      && Number.parseFloat(styleAH.bottomLeftRadius) === 0
      && !!styleAH.bg && styleAH.bg === styleAH.graphBg
      && styleAH.seamHeight === '1px' && styleAH.seamBg === styleAH.bg
      && styleAH.iconWidth === 12 && styleAH.noDrag === 'no-drag'
      && styleAH.zone && styleAH.activeView === 'kb',
      JSON.stringify(styleAH))
    check('【阶段 AH】Π 形对比度：顶栏底色深一档，活跃 tab 与画布同色且明显区别于顶栏',
      !!styleAH.titlebarBg && styleAH.titlebarBg !== styleAH.bg
      && !!styleAH.bg && styleAH.bg === styleAH.graphBg,
      JSON.stringify({ titlebarBg: styleAH.titlebarBg, bg: styleAH.bg, graphBg: styleAH.graphBg }))
    check('【阶段 AH】tab 栏不再有「+」按钮，宽度由弹性 token 注入',
      !styleAH.hasPlus && /px$/.test(styleAH.tabWidthVar ?? ''),
      JSON.stringify({ hasPlus: styleAH.hasPlus, tabWidthVar: styleAH.tabWidthVar }))

    await page.evaluate(() => (() => { const r = document.querySelector('[data-tm-nav-rail-root]'); if (r?.getAttribute('data-tm-nav-rail-visible') === 'false') document.querySelector('button[aria-label="展开全局导航栏"]')?.click() })())
    await sleep(300)
    await page.evaluate(() => document.querySelector('[data-tm-nav-item="settings"]')?.click())
    await sleep(650)
    const systemAH = await page.evaluate(() => ({
      selected: document.querySelectorAll('[data-tm-tab-bar] [role="tab"][aria-selected="true"]').length,
      labels: [...document.querySelectorAll('[data-tm-tab-bar] [role="tab"]')].map((el) => el.getAttribute('aria-label')),
      // 视图是常驻挂载的，只能用 visibility 判定当前是否真的在系统页。
      secondaryVisible: getComputedStyle(document.querySelector('[data-tm-app-view="secondary"]')).visibility === 'visible',
    }))
    check('【阶段 AH】系统页不出现在 tab 栏，且所有知识库 tab 呈非活跃态',
      systemAH.secondaryVisible && systemAH.selected === 0
      && !systemAH.labels.some((label) => ['设置', '学习统计', '系统日志', '首页'].includes(label)),
      JSON.stringify(systemAH))
    await page.screenshot({ path: path.join(shotDirAF, '07-tabs-system-view.png') })

    const firstTabAH = await page.evaluate(() => {
      const first = document.querySelector('[data-tm-tab-bar] [role="tab"]')
      if (!first) return null
      first.click()
      return first.getAttribute('data-tm-tab-id')
    })
    await sleep(650)
    const backAH = await page.evaluate(() => ({
      selected: document.querySelectorAll('[data-tm-tab-bar] [role="tab"][aria-selected="true"]').length,
      graphVisible: !!document.querySelector('#graph-panel'),
      secondaryHidden: getComputedStyle(document.querySelector('[data-tm-app-view="secondary"]')).visibility === 'hidden',
    }))
    check('【阶段 AH】单击一个 tab 即可一步切回知识库画布',
      !!firstTabAH && backAH.selected === 1 && backAH.graphVisible && backAH.secondaryHidden,
      JSON.stringify({ firstTabAH, backAH }))

    // 只改 tab zone 的 inline 宽度来模拟窄窗口：ResizeObserver 现在观察 zone，
    // 改 bar 的 max-width 不会再触发重算（bar 是内容自适应宽度）。
    await page.evaluate(() => {
      const zone = document.querySelector('[data-tm-tab-zone]')
      if (zone) zone.style.width = '320px'
    })
    await sleep(450)
    const overflowAH = await page.evaluate(() => {
      const zone = document.querySelector('[data-tm-tab-zone]')
      const gutter = document.querySelector('[data-tm-tab-drag-gutter]')
      const tab = document.querySelector('[data-tm-tab-bar] [role="tab"]')
      const bar = document.querySelector('[data-tm-tab-bar]')
      return {
        zoneWidth: zone ? Math.round(zone.getBoundingClientRect().width) : null,
        barWidth: bar ? Math.round(bar.getBoundingClientRect().width) : null,
        gutter: gutter ? Math.round(gutter.getBoundingClientRect().width) : null,
        overflow: !!document.querySelector('[aria-label^="更多已打开的知识库"]'),
        visibleTabs: document.querySelectorAll('[data-tm-tab-bar] [role="tab"]').length,
        tabWidth: tab ? Math.round(tab.getBoundingClientRect().width) : null,
        graphWidth: Math.round(document.querySelector('#graph-panel')?.getBoundingClientRect().width ?? -1),
      }
    })
    check('【阶段 AH】窄宽度下 tab 栏不撑破顶栏，拖拽安全带与画布宽度恒定',
      overflowAH.zoneWidth !== null && overflowAH.zoneWidth <= 320
      && overflowAH.barWidth !== null && overflowAH.barWidth <= overflowAH.zoneWidth
      && overflowAH.gutter !== null && overflowAH.gutter >= 80
      && overflowAH.graphWidth === beforeAF?.app?.[0],
      JSON.stringify(overflowAH))
    check('【阶段 AH】窄宽度下单个 tab 仍横向展示、不折叠、不出现「+」',
      overflowAH.visibleTabs === 1 && !overflowAH.overflow
      && !!overflowAH.tabWidth && overflowAH.tabWidth >= 88 && overflowAH.tabWidth <= 180,
      JSON.stringify(overflowAH))
    await page.screenshot({ path: path.join(shotDirAF, '08-tabs-overflow.png') })
    await page.evaluate(() => {
      const zone = document.querySelector('[data-tm-tab-zone]')
      if (zone) zone.style.width = ''
    })
    await page.mouse.move(700, 500)
    await sleep(450)
    await page.screenshot({ path: path.join(shotDirAF, '06-tabs-canvas.png') })

    // ===== 阶段 AH-v2：多个知识库必须横向并排，绝不折叠成下拉 =====
    // 早期阶段只建一个测试库；这里在末尾动态追加两个最小知识库，由首页
    // 知识库总览真实打开，实测 Chrome 式弹性压缩与「最小宽度后才溢出」。
    for (const name of ['第二知识库', '第三知识库']) {
      const dir = path.join(WORKDIR, 'kbs', name)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '_graph.json'), JSON.stringify({
        children: {}, edges: [], zoom: 1, pan: { x: 0, y: 0 },
      }), 'utf8')
    }
    // 首页列表只在挂载时读取一次目录，追加夹具后重载渲染进程让它重新列举。
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => !!document.querySelector('[data-tm-nav-rail-root]'), 10000)
    await page.evaluate(() => {
      const r = document.querySelector('[data-tm-nav-rail-root]')
      if (r?.getAttribute('data-tm-nav-rail-visible') === 'false') {
        document.querySelector('button[aria-label="展开全局导航栏"]')?.click()
      }
    })
    await waitFor(page, () => !!document.querySelector('[data-tm-nav-item="home"]'), 10000)
    await sleep(600)
    const openKBByName = async (name) => {
      await page.evaluate(() => document.querySelector('[data-tm-nav-item="home"]')?.click())
      await sleep(400)
      const ready = await waitFor(page, () => !!document.querySelector('[aria-label^="打开知识库 "]'), 5000)
      const clicked = ready && await page.evaluate((kbName) => {
        const card = document.querySelector(`[aria-label="打开知识库 ${kbName}"]`)
        if (!card) return false
        card.click()
        return true
      }, name)
      await sleep(700)
      return clicked
    }
    const opened1 = await openKBByName(KB_NAME)
    const opened2 = await openKBByName('第二知识库')
    const opened3 = await openKBByName('第三知识库')
    check('【阶段 AH】能真实打开多个知识库（夹具：追加两个库并逐一点开）',
      opened1 && opened2 && opened3, JSON.stringify({ opened1, opened2, opened3 }))

    const multiAH = await page.evaluate(() => {
      const bar = document.querySelector('[data-tm-tab-bar]')
      const zone = document.querySelector('[data-tm-tab-zone]')
      const gutter = document.querySelector('[data-tm-tab-drag-gutter]')
      const tabs = [...document.querySelectorAll('[data-tm-tab-bar] [role="tab"]')]
      const lastRight = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : null
      return {
        count: bar?.getAttribute('data-tm-tab-count') ?? null,
        visible: tabs.length,
        overflowAttr: bar?.getAttribute('data-tm-tab-overflow') ?? null,
        hasOverflowButton: !!document.querySelector('[aria-label^="更多已打开的知识库"]'),
        hasPlus: !!document.querySelector('[data-tm-tab-bar] [aria-label="打开知识库"]'),
        widths: tabs.map((el) => Math.round(el.getBoundingClientRect().width)),
        zoneWidth: zone ? Math.round(zone.getBoundingClientRect().width) : null,
        gutter: gutter ? Math.round(gutter.getBoundingClientRect().width) : null,
        rightSpace: zone && lastRight !== null
          ? Math.round(zone.getBoundingClientRect().right - lastRight) : null,
      }
    })
    check('【阶段 AH】多个知识库横向并排不折叠，全部常驻可见且右侧保留拖拽留白',
      Number(multiAH.count) >= 3 && multiAH.visible === Number(multiAH.count)
      && multiAH.overflowAttr === 'false' && !multiAH.hasOverflowButton && !multiAH.hasPlus
      && multiAH.widths.length >= 3 && multiAH.widths.every((w) => w >= 88 && w <= 180)
      && multiAH.rightSpace !== null && multiAH.gutter !== null && multiAH.rightSpace >= multiAH.gutter,
      JSON.stringify(multiAH))
    await page.screenshot({ path: path.join(shotDirAF, '09-tabs-multi.png') })

    // 中等宽度：三个 tab 应「压缩但一个都不折叠」。
    await page.evaluate(() => {
      const zone = document.querySelector('[data-tm-tab-zone]')
      if (zone) zone.style.width = '560px'
    })
    await sleep(450)
    const compressedAH = await page.evaluate(() => {
      const bar = document.querySelector('[data-tm-tab-bar]')
      const tabs = [...document.querySelectorAll('[data-tm-tab-bar] [role="tab"]')]
      return {
        count: bar?.getAttribute('data-tm-tab-count') ?? null,
        visible: tabs.length,
        hasOverflowButton: !!document.querySelector('[aria-label^="更多已打开的知识库"]'),
        widths: tabs.map((el) => Math.round(el.getBoundingClientRect().width)),
      }
    })
    check('【阶段 AH】空间变窄时优先压缩每个 tab，压到最小宽度前绝不折叠',
      Number(compressedAH.count) >= 3 && compressedAH.visible === Number(compressedAH.count)
      && !compressedAH.hasOverflowButton
      && compressedAH.widths.length >= 3
      && compressedAH.widths.every((w) => w >= 88 && w <= 180)
      && compressedAH.widths[0] < multiAH.widths[0],
      JSON.stringify({ compressedAH, before: multiAH.widths }))
    await page.screenshot({ path: path.join(shotDirAF, '10-tabs-compressed.png') })

    // 极窄宽度：三个都压到最小仍放不下，才允许出现「⋯N」。
    await page.evaluate(() => {
      const zone = document.querySelector('[data-tm-tab-zone]')
      if (zone) zone.style.width = '300px'
    })
    await sleep(450)
    const realOverflowAH = await page.evaluate(() => {
      const bar = document.querySelector('[data-tm-tab-bar]')
      const tabs = [...document.querySelectorAll('[data-tm-tab-bar] [role="tab"]')]
      return {
        count: bar?.getAttribute('data-tm-tab-count') ?? null,
        visible: tabs.length,
        overflowAttr: bar?.getAttribute('data-tm-tab-overflow') ?? null,
        hasOverflowButton: !!document.querySelector('[aria-label^="更多已打开的知识库"]'),
        widths: tabs.map((el) => Math.round(el.getBoundingClientRect().width)),
      }
    })
    check('【阶段 AH】压到最小宽度仍放不下才出现「更多已打开知识库」',
      Number(realOverflowAH.count) >= 3 && realOverflowAH.visible < Number(realOverflowAH.count)
      && realOverflowAH.overflowAttr === 'true' && realOverflowAH.hasOverflowButton
      && realOverflowAH.widths.length >= 1 && realOverflowAH.widths.every((w) => w >= 88 && w <= 92),
      JSON.stringify(realOverflowAH))
    await page.screenshot({ path: path.join(shotDirAF, '11-tabs-real-overflow.png') })
    await page.evaluate(() => {
      const zone = document.querySelector('[data-tm-tab-zone]')
      if (zone) zone.style.width = ''
    })
    await page.mouse.move(700, 500)
    await sleep(400)
    console.log(`[tab bar preview] ${shotDirAF}`)
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
