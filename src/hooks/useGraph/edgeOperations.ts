import type { Connection } from '@xyflow/react'
import type { EdgeLineMode, EdgeLineStyle, EdgeRelation, EdgeWeight, KnowledgeEdge, KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'
import { buildEdgeView } from './edgeView'
import type { GraphSession } from '../../stores/tabs/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults'

export interface EdgeOperationsDeps {
  getActiveGraphSession: () => GraphSession | undefined
  saveNow: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
}

function withEdgeSelection(edge: KnowledgeEdge, selected: boolean): KnowledgeEdge {
  const color = edge.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
  const lineStyle = edge.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
  const arrow = edge.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
  const weight = edge.data?.weight ?? 'minor'

  return {
    ...edge,
    ...buildEdgeView({
      lineMode: edge.data?.lineMode,
      lineStyle,
      color,
      arrow,
      weight,
      selected,
    }),
    data: {
      ...edge.data,
      relation: edge.data?.relation ?? '相关',
      weight,
      color,
      lineStyle,
      arrow,
      selected,
    },
  } as KnowledgeEdge
}

export function buildEdgeOperations(deps: EdgeOperationsDeps) {
  const {
    getActiveGraphSession,
    saveNow,
    storeApi,
  } = deps

  const addEdge = async (
    connection: Connection,
    edgeId: string,
    defaultStyle?: { lineMode?: EdgeLineMode; lineStyle?: EdgeLineStyle; color?: string; arrow?: boolean }
  ) => {
    const lineMode = defaultStyle?.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
    const lineStyle = defaultStyle?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
    const color = defaultStyle?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
    const arrow = defaultStyle?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
    const newEdge: KnowledgeEdge = {
      id: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      ...buildEdgeView({ lineMode, lineStyle, color, arrow }),
      data: {
        relation: '相关',
        weight: 'minor',
        lineMode,
        lineStyle,
        color,
        arrow,
        highlighted: false,
        faded: false,
      },
    }

    const store = storeApi.getState()
    store.setEdges([...store.edges, newEdge])

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    if (currentRoomPath) await saveNow(currentRoomPath)
    logAction('连线:创建', 'graphOperations', { edgeId, source: connection.source, target: connection.target })
  }

  const deleteEdge = async (edgeId: string) => {
    const store = storeApi.getState()
    store.setEdges(store.edges.filter((e) => e.id !== edgeId))
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    if (currentRoomPath) await saveNow(currentRoomPath)
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
              arrow: e.data?.arrow,
              weight,
              selected: e.data?.selected,
            }),
            data: { ...e.data, relation, weight },
          }
        : e
    ))
    if (currentRoomPath) await saveNow(currentRoomPath)
    logAction('连线:更新关系', 'graphOperations', { edgeId, relation, weight })
  }

  const updateEdgeStyle = async (
    edgeId: string,
    style: { lineMode?: EdgeLineMode; lineStyle?: EdgeLineStyle; color?: string; arrow?: boolean; selected?: boolean }
  ) => {
    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession?.roomPath || graphSession?.kbPath || ''
    const store = storeApi.getState()
    const shouldPersist =
      style.lineMode !== undefined ||
      style.lineStyle !== undefined ||
      style.color !== undefined ||
      style.arrow !== undefined
    let changed = false
    const nextEdges = store.edges.map((e) => {
      if (e.id !== edgeId) return e
      const currentSelected = e.data?.selected ?? false
      const nextColor = style.color ?? e.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
      const nextLineStyle = style.lineStyle ?? e.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
      const nextLineMode = style.lineMode ?? e.data?.lineMode
      const nextArrow = style.arrow ?? e.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
      const nextWeight = e.data?.weight ?? 'minor'
      const nextSelected = style.selected ?? currentSelected
      if (
        nextLineMode === e.data?.lineMode &&
        nextLineStyle === (e.data?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle) &&
        nextColor === (e.data?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color) &&
        nextArrow === (e.data?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow) &&
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
          arrow: nextArrow,
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
          selected: nextSelected,
        },
      } as KnowledgeEdge
    })
    if (!changed) return
    store.setEdges(nextEdges)
    if (currentRoomPath && shouldPersist) await saveNow(currentRoomPath)
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
