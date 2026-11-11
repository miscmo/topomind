/**
 * 选中区域的水平镜像（沿选中节点包围盒的中轴左右翻转）。
 *
 * 【需求 2026-11-11】用户把一片向右展开的节点 + 连线布局好之后，想「原地」
 * 改成向左展开，不想逐个挪节点。因此：
 *   - 中轴 = 所有选中节点的「左边界最小值」与「右边界最大值」的中点；
 *     镜像后包围盒左右端点互换 → 整体位置不变，只换方向。
 *   - 只改节点的 x（y 不变），宽度 / 高度 / 尺寸模式 / 内容一律不动。
 *   - 连线的 source / target 语义不动（箭头仍指向同一个目标），只把
 *     **落在选中端的锚点** u → 1-u：右侧出线变成左侧出线，v 保持。
 *   - 曲线控制点 v → -v：法向由 (dy, -dx)/len 定义，x 取反后弯曲方向
 *     必须跟着反，否则「上弯」会变成「下弯」，整体布局就不算镜像了。
 *
 * 纯函数、不碰 store / DOM / 落盘，也不改节点 / 边字段白名单：
 * 输出只含「位置」与「边 data 的少量补丁」，由调用层用展开语法透传其它字段。
 * 可 esbuild 打包真跑数据往返；连续调用两次必须回到原值（幂等）。
 */
import { normalizeCurveControl } from './edgeCurve.ts'

export interface MirrorNodeLike {
  id: string
  position: { x: number; y: number }
  width?: number | null
  measured?: { width?: number; height?: number } | null
  initialWidth?: number | null
  selected?: boolean
}

export interface MirrorAnchorLike {
  u: number
  v: number
}

export interface MirrorEdgeDataLike {
  sourceAnchor?: MirrorAnchorLike | null
  targetAnchor?: MirrorAnchorLike | null
  curveControl?: MirrorAnchorLike | null
}

export interface MirrorEdgeLike {
  id: string
  source: string
  target: string
  data?: MirrorEdgeDataLike | null
}

export interface HorizontalMirrorPatch {
  /** 选中区域包围盒的中轴 x（世界坐标） */
  axisX: number
  nodePositions: Map<string, { x: number; y: number }>
  /** edgeId → 需要合并进 edge.data 的字段补丁 */
  edgeDataPatches: Map<string, Record<string, unknown>>
  flippedNodeIds: string[]
  /** 至少一端落在选区内的边（节点移动后这些线都会跟着重算） */
  flippedEdgeIds: string[]
}

export interface HorizontalMirrorResult<N extends MirrorNodeLike, E extends MirrorEdgeLike> {
  axisX: number
  nodes: N[]
  edges: E[]
  flippedNodeIds: string[]
  flippedEdgeIds: string[]
}

/** 少于 2 个节点没有「左右布局」可言，直接不提供翻转入口。 */
export const MIRROR_MIN_SELECTED_NODES = 2
/** 与 graphBuilder / 落盘侧的兜底宽度保持一致。 */
export const DEFAULT_MIRROR_NODE_WIDTH = 120

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * 节点镜像用的宽度。优先用显式 width（buildNodes 落盘/回读都写它），
 * 再退回 measured / initialWidth，最后 120；脏值一律回落到兜底宽度。
 * 用「实际渲染宽度」而不是某个固定值，节点宽度不一时包围盒才对称。
 */
export function mirrorNodeWidth(node: MirrorNodeLike): number {
  const candidates = [node.width, node.measured?.width, node.initialWidth]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate
  }
  return DEFAULT_MIRROR_NODE_WIDTH
}

/** 边框锚点水平镜像：u → 1-u，v 不变；非法值视为「无锚点」不写补丁。 */
export function mirrorAnchorHorizontally(anchor: MirrorAnchorLike | null | undefined): MirrorAnchorLike | undefined {
  if (!anchor || typeof anchor.u !== 'number' || typeof anchor.v !== 'number') return undefined
  if (!Number.isFinite(anchor.u) || !Number.isFinite(anchor.v)) return undefined
  return { u: 1 - clamp01(anchor.u), v: clamp01(anchor.v) }
}

function centerXOf(node: MirrorNodeLike): number {
  return node.position.x + mirrorNodeWidth(node) / 2
}

/**
 * 计算镜像补丁。selectedIds 省略时从 nodes[].selected 派生（React Flow 的多选态）。
 * 返回 null 表示「选区不足 2 个节点」，调用方应直接跳过、不写库。
 */
