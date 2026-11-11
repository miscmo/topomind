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
 *   4. 图型推断直接复用第一次可见性计划里的树统计，**不重新遍历全图**；
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
  type LodFadeState,
  type LodVisibility,
} from '../../../../domain/graph/lod'
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
    const selectedKey = nodes.filter((node) => node.selected).map((node) => node.id).join('|')
    return [
      buildLodHierarchyKey(nodes, edges),
      edges.length,
      zoom,
      prefs.mode,
      // 面板改层数必须让计划立即失效：否则要等下一次缩放才生效。
      prefs.preservedDepth,
      configuredProfileId,
      pinnedKey,
      [...revealed].join('|'),
      selectedKey,
      selectedNodeId ?? '',
    ].join('~')
  }, [nodes, edges, zoom, prefs.mode, prefs.preservedDepth, configuredProfileId, pinnedKey, revealed, selectedNodeId])

  const cacheRef = useRef<{ signature: string; plan: LodPlan } | null>(null)
  // 上一次可见集合：只作为滞回输入，不进 signature（避免自我触发重算）。
  const previousVisibleRef = useRef<ReadonlySet<string>>(EMPTY_SET)
  const plan = useMemo(() => {
    if (cacheRef.current?.signature === signature) return cacheRef.current.plan
    const pinned = new Set(pinnedIds)
    const common = {
      nodes, edges, zoom, pinned, revealed,
      preservedDepth: prefs.preservedDepth,
      previousVisibleNodeIds: previousVisibleRef.current,
      selectedNodeId,
    }
    // 第一次计划同时产出图型推断所需的树统计，避免第二次遍历全图。
    const base = computeLodVisibility({ ...common, mode: 'auto' })
    const inferred = inferGraphProfile({
      nodeCount: base.totalNodeCount,
      edgeCount: edges.length,
      subordinateEdgeCount: base.subordinateEdgeCount,
      treeCoverage: base.treeCoverage,
    })
    const effectiveProfileId = resolveEffectiveGraphProfileId(configuredProfileId, inferred)
    const policy = resolveGraphProfileLodPolicy(effectiveProfileId, prefs.mode)
    const needsOverride = policy.mode !== 'auto' || policy.skipCoverageProtection
    const visibility = needsOverride
      ? computeLodVisibility({
        ...common,
        mode: policy.mode,
        skipCoverageProtection: policy.skipCoverageProtection,
      })
      : base
    previousVisibleRef.current = visibility.visibleNodeIds
    const next: LodPlan = { visibility, effectiveProfileId, policy }
    cacheRef.current = { signature, plan: next }
    return next
  }, [signature, nodes, edges, zoom, prefs.mode, prefs.preservedDepth, configuredProfileId, pinnedIds, pinnedKey, revealed, selectedNodeId])

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
