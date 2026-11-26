/**
 * AgentPatch v1 dry-run（P1 / B 第二段）。
 *
 * 纯函数：Patch + WorkspaceSnapshot → PatchPlan，逐项 before / after diff、影响范围、风险级别。
 * 零副作用——不 mutate patch / snapshot，不写 store，不落盘，不联网，不读 React / window。
 * commit 阶段复用本文件导出的 computeGraphDelta，保证「预览所见 = 提交所做」。
 */

import {
  AGENT_PATCH_PLAN_SCHEMA,
  AGENT_PATCH_PLAN_VERSION,
  AgentPatchError,
  isDocumentPatchOpName,
  type AgentDocumentState,
  type AgentPatch,
  type AgentPatchErrorCode,
  type AgentPatchOp,
  type PatchPlan,
  type PatchPreviewItem,
  type PatchRisk,
  type SnapshotEdge,
  type SnapshotNode,
  type WorkspaceSnapshot,
} from './agentPatchTypes'
import { buildDocumentWrite } from './documentWrite'

export interface GraphDeltaState {
  nodes: SnapshotNode[]
  edges: SnapshotEdge[]
}

export interface GraphDeltaResult {
  state: GraphDeltaState
  before: unknown
  after: unknown
  affectedCount: number
  risk: PatchRisk
  summary: string
  targetId?: string
}

const GRID_GAP_X = 280
const GRID_GAP_Y = 200

function cloneNode(node: SnapshotNode): SnapshotNode {
  return {
    ...node,
    position: { ...node.position },
    style: node.style ? { ...node.style } : undefined,
    linkedDocumentIds: node.linkedDocumentIds ? [...node.linkedDocumentIds] : undefined,
  }
}

function cloneEdge(edge: SnapshotEdge): SnapshotEdge {
  return { ...edge }
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 8)
}

/** 稳定指纹：只取业务字段，不含时间戳 / 选中态 / 运行时字段。 */
export function computeSnapshotDigest(snapshot: WorkspaceSnapshot): string {
  const stable = {
    roomPath: snapshot.roomPath,
    roomRev: snapshot.roomRev,
    nodes: snapshot.nodes.map((node) => [
      node.id, node.label, node.roomPath, node.position.x, node.position.y,
      node.parentId ?? '', node.treeOrder ?? '', JSON.stringify(node.style ?? {}),
      node.containerType ?? '', (node.linkedDocumentIds ?? []).join(','),
    ]),
    edges: snapshot.edges.map((edge) => [edge.id, edge.source, edge.target, edge.relation, edge.weight]),
    documents: snapshot.documents.map((doc) => [doc.id, doc.revision, doc.blockCount, doc.blockIds.join(',')]),
  }
  return shortHash(JSON.stringify(stable))
}

function blocked(
  code: AgentPatchErrorCode,
  message: string,
): never {
  throw new AgentPatchError(code, message)
}

function requireRoom(snapshot: WorkspaceSnapshot, roomPath: string): void {
  if (roomPath !== snapshot.roomPath) blocked('cross_room_ref', `跨房间引用被拒绝: ${roomPath}`)
}

function findNode(state: GraphDeltaState, id: string): SnapshotNode {
  const node = state.nodes.find((item) => item.id === id)
  if (!node) blocked('target_not_found', `节点不存在: ${id}`)
  return node
}

/**
 * 文档类 op 一律只做预览（写入口尚未开放），因此「目标文档不存在」应降级为
 * 一条 blocked 预览项，而不是抛异常把整轮 PatchPlan 一起拖垮——否则同一个
 * tool round 里其它 ready 的图变更也无法展示给用户确认。
 */
function findDocument(snapshot: WorkspaceSnapshot, id: string) {
  return snapshot.documents.find((item) => item.id === id)
}

