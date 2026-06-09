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
import { usePromptStore } from '../../../../shared/ui/PromptModal/promptStore'
import { logAction } from '../../../../core/log-backend'
import type { KnowledgeNode, KnowledgeNodeStyle } from '../../../../types'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useEdgeActions } from './useEdgeActions'
import { useGraphStoreApi } from '../../../../stores/graphStore'

export interface UseNodeActionsOptions {
  /** Called after an action to notify parent (e.g., for focus management) */
  onAction?: () => void
  graph: GraphContextValue
}

export function useNodeActions(options: UseNodeActionsOptions) {
  const storeApi = useGraphStoreApi()
  const { onAction, graph } = options
  const confirm = useConfirmStore((s) => s.open)
  const prompt = usePromptStore((s) => s.open)
  const { handleEdgeDelete, handleEdgeRelation, handleEdgeClearStyle, handleEdgeStyle } = useEdgeActions({ graph, onAction })

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
    const confirmed = await confirm({ title: '删除节点', message: `将删除节点「${node.data.label}」。此操作会进入当前存储链路的删除流程。` })
    if (!confirmed) return false
    logAction('节点:删除', 'useNodeActions', { nodeId, label: node.data.label, source: 'context-menu' })
    await graph.deleteChildNode(nodeId)
    return true
  }, [confirm, findNodeById, graph])

  const handleEnterNode = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    logAction('节点:进入', 'useNodeActions', { nodeId, label: node.data.label, source: 'context-menu' })
    await graph.navigateToChildRoom(node.id, node.data.label)
    onAction?.()
  }, [findNodeById, graph, onAction])

  const handleDelete = useCallback(async (nodeId: string) => {
    const deleted = await confirmAndDeleteNode(nodeId)
    if (deleted) onAction?.()
  }, [confirmAndDeleteNode, onAction])

  const handleRename = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const nextName = await prompt({
      title: '重命名节点',
      placeholder: '请输入新的节点名称',
      defaultValue: node.data.label,
    })
    const normalizedName = nextName?.trim()
    if (!normalizedName || normalizedName === node.data.label) return
    logAction('节点:请求重命名', 'useNodeActions', {
      nodeId,
      oldName: node.data.label,
      newName: normalizedName,
      source: 'context-menu',
    })
    const renamed = await graph.renameNode(nodeId, normalizedName)
    if (renamed) onAction?.()
  }, [findNodeById, graph, onAction, prompt])

  const handleNodeStyle = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const currentStyle = (node.data.nodeStyle ?? {}) as KnowledgeNodeStyle
    const raw = await prompt({
      title: '编辑节点样式',
      placeholder:
        '输入 JSON，例如 {"headerBackgroundColor":"#1d4ed8","headerColor":"#ffffff","borderColor":"#60a5fa","borderWidth":2,"borderRadius":16}',
      defaultValue: JSON.stringify(currentStyle),
    })
    if (!raw?.trim()) return
    let parsed: KnowledgeNodeStyle
    try {
      parsed = JSON.parse(raw) as KnowledgeNodeStyle
    } catch {
      return
    }
    logAction('节点:更新样式', 'useNodeActions', {
      nodeId,
      source: 'context-menu',
      styleKeys: Object.keys(parsed),
    })
    await graph.updateNodeStyle(nodeId, parsed)
    onAction?.()
  }, [findNodeById, graph, onAction, prompt])

  const handleNodeClearStyle = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node?.data.nodeStyle) return
    logAction('节点:清除样式', 'useNodeActions', {
      nodeId,
      source: 'context-menu',
    })
    await graph.clearNodesStyle([nodeId])
    onAction?.()
  }, [findNodeById, graph, onAction])

  return {
    handleNewChild,
    handleEnterNode,
    handleDelete,
    handleRename,
    handleNodeStyle,
    handleNodeClearStyle,
    handleEdgeDelete,
    handleEdgeRelation,
    handleEdgeClearStyle,
    handleEdgeStyle,
  }
}
