/**
 * Excalidraw 容器载荷的领域类型与纯函数。
 *
 * 刻意不 import @excalidraw/excalidraw：本模块要能被门禁脚本 / 主进程侧复用，
 * 且未安装编辑器包时也能独立编译、独立验证。真实元素类型在编辑层用官方类型收窄。
 */
export const EXCALIDRAW_DOCUMENT_SCHEMA = 'topomind.excalidraw-document'
export const EXCALIDRAW_DOCUMENT_VERSION = 1
export const EXCALIDRAW_CONTAINER_TYPE = 'excalidraw'
/**
 * 画布默认背景色。Excalidraw 用 canvas fillStyle 画背景，必须是具体色值，
 * 不能用未解析的 var(--...)。集中放这里，UI 侧就不必散落字面色值。
 */
export const EXCALIDRAW_DEFAULT_BACKGROUND = '#ffffff'

/** 只描述落盘需要的字段；元素其余字段原样保留（Excalidraw 自有演进）。 */
export interface ExcalidrawSceneElement {
  id: string
  type: string
  version?: number
  isDeleted?: boolean
  [key: string]: unknown
}

export interface ExcalidrawSceneAppState {
  viewBackgroundColor?: string
  gridSize?: number | null
  theme?: 'light' | 'dark'
  scrollX?: number
  scrollY?: number
  zoom?: number
}

export interface ExcalidrawDocumentContent {
  schema: typeof EXCALIDRAW_DOCUMENT_SCHEMA
  version: typeof EXCALIDRAW_DOCUMENT_VERSION
  title: string
  scene: {
    elements: ExcalidrawSceneElement[]
    appState: ExcalidrawSceneAppState
  }
  metadata?: {
    createdAt?: number
    updatedAt?: number
    editor?: 'excalidraw'
  }
}

const MAX_ELEMENTS = 20_000
const MAX_STRING = 512
const ZOOM_MIN = 0.1
const ZOOM_MAX = 30

function finiteOr(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeElement(raw: unknown, seen: Set<string>): ExcalidrawSceneElement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id) return null
  if (typeof item.type !== 'string' || !item.type) return null
  if (seen.has(item.id)) return null
  seen.add(item.id)
  const element: ExcalidrawSceneElement = { ...item, id: item.id.slice(0, MAX_STRING), type: item.type.slice(0, MAX_STRING) } as ExcalidrawSceneElement
  if (item.version !== undefined) element.version = finiteOr(item.version, 1, 0, 1_000_000)
  // 落盘不保留已删除元素，与 serializeAsJSON 的语义保持一致。
  if (item.isDeleted === true) return null
  delete element.isDeleted
  // v1 禁止图片载荷：files 不落盘。
  delete element.files
  return element
}

function normalizeAppState(raw: unknown): ExcalidrawSceneAppState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { viewBackgroundColor: '#ffffff' }
  const item = raw as Record<string, unknown>
  const state: ExcalidrawSceneAppState = {}
  if (typeof item.viewBackgroundColor === 'string') {
    state.viewBackgroundColor = item.viewBackgroundColor.slice(0, 32)
  } else {
    state.viewBackgroundColor = '#ffffff'
  }
  if (typeof item.gridSize === 'number' && Number.isFinite(item.gridSize)) {
    state.gridSize = finiteOr(item.gridSize, 0, 0, 10_000)
  }
  if (item.theme === 'light' || item.theme === 'dark') state.theme = item.theme
  if (item.scrollX !== undefined) state.scrollX = finiteOr(item.scrollX, 0, -1e7, 1e7)
  if (item.scrollY !== undefined) state.scrollY = finiteOr(item.scrollY, 0, -1e7, 1e7)
  if (item.zoom !== undefined) state.zoom = finiteOr(item.zoom, 1, ZOOM_MIN, ZOOM_MAX)
  // 只保留白名单字段，绝不落完整 AppState（选中态 / UI 面板状态都不能持久化）。
  return state
}

export function createEmptyExcalidrawDocumentContent(title: string): ExcalidrawDocumentContent {
  const now = Date.now()
  return {
    schema: EXCALIDRAW_DOCUMENT_SCHEMA,
    version: EXCALIDRAW_DOCUMENT_VERSION,
    title: title || '未命名白板',
    scene: { elements: [], appState: { viewBackgroundColor: '#ffffff' } },
    metadata: { createdAt: now, updatedAt: now, editor: 'excalidraw' },
  }
}

