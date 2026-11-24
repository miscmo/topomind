import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { logAction } from '../../../../core/log-backend'
import type { KnowledgeEdge } from '../../../../types'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { isActiveCanvasReadOnly } from '../../../../stores/canvasReadOnlyStore'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import { useTabStore } from '@/stores/tabs/tabStore'
import { HOST_VIEW_IDS } from '@/features/layout/NavRail/navModel'

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
    // deleteElements 是 React Flow 自带的删除 API，绕过了 useGraph 的编辑闸门，
    // 必须在这里单独挡住（右键菜单只读时不打开，这里是第二道保险）。
    if (isActiveCanvasReadOnly()) return
    const edge = findEdgeById(edgeId)
    logAction('edge.delete', 'useNodeActions', { edgeId, edgeSource: edge?.source, edgeTarget: edge?.target, trigger: 'context-menu' })
    deleteElements({ edges: [{ id: edgeId }] })
    onAction?.()
  }, [findEdgeById, deleteElements, onAction])

  // 右键菜单「连线样式」：样式设置已迁入全局设置页。共用 stylePanelTab，
  // 打开设置页时自动落在「连线样式」子分区；选中该连线便于后续回画布查看。
  const handleEdgeStyle = useCallback((edgeId: string) => {
    const edge = findEdgeById(edgeId)
    if (!edge) return
    logAction('edge.update', 'useEdgeActions', { edgeId, edgeSource: edge.source, edgeTarget: edge.target, trigger: 'context-menu' })
    useRightPanelStore.getState().setStylePanelTab('edges')
    graph.selectEdge(edgeId)
    useTabStore.getState().openSecondaryViewTab({ viewId: HOST_VIEW_IDS.settings, label: '设置' })
    onAction?.()
  }, [findEdgeById, graph, onAction])

  return {
    handleEdgeDelete,
    handleEdgeStyle,
  }
}
