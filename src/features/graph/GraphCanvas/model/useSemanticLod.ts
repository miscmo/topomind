/**
 * 语义缩放的画布接线层：把「连续 zoom + 树 + 偏好 + 房间图型」变成 React Flow 的 hidden 过滤。
 *
 * 性能铁律：
 *   1. zoom 每帧变化，但只有**跨 2% 显示比台阶**才更新（由 useGraphCanvasModel 量化），
 *      可见性计划不会每帧重算；
 *   2. 拖动节点时 nodes 数组每帧都变，但「节点 id 集合 + 从属边」不变，
 *      hierarchyKey 命中缓存 → 不重建树；
 *   3. applyLodNodeHidden / applyLodEdgeHidden 只改真正需要变 hidden / 淡入淡出的对象，
 *      其余复用原引用；状态不变时直接返回 store 原数组，拖动零拷贝；
 *   4. 图型推断与最终可见性在**同一趟** computeLodVisibility 里完成（resolvePolicy 回调），
 *      不再「先跑 auto 出统计、再跑 override 出可见集合」遍历两遍全图；
 *   5. 淡出对象先保持挂载 LOD_FADE_MS 再真正卸载，上限 N 个，避免大图缩放时挂太多临终节点。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KnowledgeEdge, KnowledgeNode } from '../../../../types'
import {
  LOD_FADE_MS,
  LOD_MAX_FADE_EDGES,
  LOD_MAX_FADE_NODES,
  applyLodEdgeHidden,
  applyLodNodeHidden,
  buildLodHierarchyKey,
  computeLodVisibility,
  isLodFullZoom,
  type LodFadeState,
  type LodVisibility,
} from '../../../../domain/graph/lod'
import { buildLodPlanSignature } from '../../../../domain/graph/lodPlanSignature'
import {
  inferGraphProfile,
  normalizeGraphProfileId,
  recommendedRelationForProfile,
  resolveEffectiveGraphProfileId,
  resolveGraphProfileLodPolicy,
  type ConcreteGraphProfileId,
  type GraphProfileId,
  type GraphProfileLodPolicy,
} from '../../../../domain/graph/graphProfiles'
import {
  clearPinned,
  prunePinned,
  setLodPreservedDepth,
  togglePinned,
  useLodPreferences,
} from './lodPreferences'
import { clearCollapsedCounts, publishCollapsedCounts } from './lodCollapseStore'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { CANVAS_OPERATIONS, PERFORMANCE_METRICS } from '../../../../shared/observability/performanceContract'
import { startCanvasSpan } from '../../../../hooks/useGraph/canvasPerformanceContext'

const EMPTY_IDS: readonly string[] = []
const EMPTY_SET: ReadonlySet<string> = new Set<string>()

export interface UseSemanticLodOptions {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  /** 量化后的 raw zoom，只在跨 2% 显示比台阶时变化 */
  zoom: number
  /** 粗档位 0~3，只用于「跨明显档位清空搜索临时显示」 */
  stage: number
  roomPath: string
  /** 本房间配置的图型（旧房间无配置即 auto） */
  configuredProfileId?: GraphProfileId
  /** graph store 的当前选中节点；诊断面板与置顶按钮共用同一来源 */
  selectedNodeId?: string | null
}

interface LodPlan {
  visibility: LodVisibility
  /** auto 解析后的实际图型 */
  effectiveProfileId: ConcreteGraphProfileId
  policy: GraphProfileLodPolicy
}

interface FadeState {
  nodeOut: ReadonlySet<string>
  nodeIn: ReadonlySet<string>
  edgeOut: ReadonlySet<string>
  edgeIn: ReadonlySet<string>
}

const EMPTY_FADE_STATE: FadeState = {
  nodeOut: EMPTY_SET,
  nodeIn: EMPTY_SET,
  edgeOut: EMPTY_SET,
  edgeIn: EMPTY_SET,
}

function diffHidden(previous: ReadonlySet<string>, current: ReadonlySet<string>) {
  const out: string[] = []
  const inn: string[] = []
  for (const id of current) if (!previous.has(id)) out.push(id)
  for (const id of previous) if (!current.has(id)) inn.push(id)
  return { out, in: inn }
}

function mergeFadeBatch(current: ReadonlySet<string>, outBatch: readonly string[], inBatch: readonly string[]): ReadonlySet<string> {
  const next = new Set(current)
  for (const id of inBatch) next.delete(id)
  for (const id of outBatch) next.add(id)
  return next
}

function removeFadeBatch(current: ReadonlySet<string>, batch: readonly string[]): ReadonlySet<string> {
  if (batch.length === 0) return current
  const next = new Set(current)
  for (const id of batch) next.delete(id)
  return next
}