function layoutNodes(nodes: SnapshotNode[], algorithm: 'grid' | 'tree'): SnapshotNode[] {
  if (nodes.length === 0) return []
  const originX = nodes.reduce((sum, node) => sum + node.position.x, 0) / nodes.length
  const originY = nodes.reduce((sum, node) => sum + node.position.y, 0) / nodes.length
  if (algorithm === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    const positions = new Map<string, { x: number; y: number }>()
    nodes.forEach((node, index) => {
      positions.set(node.id, {
        x: Math.round(originX + (index % columns) * GRID_GAP_X),
        y: Math.round(originY + Math.floor(index / columns) * GRID_GAP_Y),
      })
    })
    return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
  }
  // tree：按 parentId 分层，同层按原顺序横向排布；无父节点的算第 0 层。
  const depthCache = new Map<string, number>()
  const depthOf = (id: string, guard: Set<string>): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    if (guard.has(id)) return 0
    guard.add(id)
    const node = nodes.find((item) => item.id === id)
    const parent = node?.parentId ? nodes.find((item) => item.id === node.parentId) : undefined
    const depth = parent ? Math.min(8, depthOf(parent.id, guard) + 1) : 0
    depthCache.set(id, depth)
    return depth
  }
  const layers = new Map<number, SnapshotNode[]>()
  nodes.forEach((node) => {
    const depth = depthOf(node.id, new Set())
    const layer = layers.get(depth) ?? []
    layer.push(node)
    layers.set(depth, layer)
  })
  const positions = new Map<string, { x: number; y: number }>()
  for (const [depth, layer] of layers) {
    layer.forEach((node, index) => {
      positions.set(node.id, {
        x: Math.round(originX + index * GRID_GAP_X),
        y: Math.round(originY + depth * GRID_GAP_Y),
      })
    })
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
}

/**
 * 单个图类 op 的纯变换。抛 AgentPatchError 表示该 op 无法预览 / 提交。
 * 返回的新 state 与传入 state 完全不共享可变引用。
 */