/**
 * 未知 version 必须抛错且绝不回写：旧档 / 未来版本都交由适配层显示「版本不受支持」，
 * 静默降级会把看不懂的数据当空场景覆盖掉。
 */
export function normalizeExcalidrawDocumentContent(raw: unknown, fallbackTitle: string): ExcalidrawDocumentContent {
  if (raw === undefined || raw === null || raw === '') {
    return createEmptyExcalidrawDocumentContent(fallbackTitle)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createEmptyExcalidrawDocumentContent(fallbackTitle)
  }
  const item = raw as Record<string, unknown>
  if (item.version !== undefined && item.version !== EXCALIDRAW_DOCUMENT_VERSION) {
    throw new Error(`Excalidraw 文档版本不受支持: ${String(item.version)}`)
  }
  const scene = (item.scene && typeof item.scene === 'object' && !Array.isArray(item.scene))
    ? item.scene as Record<string, unknown>
    : {}
  const rawElements = Array.isArray(scene.elements) ? scene.elements : Array.isArray(item.elements) ? item.elements : []
  const seen = new Set<string>()
  const elements = rawElements
    .slice(0, MAX_ELEMENTS)
    .map((element) => normalizeElement(element, seen))
    .filter((element): element is ExcalidrawSceneElement => element !== null)
  const title = typeof item.title === 'string' && item.title.trim()
    ? item.title.trim().slice(0, MAX_STRING)
    : (fallbackTitle || '未命名白板')
  const metadata = (item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata))
    ? item.metadata as Record<string, unknown>
    : {}
  return {
    schema: EXCALIDRAW_DOCUMENT_SCHEMA,
    version: EXCALIDRAW_DOCUMENT_VERSION,
    title,
    scene: { elements, appState: normalizeAppState(scene.appState ?? item.appState) },
    metadata: {
      createdAt: finiteOr(metadata.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      updatedAt: finiteOr(metadata.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      editor: 'excalidraw',
    },
  }
}

export function serializeExcalidrawDocumentContent(value: ExcalidrawDocumentContent): string {
  return JSON.stringify(value)
}

/**
 * 内容版本：元素版本 + 用户可持久化的画布外观（背景色 / 网格 / 主题）。
 *
 * 这个函数是两处「变化判定」的唯一依据，改字段前务必看清：
 *   - ContainerFullscreenEditorHost.handleChange 拿它做写盘去重；
 *   - ContainerSvgPreview 拿它做 SVG 导出缓存键（下沉到 svgPreviewQueue 的 LRU）。
 * 凡是「落盘后会改变预览」的字段都必须进这个哈希。只改画布背景色时元素一个
 * 都没动，若哈希不变：宿主直接 return 不写盘，预览又命中旧 SVG 缓存 —— 表现就是
 * 退出编辑后背景没变、再次双击进去上次的设置也丢了。
 *
 * 刻意不含 scrollX / scrollY / zoom / 选中态：Excalidraw 平移、缩放、点选都会
 * 触发 onChange，把这些视口瞬态纳入哈希会导致每次镜头操作都写盘并重导出预览。
 */
export function excalidrawSceneVersion(value: ExcalidrawDocumentContent): number {
  let hash = 0
  for (const element of value.scene?.elements ?? []) {
    const version = typeof element.version === 'number' ? element.version : 1
    hash = (hash * 31 + version) | 0
    for (let i = 0; i < element.id.length; i += 1) {
      hash = (hash * 31 + element.id.charCodeAt(i)) | 0
    }
  }
  const appState = value.scene?.appState ?? {}
  // 字段间插入分隔符，避免相邻字段拼接相同造成哈希碰撞（'ab'+'c' vs 'a'+'bc'）。
  for (const part of [
    appState.viewBackgroundColor ?? '',
    appState.gridSize === null || appState.gridSize === undefined ? '' : String(appState.gridSize),
    appState.theme ?? '',
  ]) {
    for (let i = 0; i < part.length; i += 1) {
      hash = (hash * 31 + part.charCodeAt(i)) | 0
    }
    hash = (hash * 31 + 7) | 0
  }
  return hash
}
