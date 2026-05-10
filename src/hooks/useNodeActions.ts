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
import { useAppStore } from '../stores/appStore'
import { usePromptStore } from '../stores/promptStore'
import { useGraphContext } from '../contexts/GraphContext'
import { logAction } from '../core/log-backend'
import type { KnowledgeNode, KnowledgeEdge } from '../types'

export interface UseNodeActionsOptions {
  /** Called after an action to notify parent (e.g., for focus management) */
  onAction?: () => void
  graph?: ReturnType<typeof useGraphContext>
}

export function useNodeActions(options: UseNodeActionsOptions) {
  const { onAction, graph: graphFromOptions } = options
  const graphFromContext = useGraphContext()
  const graph = graphFromOptions ?? graphFromContext
  const { fitView, deleteElements } = useReactFlow()
  const selectNode = useAppStore((s) => s.selectNode)
  const prompt = usePromptStore((s) => s.open)

  // Use nodesMapRef/edgesMapRef (Map) for O(1) lookup instead of nodesRef/edgesRef arrays.
  // Maps are consistently updated by rebuildMaps() on every state change.
  // Arrays via refs are recreated on every context re-creation, causing stale closures.
  const findNodeById = useCallback((nodeId: string): KnowledgeNode | undefined => {
    return graph.nodesMapRef.current.get(nodeId)
  }, [graph.nodesMapRef])

  const findEdgeById = useCallback((edgeId: string): KnowledgeEdge | undefined => {
    return graph.edgesMapRef.current.get(edgeId)
  }, [graph.edgesMapRef])

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

  const handleDelete = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const confirmed = await prompt({ title: '确认删除', placeholder: `输入 "${node.data.label}" 确认删除`, defaultValue: node.data.label })
    if (!confirmed?.trim() || confirmed !== node.data.label) return
    logAction('节点:删除', 'useNodeActions', { nodeId, label: node.data.label, path: node.data.path, source: 'context-menu' })
    await graph.deleteChildNode(nodeId)
    onAction?.()
  }, [findNodeById, graph, onAction, prompt])

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

  const handleFocus = useCallback((nodeId: string) => {
    selectNode(nodeId)
    const node = findNodeById(nodeId)
    if (node) {
      fitView({ nodes: [node], padding: 0.3, duration: 300 })
    }
    logAction('节点:聚焦', 'useNodeActions', { nodeId })
    onAction?.()
  }, [findNodeById, selectNode, fitView, onAction])

  const handleProperties = useCallback((nodeId: string) => {
    selectNode(nodeId)
    logAction('节点:属性', 'useNodeActions', { nodeId })
    onAction?.()
  }, [selectNode, onAction])

  /** Delete selected node — used by keyboard shortcut */
  const deleteSelectedNode = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const confirmed = await prompt({ title: '确认删除', placeholder: `输入 "${node.data.label}" 确认删除`, defaultValue: node.data.label })
    if (!confirmed?.trim() || confirmed !== node.data.label) return
    logAction('节点:删除', 'useNodeActions', { nodeId, label: node.data.label, path: node.data.path, source: 'keyboard-delete' })
    await graph.deleteChildNode(nodeId)
  }, [findNodeById, graph, prompt])

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
