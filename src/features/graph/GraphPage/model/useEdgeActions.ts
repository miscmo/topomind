import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { logAction } from '../../../../core/log-backend'
import type { KnowledgeEdge } from '../../../../types'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { useRightPanelStore } from '../../../right-panel/model/rightPanelStore'

export interface UseEdgeActionsOptions {
  onAction?: () => void
  graph: GraphContextValue
}

export function useEdgeActions(options: UseEdgeActionsOptions) {
  const storeApi = useGraphStoreApi()
  const { onAction, graph } = options
  const { deleteElements } = useReactFlow()

  const findEdgeById = useCallback((edgeId: string): KnowledgeEdge | undefined => {
    return storeApi.getState().edgesMap.get(edgeId)
  }, [storeApi])

  const handleEdgeDelete = useCallback((edgeId: string) => {
    const edge = findEdgeById(edgeId)
    logAction('连线:删除', 'useNodeActions', { edgeId, edgeSource: edge?.source, edgeTarget: edge?.target, trigger: 'context-menu' })
    deleteElements({ edges: [{ id: edgeId }] })
    onAction?.()
  }, [findEdgeById, deleteElements, onAction])

  // 右键菜单"连线样式"：不再弹出 JSON 编辑框，而是展开右侧面板、切到"样式"Tab
  // 与"连线"子 Tab，并选中该连线，引导用户在面板里编辑样式。
  // 这里显式设置各层状态，而不是依赖"选中后自动切换"的副作用——
  // 面板折叠时 StyleSection 不会走挂载副作用，重复选中同一条连线时也不会重新触发。
  const handleEdgeStyle = useCallback((edgeId: string) => {
    const edge = findEdgeById(edgeId)
    if (!edge) return
    logAction('连线:样式(面板)', 'useEdgeActions', { edgeId, edgeSource: edge.source, edgeTarget: edge.target, trigger: 'context-menu' })
    useRightPanelStore.getState().expandRightPanel()
    useRightPanelStore.getState().setRightPanelTab('style')
    useRightPanelStore.getState().setStylePanelTab('edges')
    graph.selectEdge(edgeId)
    onAction?.()
  }, [findEdgeById, graph, onAction])

  return {
    handleEdgeDelete,
    handleEdgeStyle,
  }
}
