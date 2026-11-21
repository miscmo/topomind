/**
 * 容器渲染层注册表。
 *
 * 领域层按 container.type 决定「数据是什么」，渲染层按同一 key 决定「怎么画」。
 * Preview 挂在节点内（只读 SVG），Editor 由全屏宿主按会话 lazy 挂载，
 * 全局同时最多一个实例：万级节点画布里绝不能为每个容器挂载编辑器。
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
  /** 全屏会话期间恒为 true；保留字段供渲染器做 viewMode / 事件闸门双保险。 */
  active: boolean
  onChange: (next: unknown) => void
}

export interface ContainerRendererRegistration {
  type: string
  Preview: ComponentType<ContainerPreviewProps>
  /** 必须是 React.lazy 产出的组件，保证主 chunk 不含编辑器实现。 */
  Editor: ComponentType<ContainerEditorProps>
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
