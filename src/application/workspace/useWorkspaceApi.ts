/**
 * Workspace API 的渲染层绑定（P1 / B）。
 *
 * 这一层是唯一允许碰 React / Provider / 全局 store 的地方：把真实 storeApi、
 * graphStore 的 capture/commit 快照、guardCanvasEdit 语义、日志通道注入给
 * headless 的 createWorkspaceApi。Patch 的纯函数与门禁脚本不依赖本文件。
 *
 * P2 已补齐：调用方注入 storage / buildMeta 后，dirPath 缺省直接取当前会话的
 * roomPath，commitAgentPatch 的 api.flush() 会走完整落盘链路。roomPath 用订阅式
 * selector 读取，房间切换后快照与写盘目标会一起更新，不会滞留在旧房间。
 */

import { useMemo } from 'react'
import { useGraphStoreApi, captureGraphHistorySnapshot, commitGraphHistorySnapshot } from '../../stores/graphStore'
import type { GraphHistorySnapshot } from '../../stores/graphStore'
import { useGraphSession } from '../../stores/tabs/tabStore'
import { isCanvasReadOnly } from '../../stores/canvasReadOnlyStore'
import { recordUser } from '../../core/observe'
import { useStorage } from '../../core/storage'
import { isDocumentDirty, publishDocumentExternalWrite } from '../../features/documents/services/documentExternalWriteBus'
import { useActiveContainerStore } from '../../features/graph/GraphCanvas/containers/activeContainerStore'
import type { KnowledgeEdge, KnowledgeNode } from '../../types/graph'
import type { SnapshotDocument } from '../../features/ai-agent/patch/agentPatchTypes'
import {
  createWorkspaceApi,
  type GraphEdgeLike,
  type GraphNodeLike,
  type WorkspaceApi,
  type WorkspaceDocumentStorageLike,
  type WorkspaceGraphStoreLike,
  type WorkspaceHistory,
  type WorkspaceStorageLike,
} from './workspaceApi'

/** 文档写入端口 + 外部写入桥：把既有 storage 方法与 UI 同步总线绑在一起。 */
function bindDocumentPort(storage: ReturnType<typeof useStorage>): {
  documentStorage: WorkspaceDocumentStorageLike
  documentBridge: { isDirty: (id: string) => boolean; onWritten: (id: string, path: string, content: unknown) => void }
} {
  const documentStorage: WorkspaceDocumentStorageLike = {
    resolveDocumentById: (docId) => storage.resolveDocumentById(docId) as never,
    readTopoDocument: (cardPath, documentId) => storage.readTopoDocument(cardPath, documentId),
    writeTopoDocument: (cardPath, documentId, content) => storage.writeTopoDocument(cardPath, documentId, content),
    createTopoDocument: (cardPath, input) =>
      storage.createTopoDocument(cardPath, { type: input.type as 'cardspec', title: input.title }),
    renameTopoDocument: (cardPath, documentId, title) => storage.renameTopoDocument(cardPath, documentId, title),
  }
  return {
    documentStorage,
    documentBridge: {
      isDirty: (documentId) => isDocumentDirty(documentId),
      onWritten: (documentId, cardPath, content) => {
        // 1) 右栏会话认领新基线、编辑器按 revision 重挂载；
        // 2) 画布上的 CardSpec / Excalidraw 只读预览重读磁盘。
        publishDocumentExternalWrite({ documentId, cardPath, content })
        useActiveContainerStore.getState().bumpRevision()
      },
    },
  }
}

export interface UseWorkspaceApiOptions {
  tabId: string
  roomRev?: number
  documents?: SnapshotDocument[]
  storage?: WorkspaceStorageLike
  dirPath?: string
  buildMeta?: (nodes: GraphNodeLike[], edges: GraphEdgeLike[]) => unknown
}

export function useWorkspaceApi(options: UseWorkspaceApiOptions): WorkspaceApi {
  const storeApi = useGraphStoreApi()
  const storage = useStorage()
  const { tabId, roomRev, documents, storage: graphStorage, dirPath, buildMeta } = options
  // 订阅式读取：房间切换时 roomPath 变化会触发 api 重建，snapshot / flush 目标同步更新。
  const session = useGraphSession(tabId)
  const roomPath = session?.roomPath ?? ''

  return useMemo(() => {
    const adapter: WorkspaceGraphStoreLike = {
      getState: () => {
        const state = storeApi.getState()
        return {
          nodes: state.nodes as unknown as GraphNodeLike[],
          edges: state.edges as unknown as GraphEdgeLike[],
          historyRevision: state.historyRevision,
        }
      },
      setNodes: (nodes) => storeApi.getState().setNodes(nodes as unknown as KnowledgeNode[]),
      setEdges: (edges) => storeApi.getState().setEdges(edges as unknown as KnowledgeEdge[]),
      temporal: storeApi.temporal as unknown as WorkspaceGraphStoreLike['temporal'],
    }

    // 用容器对象而非闭包变量：useMemo 内创建的 history 会跨渲染存活，
    // 避免 react-hooks/immutability 对「渲染后重赋值」的告警。
    const historyState: { current: GraphHistorySnapshot | null } = { current: null }
    const history: WorkspaceHistory = {
      begin() {
        historyState.current = captureGraphHistorySnapshot(storeApi.getState())
        storeApi.temporal.getState().pause()
      },
      end() {
        storeApi.temporal.getState().resume()
        if (historyState.current) commitGraphHistorySnapshot(storeApi, historyState.current)
        historyState.current = null
      },
      abort() {
        storeApi.temporal.getState().resume()
        historyState.current = null
      },
    }

    const documentPort = bindDocumentPort(storage)
    return createWorkspaceApi({
      storeApi: adapter,
      roomPath,
      roomRev: roomRev ?? 0,
      documents,
      history,
      storage: graphStorage,
      documentStorage: documentPort.documentStorage,
      documentBridge: documentPort.documentBridge,
      // roomPath 就是既有 saveGraphDebounced / writeLayout 使用的房间相对路径；
      // 调用方只需注入 storage + buildMeta，不必再重复传同一个路径。
      dirPath: dirPath || roomPath,
      buildMeta,
      guard: () => !isCanvasReadOnly('agent.patch'),
      logger: (actionId, detail) => {
        void recordUser(actionId, {
          params: detail,
          result: 'success',
          target: { type: 'app' },
        })
      },
    })
  }, [storeApi, tabId, roomPath, roomRev, documents, storage, graphStorage, dirPath, buildMeta])
}
