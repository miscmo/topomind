/**
 * CardSpec 知识卡片载荷的领域类型与纯函数（阶段 5）。
 *
 * 设计依据：docs/design/cardspec-renderer-design.md §2。
 * 刻意不 import React / 任何渲染器：本模块必须能被门禁脚本 / 主进程侧复用，
 * 未安装编辑器包时也能独立编译、独立验证。AI（阶段 6）产出的也是这份结构，
 * normalizeCardSpecContent 是「生成 → 校验 → 落盘」链路里唯一的校验闸。
 */
export const CARDSPEC_DOCUMENT_SCHEMA = 'topomind.card-spec'
export const CARDSPEC_DOCUMENT_VERSION = 1
export const CARDSPEC_CONTAINER_TYPE = 'cardspec'

export const CARDSPEC_LAYOUTS = ['stack', 'grid'] as const
export type CardSpecLayout = typeof CARDSPEC_LAYOUTS[number]

export const CARD_BINDING_KINDS = ['title', 'summary', 'doc', 'children', 'static'] as const
export type CardBindingKind = typeof CARD_BINDING_KINDS[number]

export const CARD_BADGE_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const
export type CardBadgeTone = typeof CARD_BADGE_TONES[number]

export const CARD_PROGRESS_TONES = ['accent', 'success', 'warning', 'danger'] as const
export type CardProgressTone = typeof CARD_PROGRESS_TONES[number]

/** 已注册组件类型。flowchart 为阶段内 P2（引用同节点 Excalidraw 文档）；html 仅占位。 */
export const KNOWN_CARD_COMPONENT_TYPES = [
  'title', 'text', 'badge', 'image', 'audio', 'video',
  'table', 'progress', 'flowchart', 'html',
] as const
export type KnownCardComponentType = typeof KNOWN_CARD_COMPONENT_TYPES[number]

export interface CardBinding {
  kind: CardBindingKind
}

export interface CardComponent {
  id: string
  /** 未注册类型原样保留并标记 degraded='unknown-type'，渲染降级占位，绝不抹数据。 */
  type: string
  props: Record<string, unknown>
  styleRef?: string
  binding?: CardBinding
  /** normalize 判定的降级原因；渲染层据此显示占位，原始 props 不回写抹除。 */
  degraded?: 'unknown-type' | 'invalid-src'
}

export interface CardSpecContent {
  schema: typeof CARDSPEC_DOCUMENT_SCHEMA
  version: typeof CARDSPEC_DOCUMENT_VERSION
  title: string
  layout: CardSpecLayout
  components: CardComponent[]
  metadata?: {
    createdAt?: number
    updatedAt?: number
    generatedBy?: 'ai' | 'user'
  }
}

const MAX_COMPONENTS = 50
const MAX_ID = 64
const MAX_TITLE = 200
const MAX_TEXT = 4000
const MAX_BADGE = 50
const MAX_LABEL = 200
const MAX_ALT = 200
const MAX_SRC = 512
const MAX_HTML = 20_000
const MAX_DOCUMENT_ID = 128
const MAX_STYLE_REF = 64
const MAX_TABLE_COLS = 10
const MAX_TABLE_ROWS = 100
const MAX_CELL = 500

export const CARD_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const
export const CARD_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'] as const
export const CARD_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, max)
}

function finiteOr(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback
}

/** 资源路径规则：assets/ 开头的相对路径；拒绝绝对路径 / .. / 反斜杠 / 任何协议头 / data:。 */
export function isValidCardAssetSrc(src: string, allowedExtensions: readonly string[]): boolean {
  if (!src || src.length > MAX_SRC) return false
  if (!src.startsWith('assets/')) return false
  if (src.includes('..') || src.includes('\\')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) return false
  const fileName = src.slice('assets/'.length)
  if (!fileName || fileName.includes('/')) return false
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = fileName.slice(dot + 1).toLowerCase()
  return allowedExtensions.includes(ext)
}

function srcExtensionsFor(type: string): readonly string[] {
  if (type === 'image') return CARD_IMAGE_EXTENSIONS
  if (type === 'audio') return CARD_AUDIO_EXTENSIONS
  if (type === 'video') return CARD_VIDEO_EXTENSIONS
  return []
}

function normalizeBinding(raw: unknown): CardBinding | undefined {
  if (!isPlainObject(raw)) return undefined
  if (typeof raw.kind !== 'string') return undefined
  if (!(CARD_BINDING_KINDS as readonly string[]).includes(raw.kind)) return undefined
  return { kind: raw.kind as CardBindingKind }
}

