import type { Connection } from '@xyflow/react'
import type { EdgeLineMode, EdgeLineStyle, EdgeRelation, EdgeWeight, KnowledgeEdge, KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'

export interface EdgeOperationsDeps {
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveNavState: () => { kbPath: string; roomPath: string; roomName: string }
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  scheduleSave: (dirPath: string) => void
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
}

export function buildEdgeOperations(deps: EdgeOperationsDeps) {
  const {
    edgesRef,
    getActiveNavState,
    rebuildMaps,
    scheduleSave,
    setState,
  } = deps

  const addEdge = (
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
      type: lineMode,
      style: {
        stroke: color,
        strokeWidth: 2,
        strokeDasharray: lineStyle === 'dashed' ? '6 4' : undefined,
      },
      markerEnd: arrow ? { type: 'arrowclosed', color } : undefined,
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

    const dirPath = getActiveNavState().roomPath
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:创建', 'graphOperations', { edgeId, source: connection.source, target: connection.target })
  }

  const deleteEdge = (edgeId: string) => {
    setState((prev) => {
      const edges = prev.edges.filter((e) => e.id !== edgeId)
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    const dirPath = getActiveNavState().roomPath
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:删除', 'graphOperations', { edgeId })
  }

  const updateEdgeRelation = (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => {
    const dirPath = getActiveNavState().roomPath
    setState((prev) => {
      const edges = prev.edges.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              animated: weight === 'main',
              style: {
                ...e.style,
                strokeWidth: weight === 'main' ? 2.5 : 2,
              },
              data: { ...e.data, relation, weight },
            }
          : e
      )
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:更新关系', 'graphOperations', { edgeId, relation, weight })
  }

  const updateEdgeStyle = (
    edgeId: string,
    style: { lineMode?: EdgeLineMode; lineStyle?: EdgeLineStyle; color?: string; arrow?: boolean; selected?: boolean }
  ) => {
    const dirPath = getActiveNavState().roomPath
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
          type: style.lineMode ?? e.data?.lineMode ?? 'smoothstep',
          style: {
            stroke: nextColor,
            strokeWidth: nextSelected ? (nextWeight === 'main' ? 4 : 3.5) : (nextWeight === 'main' ? 2.5 : 2),
            strokeDasharray: nextLineStyle === 'dashed' ? '6 4' : undefined,
            filter: nextSelected ? 'drop-shadow(0 0 6px rgba(52, 152, 219, 0.45))' : undefined,
          },
          markerEnd: nextArrow
            ? {
                type: 'arrowclosed',
                color: nextColor,
              }
            : undefined,
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
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:更新样式', 'graphOperations', { edgeId, ...style })
  }

  return {
    addEdge,
    deleteEdge,
    updateEdgeRelation,
    updateEdgeStyle,
  }
}
