import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { usePromptStore } from '../../../../shared/ui/PromptModal/promptStore'
import { logAction } from '../../../../core/log-backend'
import type { EdgeRelation, EdgeWeight, KnowledgeEdge } from '../../../../types'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { STYLE_CONFIG_DEFAULTS } from '../../../../domain/style/styleDefaults'

export interface UseEdgeActionsOptions {
  onAction?: () => void
  graph: GraphContextValue
}

export function useEdgeActions(options: UseEdgeActionsOptions) {
  const storeApi = useGraphStoreApi()
  const { onAction, graph } = options
  const { deleteElements } = useReactFlow()
  const prompt = usePromptStore((s) => s.open)
  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)

  const findEdgeById = useCallback((edgeId: string): KnowledgeEdge | undefined => {
    return storeApi.getState().edgesMap.get(edgeId)
  }, [storeApi])

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
        lineMode: current?.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode,
        lineStyle: current?.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle,
        color: current?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color,
        arrow: current?.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow,
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

  const handleEdgeClearStyle = useCallback(async (edgeId: string) => {
    const edge = findEdgeById(edgeId)
    if (!edge) return
    logAction('连线:清除样式', 'useEdgeActions', {
      edgeId,
      source: 'context-menu',
    })
    graph.updateEdgeStyle(edgeId, {
      lineMode: defaultEdgeStyle.lineMode,
      lineStyle: defaultEdgeStyle.lineStyle,
      color: defaultEdgeStyle.color,
      arrow: defaultEdgeStyle.arrow,
    })
    onAction?.()
  }, [defaultEdgeStyle.arrow, defaultEdgeStyle.color, defaultEdgeStyle.lineMode, defaultEdgeStyle.lineStyle, findEdgeById, graph, onAction])

  const handleEdgeRelation = useCallback(async (edgeId: string) => {
    const edge = findEdgeById(edgeId)
    if (!edge) return
    const current = (edge.data ?? {}) as KnowledgeEdge['data']
    const raw = await prompt({
      title: '编辑连线关系',
      placeholder: '输入 JSON，例如 {"relation":"依赖","weight":"main"}',
      defaultValue: JSON.stringify({
        relation: current?.relation ?? '相关',
        weight: current?.weight ?? 'minor',
      }),
    })
    if (!raw?.trim()) return
    let parsed: { relation?: EdgeRelation; weight?: EdgeWeight }
    try {
      parsed = JSON.parse(raw) as { relation?: EdgeRelation; weight?: EdgeWeight }
    } catch {
      return
    }
    const relation = parsed.relation
    const weight = parsed.weight
    if (
      (relation !== '演进' && relation !== '依赖' && relation !== '相关')
      || (weight !== 'main' && weight !== 'minor')
    ) {
      return
    }
    graph.updateEdgeRelation(edgeId, relation, weight)
    onAction?.()
  }, [findEdgeById, graph, prompt, onAction])

  return {
    handleEdgeDelete,
    handleEdgeRelation,
    handleEdgeClearStyle,
    handleEdgeStyle,
  }
}