function normalizeProps(type: string, raw: unknown): Record<string, unknown> {
  const item = isPlainObject(raw) ? raw : {}
  switch (type) {
    case 'title':
      return {
        text: text(item.text, MAX_TEXT),
        level: item.level === 2 || item.level === 3 ? item.level : 1,
      }
    case 'text':
      return {
        text: text(item.text, MAX_TEXT),
        variant: pickEnum(item.variant, ['body', 'caption'] as const, 'body'),
      }
    case 'badge':
      return {
        text: text(item.text, MAX_BADGE),
        tone: pickEnum(item.tone, CARD_BADGE_TONES, 'neutral'),
      }
    case 'image':
      return {
        src: text(item.src, MAX_SRC),
        alt: text(item.alt, MAX_ALT),
        fit: pickEnum(item.fit, ['contain', 'cover'] as const, 'contain'),
      }
    case 'audio':
      return { src: text(item.src, MAX_SRC), label: text(item.label, MAX_LABEL) }
    case 'video':
      return {
        src: text(item.src, MAX_SRC),
        label: text(item.label, MAX_LABEL),
        poster: text(item.poster, MAX_SRC),
      }
    case 'table': {
      const rawColumns = Array.isArray(item.columns) ? item.columns : []
      const columns = rawColumns.slice(0, MAX_TABLE_COLS).map((col) => text(col, MAX_CELL))
      const rawRows = Array.isArray(item.rows) ? item.rows : []
      const rows = rawRows.slice(0, MAX_TABLE_ROWS).map((row) => {
        const cells = Array.isArray(row) ? row : []
        // 列数以表头为准：少了补空串，多了截断，保证渲染永远是矩形。
        return Array.from({ length: columns.length }, (_, i) => text(cells[i], MAX_CELL))
      })
      return { columns, rows }
    }
    case 'progress':
      return {
        value: finiteOr(item.value, 0, 0, 100),
        label: text(item.label, MAX_LABEL),
        tone: pickEnum(item.tone, CARD_PROGRESS_TONES, 'accent'),
      }
    case 'flowchart':
      return { documentId: text(item.documentId, MAX_DOCUMENT_ID) }
    case 'html':
      // 占位组件：内容可保存但永不渲染（沙箱渲染推迟到阶段 8 评估）。
      return { html: text(item.html, MAX_HTML) }
    default:
      // 未知类型：props 原样保留（浅拷贝防调用方改引用），供未来版本理解。
      return { ...item }
  }
}

/** 返回 true 表示该组件必须标记 invalid-src（媒体组件 src 缺失或非法）。 */
function hasInvalidSrc(type: string, props: Record<string, unknown>): boolean {
  const extensions = srcExtensionsFor(type)
  if (extensions.length === 0) return false
  const src = typeof props.src === 'string' ? props.src : ''
  if (!isValidCardAssetSrc(src, extensions)) return true
  if (type === 'video' && typeof props.poster === 'string' && props.poster) {
    return !isValidCardAssetSrc(props.poster, CARD_IMAGE_EXTENSIONS)
  }
  return false
}

function normalizeComponent(raw: unknown, seen: Set<string>): CardComponent | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (typeof raw.type !== 'string' || !raw.type.trim()) return null
  const id = raw.id.trim().slice(0, MAX_ID)
  if (seen.has(id)) return null
  seen.add(id)
  const type = raw.type.trim().slice(0, MAX_ID)
  const props = normalizeProps(type, raw.props)
  const component: CardComponent = { id, type, props }
  const binding = normalizeBinding(raw.binding)
  if (binding) component.binding = binding
  if (typeof raw.styleRef === 'string' && raw.styleRef.trim()) {
    component.styleRef = raw.styleRef.trim().slice(0, MAX_STYLE_REF)
  }
  if (!(KNOWN_CARD_COMPONENT_TYPES as readonly string[]).includes(type)) {
    component.degraded = 'unknown-type'
  } else if (hasInvalidSrc(type, props)) {
    component.degraded = 'invalid-src'
  }
  return component
}

export function createEmptyCardSpecContent(title: string): CardSpecContent {
  const now = Date.now()
  return {
    schema: CARDSPEC_DOCUMENT_SCHEMA,
    version: CARDSPEC_DOCUMENT_VERSION,
    title: title || '未命名卡片',
    layout: 'stack',
    components: [],
    metadata: { createdAt: now, updatedAt: now, generatedBy: 'user' },
  }
}

/**
 * 未知 version 必须抛错且绝不回写：旧档 / 未来版本交由适配层显示「版本不受支持」。
 * 缺 version 按 v1 容忍（与 excalidraw normalize 同契约），非对象输入回落为空卡片。
 */
export function normalizeCardSpecContent(raw: unknown, fallbackTitle: string): CardSpecContent {
  if (raw === undefined || raw === null || raw === '') {
    return createEmptyCardSpecContent(fallbackTitle)
  }
  if (!isPlainObject(raw)) {
    return createEmptyCardSpecContent(fallbackTitle)
  }
  if (raw.version !== undefined && raw.version !== CARDSPEC_DOCUMENT_VERSION) {
    throw new Error(`CardSpec 文档版本不受支持: ${String(raw.version)}`)
  }
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim().slice(0, MAX_TITLE)
    : (fallbackTitle || '未命名卡片')
  const layout = pickEnum(raw.layout, CARDSPEC_LAYOUTS, 'stack')
  const seen = new Set<string>()
  const rawComponents = Array.isArray(raw.components) ? raw.components : []
  const components = rawComponents
    .slice(0, MAX_COMPONENTS)
    .map((component) => normalizeComponent(component, seen))
    .filter((component): component is CardComponent => component !== null)
  const metadata = isPlainObject(raw.metadata) ? raw.metadata : {}
  return {
    schema: CARDSPEC_DOCUMENT_SCHEMA,
    version: CARDSPEC_DOCUMENT_VERSION,
    title,
    layout,
    components,
    metadata: {
      createdAt: finiteOr(metadata.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      updatedAt: finiteOr(metadata.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      generatedBy: metadata.generatedBy === 'ai' ? 'ai' : 'user',
    },
  }
}

export function serializeCardSpecContent(value: CardSpecContent): string {
  return JSON.stringify(value, null, 2)
}

/** FNV-1a：预览缓存失效键，只依赖规范化后的内容，与组件顺序/字段序稳定。 */
export function cardSpecContentVersion(value: CardSpecContent): number {
  const serialized = serializeCardSpecContent(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}
