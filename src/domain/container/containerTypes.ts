/**
 * 容器类型注册表（领域层，纯数据，无 React / 无 IO）。
 *
 * 设计契约：外层关系树只认 kind='container' 与 container.type 这个字符串，
 * 具体能力全部由这里查表。新增一种容器 = 一个 spec + 一个渲染注册项，
 * 不改节点类型、图谱映射、LOD、选中、保存链路。
 */
import type { TopoDocumentType } from '../../core/topoDocumentTypes'

export interface ContainerNodeSizeLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

/** 运行时才能拿到的内容信息（例如图片解码后的原始像素），不进载荷。 */
export interface ContainerSizeContext {
  intrinsicWidth?: number
  intrinsicHeight?: number
}

/** 容器载荷建议的节点尺寸；ratio 用于拖动时锁定宽高比。 */
export interface PreferredNodeSize {
  width: number
  height: number
  /** 适配判定键：换图后 key 变化会重新适配；用户手动 resize 后 key 不变则不拉回。 */
  key: string
}

export interface ContainerTypeSpec<T = unknown> {
  /** 与 ContainerRef.type 对应，注册表主键 */
  id: string
  /** 载荷文档的落盘类型（决定扩展名 / schema 校验） */
  documentType: TopoDocumentType
  schema: string
  version: number
  createEmpty(title: string): T
  /** 纯函数：缺省 / 脏值 → 合法内容；未知 version 抛错，由适配层显示「版本不受支持」 */
  normalize(raw: unknown, title: string): T
  serialize(value: T): string
  /**
   * 内容版本 / 变化判定键：既用于预览缓存失效，也被全屏宿主用作写盘去重。
   * 必须覆盖所有「落盘后会改变预览」的字段（例如画布背景色），但不能包含
   * 视口瞬态（滚动 / 缩放 / 选中），否则每次镜头操作都会写盘并重导出预览。
   * 未实现时调用方按内容字符串兜底。
   */
  getSceneVersion?(value: T): number
  /**
   * 可选：载荷建议的节点尺寸（纯函数）。目前只有图片容器用——按图片原始宽高比
   * 等比缩放，让节点矩形与图片严丝合缝、四周零空隙。返回的 width/height 供节点
   * 自适应一次，ratio 供 NodeResizer 锁定宽高比；其他容器返回 null 保持既有行为。
   */
  getPreferredNodeSize?(value: T, limits: ContainerNodeSizeLimits, context?: ContainerSizeContext): PreferredNodeSize | null
}

const CONTAINER_TYPE_REGISTRY = new Map<string, ContainerTypeSpec>()

export function registerContainerType(spec: ContainerTypeSpec): void {
  if (!spec || typeof spec.id !== 'string' || !spec.id.trim()) {
    throw new Error('容器类型注册失败：缺少 id')
  }
  if (typeof spec.createEmpty !== 'function' || typeof spec.normalize !== 'function' || typeof spec.serialize !== 'function') {
    throw new Error(`容器类型注册失败：${spec.id} 缺少 createEmpty/normalize/serialize`)
  }
  CONTAINER_TYPE_REGISTRY.set(spec.id, spec)
}

export function getContainerType(id: string): ContainerTypeSpec | undefined {
  return CONTAINER_TYPE_REGISTRY.get(id)
}

export function listContainerTypes(): ContainerTypeSpec[] {
  return [...CONTAINER_TYPE_REGISTRY.values()]
}

/** 仅用于断言与调试：注册表内容不应意外重复注册。 */
export function hasContainerType(id: string): boolean {
  return CONTAINER_TYPE_REGISTRY.has(id)
}
