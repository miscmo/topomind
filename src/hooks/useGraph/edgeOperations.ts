import type { Connection } from '@xyflow/react'
import type { EdgeLineMode, EdgeLineStyle, EdgeRelation, EdgeWeight, KnowledgeEdge, KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'
import { buildEdgeView } from './edgeView'
import type { GraphSession } from '../../stores/tabStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'

export interface EdgeOperationsDeps {
  getActiveGraphSession: () => GraphSession | undefined
  saveNow: (dirPath: string) => Promise<void>
  storeApi: StoreApi<GraphState>
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
    const lineMode = defaultStyle?.lineMode ?? 'smoothstep'
    const lineStyle = defaultStyle?.lineStyle ?? 'solid'
    const color = defaultStyle?.color ?? '#7f8c8d'
    const arrow = defaultStyle?.arrow ?? true
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
    store.setEdges(store.edges.map((e) => {
      if (e.id !== edgeId) return e
      const nextColor = style.color ?? e.data?.color ?? '#7f8c8d'
      const nextLineStyle = style.lineStyle ?? e.data?.lineStyle ?? 'solid'
      const nextArrow = style.arrow ?? e.data?.arrow ?? true
      const nextWeight = e.data?.weight ?? 'minor'
      const nextSelected = style.selected ?? false
      return {
        ...e,
        ...buildEdgeView({
          lineMode: style.lineMode ?? e.data?.lineMode,
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
    }))
    if (currentRoomPath) await saveNow(currentRoomPath)
    logAction('连线:更新样式', 'graphOperations', { edgeId, ...style })
  }

  return {
    addEdge,
    deleteEdge,
    updateEdgeRelation,
    updateEdgeStyle,
  }
}
