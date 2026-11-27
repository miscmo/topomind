/**
 * P2：工具执行期的渲染层绑定（唯一允许碰 React / Provider / 全局 store 的地方）。
 *
 * 把既有只读能力注入 headless 的 ToolRuntime：
 *  - 图数据 → useWorkspaceApi().snapshot()（全量 store，不读 lod.visibleNodes）；
 *  - 文档 / 房间 / 双链 → useStorage() 的既有方法，不新开 IPC、不直接读盘；
 *  - 工作区上下文 → tabStore / graphStore / detailPanelStore 的 getState()。
 *
 * 工具 handler 本身不 import 本文件，保证门禁可以脱离 React 环境打包真跑。
 */

import { useMemo } from 'react'
import { useGraphStoreApi } from '@/stores/graphStore'
import { tabStore } from '@/stores/tabs/tabStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useDetailPanelStore } from '@/features/right-panel/model/detailPanelStore'
import { topoDocumentIdFromPath } from '@/features/documents/types/documentTypes'
import { useStorage, type GraphMeta } from '@/core/storage'
import { queryAiIndex } from '@/core/ai-backend'
import { buildMetaFromNodesEdges } from '@/hooks/useGraph/graphBuilder'
import type { KnowledgeEdge, KnowledgeNode } from '@/types/graph'
import { useWorkspaceApi } from '@/application/workspace/useWorkspaceApi'
import type {
  GraphEdgeLike,
  GraphNodeLike,
  WorkspaceApi,
  WorkspaceStorageLike,
} from '@/application/workspace/workspaceApi'
import type { ToolReadPort, ToolRuntime, ToolWorkspaceContext } from '../tools/toolTypes'
import { createDelegatePort } from './agentDelegation'
import { buildSelectionSnapshot } from './aiSelectionSnapshot'
import { ensureStableBlockIds, type BlockNoteBlock } from '@/features/documents/SmartDocumentEditor/smartDocumentTypes'

const MAX_DOCUMENT_TEXT = 8000
const MAX_BLOCKS = 200

/** 白名单提取文档摘要：绝不把原始载体（可能含 base64 媒体）整包发给模型。 */
function summarizeDocument(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    return { content: raw.slice(0, MAX_DOCUMENT_TEXT), truncated: raw.length > MAX_DOCUMENT_TEXT, blockCount: 0, blocks: [] }
  }
  if (!raw || typeof raw !== 'object') return { content: '', blockCount: 0, blocks: [] }
  const source = raw as Record<string, unknown>
  const blocksRaw = Array.isArray(source.blocks) ? source.blocks : []
  // 摘要里的 id 必须与 AI 写入时的 base.blocks、编辑器内存里的 id 完全一致；
  // 旧档缺 id 时用同一套确定性补齐，保证模型拿到的 blockId 真的能定位到目标。
  const blocksWithIds = ensureStableBlockIds(blocksRaw as BlockNoteBlock[])
  const blocks = blocksWithIds.slice(0, MAX_BLOCKS).map((block) => {
    if (!block || typeof block !== 'object') return { type: 'unknown', text: '' }
    const item = block as Record<string, unknown>
    const text = typeof item.text === 'string'
      ? item.text
      : Array.isArray(item.content)
        ? item.content.map((part) => (part && typeof part === 'object' ? String((part as Record<string, unknown>).text ?? '') : '')).join('')
        : ''
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      type: typeof item.type === 'string' ? item.type : 'unknown',
      text: text.slice(0, 1000),
    }
  })
  const content = blocks.map((block) => block.text).filter(Boolean).join('\n').slice(0, MAX_DOCUMENT_TEXT)
  return {
    title: typeof source.title === 'string' ? source.title.slice(0, 200) : undefined,
    content,
    blockCount: blocksRaw.length,
    truncated: blocksRaw.length > MAX_BLOCKS,
    blocks,
  }
}

function toRecordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .slice(0, 100)
}

export interface AgentToolBinding {
  runtime: ToolRuntime
  /** 与 runtime.snapshot() 同源，供 commitAgentPatch 复用（digest 口径必须一致）。 */
  workspaceApi: WorkspaceApi
}