export function computeGraphDelta(
  state: GraphDeltaState,
  op: AgentPatchOp,
  index: number,
  taskId: string,
): GraphDeltaResult {
  const nextNodes = () => state.nodes.map(cloneNode)
  const nextEdges = () => state.edges.map(cloneEdge)
  const tag = `${index}-${shortHash(taskId)}`

  switch (op.op) {
    case 'node.create': {
      const id = `agent-n-${tag}`
      if (op.parentId) findNode(state, op.parentId)
      const created: SnapshotNode = {
        id,
        label: op.title,
        roomPath: op.roomPath,
        position: { ...op.position },
        ...(op.parentId ? { parentId: op.parentId } : {}),
      }
      return {
        state: { nodes: [...nextNodes(), created], edges: nextEdges() },
        before: null,
        after: { id, label: op.title, position: op.position, parentId: op.parentId },
        affectedCount: 1,
        risk: 'medium',
        summary: `新建节点「${op.title}」`,
        targetId: id,
      }
    }
    case 'node.rename': {
      const node = findNode(state, op.nodeId)
      const before = node.label
      if (before === op.title) {
        return {
          state: { nodes: nextNodes(), edges: nextEdges() },
          before, after: before, affectedCount: 0, risk: 'low',
          summary: `重命名「${before}」（无变化）`, targetId: op.nodeId,
        }
      }
      const nodes = nextNodes().map((item) => (item.id === op.nodeId ? { ...item, label: op.title } : item))
      return {
        state: { nodes, edges: nextEdges() },
        before, after: op.title, affectedCount: 1, risk: 'low',
        summary: `重命名「${before}」→「${op.title}」`, targetId: op.nodeId,
      }
    }
    case 'node.style': {
      const targets = op.nodeIds.map((id) => findNode(state, id))
      const before = targets.map((node) => ({ id: node.id, style: node.style ?? {} }))
      const patch = op.patch as Record<string, unknown>
      const nodes = nextNodes().map((item) => (
        op.nodeIds.includes(item.id)
          ? { ...item, style: { ...(item.style ?? {}), ...patch } }
          : item
      ))
      return {
        state: { nodes, edges: nextEdges() },
        before,
        after: targets.map((node) => ({ id: node.id, style: { ...(node.style ?? {}), ...patch } })),
        affectedCount: targets.length,
        risk: 'low',
        summary: `调整 ${targets.length} 个节点样式`,
        targetId: op.nodeIds[0],
      }
    }
    case 'node.tree_order': {
      const unknown = op.order.filter((id) => !state.nodes.some((node) => node.id === id))
      if (unknown.length > 0) blocked('target_not_found', `排序含未知节点: ${unknown[0]}`)
      const before = state.nodes
        .filter((node) => op.order.includes(node.id))
        .map((node) => ({ id: node.id, treeOrder: node.treeOrder ?? null }))
      const orderMap = new Map(op.order.map((id, order) => [id, order]))
      const nodes = nextNodes().map((item) => (
        orderMap.has(item.id) ? { ...item, treeOrder: orderMap.get(item.id) } : item
      ))
      return {
        state: { nodes, edges: nextEdges() },
        before,
        after: op.order.map((id) => ({ id, treeOrder: orderMap.get(id) })),
        affectedCount: op.order.length,
        risk: 'low',
        summary: `调整 ${op.order.length} 个同级节点顺序`,
      }
    }
    case 'edge.create': {
      const source = findNode(state, op.source)
      const target = findNode(state, op.target)
      if (source.roomPath !== op.roomPath || target.roomPath !== op.roomPath) {
        blocked('cross_room_ref', '连线端点不在目标房间')
      }
      const duplicate = state.edges.some((edge) => edge.source === op.source && edge.target === op.target)
      if (duplicate) blocked('target_not_found', '连线已存在，无需重复创建')
      const id = `agent-e-${tag}`
      const created: SnapshotEdge = {
        id, source: op.source, target: op.target, roomPath: op.roomPath,
        relation: op.relation, weight: op.weight ?? 'main',
      }
      return {
        state: { nodes: nextNodes(), edges: [...nextEdges(), created] },
        before: null,
        after: { id, source: op.source, target: op.target, relation: op.relation, weight: op.weight ?? 'main' },
        affectedCount: 1,
        risk: 'medium',
        summary: `新增连线 ${op.source} → ${op.target}`,
        targetId: id,
      }
    }
    case 'edge.delete': {
      const edge = state.edges.find((item) => item.id === op.edgeId)
      if (!edge) blocked('target_not_found', `连线不存在: ${op.edgeId}`)
      return {
        state: { nodes: nextNodes(), edges: nextEdges().filter((item) => item.id !== op.edgeId) },
        before: { id: edge.id, source: edge.source, target: edge.target },
        after: null,
        affectedCount: 1,
        risk: 'high',
        summary: `删除连线 ${edge.source} → ${edge.target}`,
        targetId: op.edgeId,
      }
    }
    case 'canvas.layout': {
      const ids = op.nodeIds ?? state.nodes.map((node) => node.id)
      const targets = ids.map((id) => findNode(state, id))
      if (targets.some((node) => node.roomPath !== op.roomPath)) {
        blocked('cross_room_ref', '布局包含跨房间节点')
      }
      const repositioned = layoutNodes(targets, op.algorithm)
      const positionMap = new Map(repositioned.map((node) => [node.id, node.position]))
      const nodes = nextNodes().map((item) => (
        positionMap.has(item.id) ? { ...item, position: { ...positionMap.get(item.id)! } } : item
      ))
      return {
        state: { nodes, edges: nextEdges() },
        before: targets.slice(0, 3).map((node) => ({ id: node.id, position: node.position })),
        after: { algorithm: op.algorithm, count: targets.length, sample: repositioned.slice(0, 3).map((node) => ({ id: node.id, position: node.position })) },
        affectedCount: targets.length,
        risk: 'high',
        summary: `按 ${op.algorithm} 重排 ${targets.length} 个节点`,
      }
    }
    default:
      return blocked('op_unknown', `非图类 op 不能产生 graphDelta: ${(op as AgentPatchOp).op}`)
  }
}

