/**
 * useNodeActions — Node/edge action handlers
 *
 * Handles context-menu node/edge operations.
 *
 * NOTE: Use nodesMapRef/edgesMapRef (O(1) lookup) instead of nodesRef/edgesRef
 * arrays because refs are recreated on every context re-creation (after setState),
 * causing stale closures. The Map objects are consistently updated by rebuildMaps().
 */
import { useCallback } from 'react'
import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'
import { logAction } from '../../../../core/log-backend'
import type { KnowledgeNode } from '../../../../types'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useEdgeActions } from './useEdgeActions'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { resolveRoomChildRef } from '../../../../domain/graph/path-utils'

export interface UseNodeActionsOptions {
  /** Called after an action to notify parent (e.g., for focus management) */
  onAction?: () => void
  graph: GraphContextValue
}

export function useNodeActions(options: UseNodeActionsOptions) {
  const storeApi = useGraphStoreApi()
  const { onAction, graph } = options
  const confirm = useConfirmStore((s) => s.open)
  const { handleEdgeDelete, handleEdgeStyle } = useEdgeActions({ graph, onAction })

  // Use nodesMapRef/edgesMapRef (Map) for O(1) lookup instead of nodesRef/edgesRef arrays.
  // Maps are consistently updated by rebuildMaps() on every state change.
  // Arrays via refs are recreated on every context re-creation, causing stale closures.
  const findNodeById = useCallback((nodeId: string): KnowledgeNode | undefined => {
    return storeApi.getState().nodesMap.get(nodeId)
  }, [storeApi])

  const handleNewChild = useCallback(async (position?: { x: number; y: number }) => {
    logAction('节点:创建', 'useNodeActions', { 
      nodeName: '新节点',
      source: 'pane-context-menu',
      position 
    })
    await graph.createChildNode('新节点', undefined, position, { editTitle: true })
    onAction?.()
  }, [graph, onAction])

  const confirmAndDeleteNode = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return false
    const confirmed = await confirm({ title: '删除节点', message: `将删除节点「${node.data.label}」。节点目录会移入全局回收站。` })
    if (!confirmed) return false
    logAction('节点:删除', 'useNodeActions', { nodeId, label: node.data.label, source: 'context-menu' })
    await graph.deleteChildNode(nodeId)
    return true
  }, [confirm, findNodeById, graph])

  const handleEnterNode = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const absoluteChildPath = resolveRoomChildRef(typeof node.data.parent === 'string' ? node.data.parent : '', node.id)
    logAction('节点:进入', 'useNodeActions', { nodeId, label: node.data.label, source: 'context-menu' })
    await graph.navigateToChildRoom(absoluteChildPath, node.data.label)
    onAction?.()
  }, [findNodeById, graph, onAction])

  const handleDelete = useCallback(async (nodeId: string) => {
    const deleted = await confirmAndDeleteNode(nodeId)
    if (deleted) onAction?.()
  }, [confirmAndDeleteNode, onAction])

  return {
    handleNewChild,
    handleEnterNode,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
  }
}
