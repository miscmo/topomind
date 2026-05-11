/**
 * useNodeActions — Node/edge action handlers
 *
 * Handles context-menu and keyboard-triggered node/edge operations.
 *
 * NOTE: Use nodesMapRef/edgesMapRef (O(1) lookup) instead of nodesRef/edgesRef
 * arrays because refs are recreated on every context re-creation (after setState),
 * causing stale closures. The Map objects are consistently updated by rebuildMaps().
 */
import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { usePromptStore } from '../stores/promptStore'
import { logAction } from '../core/log-backend'
import type { KnowledgeNode } from '../types'
import type { GraphContextValue } from '../contexts/GraphContext'
import { useEdgeActions } from './useEdgeActions'

export interface UseNodeActionsOptions {
  /** Called after an action to notify parent (e.g., for focus management) */
  onAction?: () => void
  graph: GraphContextValue
}

export function useNodeActions(options: UseNodeActionsOptions) {
  const { onAction, graph } = options
  const { fitView } = useReactFlow()
  const prompt = usePromptStore((s) => s.open)
  const { handleEdgeDelete, handleEdgeStyle } = useEdgeActions({ graph, onAction })

  // Use nodesMapRef/edgesMapRef (Map) for O(1) lookup instead of nodesRef/edgesRef arrays.
  // Maps are consistently updated by rebuildMaps() on every state change.
  // Arrays via refs are recreated on every context re-creation, causing stale closures.
  const findNodeById = useCallback((nodeId: string): KnowledgeNode | undefined => {
    return graph.nodesMapRef.current.get(nodeId)
  }, [graph.nodesMapRef])

  const handleNewChild = useCallback(async (nodeId: string, position?: { x: number; y: number }) => {
    const name = await prompt({ title: '请输入新节点名称', placeholder: '节点名称' })
    if (!name?.trim()) return
    logAction('节点:创建', 'useNodeActions', { 
      nodeId, nodeName: name.trim(), 
      source: nodeId ? 'context-menu' : 'pane-context-menu', 
      position 
    })
    await graph.createChildNode(name.trim(), nodeId || undefined, position)
    onAction?.()
  }, [graph, onAction, prompt])

  const handleRename = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const newName = await prompt({ title: '请输入新名称', placeholder: '节点名称', defaultValue: node.data.label })
    if (!newName?.trim() || newName === node.data.label) return
    logAction('节点:重命名', 'useNodeActions', { nodeId, oldName: node.data.label, newName: newName.trim(), source: 'context-menu' })
    await graph.renameNode(nodeId, newName.trim())
    onAction?.()
  }, [findNodeById, graph, onAction, prompt])

  const confirmAndDeleteNode = useCallback(async (nodeId: string, source: 'context-menu' | 'keyboard-delete') => {
    const node = findNodeById(nodeId)
    if (!node) return false
    const confirmed = await prompt({ title: '确认删除', placeholder: `输入 "${node.data.label}" 确认删除`, defaultValue: node.data.label })
    if (!confirmed?.trim() || confirmed !== node.data.label) return false
    logAction('节点:删除', 'useNodeActions', { nodeId, label: node.data.label, path: node.data.path, source })
    await graph.deleteChildNode(nodeId)
    return true
  }, [findNodeById, graph, prompt])

  const handleDelete = useCallback(async (nodeId: string) => {
    const deleted = await confirmAndDeleteNode(nodeId, 'context-menu')
    if (deleted) onAction?.()
  }, [confirmAndDeleteNode, onAction])

  const handleFocus = useCallback((nodeId: string) => {
    graph.selectNode(nodeId)
    const node = findNodeById(nodeId)
    if (node) {
      fitView({ nodes: [node], padding: 0.3, duration: 300 })
    }
    logAction('节点:聚焦', 'useNodeActions', { nodeId })
    onAction?.()
  }, [findNodeById, graph, fitView, onAction])

  const handleProperties = useCallback((nodeId: string) => {
    graph.selectNode(nodeId)
    logAction('节点:属性', 'useNodeActions', { nodeId })
    onAction?.()
  }, [graph, onAction])

  /** Delete selected node — used by keyboard shortcut */
  const deleteSelectedNode = useCallback(async (nodeId: string) => {
    await confirmAndDeleteNode(nodeId, 'keyboard-delete')
  }, [confirmAndDeleteNode])

  /** Add child node — used by keyboard Tab shortcut */
  const addChildNode = useCallback(async (parentId: string) => {
    const name = await prompt({ title: '请输入新节点名称', placeholder: '节点名称' })
    if (!name?.trim()) return
    logAction('节点:创建', 'useNodeActions', { nodeId: parentId, nodeName: name.trim(), source: 'keyboard-tab' })
    await graph.createChildNode(name.trim(), parentId)
  }, [graph, prompt])

  return {
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
    handleFocus,
    handleProperties,
    deleteSelectedNode,
    addChildNode,
  }
}
