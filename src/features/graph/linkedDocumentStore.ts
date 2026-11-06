/**
 * 节点关联已有文档：跨组件（画布节点 / 右键菜单 / 右栏）的最小通信总线。
 *
 * 不塞进 props 链的原因：KnowledgeCard 与 DetailPanel 分属两条很深的组件树，
 * 且 GraphPage 的每个标签页都常驻挂载；用一个轻量 store 传「打开对话框」和
 * 「一键跳到关联视图」两个一次性请求，比逐层透传更不容易漏接线。
 */
import { create } from 'zustand'
import type { LinkedDocumentRef } from '../../domain/graph/linkedDocuments'
import { normalizeLinkedDocuments } from '../../domain/graph/linkedDocuments'

export interface LinkedDocumentDialogState {
  nodeId: string
  cardPath: string
  label: string
  /** 打开时的关联快照，用于多选框回显 */
  links: LinkedDocumentRef[]
}

interface LinkedDocumentStore {
  dialog: LinkedDocumentDialogState | null
  /** tabId 不能省：所有标签页常驻挂载，不带 tabId 会被非目标标签页误消费。 */
  navRequest: { nodeId: string; tabId: string; seq: number } | null
  openDialog: (state: LinkedDocumentDialogState) => void
  closeDialog: () => void
  requestLinkedView: (nodeId: string, tabId: string) => void
  consumeLinkedView: (nodeId: string, tabId: string) => boolean
}

export const useLinkedDocumentStore = create<LinkedDocumentStore>((set, get) => ({
  dialog: null,
  navRequest: null,
  openDialog: (state) => set({ dialog: state }),
  closeDialog: () => set({ dialog: null }),
  requestLinkedView: (nodeId, tabId) => set((state) => ({
    navRequest: { nodeId, tabId, seq: (state.navRequest?.seq ?? 0) + 1 },
  })),
  consumeLinkedView: (nodeId, tabId) => {
    const pending = get().navRequest
    if (!pending || pending.nodeId !== nodeId || pending.tabId !== tabId) return false
    set({ navRequest: null })
    return true
  },
}))

/**
 * 各标签页常驻挂载但各有自己的 graph store。对话框挂在 App 根（唯一实例），
 * 保存后通过注册表把结果广播给所有标签页，避免出现 N 个重叠模态。
 *
 * 这里只声明「用得到的那部分形状」，不 import 完整 GraphState：
 * 该 store 由 React Provider 按标签页创建，本模块在 Provider 之外，不能依赖其具体类型。
 * getState 的返回值标 unknown，再在调用点窄化，避免用 any 绕过类型系统。
 */
interface GraphNodeLike {
  data: Record<string, unknown>
}
interface GraphStateLike {
  nodesMap: Map<string, GraphNodeLike>
  updateNode: (nodeId: string, updater: (node: GraphNodeLike) => GraphNodeLike) => void
}
interface TemporalLike {
  pause?: () => void
  resume?: () => void
}
export interface GraphApiLike {
  getState: () => unknown
  temporal?: { getState: () => unknown }
}

/** 把权威写盘结果同步到画布内存，让链环标记立即生效。 */
const graphApis = new Set<GraphApiLike>()

export function registerGraphApi(api: GraphApiLike) {
  graphApis.add(api)
  return () => { graphApis.delete(api) }
}

export function syncLinkedDocumentsToGraph(nodeId: string, links: LinkedDocumentRef[] | undefined) {
  graphApis.forEach((api) => applyLinkedDocumentsToNode(api, nodeId, links))
}

/**
 * 暂停 zundo 历史：关联关系不是「可撤销的画布布局操作」。
 * 后续 buildMetaFromNodesEdges 会把同一份数据写回 _graph.json，两次写入内容一致。
 */
export function applyLinkedDocumentsToNode(
  api: GraphApiLike,
  nodeId: string,
  links: LinkedDocumentRef[] | undefined,
) {
  const state = api.getState() as GraphStateLike | undefined
  if (!state?.nodesMap?.has(nodeId)) return
  const temporal = api.temporal?.getState?.() as TemporalLike | undefined
  temporal?.pause?.()
  state.updateNode(nodeId, (node: GraphNodeLike) => ({
    ...node,
    data: { ...node.data, linkedDocuments: normalizeLinkedDocuments(links) },
  }))
  temporal?.resume?.()
}
