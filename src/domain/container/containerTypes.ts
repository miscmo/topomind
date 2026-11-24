/**
 * 容器类型注册表（领域层，纯数据，无 React / 无 IO）。
 *
 * 设计契约：外层关系树只认 kind='container' 与 container.type 这个字符串，
 * 具体能力全部由这里查表。新增一种容器 = 一个 spec + 一个渲染注册项，
 * 不改节点类型、图谱映射、LOD、选中、保存链路。
 */
import type { TopoDocumentType } from '../../core/topoDocumentTypes'

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
