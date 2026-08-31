import type { Connection } from '@xyflow/react'
import type { EdgeRelation, EdgeStylePatch, EdgeWeight, KnowledgeEdge } from '../../types'
import { logAction } from '../../core/log-backend'
import { buildEdgeView } from './edgeView'
import type { GraphSession } from '../../stores/tabs/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT, clampNumber } from '../../domain/style/styleConstraints'

export interface EdgeOperationsDeps {
  getActiveGraphSession: () => GraphSession | undefined
  saveNow: (dirPath: string) => Promise<void>
  saveLater: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
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

  const addEdge = async (
    connection: Connection,
    edgeId: string,
    defaultStyle?: EdgeStylePatch
  ) => {
    const lineMode = defaultStyle?.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
    const lineStyle = defaultStyle?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
    const color = defaultStyle?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
    const lineWidth = defaultStyle?.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth
    const arrow = defaultStyle?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
    const arrowSize = defaultStyle?.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize
    const arrowShape = defaultStyle?.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
    const arrowPosition = defaultStyle?.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition
    const newEdge: KnowledgeEdge = {
      id: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      ...buildEdgeView({ lineMode, lineStyle, color, lineWidth, arrow, arrowSize, arrowShape, arrowPosition }),
      data: {
        relation: '相关',
        weight: 'minor',
        lineMode,
        lineStyle,
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
  }

  const updateEdgeRelation = async (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => {
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    const store = storeApi.getState()
    store.setEdges(store.edges.map((e) =>
      e.id === edgeId
        ? {
            ...e,
            ...buildEdgeView({
              lineMode: e.data?.lineMode,
              lineStyle: e.data?.lineStyle,
              color: e.data?.color,
              lineWidth: e.data?.lineWidth,
              arrow: e.data?.arrow,
              arrowSize: e.data?.arrowSize,
              arrowShape: e.data?.arrowShape,
              arrowPosition: e.data?.arrowPosition,
              weight,
              selected: e.data?.selected,
            }),
            data: { ...e.data, relation, weight },
          }
        : e
    ))
    if (currentRoomPath) await saveLater(currentRoomPath)
    logAction('连线:更新关系', 'graphOperations', { edgeId, relation, weight })
  }

  const updateEdgeStyle = async (
    edgeId: string,
    style: EdgeStylePatch & { selected?: boolean }
  ) => {
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    const store = storeApi.getState()
    const shouldPersist =
      style.lineMode !== undefined ||
      style.lineStyle !== undefined ||
      style.color !== undefined ||
      style.lineWidth !== undefined ||
      style.arrow !== undefined ||
      style.arrowSize !== undefined ||
      style.arrowShape !== undefined ||
      style.arrowPosition !== undefined
    let changed = false
    const nextEdges = store.edges.map((e) => {
      if (e.id !== edgeId) return e
      const currentSelected = e.data?.selected ?? false
      const nextColor = style.color ?? e.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
      const nextLineStyle = style.lineStyle ?? e.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
      const nextLineMode = style.lineMode ?? e.data?.lineMode
      const nextArrow = style.arrow ?? e.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
      const nextLineWidth = clampNumber(
        style.lineWidth ?? e.data?.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth,
        EDGE_LINE_WIDTH_LIMIT.min,
        EDGE_LINE_WIDTH_LIMIT.max
      )
      const nextArrowSize = clampNumber(
        style.arrowSize ?? e.data?.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize,
        EDGE_ARROW_SIZE_LIMIT.min,
        EDGE_ARROW_SIZE_LIMIT.max
      )
      const nextArrowShape = style.arrowShape ?? e.data?.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
      const nextArrowPosition = style.arrowPosition ?? e.data?.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition
      const nextWeight = e.data?.weight ?? 'minor'
      const nextSelected = style.selected ?? currentSelected
      if (
        nextLineMode === e.data?.lineMode &&
        nextLineStyle === (e.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle) &&
        nextColor === (e.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color) &&
        nextArrow === (e.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow) &&
        nextLineWidth === (e.data?.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth) &&
        nextArrowSize === (e.data?.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize) &&
        nextArrowShape === (e.data?.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape) &&
        nextArrowPosition === (e.data?.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition) &&
        nextSelected === currentSelected
      ) {
        return e
      }
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
        data: {
          ...e.data,
          ...style,
          relation: e.data?.relation ?? '相关',
          weight: e.data?.weight ?? 'minor',
          color: nextColor,
          lineStyle: nextLineStyle,
          arrow: nextArrow,
          // 放在 ...style 之后，确保存进去的是 clamp/兜底后的值
          lineWidth: nextLineWidth,
          arrowSize: nextArrowSize,
          arrowShape: nextArrowShape,
          arrowPosition: nextArrowPosition,
          selected: nextSelected,
        },
      } as KnowledgeEdge
    })
    if (!changed) return
    store.setEdges(nextEdges)
    if (currentRoomPath && shouldPersist) await saveLater(currentRoomPath)
    if (shouldPersist) logAction('连线:更新样式', 'graphOperations', { edgeId, ...style })
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
    setSelectedEdgeInGraph,
  }
}
