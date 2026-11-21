/**
 * 容器渲染层注册表。
 *
 * 领域层按 container.type 决定「数据是什么」，渲染层按同一 key 决定「怎么画」。
 * Editor 必须是 lazy 组件：万级节点画布里绝不能为每个容器挂载编辑器实例。
 */
import type { ComponentType } from 'react'

export interface ContainerPreviewProps {
  nodeId: string
  documentId: string
  content: unknown
  title: string
  /** 只在 LOD 可见集合内才生成 SVG；不可见时显示静态占位，不排队、不导出。 */
  visible: boolean
}

export interface ContainerEditorProps {
  nodeId: string
  documentId: string
  cardPath: string
  content: unknown
  title: string
  active: boolean
  onChange: (next: unknown) => void
  onRequestDeactivate: () => void
}

export interface ContainerRendererRegistration {
  type: string
  Preview: ComponentType<ContainerPreviewProps>
  /** 必须是 React.lazy 产出的组件，保证主 chunk 不含编辑器实现。 */
  Editor: ComponentType<ContainerEditorProps>
  /** 进入编辑态所需的最小**显示百分比**（0-100，100 = 常规阅读比例 / 镜头上限）。
   * 注意 React Flow 的 `transform[2]` 是 raw zoom，100% 对应 0.65，绝不能拿它直接跟 1 比。 */
  minEditDisplayPercent: number
}

const CONTAINER_RENDERER_REGISTRY = new Map<string, ContainerRendererRegistration>()

export function registerContainerRenderer(registration: ContainerRendererRegistration): void {
  if (!registration?.type) throw new Error('容器渲染器注册失败：缺少 type')
  CONTAINER_RENDERER_REGISTRY.set(registration.type, registration)
}

export function getContainerRenderer(type: string): ContainerRendererRegistration | undefined {
  return CONTAINER_RENDERER_REGISTRY.get(type)
}

export function listContainerRenderers(): ContainerRendererRegistration[] {
  return [...CONTAINER_RENDERER_REGISTRY.values()]
}