export function useAgentToolRuntime(): AgentToolBinding {
  const store = useStorage()
  const storeApi = useGraphStoreApi()
  const activeTabId = tabStore((state) => state.activeTabId)

  /**
   * P2 遗留补齐：把真实落盘依赖注入 headless WorkspaceApi。
   * 之前这里只传 tabId，api.flush() 因缺 storage / dirPath / buildMeta 直接 return，
   * 于是 edge.create / canvas.layout 提交后只改内存、_graph.json 不变（真机冒烟实测）。
   * dirPath 由 useWorkspaceApi 用当前会话 roomPath 自动补齐，房间切换会同步更新。
   */
  const saveDeps = useMemo(() => {
    const storage: WorkspaceStorageLike = {
      saveGraphDebounced: (target, build, onSaved) =>
        store.saveGraphDebounced(target, () => build() as GraphMeta, onSaved),
      flushGraphSave: (target, build, onSaved) =>
        store.flushGraphSave(target, () => build() as GraphMeta, onSaved),
    }
    const buildMeta = (nodes: GraphNodeLike[], edges: GraphEdgeLike[]) => {
      const viewport = storeApi.getState().viewport
      return buildMetaFromNodesEdges(
        nodes as unknown as KnowledgeNode[],
        edges as unknown as KnowledgeEdge[],
        { zoom: viewport?.zoom ?? 1, pan: { x: viewport?.x ?? 0, y: viewport?.y ?? 0 } },
      )
    }
    return { storage, buildMeta }
  }, [store, storeApi])

  const api = useWorkspaceApi({ tabId: activeTabId, ...saveDeps })

  return useMemo(() => {
    const read: ToolReadPort = {
      searchDocuments: async (query) => toRecordList(await store.searchUnifiedDocuments(query, { limit: 60 })),
      listRooms: async () => toRecordList(await store.listRoomNodeTargets()),
      readDocument: async (docId) => {
        const resolution = await store.resolveDocumentById(docId) as unknown as Record<string, unknown>
        const cardPath = typeof resolution?.cardPath === 'string' ? String(resolution.cardPath) : ''
        if (!cardPath) return { docId, empty: true, reason: '文档未解析到所在卡片', ...summarizeDocument(null) }
        return { docId, ...summarizeDocument(await store.readTopoDocument(cardPath, docId)) }
      },
      listDocumentRelations: async (docId) => {
        const value = await store.listDocumentRelations(docId) as unknown
        return value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown>
          : {}
      },
      listDocumentBacklinks: async (docId) => toRecordList(await store.listDocumentBacklinks(docId)),
    }

    const getContext = (): ToolWorkspaceContext => {
      const graph = storeApi.getState() as unknown as {
        selectedNodeIds?: string[]
        viewport?: { x: number; y: number; zoom: number }
      }
      const selectedNodeIds = Array.isArray(graph.selectedNodeIds) ? graph.selectedNodeIds : []
      const paths = useDetailPanelStore.getState().activeDocumentPathsByNodeId
      const firstPath = selectedNodeIds.length > 0 ? paths?.[selectedNodeIds[0]] : undefined
      const session = tabStore.getState().getGraphSession(activeTabId)
      const nodesMap = (storeApi.getState() as unknown as {
        nodesMap?: Map<string, { data?: { label?: unknown } }>
      }).nodesMap
      const nodeLabels = selectedNodeIds.map((id) => {
        const label = nodesMap?.get(id)?.data?.label
        return typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : id
      })
      // 选中快照在此冻结一次：文档 / 块 / 引用来自 aiSelectionStore，
      // 节点 id + 标题来自当前 tab 的 graphStore，AI 不用靠标题猜目标。
      const selection = buildSelectionSnapshot({ nodeIds: selectedNodeIds, nodeLabels })
      return {
        activeTabId,
        roomPath: session?.roomPath ?? api.snapshot().roomPath,
        workDir: useWorkspaceStore.getState().currentWorkDir ?? '',
        selectedNodeIds,
        // 优先用编辑器实际上报的当前文档；旧「按第一个选中节点推路径」只作兜底。
        activeDocumentId: selection.documentId || topoDocumentIdFromPath(firstPath ?? null) || null,
        selection,
        viewport: graph.viewport,
      }
    }

    const runtime: ToolRuntime = {
      snapshot: () => api.snapshot(),
      getContext,
      read,
      describeDocuments: (docIds) => api.describeDocuments(docIds),
      // P3：本地索引端口只走主进程 ai:index:query，不在渲染层读盘、不联网。
      index: { query: (request) => queryAiIndex(request) },
    }
    // S3：只有主会话的 runtime 注入 delegate 端口；子调用会在 agentDelegation 里
    // 复制一份去掉该端口的 runtime，递归委托没有代码路径。
    runtime.delegate = createDelegatePort(runtime)
    return { runtime, workspaceApi: api }
  }, [api, store, storeApi, activeTabId])
}
