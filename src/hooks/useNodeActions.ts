/**
 * useNodeActions — Node/edge action handlers
 *
 * Extracted from GraphPage.tsx to reduce component complexity.
 * Handles context-menu and keyboard-triggered node/edge operations.
 */
import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useAppStore } from '../stores/appStore'
import { useGraphContext } from '../contexts/GraphContext'
import { logAction } from '../core/log-backend'
import type { KnowledgeNode, KnowledgeEdge } from '../types'

export interface UseNodeActionsOptions {
  /** Called after an action to notify parent (e.g., for focus management) */
  onAction?: () => void
}

export function useNodeActions(options: UseNodeActionsOptions = {}) {
  const { onAction } = options
  const graph = useGraphContext()
  const { fitView, deleteElements } = useReactFlow()
  const selectNode = useAppStore((s) => s.selectNode)

  const handleNewChild = useCallback((nodeId: string) => {
    const name = window.prompt('请输入新节点名称：')
    if (!name?.trim()) return
    logAction('节点:创建', 'GraphPage', { nodeId, nodeName: name.trim(), source: 'context-menu' })
    graph.createChildNode(name.trim(), nodeId)
    onAction?.()
  }, [graph, onAction])

  const handleRename = useCallback((nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const newName = window.prompt('请输入新名称：', node.data.label)
    if (!newName?.trim() || newName === node.data.label) return
    logAction('节点:重命名', 'GraphPage', { nodeId, oldName: node.data.label, newName: newName.trim(), source: 'context-menu' })
    graph.renameNode(nodeId, newName.trim())
    onAction?.()
  }, [graph, onAction])

  const handleDelete = useCallback((nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    if (!window.confirm(`确定要删除 "${node.data.label}" 吗？`)) return
    logAction('节点:删除', 'GraphPage', { nodeId, label: node.data.label, path: node.data.path, source: 'context-menu' })
    graph.deleteChildNode(nodeId)
    onAction?.()
  }, [graph, onAction])

  const handleEdgeDelete = useCallback((edgeId: string) => {
    const edge = graph.edges.find((e) => e.id === edgeId)
    logAction('连线:删除', 'GraphPage', { edgeId, edgeSource: edge?.source, edgeTarget: edge?.target, trigger: 'context-menu' })
    deleteElements({ edges: [{ id: edgeId }] })
    onAction?.()
  }, [graph, deleteElements, onAction])

  const handleFocus = useCallback((nodeId: string) => {
    selectNode(nodeId)
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (node) {
      fitView({ nodes: [node], padding: 0.3, duration: 300 })
    }
    logAction('节点:聚焦', 'GraphPage', { nodeId })
    onAction?.()
  }, [graph, selectNode, fitView, onAction])

  const handleProperties = useCallback((nodeId: string) => {
    selectNode(nodeId)
    logAction('节点:属性', 'GraphPage', { nodeId })
    onAction?.()
  }, [selectNode, onAction])

  /** Delete selected node — used by keyboard shortcut */
  const deleteSelectedNode = useCallback((nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    if (!window.confirm(`确定要删除 "${node.data.label}" 吗？`)) return
    logAction('节点:删除', 'GraphPage', { nodeId, label: node.data.label, path: node.data.path, source: 'keyboard-delete' })
    graph.deleteChildNode(nodeId)
  }, [graph])

  /** Add child node — used by keyboard Tab shortcut */
  const addChildNode = useCallback((parentId: string) => {
    const name = window.prompt('请输入新节点名称：')
    if (!name?.trim()) return
    logAction('节点:创建', 'GraphPage', { parentId, nodeName: name.trim(), source: 'keyboard-tab' })
    graph.createChildNode(name.trim(), parentId)
  }, [graph])

  return {
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleFocus,
    handleProperties,
    deleteSelectedNode,
    addChildNode,
  }
}
