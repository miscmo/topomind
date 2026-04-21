/**
 * useNodeActions — Node/edge action handlers
 *
 * Extracted from GraphPage.tsx to reduce component complexity.
 * Handles context-menu and keyboard-triggered node/edge operations.
 */
import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useAppStore } from '../stores/appStore'
import { usePromptStore } from '../stores/promptStore'
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
  const prompt = usePromptStore((s) => s.open)

  const handleNewChild = useCallback(async (nodeId: string) => {
    const name = await prompt({ title: '请输入新节点名称', placeholder: '节点名称' })
    if (!name?.trim()) return
    logAction('节点:创建', 'GraphPage', { nodeId, nodeName: name.trim(), source: 'context-menu' })
    graph.createChildNode(name.trim(), nodeId)
    onAction?.()
  }, [graph, onAction, prompt])

  const handleRename = useCallback(async (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const newName = await prompt({ title: '请输入新名称', placeholder: '节点名称', defaultValue: node.data.label })
    if (!newName?.trim() || newName === node.data.label) return
    logAction('节点:重命名', 'GraphPage', { nodeId, oldName: node.data.label, newName: newName.trim(), source: 'context-menu' })
    graph.renameNode(nodeId, newName.trim())
    onAction?.()
  }, [graph, onAction, prompt])

  const handleDelete = useCallback(async (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const confirmed = await prompt({ title: '确认删除', placeholder: `输入 "${node.data.label}" 确认删除` })
    if (!confirmed?.trim() || confirmed !== node.data.label) return
    logAction('节点:删除', 'GraphPage', { nodeId, label: node.data.label, path: node.data.path, source: 'context-menu' })
    graph.deleteChildNode(nodeId)
    onAction?.()
  }, [graph, onAction, prompt])

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
  const deleteSelectedNode = useCallback(async (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const confirmed = await prompt({ title: '确认删除', placeholder: `输入 "${node.data.label}" 确认删除` })
    if (!confirmed?.trim() || confirmed !== node.data.label) return
    logAction('节点:删除', 'GraphPage', { nodeId, label: node.data.label, path: node.data.path, source: 'keyboard-delete' })
    graph.deleteChildNode(nodeId)
  }, [graph, prompt])

  /** Add child node — used by keyboard Tab shortcut */
  const addChildNode = useCallback(async (parentId: string) => {
    const name = await prompt({ title: '请输入新节点名称', placeholder: '节点名称' })
    if (!name?.trim()) return
    logAction('节点:创建', 'GraphPage', { nodeId: parentId, nodeName: name.trim(), source: 'keyboard-tab' })
    graph.createChildNode(name.trim(), parentId)
  }, [graph, prompt])

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