export function useSemanticLod(options: UseSemanticLodOptions) {
  const { nodes, edges, zoom, stage, roomPath, configuredProfileId = 'auto', selectedNodeId = null } = options
  const graphStoreApi = useGraphStoreApi()
  const prefs = useLodPreferences()
  const pinnedIds: readonly string[] = prefs.pinnedByRoom[roomPath] ?? EMPTY_IDS
  const pinnedKey = pinnedIds.join('|')

  // 搜索定位等临时显示：跨粗档位即清空，避免一个节点被永久「钉」在画面上。
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set<string>())
  useEffect(() => { setRevealed(new Set<string>()) }, [stage])
  const revealNode = useCallback((nodeId: string) => {
    setRevealed((prev) => (prev.has(nodeId) ? prev : new Set(prev).add(nodeId)))
  }, [])

  // 【P1】signature 刻意不含节点坐标：几何压力曲线每次重算计划时读最新的
  // nodes[].position，但拖动本身不该触发重算（否则每帧重建压力表 + 整树，
  // 且节点会随手指位置忽隐忽现）。坐标只在跨 2% 台阶 / 关系变化时重新采样。
  const signature = useMemo(() => {
    // 【2026-11-15 多选卡顿修复】100% 是唯一可编辑档位，此时全部节点可见，
    // 选中集合既不影响裁剪也不影响强制显示。旧签名把所有选中 id 拼串 + selectedNodeId
    // 算进去，Shift 拖框每帧选中集合一变就重算整张 LOD 计划（hierarchy / 排序 /
    // 压力曲线 / 碰撞）。满缩放连拼串都省掉；只有真正缩小时才纳入整份选中集合。
    // selectedNodeId（单个 id）仍进签名：左上角诊断面板的深度 / 类型 / 隐藏阈值
    // 来自同一次计算，选中节点变了必须重算一次，否则面板会停在旧节点上。
    const fullZoom = isLodFullZoom(zoom)
    const selectedKey = fullZoom
      ? ''
      : nodes.filter((node) => node.selected).map((node) => node.id).join('|')
    return buildLodPlanSignature({
      hierarchyKey: buildLodHierarchyKey(nodes, edges),
      edgeCount: edges.length,
      zoom,
      mode: prefs.mode,
      preservedDepth: prefs.preservedDepth,
      configuredProfileId,
      pinnedKey,
      revealedKey: [...revealed].join('|'),
      fullZoom,
      selectedKey,
      selectedNodeId,
    })
  }, [nodes, edges, zoom, prefs.mode, prefs.preservedDepth, configuredProfileId, pinnedKey, revealed, selectedNodeId])

  const cacheRef = useRef<{ signature: string; plan: LodPlan } | null>(null)
  // 上一次可见集合：只作为滞回输入，不进 signature（避免自我触发重算）。
  const previousVisibleRef = useRef<ReadonlySet<string>>(EMPTY_SET)
  const plan = useMemo(() => {
    if (cacheRef.current?.signature === signature) return cacheRef.current.plan
    // 只测真正重算的那一次：signature 命中缓存就走上面的早退，不产生样本。
    const perfSpan = startCanvasSpan(graphStoreApi, {
      operation: CANVAS_OPERATIONS.lodRecompute,
      metric: PERFORMANCE_METRICS.canvasLod,
      roomPath,
      module: 'semanticLod',
      params: { zoom: Number(zoom.toFixed(3)), trigger: 'signature-change' },
    })
    const pinned = new Set(pinnedIds)
    const common = {
      nodes, edges, zoom, pinned, revealed,
      preservedDepth: prefs.preservedDepth,
      previousVisibleNodeIds: previousVisibleRef.current,
      selectedNodeId,
    }
    // 图型推断与可见性计算合并在一次遍历里：纯函数层拿到树统计后同步回调，
    // 返回最终 mode / skipCoverageProtection，不再跑第二遍全图。
    let effectiveProfileId: ConcreteGraphProfileId = 'network'
    let policy: GraphProfileLodPolicy = { mode: 'auto', skipCoverageProtection: false, source: 'profile' }
    const visibility = computeLodVisibility({
      ...common,
      resolvePolicy: (stats) => {
        const inferred = inferGraphProfile({
          nodeCount: stats.totalNodeCount,
          edgeCount: stats.edgeCount,
          subordinateEdgeCount: stats.subordinateEdgeCount,
          treeCoverage: stats.treeCoverage,
        })
        effectiveProfileId = resolveEffectiveGraphProfileId(configuredProfileId, inferred)
        policy = resolveGraphProfileLodPolicy(effectiveProfileId, prefs.mode)
        return { mode: policy.mode, skipCoverageProtection: policy.skipCoverageProtection }
      },
    })
    previousVisibleRef.current = visibility.visibleNodeIds
    const next: LodPlan = { visibility, effectiveProfileId, policy }
    cacheRef.current = { signature, plan: next }
    perfSpan.end({
      hiddenCount: visibility.hiddenNodeIds.size,
      visibleCount: visibility.visibleNodeIds.size,
      displayPercent: visibility.displayPercent,
      // 字段名保留以兼容旧看板；恒 false + singlePass 用于确认单次遍历已生效。
      recomputedTwice: false,
      singlePass: true,
      effectiveProfileId,
    })
    return next
  }, [signature, nodes, edges, zoom, prefs.mode, prefs.preservedDepth, configuredProfileId, pinnedIds, pinnedKey, revealed, selectedNodeId, graphStoreApi, roomPath])

  const { visibility, effectiveProfileId, policy } = plan

  // 【P1.75】折叠子树计数只广播到「计数变化的卡片」，不进节点 data / 不落盘。
  // visibility 走 2% 台阶缓存，所以一次滚轮最多发布几次；effect 里发布，
  // 避免在 render 阶段写外部 store。换房间 / 卸载时清空该 scope 的快照。
  useEffect(() => {
    publishCollapsedCounts(roomPath, visibility.collapsedCounts)
  }, [roomPath, visibility])
  useEffect(() => () => clearCollapsedCounts(roomPath), [roomPath])

  // 淡入淡出：节点与边各记一组 out/in 批次，单批 LOD_FADE_MS 后统一转为真 hidden。
  const [fadeState, setFadeState] = useState<FadeState>(EMPTY_FADE_STATE)
  const previousNodeHiddenRef = useRef<ReadonlySet<string>>(EMPTY_SET)
  const previousEdgeHiddenRef = useRef<ReadonlySet<string>>(EMPTY_SET)
  const fadeTimersRef = useRef<number[]>([])
  useEffect(() => () => {
    for (const timer of fadeTimersRef.current) window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const nodeDiff = diffHidden(previousNodeHiddenRef.current, visibility.hiddenNodeIds)
    const edgeDiff = diffHidden(previousEdgeHiddenRef.current, visibility.hiddenEdgeIds)
    previousNodeHiddenRef.current = visibility.hiddenNodeIds
    previousEdgeHiddenRef.current = visibility.hiddenEdgeIds
    const nodeOut = nodeDiff.out.slice(0, LOD_MAX_FADE_NODES)
    const nodeIn = nodeDiff.in.slice(0, LOD_MAX_FADE_NODES)
    const edgeOut = edgeDiff.out.slice(0, LOD_MAX_FADE_EDGES)
    const edgeIn = edgeDiff.in.slice(0, LOD_MAX_FADE_EDGES)
    if (nodeOut.length + nodeIn.length + edgeOut.length + edgeIn.length === 0) return

    setFadeState((prev) => ({
      nodeOut: mergeFadeBatch(prev.nodeOut, nodeOut, nodeIn),
      nodeIn: mergeFadeBatch(prev.nodeIn, nodeIn, nodeOut),
      edgeOut: mergeFadeBatch(prev.edgeOut, edgeOut, edgeIn),
      edgeIn: mergeFadeBatch(prev.edgeIn, edgeIn, edgeOut),
    }))
    const timer = window.setTimeout(() => {
      setFadeState((prev) => ({
        nodeOut: removeFadeBatch(prev.nodeOut, nodeOut),
        nodeIn: removeFadeBatch(prev.nodeIn, nodeIn),
        edgeOut: removeFadeBatch(prev.edgeOut, edgeOut),
        edgeIn: removeFadeBatch(prev.edgeIn, edgeIn),
      }))
    }, LOD_FADE_MS)
    fadeTimersRef.current.push(timer)
  }, [visibility])

  const nodeFade = useMemo<LodFadeState>(
    () => ({ out: fadeState.nodeOut, in: fadeState.nodeIn }),
    [fadeState.nodeOut, fadeState.nodeIn],
  )
  const edgeFade = useMemo<LodFadeState>(
    () => ({ out: fadeState.edgeOut, in: fadeState.edgeIn }),
    [fadeState.edgeOut, fadeState.edgeIn],
  )

  const visibleNodes = useMemo(
    () => applyLodNodeHidden(nodes, visibility, nodeFade),
    [nodes, visibility, nodeFade],
  )
  const visibleEdges = useMemo(
    () => applyLodEdgeHidden(edges, visibility, edgeFade),
    [edges, visibility, edgeFade],
  )

  // 剪枝只在用户点击置顶时做，避免拖动时每帧构造有效 id 集合。
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const togglePin = useCallback((nodeId: string) => {
    togglePinned(roomPath, nodeId)
    prunePinned(roomPath, new Set(nodesRef.current.map((node) => node.id)))
  }, [roomPath])
  const clearPin = useCallback(() => clearPinned(roomPath), [roomPath])

  return {
    visibility,
    visibleNodes,
    visibleEdges,
    /** 用户选择的三态（控件显示用户视角，不被图型覆盖） */
    mode: prefs.mode,
    /** 面板可随时变更的永久显示层数；与 visibility.preservedDepth 同源 */
    preservedDepth: prefs.preservedDepth,
    setPreservedDepth: setLodPreservedDepth,
    effectiveMode: policy.mode,
    policySource: policy.source,
    profileId: normalizeGraphProfileId(configuredProfileId),
    effectiveProfileId,
    /** 新建连线浮层的推荐关系：仅排序/标记，绝不自动落盘 */
    recommendedRelation: recommendedRelationForProfile(effectiveProfileId),
    pinnedIds,
    pinnedCount: pinnedIds.length,
    revealNode,
    togglePin,
    clearPin,
  }
}
