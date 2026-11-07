import type { Connection } from '@xyflow/react'
import type { EdgeRelation, EdgeStylePatch, EdgeWeight, KnowledgeEdge } from '../../types'
import { logAction } from '../../core/log-backend'
import { buildEdgeView } from './edgeView'
import type { GraphSession } from '../../stores/tabs/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT, clampNumber } from '../../domain/style/styleConstraints'
import { normalizeEdgeAnchor, type EdgeAnchor, type EdgeAnchorPatch } from '../../domain/graph/edgeAnchors'
import { CURVE_MODE_DEFAULT_CONTROL, normalizeCurveControl, sameCurveControl, type CurveControl } from '../../domain/graph/edgeCurve'
import {
  DEFAULT_EDGE_RELATION_ID,
  edgeRelationStylePatch,
  findEdgeRelationDefinition,
  normalizeEdgeRelationDefinitions,
  type EdgeRelationDefinition,
} from '../../domain/graph/edgeRelations'

export interface EdgeOperationsDeps {
  getActiveGraphSession: () => GraphSession | undefined
  saveNow: (dirPath: string) => Promise<void>
  saveLater: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
  /**
   * 注入当前全局连线关系定义。缺省时回退到内置 4 种，让纯 Node 回归脚本
   * 不必加载 zustand / localStorage 也能直接真跑本模块。
   */
  getEdgeRelations?: () => readonly EdgeRelationDefinition[]
}

function sameAnchor(a: EdgeAnchor | null | undefined, b: EdgeAnchor | null | undefined) {
  const left = normalizeEdgeAnchor(a)
  const right = normalizeEdgeAnchor(b)
  if (!left || !right) return left === right
  return left.u === right.u && left.v === right.v
}

/**
 * 样式数据浅比较。
 *
 * 这里刻意不写"字段白名单"：早期 updateEdgeStyle 逐字段比对 8 个样式字段，
 * 新增 curveBend 时漏加，导致「只改曲线参数 → 判定无变化 → 连内存都不写」。
 * 改成遍历两边实际字段的并集，未来任何新增样式字段都自动纳入变化检测。
 * 对象型字段（曲线控制点）单独按归一化后的值比较，避免 undefined/null 造成假变化。
 */
function sameStyleData(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (key === 'curveControl') {
      if (!sameCurveControl(
        a[key] as CurveControl | null | undefined,
        b[key] as CurveControl | null | undefined
      )) return false
      continue
    }
    if (a[key] !== b[key]) return false
  }
  return true
}

function withEdgeSelection(edge: KnowledgeEdge, selected: boolean): KnowledgeEdge {
  const color = edge.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
  const lineStyle = edge.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
  const lineWidth = edge.data?.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth
  const arrow = edge.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
  const arrowSize = edge.data?.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize
  const arrowShape = edge.data?.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
  const arrowPosition = edge.data?.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition
  const weight = edge.data?.weight ?? 'minor'

  return {
    ...edge,
    ...buildEdgeView({
      lineMode: edge.data?.lineMode,
      lineStyle,
      color,
      lineWidth,
      arrow,
      arrowSize,
      arrowShape,
      arrowPosition,
      weight,
      selected,
    }),
    data: {
      ...edge.data,
      relation: edge.data?.relation ?? '相关',
      weight,
      color,
      lineStyle,
      lineWidth,
      arrow,
      arrowSize,
      arrowShape,
      arrowPosition,
      selected,
    },
  } as KnowledgeEdge
}