function summarizeBlocks(op: AgentPatchOp): unknown {
  if (op.op === 'document.insert_blocks' || op.op === 'document.replace_blocks') {
    return { count: op.blocks.length, types: op.blocks.slice(0, 3).map((block) => block.type) }
  }
  if (op.op === 'document.update_meta') return { keys: Object.keys(op.patch) }
  if (op.op === 'cardspec.create' || op.op === 'cardspec.update') {
    return { title: op.spec.title, components: op.spec.components.length }
  }
  return null
}

type DocumentPreview = Pick<
  PatchPreviewItem,
  'before' | 'after' | 'affectedCount' | 'risk' | 'summary' | 'targetId' | 'status' | 'blockedReason' | 'documentWrite'
>

/**
 * 文档 / CardSpec 类 op 的预览（P2 遗留补齐后已可提交）。
 *
 * 与 P1 的差异：不再恒定产出 `document_write_not_wired` / `cardspec_write_not_wired`，
 * 而是在调用方注入 documentStates 后，用纯函数算出**完整规范化载荷**，随预览项一起
 * 交给 commit。没有任何文档状态时不猜、不读盘，降级为一条 blocked 提示项。
 */
function previewDocumentOp(
  patch: AgentPatch,
  snapshot: WorkspaceSnapshot,
  op: AgentPatchOp,
  opId: string,
  index: number,
  documentStates: Record<string, AgentDocumentState> | undefined,
): DocumentPreview {
  const documentId = 'documentId' in op ? op.documentId : ''
  const blockedItem = (code: AgentPatchErrorCode, summary: string): DocumentPreview => ({
    before: null,
    after: summarizeBlocks(op),
    affectedCount: 1,
    risk: 'medium',
    summary,
    targetId: documentId || (op.op === 'cardspec.create' ? op.nodeId ?? op.title : ''),
    status: 'blocked',
    blockedReason: code,
  })

  // 旧口径保留：显式声明 documentRev 时与快照里的文档修订号比对。
  if (documentId) {
    const doc = findDocument(snapshot, documentId)
    const expected = patch.baseRevision.documentRev?.[documentId]
    if (doc && expected !== undefined && expected !== doc.revision) {
      return blockedItem('document_revision_mismatch', `${op.op} → ${documentId}（文档版本已变化，请重跑预览）`)
    }
  }

  if (!documentStates) {
    return blockedItem('document_state_unavailable', `${op.op} → 未能读取目标文档，请重新生成预览`)
  }

  try {
    const built = buildDocumentWrite(op, opId, documentStates, snapshot.roomPath, index, patch.taskId)
    return {
      before: built.before,
      after: built.after,
      affectedCount: built.affectedCount,
      risk: 'medium',
      summary: built.summary,
      targetId: built.targetId,
      status: 'ready',
      documentWrite: built.write,
    }
  } catch (error) {
    const code: AgentPatchErrorCode = error instanceof AgentPatchError ? error.code : 'schema_invalid'
    return blockedItem(code, `${op.op} 被阻断：${error instanceof Error ? error.message : String(error)}`)
  }
}

export interface DryRunOptions {
  /** 注入时钟，保证门禁里可重复断言；缺省 0。 */
  now?: number
  /** 预览时由渲染层异步抓取的文档状态；未注入时文档类 op 一律降级为 blocked。 */
  documentStates?: Record<string, AgentDocumentState>
}

/**
 * 唯一 dry-run 入口。任何不可解析的 op 都产出 status='blocked' 的预览项，
 * 而不是抛整批错误——用户仍能看到其余 op 的影响并逐项勾选。
 */
