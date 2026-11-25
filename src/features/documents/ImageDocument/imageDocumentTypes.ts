/**
 * 图片容器载荷的领域类型与纯函数（无 React / 无 IO）。
 *
 * 一张本地图片 = 一个容器载荷：图片二进制由主进程导入节点 `_docs/assets/`，
 * 文档里只存 `assets/xxx.png` 相对引用。因此跨房间搬运、导入导出、回收站恢复
 * 都能靠目录搬运自动跟随，不需要任何绝对路径或 base64 内联。
 *
 * 路径规则刻意复用 CardSpec 的 isValidCardAssetSrc（拒绝 .. / 绝对路径 /
 * 协议头 / 非图片扩展名），避免形成第二份校验真源，也能继续享受主进程的
 * realpath 防符号链接逃逸。
 */
import {
  CARD_IMAGE_EXTENSIONS,
  isValidCardAssetSrc,
} from '../CardSpecDocument/cardSpecTypes'

export const IMAGE_DOCUMENT_SCHEMA = 'topomind.image-document'
export const IMAGE_DOCUMENT_VERSION = 1
/** 与 ContainerRef.type 对应，同时也是 TopoDocumentType。 */
export const IMAGE_CONTAINER_TYPE = 'image'

export const IMAGE_FITS = ['contain', 'cover'] as const
export type ImageFit = typeof IMAGE_FITS[number]

const MAX_TITLE = 200
const MAX_ALT = 200

/**
 * 【2026-11-24】图片节点自适应：选图后节点矩形严格按图片宽高比缩放，让
 * 图片与节点严丝合缝、四周零空隙。默认长边 480px —— 一屏放得下，且远小于
 * 容器节点放宽后的 1600×1200 上限，用户之后仍可拖大。
 */
export const IMAGE_NODE_FIT_LONG_EDGE = 480

export interface ImageNodeSizeLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

/**
 * 纯函数：按图片真实宽高算出节点尺寸。
 *
 * 先按长边等比缩放到 480，再统一 clamp 到 [min, max]；clamp 时仍用同一个
 * scale，保证返回的宽高比恒等于图片宽高比（这是「fill 不变形」的前提）。
 * 非法 / 零尺寸返回 null，由调用方保留用户当前尺寸，绝不写坏 _graph.json。
 */
export function fitImageNodeSize(
  intrinsicWidth: number,
  intrinsicHeight: number,
  limits: ImageNodeSizeLimits,
): { width: number; height: number } | null {
  if (!Number.isFinite(intrinsicWidth) || !Number.isFinite(intrinsicHeight)
    || intrinsicWidth <= 0 || intrinsicHeight <= 0) return null
  const minWidth = Number.isFinite(limits.minWidth) && limits.minWidth > 0 ? limits.minWidth : 1
  const minHeight = Number.isFinite(limits.minHeight) && limits.minHeight > 0 ? limits.minHeight : 1
  const maxWidth = Math.max(minWidth, Number.isFinite(limits.maxWidth) ? limits.maxWidth : minWidth)
  const maxHeight = Math.max(minHeight, Number.isFinite(limits.maxHeight) ? limits.maxHeight : minHeight)

  // 把 min/max 约束换算成 scale 的可行区间，在区间内取「长边 480」。
  // 这样无论多极端的宽高比，返回的宽高比都恒等于图片宽高比。
  const lowerScale = Math.max(minWidth / intrinsicWidth, minHeight / intrinsicHeight)
  const upperScale = Math.min(maxWidth / intrinsicWidth, maxHeight / intrinsicHeight)
  const wanted = IMAGE_NODE_FIT_LONG_EDGE / Math.max(intrinsicWidth, intrinsicHeight)
  // 极端比例下区间可能为空（例如 10000×1 既要 minHeight 又不能超 maxWidth）；
  // 此时优先守住 max，不写超出上限的尺寸，比例仍不破坏。
  const scale = upperScale < lowerScale ? upperScale : Math.min(upperScale, Math.max(lowerScale, wanted))
  if (!Number.isFinite(scale) || scale <= 0) return null

  return {
    width: Math.max(1, Math.round(intrinsicWidth * scale)),
    height: Math.max(1, Math.round(intrinsicHeight * scale)),
  }
}

export interface ImageDocumentContent {
  schema: typeof IMAGE_DOCUMENT_SCHEMA
  version: typeof IMAGE_DOCUMENT_VERSION
  title: string
  /** assets/ 相对引用；空串表示「尚未选图」，预览显示空态占位。 */
  src: string
  alt: string
  fit: ImageFit
  metadata?: {
    createdAt?: number
    updatedAt?: number
    editor?: string
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** 图片载荷允许的资源引用：只允许 assets/ 下的图片文件。 */
export function isImageAssetSrc(src: unknown): src is string {
  return typeof src === 'string' && isValidCardAssetSrc(src, CARD_IMAGE_EXTENSIONS)
}

export function createEmptyImageDocumentContent(title: string): ImageDocumentContent {
  const now = Date.now()
  return {
    schema: IMAGE_DOCUMENT_SCHEMA,
    version: IMAGE_DOCUMENT_VERSION,
    title: title || '图片容器',
    src: '',
    alt: '',
    fit: 'contain',
    metadata: { createdAt: now, updatedAt: now, editor: 'image' },
  }
}

/**
 * 未知 version 必须抛错且绝不回写（与 excalidraw / cardspec 同契约），
 * 由适配层显示「版本不受支持」；脏 src 一律回落成空态，绝不把非法路径渲染进 img。
 */
export function normalizeImageDocumentContent(raw: unknown, fallbackTitle: string): ImageDocumentContent {
  if (raw === undefined || raw === null || raw === '' || !isPlainObject(raw)) {
    return createEmptyImageDocumentContent(fallbackTitle)
  }
  if (raw.version !== undefined && raw.version !== IMAGE_DOCUMENT_VERSION) {
    throw new Error(`图片文档版本不受支持: ${String(raw.version)}`)
  }
  const metadata = isPlainObject(raw.metadata) ? raw.metadata : {}
  return {
    schema: IMAGE_DOCUMENT_SCHEMA,
    version: IMAGE_DOCUMENT_VERSION,
    title: text(raw.title, MAX_TITLE).trim() || (fallbackTitle || '图片容器'),
    src: isImageAssetSrc(raw.src) ? raw.src : '',
    alt: text(raw.alt, MAX_ALT),
    fit: raw.fit === 'cover' ? 'cover' : 'contain',
    metadata: {
      createdAt: typeof metadata.createdAt === 'number' && Number.isFinite(metadata.createdAt)
        ? metadata.createdAt : Date.now(),
      updatedAt: typeof metadata.updatedAt === 'number' && Number.isFinite(metadata.updatedAt)
        ? metadata.updatedAt : Date.now(),
      editor: 'image',
    },
  }
}

export function serializeImageDocumentContent(value: ImageDocumentContent): string {
  return JSON.stringify(value, null, 2)
}

/** FNV-1a：全屏宿主用它做写盘去重，覆盖 src / alt / fit 等所有影响预览的字段。 */
export function imageContentVersion(value: ImageDocumentContent): number {
  const serialized = serializeImageDocumentContent(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}