export function computeHorizontalMirror(
  nodes: readonly MirrorNodeLike[],
  edges: readonly MirrorEdgeLike[],
  selectedIds?: readonly string[],
): HorizontalMirrorPatch | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const requested = selectedIds ?? nodes.filter((node) => node.selected).map((node) => node.id)
  const selected = new Set(requested.filter((id) => nodeById.has(id)))
  const selectedNodes = [...selected].map((id) => nodeById.get(id)!)
  if (selectedNodes.length < MIRROR_MIN_SELECTED_NODES) return null

  let left = Infinity
  let right = -Infinity
  for (const node of selectedNodes) {
    left = Math.min(left, node.position.x)
    right = Math.max(right, node.position.x + mirrorNodeWidth(node))
  }
  const axisX = (left + right) / 2
  const nodePositions = new Map<string, { x: number; y: number }>()
  for (const node of selectedNodes) {
    // 镜像的是整个矩形：左边界 x' = 2*axis - (x + width)，包围盒左右端点互换。
    nodePositions.set(node.id, {
      x: 2 * axisX - (node.position.x + mirrorNodeWidth(node)),
      y: node.position.y,
    })
  }

  const edgeDataPatches = new Map<string, Record<string, unknown>>()
  const flippedEdgeIds: string[] = []
  for (const edge of edges) {
    const sourceSelected = selected.has(edge.source)
    const targetSelected = selected.has(edge.target)
    if (!sourceSelected && !targetSelected) continue
    flippedEdgeIds.push(edge.id)

    const data = (edge.data ?? {}) as MirrorEdgeDataLike
    const patch: Record<string, unknown> = {}
    if (sourceSelected) {
      const anchor = mirrorAnchorHorizontally(data.sourceAnchor)
      if (anchor) patch.sourceAnchor = anchor
    }
    if (targetSelected) {
      const anchor = mirrorAnchorHorizontally(data.targetAnchor)
      if (anchor) patch.targetAnchor = anchor
    }

    // 曲线控制点：两端都选中 ⇒ 线段方向严格取反，v 必须跟着取反（含垂直线）。
    // 只有一端选中 ⇒ 线不是整体镜像，仅当两端中心连线的水平方向反转时才取反，
    // 否则保持用户设定的弯曲量，避免跨界连线莫名变形。
    const control = normalizeCurveControl(data.curveControl)
    if (control) {
      const sourceNode = nodeById.get(edge.source)
      const targetNode = nodeById.get(edge.target)
      let shouldFlip = sourceSelected && targetSelected
      if (!shouldFlip && sourceNode && targetNode) {
        const oldSourceCenter = centerXOf(sourceNode)
        const oldTargetCenter = centerXOf(targetNode)
        const oldDx = oldTargetCenter - oldSourceCenter
        const newSourceCenter = sourceSelected ? 2 * axisX - oldSourceCenter : oldSourceCenter
        const newTargetCenter = targetSelected ? 2 * axisX - oldTargetCenter : oldTargetCenter
        shouldFlip = Math.sign(oldDx) !== Math.sign(newTargetCenter - newSourceCenter)
      }
      if (shouldFlip) patch.curveControl = { u: control.u, v: -control.v }
    }

    if (Object.keys(patch).length > 0) edgeDataPatches.set(edge.id, patch)
  }

  return {
    axisX,
    nodePositions,
    edgeDataPatches,
    flippedNodeIds: [...selected],
    flippedEdgeIds,
  }
}

/**
 * 把补丁应用到完整节点 / 边数组：未选中的对象保持原引用（React Flow 跳过重渲染），
 * 其它所有字段（含 data 里的样式、关系、运行时标记）一律展开透传。
 */
export function applyHorizontalMirror<N extends MirrorNodeLike, E extends MirrorEdgeLike>(
  nodes: readonly N[],
  edges: readonly E[],
  selectedIds?: readonly string[],
): HorizontalMirrorResult<N, E> | null {
  const patch = computeHorizontalMirror(nodes, edges, selectedIds)
  if (!patch) return null
  const nextNodes = nodes.map((node) => {
    const position = patch.nodePositions.get(node.id)
    return position ? { ...node, position } as N : node
  })
  const nextEdges = edges.map((edge) => {
    const dataPatch = patch.edgeDataPatches.get(edge.id)
    if (!dataPatch) return edge
    return { ...edge, data: { ...(edge.data ?? {}), ...dataPatch } } as E
  })
  return {
    axisX: patch.axisX,
    nodes: nextNodes,
    edges: nextEdges,
    flippedNodeIds: patch.flippedNodeIds,
    flippedEdgeIds: patch.flippedEdgeIds,
  }
}
