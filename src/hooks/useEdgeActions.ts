import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { usePromptStore } from '../stores/promptStore'
import { logAction } from '../core/log-backend'
import type { KnowledgeEdge } from '../types'
import type { GraphContextValue } from '../contexts/GraphContext'

export interface UseEdgeActionsOptions {
  onAction?: () => void
  graph: GraphContextValue
}

export function useEdgeActions(options: UseEdgeActionsOptions) {
  const { onAction, graph } = options
  const { deleteElements } = useReactFlow()
  const prompt = usePromptStore((s) => s.open)

  const findEdgeById = useCallback((edgeId: string): KnowledgeEdge | undefined => {
    return graph.edgesMapRef.current.get(edgeId)
  }, [graph.edgesMapRef])

  const handleEdgeDelete = useCallback((edgeId: string) => {
    const edge = findEdgeById(edgeId)
    logAction('连线:删除', 'useNodeActions', { edgeId, edgeSource: edge?.source, edgeTarget: edge?.target, trigger: 'context-menu' })
    deleteElements({ edges: [{ id: edgeId }] })
    onAction?.()
  }, [findEdgeById, deleteElements, onAction])

  const handleEdgeStyle = useCallback(async (edgeId: string) => {
    const edge = findEdgeById(edgeId)
    if (!edge) return
    const current = (edge.data ?? {}) as KnowledgeEdge['data']
    const raw = await prompt({
      title: '编辑连线样式',
      placeholder: '输入 JSON，例如 {"lineMode":"straight","lineStyle":"dashed","color":"#e74c3c","arrow":true}',
      defaultValue: JSON.stringify({
        lineMode: current?.lineMode ?? 'smoothstep',
        lineStyle: current?.lineStyle ?? 'solid',
        color: current?.color ?? '#7f8c8d',
        arrow: current?.arrow ?? true,
      }),
    })
    if (!raw?.trim()) return
    let parsed: { lineMode?: 'smoothstep' | 'straight'; lineStyle?: 'solid' | 'dashed'; color?: string; arrow?: boolean }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    graph.updateEdgeStyle(edgeId, parsed)
    onAction?.()
  }, [findEdgeById, graph, prompt, onAction])

  return {
    handleEdgeDelete,
    handleEdgeStyle,
  }
}
