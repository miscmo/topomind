import type { Connection } from '@xyflow/react'
import type { EdgeLineMode, EdgeLineStyle, EdgeRelation, EdgeWeight, KnowledgeEdge, KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'
import { buildEdgeView } from './edgeView'

export interface EdgeOperationsDeps {
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  saveNow: (dirPath: string) => Promise<void>
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
}

export function buildEdgeOperations(deps: EdgeOperationsDeps) {
  const {
    edgesRef,
    getActiveGraphSession,
    rebuildMaps,
    saveNow,
    setState,
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

    setState((prev) => {
      const edges = [...prev.edges, newEdge]
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })

    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
    logAction('连线:创建', 'graphOperations', { edgeId, source: connection.source, target: connection.target })
  }

  const deleteEdge = async (edgeId: string) => {
    setState((prev) => {
      const edges = prev.edges.filter((e) => e.id !== edgeId)
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
    logAction('连线:删除', 'graphOperations', { edgeId })
  }

  const updateEdgeRelation = async (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => {
    const dirPath = getActiveGraphSession().roomPath
    setState((prev) => {
      const edges = prev.edges.map((e) =>
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
      )
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    if (dirPath) await saveNow(dirPath)
    logAction('连线:更新关系', 'graphOperations', { edgeId, relation, weight })
  }

  const updateEdgeStyle = async (
    edgeId: string,
    style: { lineMode?: EdgeLineMode; lineStyle?: EdgeLineStyle; color?: string; arrow?: boolean; selected?: boolean }
  ) => {
    const dirPath = getActiveGraphSession().roomPath
    setState((prev) => {
      const edges = prev.edges.map((e) => {
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
      })
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    if (dirPath) await saveNow(dirPath)
    logAction('连线:更新样式', 'graphOperations', { edgeId, ...style })
  }

  return {
    addEdge,
    deleteEdge,
    updateEdgeRelation,
    updateEdgeStyle,
  }
}
