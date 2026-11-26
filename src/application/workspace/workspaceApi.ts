/**
 * headless Workspace API（P1 / B）。
 *
 * 目的：把图写入能力从 React hook 装配里抽成「可注入 storeApi + storage + history」的模块级服务，
 * 使 AgentPatch 的 dryRun / commit 能在无 React、无 DOM、无 Provider 的环境下真跑与验证。
 *
 * 刻意不 import React / window / electronAPI / 任何全局单例：调用方（useWorkspaceApi.ts）负责
 * 把真实 storeApi、storage、guardCanvasEdit、history 快照函数注入进来。
 * 图写入只用 setNodes / setEdges 两个既有原语，且**在原始节点对象上 spread**，
 * 保证 container / linkedDocuments / treeOrder / nodeStyle 等 7 处白名单字段不丢。
 */

import type {
  AgentDocumentState,
  AgentDocumentWrite,
  AgentDocumentWriteOutcome,
  SnapshotDocument,
  SnapshotEdge,
  SnapshotNode,
  WorkspaceSnapshot,
} from '../../features/ai-agent/patch/agentPatchTypes'
import type { GraphDeltaState } from '../../features/ai-agent/patch/dryRunAgentPatch'
import { computeSnapshotDigest } from '../../features/ai-agent/patch/dryRunAgentPatch'
import { readDocumentBlockIds, stableContentDigest } from '../../features/ai-agent/patch/documentWrite'

export interface GraphNodeLike {
  id: string
  type?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  width?: number
  height?: number
}

export interface GraphEdgeLike {
  id: string
  source: string
  target: string
  type?: string
  data?: Record<string, unknown>
}

export interface WorkspaceGraphStoreLike {
  getState(): {
    nodes: readonly GraphNodeLike[]
    edges: readonly GraphEdgeLike[]
    historyRevision?: number
  }
  setNodes: (nodes: GraphNodeLike[]) => void
  setEdges: (edges: GraphEdgeLike[]) => void
  temporal?: {
    getState(): { pause(): void; resume(): void; pastStates: unknown[]; futureStates: unknown[] }
    setState(updater: (state: { pastStates: unknown[]; futureStates: unknown[] }) => {
      pastStates: unknown[]; futureStates: unknown[]
    }): void
  }
}

export interface WorkspaceHistory {
  /** capture 基线 + temporal.pause() */
  begin(): void
  /** temporal.resume() + 推入恰好一份 pastState（一次任务 = 一步 undo） */
  end(): void
  /** 异常时只 resume，不写历史 */
  abort(): void
}

export interface WorkspaceStorageLike {
  saveGraphDebounced?: (dirPath: string, buildMeta: () => unknown, onSaved?: () => void) => Promise<void>
  flushGraphSave?: (dirPath: string, buildMeta: () => unknown, onFlush?: () => void) => Promise<void>
}

/**
 * 文档写入端口：全部是既有 storage 方法，不新开 IPC。
 * createTopoDocument 只用于 cardspec.create（新建载荷 + 新建容器节点）。
 */
export interface WorkspaceDocumentStorageLike {
  resolveDocumentById(docId: string): Promise<{
    status?: string
    cardPath?: string
    title?: string
    type?: string
  } | null>
  readTopoDocument(cardPath: string, documentId: string): Promise<unknown>
  writeTopoDocument(cardPath: string, documentId: string, content: unknown): Promise<void>
  createTopoDocument(cardPath: string, input: { type: string; title: string }): Promise<{ id: string }>
  renameTopoDocument?(cardPath: string, documentId: string, title: string): Promise<unknown>
}

/** 与右栏文档会话 / 画布预览之间的桥：dirty 门槛 + 写盘成功后广播。 */
export interface WorkspaceDocumentBridge {
  isDirty(documentId: string): boolean
  onWritten(documentId: string, cardPath: string, content: unknown): void
}

export interface WorkspaceApiDeps {
  storeApi: WorkspaceGraphStoreLike
  roomPath: string
  roomRev?: number
  documents?: SnapshotDocument[]
  /** 注入真实的 captureGraphHistorySnapshot / commitGraphHistorySnapshot；缺省用内建同口径实现。 */
  history?: WorkspaceHistory
  storage?: WorkspaceStorageLike
  documentStorage?: WorkspaceDocumentStorageLike
  documentBridge?: WorkspaceDocumentBridge
  dirPath?: string
  buildMeta?: (nodes: GraphNodeLike[], edges: GraphEdgeLike[]) => unknown
  /** guardCanvasEdit 语义：false 表示只读，不允许任何 commit。 */
  guard?: () => boolean
  logger?: (actionId: string, detail: Record<string, unknown>) => void
}