export function dryRunAgentPatch(
  patch: AgentPatch,
  snapshot: WorkspaceSnapshot,
  options: DryRunOptions = {},
): PatchPlan {
  const items: PatchPreviewItem[] = []
  const warnings: string[] = []
  let state: GraphDeltaState = {
    nodes: snapshot.nodes.map(cloneNode),
    edges: snapshot.edges.map(cloneEdge),
  }

  const roomMismatch = patch.baseRevision.roomRev !== undefined
    && patch.baseRevision.roomRev !== snapshot.roomRev
  if (roomMismatch) warnings.push('房间修订号已变化，图类变更已阻断，请重新生成 Patch')

  patch.ops.forEach((rawOp, index) => {
    const op = rawOp as AgentPatchOp
    const opId = `${index}:${op.op}`
    const base = {
      opId, index, op: op.op,
      summary: op.op,
      before: null as unknown,
      after: null as unknown,
      affectedCount: 0,
      risk: 'low' as PatchRisk,
      status: 'ready' as PatchPreviewItem['status'],
    }
    try {
      const isDocumentOp = isDocumentPatchOpName(op.op)
      const roomPath = 'roomPath' in op ? op.roomPath : undefined
      if (roomPath) requireRoom(snapshot, roomPath)
      if (isDocumentOp) {
        const preview = previewDocumentOp(patch, snapshot, op, opId, index, options.documentStates)
        items.push({ ...base, ...preview })
        return
      }
      if (roomMismatch) blocked('room_revision_mismatch', '房间修订号不匹配')
      // 无 roomPath 的 op（rename / style / edge.delete）也校验目标对象属于当前房间。
      if (op.op === 'node.rename' || op.op === 'node.style') {
        const ids = op.op === 'node.rename' ? [op.nodeId] : op.nodeIds
        for (const id of ids) {
          const node = findNode(state, id)
          if (node.roomPath !== snapshot.roomPath) blocked('cross_room_ref', `节点 ${id} 不在当前房间`)
        }
      }
      if (op.op === 'edge.delete') {
        const edge = state.edges.find((item) => item.id === op.edgeId)
        if (!edge) blocked('target_not_found', `连线不存在: ${op.edgeId}`)
        if (edge.roomPath !== snapshot.roomPath) blocked('cross_room_ref', '连线不在当前房间')
      }
      const delta = computeGraphDelta(state, op, index, patch.taskId)
      state = delta.state
      items.push({
        ...base,
        before: delta.before,
        after: delta.after,
        affectedCount: delta.affectedCount,
        risk: delta.risk,
        summary: delta.summary,
        targetId: delta.targetId,
        graphDelta: delta.state,
      })
    } catch (error) {
      const code: AgentPatchErrorCode = error instanceof AgentPatchError ? error.code : 'schema_invalid'
      items.push({
        ...base,
        status: 'blocked',
        blockedReason: code,
        summary: `${op.op} 被阻断：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  })

  if (items.some((item) => item.blockedReason === 'document_state_unavailable')) {
    warnings.push('部分文档变更未能读取到目标文档，已阻断；可重新生成预览后重试')
  }
  if (items.some((item) => item.blockedReason === 'document_dirty')) {
    warnings.push('目标文档存在未保存草稿，AI 写入已阻断：请先保存草稿，避免 1500ms 自动保存整篇覆盖')
  }

  const documentDigests: Record<string, string> = {}
  for (const item of items) {
    if (item.status === 'ready' && item.documentWrite?.baseDigest) {
      documentDigests[item.documentWrite.documentId] = item.documentWrite.baseDigest
    }
  }

  const ready = items.filter((item) => item.status === 'ready')
  return {
    schema: AGENT_PATCH_PLAN_SCHEMA,
    version: AGENT_PATCH_PLAN_VERSION,
    taskId: patch.taskId,
    items,
    warnings,
    totalAffected: ready.reduce((sum, item) => sum + item.affectedCount, 0),
    readyCount: ready.length,
    blockedCount: items.length - ready.length,
    snapshotDigest: computeSnapshotDigest(snapshot),
    documentDigests,
    requiresConfirmation: true,
    createdAt: options.now ?? 0,
  }
}