export function buildEdgeOperations(deps: EdgeOperationsDeps) {
  const {
    getActiveGraphSession,
    saveLater,
    storeApi,
  } = deps

  const getRelations = deps.getEdgeRelations ?? (() => normalizeEdgeRelationDefinitions(undefined))

  const addEdge = async (
    connection: Connection,
    edgeId: string,
    defaultStyle?: EdgeStylePatch,
    relationId?: string
  ) => {
    const definition = findEdgeRelationDefinition(relationId ?? DEFAULT_EDGE_RELATION_ID, getRelations())
    // 显式指定非基础关系时才用关系样式覆盖；默认「关联」仍然继承右栏的
    // 「默认连线样式」，避免用户已配置的 defaultEdgeStyle 在一夜之间失效。
    // 切换已有边的关系由 updateEdgeRelation 统一套用关系样式。
    const relationStyle = relationId && relationId !== DEFAULT_EDGE_RELATION_ID
      ? edgeRelationStylePatch(definition.style)
      : undefined
    const effectiveStyle: EdgeStylePatch = { ...defaultStyle, ...relationStyle }
    const lineMode = effectiveStyle.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
    const lineStyle = effectiveStyle.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
    const color = effectiveStyle.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
    const lineWidth = effectiveStyle.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth
    const arrow = effectiveStyle.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
    const arrowSize = effectiveStyle.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize
    const arrowShape = effectiveStyle.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
    const arrowPosition = effectiveStyle.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition
    // 默认样式为曲线时，新建连线继承默认控制点；控制点缺失时给一个可见的默认弧度，
    // 否则「默认线型=曲线」新建出来的仍是一条直线。显式存了 v=0 的直线形态会被尊重。
    const curveControl = normalizeCurveControl(
      effectiveStyle.curveControl ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.curveControl
    ) ?? (lineMode === 'curve' ? { ...CURVE_MODE_DEFAULT_CONTROL } : null)
    const newEdge: KnowledgeEdge = {
      id: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      ...buildEdgeView({ lineMode, lineStyle, color, lineWidth, arrow, arrowSize, arrowShape, arrowPosition }),
      data: {
        relation: definition.id,
        weight: 'minor',
        lineMode,
        lineStyle,
        curveControl,
        color,
        lineWidth,
        arrow,
        arrowSize,
        arrowShape,
        arrowPosition,
        highlighted: false,
        faded: false,
      },
    }

    const store = storeApi.getState()
    const alreadyExists = store.edges.some((edge) => (
      edge.source === connection.source
      && edge.target === connection.target
      && (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null)
      && (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
    ))
    if (alreadyExists) return false
    store.setEdges([...store.edges, newEdge])

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('连线:创建', 'graphOperations', { edgeId, source: connection.source, target: connection.target })
    return true
  }

  const deleteEdge = async (edgeId: string) => {
    const store = storeApi.getState()
    store.setEdges(store.edges.filter((e) => e.id !== edgeId))
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('连线:删除', 'graphOperations', { edgeId })
    return true
  }

  const updateEdgeRelation = async (edgeId: string, relation: EdgeRelation, weight?: EdgeWeight) => {
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    const store = storeApi.getState()
    // 关系按稳定 id 落盘；旧中文值 / 已删除的自定义 id 在这里解析回当前定义。
    // 用户决策「切换即套用，可单条覆盖」：套用该关系的默认样式，之后仍可用
    // updateEdgeStyle 单独微调，不锁死。
    const definition = findEdgeRelationDefinition(relation, getRelations())
    const stylePatch = edgeRelationStylePatch(definition.style)
    let changed = false
    const nextEdges = store.edges.map((e) => {
      if (e.id !== edgeId) return e
      changed = true
      const nextWeight = weight ?? e.data?.weight ?? 'minor'
      return {
        ...e,
        ...buildEdgeView({
          lineMode: stylePatch.lineMode,
          lineStyle: stylePatch.lineStyle,
          color: stylePatch.color,
          lineWidth: stylePatch.lineWidth,
          arrow: stylePatch.arrow,
          arrowSize: stylePatch.arrowSize,
          arrowShape: stylePatch.arrowShape,
          arrowPosition: stylePatch.arrowPosition,
          weight: nextWeight,
          selected: e.data?.selected,
        }),
        data: { ...e.data, ...stylePatch, relation: definition.id, weight: nextWeight },
      } as KnowledgeEdge
    })
    if (!changed) return
    store.setEdges(nextEdges)
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('连线:更新关系', 'graphOperations', { edgeId, relation: definition.id, weight })
  }

  const updateEdgeStyle = async (
    edgeId: string,
    style: EdgeStylePatch & { selected?: boolean }
  ) => {
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    const store = storeApi.getState()
    // 通用持久化判定：除 selected（纯运行时状态）外，任何显式传入的 patch 字段都要落盘。
    // 早期这里手写 8 个字段的白名单，新增曲线参数时漏加 → 设置后既不写库也不落盘。
    const shouldPersist = Object.entries(style).some(
      ([key, value]) => key !== 'selected' && value !== undefined
    )
    let changed = false
    const nextEdges = store.edges.map((e) => {
      if (e.id !== edgeId) return e
      const d = (e.data ?? {}) as Record<string, unknown> & KnowledgeEdge['data']
      const defaults = STYLE_CONFIG_DEFAULTS.defaultEdgeStyle
      const nextColor = style.color ?? d.color ?? defaults.color
      const nextLineStyle = style.lineStyle ?? d.lineStyle ?? defaults.lineStyle
      const nextLineMode = style.lineMode ?? d.lineMode
      const nextArrow = style.arrow ?? d.arrow ?? defaults.arrow
      const nextLineWidth = clampNumber(
        style.lineWidth ?? d.lineWidth ?? defaults.lineWidth,
        EDGE_LINE_WIDTH_LIMIT.min,
        EDGE_LINE_WIDTH_LIMIT.max
      )
      const nextArrowSize = clampNumber(
        style.arrowSize ?? d.arrowSize ?? defaults.arrowSize,
        EDGE_ARROW_SIZE_LIMIT.min,
        EDGE_ARROW_SIZE_LIMIT.max
      )
      const nextArrowShape = style.arrowShape ?? d.arrowShape ?? defaults.arrowShape
      const nextArrowPosition = style.arrowPosition ?? d.arrowPosition ?? defaults.arrowPosition
      const nextWeight = d.weight ?? 'minor'
      const nextSelected = style.selected ?? d.selected ?? false
      // 显式传 curveControl（含 null）表示设置/复位；未传则沿用原值。
      // 统一归一化后写入，避免非法值流入磁盘。
      const nextCurveControl = 'curveControl' in style
        ? normalizeCurveControl(style.curveControl)
        : normalizeCurveControl(d.curveControl)

      // ...style 原样透传所有 patch 字段（未来新增字段无需改这里），
      // 随后用 clamp/兜底后的值覆盖，保证存进去的始终是合法值。
      const nextData = {
        ...d,
        ...style,
        relation: d.relation ?? '相关',
        weight: nextWeight,
        lineMode: nextLineMode,
        color: nextColor,
        lineStyle: nextLineStyle,
        lineWidth: nextLineWidth,
        arrow: nextArrow,
        arrowSize: nextArrowSize,
        arrowShape: nextArrowShape,
        arrowPosition: nextArrowPosition,
        curveControl: nextCurveControl,
        selected: nextSelected,
      }
      if (sameStyleData(d, nextData)) return e
      changed = true
      return {
        ...e,
        ...buildEdgeView({
          lineMode: nextLineMode,
          lineStyle: nextLineStyle,
          color: nextColor,
          lineWidth: nextLineWidth,
          arrow: nextArrow,
          arrowSize: nextArrowSize,
          arrowShape: nextArrowShape,
          arrowPosition: nextArrowPosition,
          weight: nextWeight,
          selected: nextSelected,
        }),
        data: nextData,
      } as KnowledgeEdge
    })
    if (!changed) return
    store.setEdges(nextEdges)
    if (currentRoomPath && shouldPersist) await saveLater(currentRoomPath)
    if (shouldPersist) logAction('连线:更新样式', 'graphOperations', { edgeId, ...style })
  }

  /**
   * 设置 / 复位某条连线的端点锚点。锚点属于连线，不属于节点：
   * 同一节点对不同连线各有独立端点；存的是相对节点矩形的归一化坐标。
   * patch 里显式传 null 表示恢复该端的自动交点。
   */
  const updateEdgeAnchor = async (edgeId: string, patch: EdgeAnchorPatch) => {
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    const store = storeApi.getState()
    let changed = false
    const nextEdges = store.edges.map((e) => {
      if (e.id !== edgeId) return e
      const nextData = { ...e.data }
      if ('sourceAnchor' in patch) {
        const normalized = normalizeEdgeAnchor(patch.sourceAnchor)
        if (normalized) nextData.sourceAnchor = normalized
        else delete nextData.sourceAnchor
      }
      if ('targetAnchor' in patch) {
        const normalized = normalizeEdgeAnchor(patch.targetAnchor)
        if (normalized) nextData.targetAnchor = normalized
        else delete nextData.targetAnchor
      }
      if (
        sameAnchor(e.data?.sourceAnchor, nextData.sourceAnchor)
        && sameAnchor(e.data?.targetAnchor, nextData.targetAnchor)
      ) return e
      changed = true
      return {
        ...e,
        data: {
          ...nextData,
          relation: e.data?.relation ?? '相关',
          weight: e.data?.weight ?? 'minor',
        },
      } as KnowledgeEdge
    })
    if (!changed) return
    store.setEdges(nextEdges)
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('连线:更新锚点', 'graphOperations', { edgeId, ...patch })
  }

  const setSelectedEdgeInGraph = (edgeId: string | null) => {
    const store = storeApi.getState()
    let changed = false
    const nextEdges = store.edges.map((edge) => {
      const nextSelected = edgeId !== null && edge.id === edgeId
      if ((edge.data?.selected ?? false) === nextSelected) return edge
      changed = true
      return withEdgeSelection(edge, nextSelected)
    })
    if (changed) store.setEdges(nextEdges)
  }

  return {
    addEdge,
    deleteEdge,
    updateEdgeRelation,
    updateEdgeStyle,
    updateEdgeAnchor,
    setSelectedEdgeInGraph,
  }
}