export interface WorkspaceApi {
  snapshot(): WorkspaceSnapshot
  digest(): string
  isEditable(): boolean
  beginTransaction(): void
  endTransaction(): void
  abortTransaction(): void
  /** 唯一图写入口：把 dryRun 产出的纯数据 delta 映射回真实节点 / 边。 */
  applyGraphDelta(delta: GraphDeltaState): void
  flush(): Promise<void>
  /** 预览阶段异步抓取目标文档的磁盘态 + 脏草稿态。 */
  describeDocuments(docIds: readonly string[]): Promise<Record<string, AgentDocumentState>>
  /** 提交阶段：先全量预校验，再逐条写盘；任一预校验失败则零写入。 */
  applyDocumentWrites(writes: readonly AgentDocumentWrite[]): Promise<AgentDocumentWriteOutcome[]>
  log(actionId: string, detail: Record<string, unknown>): void
}

function readNodeData(node: GraphNodeLike): Record<string, unknown> {
  return (node.data ?? {}) as Record<string, unknown>
}

function readEdgeData(edge: GraphEdgeLike): Record<string, unknown> {
  return (edge.data ?? {}) as Record<string, unknown>
}

/** 真实 React Flow 节点 → dryRun 用的冻结快照（纯函数，不读 lod.visibleNodes）。 */
export function toWorkspaceSnapshot(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[],
  options: { roomPath: string; roomRev?: number; documents?: SnapshotDocument[] },
): WorkspaceSnapshot {
  const snapshotNodes: SnapshotNode[] = nodes.map((node) => {
    const data = readNodeData(node)
    const container = data.container as { type?: string } | undefined
    const linked = data.linkedDocuments as Array<{ docId?: string }> | undefined
    const result: SnapshotNode = {
      id: node.id,
      label: typeof data.label === 'string' ? data.label : '',
      roomPath: options.roomPath,
      position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
      style: (data.nodeStyle as Record<string, unknown> | undefined) ?? {},
    }
    if (typeof data.parent === 'string') result.parentId = data.parent
    if (typeof data.treeOrder === 'number') result.treeOrder = data.treeOrder
    if (container?.type) result.containerType = container.type
    if (Array.isArray(linked)) result.linkedDocumentIds = linked.map((item) => item.docId ?? '')
    return result
  })
  const snapshotEdges: SnapshotEdge[] = edges.map((edge) => {
    const data = readEdgeData(edge)
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      roomPath: options.roomPath,
      relation: data.relation === 'subordinate' ? 'subordinate' : 'related',
      weight: data.weight === 'minor' ? 'minor' : 'main',
    }
  })
  return {
    roomPath: options.roomPath,
    roomRev: options.roomRev ?? 0,
    nodes: snapshotNodes,
    edges: snapshotEdges,
    documents: options.documents ?? [],
  }
}

/** 合并单个 delta 节点到原始节点：只改变化字段，其余（含 7 处白名单）原样保留。 */
function mergeNode(original: GraphNodeLike, target: SnapshotNode): GraphNodeLike {
  const data = { ...readNodeData(original) }
  if (data.label !== target.label) data.label = target.label
  if (target.style && JSON.stringify(data.nodeStyle ?? {}) !== JSON.stringify(target.style)) {
    data.nodeStyle = { ...target.style }
  }
  if (target.treeOrder !== undefined && data.treeOrder !== target.treeOrder) data.treeOrder = target.treeOrder
  if (target.parentId !== undefined && data.parent !== target.parentId) data.parent = target.parentId
  const position = original.position && original.position.x === target.position.x && original.position.y === target.position.y
    ? original.position
    : { ...target.position }
  return { ...original, position, data }
}

function createNode(target: SnapshotNode): GraphNodeLike {
  const data: Record<string, unknown> = { label: target.label }
  if (target.parentId) data.parent = target.parentId
  if (target.treeOrder !== undefined) data.treeOrder = target.treeOrder
  if (target.style && Object.keys(target.style).length > 0) data.nodeStyle = { ...target.style }
  // cardspec.create 新建的容器节点：必须与产品 createContainerChild 的载荷形状一致，
  // 否则画布只看到一个没有 documentId 指针的空壳容器。
  if (target.containerType) {
    data.kind = 'container'
    data.container = {
      type: target.containerType,
      documentId: target.linkedDocumentIds?.[0] ?? '',
    }
    data.collapsedWidth = 360
    data.collapsedHeight = 240
  }
  return {
    id: target.id,
    type: target.containerType ? 'containerCard' : 'knowledgeCard',
    position: { ...target.position },
    ...(target.containerType ? { width: 360, height: 240 } : {}),
    data,
  }
}

function createEdge(target: SnapshotEdge, template: GraphEdgeLike | undefined): GraphEdgeLike {
  return {
    id: target.id,
    source: target.source,
    target: target.target,
    type: template?.type,
    data: {
      ...(template ? readEdgeData(template) : {}),
      relation: target.relation,
      weight: target.weight,
    },
  }
}

/** 与 graphStore 的 capture/commit 同口径；渲染层可注入更精确的业务字段比较版本。 */
function createBuiltinHistory(storeApi: WorkspaceGraphStoreLike): WorkspaceHistory {
  let baseline: { nodes: readonly GraphNodeLike[]; edges: readonly GraphEdgeLike[] } | null = null
  return {
    begin() {
      const state = storeApi.getState()
      baseline = { nodes: state.nodes, edges: state.edges }
      storeApi.temporal?.getState().pause()
    },
    end() {
      const temporal = storeApi.temporal
      temporal?.getState().resume()
      const state = storeApi.getState()
      if (temporal && baseline && (state.nodes !== baseline.nodes || state.edges !== baseline.edges)) {
        const pastState = baseline
        temporal.setState((temporalState) => ({
          pastStates: [...temporalState.pastStates.slice(-19), pastState],
          futureStates: [],
        }))
      }
      baseline = null
    },
    abort() {
      storeApi.temporal?.getState().resume()
      baseline = null
    },
  }
}

export function createWorkspaceApi(deps: WorkspaceApiDeps): WorkspaceApi {
  const history = deps.history ?? createBuiltinHistory(deps.storeApi)

  const snapshot = (): WorkspaceSnapshot => {
    const state = deps.storeApi.getState()
    return toWorkspaceSnapshot(state.nodes, state.edges, {
      roomPath: deps.roomPath,
      roomRev: deps.roomRev,
      documents: deps.documents,
    })
  }

  return {
    snapshot,
    digest: () => computeSnapshotDigest(snapshot()),
    isEditable: () => deps.guard?.() ?? true,
    beginTransaction: () => history.begin(),
    endTransaction: () => history.end(),
    abortTransaction: () => history.abort(),
    applyGraphDelta: (delta) => {
      const state = deps.storeApi.getState()
      const originalNodes = new Map(state.nodes.map((node) => [node.id, node]))
      const originalEdges = new Map(state.edges.map((edge) => [edge.id, edge]))
      const nextNodes: GraphNodeLike[] = delta.nodes.map((target) => {
        const original = originalNodes.get(target.id)
        return original ? mergeNode(original, target) : createNode(target)
      })
      const nextEdges: GraphEdgeLike[] = delta.edges.map((target) => {
        const original = originalEdges.get(target.id)
        if (original) return original
        return createEdge(target, state.edges[0])
      })
      const nodesChanged = nextNodes.length !== state.nodes.length
        || nextNodes.some((node, index) => node !== state.nodes[index])
      const edgesChanged = nextEdges.length !== state.edges.length
        || nextEdges.some((edge, index) => edge !== state.edges[index])
      if (nodesChanged) deps.storeApi.setNodes(nextNodes)
      if (edgesChanged) deps.storeApi.setEdges(nextEdges)
    },
    flush: async () => {
      const storage = deps.storage
      if (!storage || !deps.dirPath || !deps.buildMeta) return
      const state = deps.storeApi.getState()
      // meta 在 applyGraphDelta 之后同步构建，写盘时直接用这份快照，
      // 不依赖 debounce 触发时 store 是否已被后续操作改动。
      const meta = deps.buildMeta([...state.nodes], [...state.edges])
      const buildMeta = () => meta
      // commit 是「用户已确认」的显式写入点：优先走立即 flush（无 300ms debounce），
      // 让「回写提示」出现时数据已确确实实落盘；老调用方只注入 debounced 时仍能工作。
      if (storage.flushGraphSave) {
        await storage.flushGraphSave(deps.dirPath, buildMeta, undefined)
        return
      }
      await storage.saveGraphDebounced?.(deps.dirPath, buildMeta, undefined)
    },
    describeDocuments: async (docIds) => {
      const storage = deps.documentStorage
      if (!storage) return {}
      const result: Record<string, AgentDocumentState> = {}
      for (const documentId of Array.from(new Set(docIds))) {
        if (!documentId) continue
        try {
          const resolution = await storage.resolveDocumentById(documentId)
          const cardPath = typeof resolution?.cardPath === 'string' ? resolution.cardPath : ''
          if (!cardPath || resolution?.status === 'missing') continue
          const content = await storage.readTopoDocument(cardPath, documentId)
          const raw = (content && typeof content === 'object' ? content : {}) as Record<string, unknown>
          const blockCount = Array.isArray(raw.blocks)
            ? raw.blocks.length
            : Array.isArray(raw.components) ? raw.components.length : 0
          result[documentId] = {
            documentId,
            cardPath,
            type: String(resolution?.type ?? ''),
            title: String(resolution?.title ?? documentId),
            digest: stableContentDigest(content),
            blockIds: readDocumentBlockIds(content),
            blockCount,
            dirty: deps.documentBridge?.isDirty(documentId) ?? false,
            content,
          }
        } catch {
          // 解析 / 读盘失败一律视为「目标不可用」，dryRun 会降级为 blocked 提示项。
        }
      }
      return result
    },
    applyDocumentWrites: async (writes) => {
      const storage = deps.documentStorage
      const unavailable = (write: AgentDocumentWrite, message: string): AgentDocumentWriteOutcome => ({
        opId: write.opId,
        documentId: write.documentId,
        cardPath: write.cardPath,
        ok: false,
        code: 'document_write_failed',
        message,
      })
      if (!storage) return writes.map((write) => unavailable(write, '文档写入端口未注入'))

      // 阶段 1：全量预校验。任何一条不通过就整体零写入，避免「前半写成功、后半被拒绝」。
      const preflight: AgentDocumentWriteOutcome[] = []
      for (const write of writes) {
        if (write.kind !== 'cardspec-create') {
          try {
            const current = await storage.readTopoDocument(write.cardPath, write.documentId)
            if (stableContentDigest(current) !== write.baseDigest) {
              preflight.push({
                opId: write.opId, documentId: write.documentId, cardPath: write.cardPath,
                ok: false, code: 'document_revision_mismatch',
                message: '预览后文档内容已变化，请重新生成预览',
              })
              continue
            }
          } catch (error) {
            preflight.push({
              opId: write.opId, documentId: write.documentId, cardPath: write.cardPath,
              ok: false, code: 'target_not_found',
              message: error instanceof Error ? error.message : String(error),
            })
            continue
          }
          if (deps.documentBridge?.isDirty(write.documentId)) {
            preflight.push({
              opId: write.opId, documentId: write.documentId, cardPath: write.cardPath,
              ok: false, code: 'document_dirty',
              message: '文档存在未保存草稿，请先保存后再让 AI 写入',
            })
            continue
          }
        }
        preflight.push({ opId: write.opId, documentId: write.documentId, cardPath: write.cardPath, ok: true })
      }
      if (preflight.some((item) => !item.ok)) return preflight

      // 阶段 2：真正写盘，成功后广播外部写入让右栏会话 / 画布预览同步。
      const outcomes: AgentDocumentWriteOutcome[] = []
      for (const write of writes) {
        try {
          if (write.kind === 'cardspec-create') {
            const created = await storage.createTopoDocument(write.cardPath, {
              type: 'cardspec',
              title: write.title || '知识卡片容器',
            })
            const documentId = String(created?.id ?? '')
            if (!documentId) throw new Error('载荷文档未返回 id')
            await storage.writeTopoDocument(write.cardPath, documentId, write.content)
            deps.documentBridge?.onWritten(documentId, write.cardPath, write.content)
            outcomes.push({ opId: write.opId, documentId, cardPath: write.cardPath, ok: true })
            continue
          }
          await storage.writeTopoDocument(write.cardPath, write.documentId, write.content)
          if (write.title && storage.renameTopoDocument) {
            // 标题同步是锦上添花：失败不影响正文已落盘的事实。
            try { await storage.renameTopoDocument(write.cardPath, write.documentId, write.title) } catch { /* noop */ }
          }
          deps.documentBridge?.onWritten(write.documentId, write.cardPath, write.content)
          outcomes.push({
            opId: write.opId, documentId: write.documentId, cardPath: write.cardPath, ok: true,
          })
        } catch (error) {
          outcomes.push({
            opId: write.opId, documentId: write.documentId, cardPath: write.cardPath,
            ok: false,
            code: write.kind === 'cardspec-create' ? 'cardspec_create_failed' : 'document_write_failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return outcomes
    },
    log: (actionId, detail) => deps.logger?.(actionId, detail),
  }
}
