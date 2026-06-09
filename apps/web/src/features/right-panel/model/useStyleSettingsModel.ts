import { useEffect, useMemo, useState, useCallback } from 'react'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useGraphStore } from '../../../stores/graphStore'
import { useStorage } from '../../../core/storage'
import { GRAPH_UI_INITIAL_STATE } from '../../../stores/graphUiStore'
import type { KnowledgeNodeStyle } from '../../../types'
import type { NodeDimensionChange } from '@xyflow/react'
import type { DefaultEdgeStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits, DefaultEditorStyle } from '../../../types/uiStoreTypes'
import { NODE_BADGE_SIZE_LIMIT, NODE_STYLE_NUMBER_LIMITS, clampNumber } from '../../../domain/style/styleConstraints'
import { STYLE_CONFIG_DEFAULTS } from '../../../domain/style/styleDefaults'
import { EDGE_STYLE_PRESETS, EDITOR_STYLE_PRESETS, NODE_STYLE_PRESETS } from './stylePresets'
import {
  getNodeHeight,
  getNodeWidth,
  getSelectedNodeColorStyleValue,
  getSelectedNodeNumberStyleValue,
  mixedValue,
  type NodeStyleNumberKey,
} from './styleSectionModel'

type NodeSizeLimitKey = keyof NodeSizeLimits

export function useStyleSettingsModel() {
  const storage = useStorage()
  const selectedEdgeId = useGraphUiStore((s) => s.selectedEdgeId)
  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const defaultNodeStyle = useGraphUiStore((s) => s.defaultNodeStyle)
  const defaultNodeSize = useGraphUiStore((s) => s.defaultNodeSize)
  const nodeSizeLimits = useGraphUiStore((s) => s.nodeSizeLimits)
  const nodeBadgeSize = useGraphUiStore((s) => s.nodeBadgeSize)
  const setDefaultEdgeStyle = useGraphUiStore((s) => s.setDefaultEdgeStyle)
  const setDefaultNodeStyle = useGraphUiStore((s) => s.setDefaultNodeStyle)
  const setDefaultNodeSize = useGraphUiStore((s) => s.setDefaultNodeSize)
  const setNodeSizeLimits = useGraphUiStore((s) => s.setNodeSizeLimits)
  const setNodeBadgeSize = useGraphUiStore((s) => s.setNodeBadgeSize)
  const defaultEditorStyle = useGraphUiStore((s) => s.defaultEditorStyle)
  const setDefaultEditorStyle = useGraphUiStore((s) => s.setDefaultEditorStyle)

  const graph = useGraphContext()

  const selectedEdge = useGraphStore((s) => selectedEdgeId ? s.edgesMap.get(selectedEdgeId) : null)
  const nodes = useGraphStore((s) => s.nodes)
  const selectedNodes = useMemo(() => nodes.filter(n => n.selected), [nodes])
  const selectedNode = selectedNodes.length > 0 ? selectedNodes[0] : null

  const isMultiSelection = selectedNodes.length > 1
  const currentEdgeStyle = selectedEdge?.data
    ? {
        lineMode: selectedEdge.data.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode,
        lineStyle: selectedEdge.data.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle,
        color: selectedEdge.data.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color,
        arrow: selectedEdge.data.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow,
      }
    : defaultEdgeStyle
  const currentNodeStyle = {
    ...defaultNodeStyle,
    ...(selectedNode?.data.nodeStyle ?? {}),
  }
  const currentNodeWidth = selectedNode?.width ?? selectedNode?.initialWidth ?? selectedNode?.measured?.width ?? defaultNodeSize.width
  const currentNodeHeight = selectedNode?.height ?? selectedNode?.initialHeight ?? selectedNode?.measured?.height ?? defaultNodeSize.height
  const selectedNodeWidthValue = mixedValue(selectedNodes.map(node => getNodeWidth(node, defaultNodeSize)), currentNodeWidth)
  const selectedNodeHeightValue = mixedValue(selectedNodes.map(node => getNodeHeight(node, defaultNodeSize)), currentNodeHeight)
  const selectedNodeNumberStyleValue = (key: NodeStyleNumberKey) => getSelectedNodeNumberStyleValue(selectedNodes, defaultNodeStyle, currentNodeStyle, key)
  const selectedNodeColorStyleValue = (key: 'headerColor' | 'headerBackgroundColor' | 'borderColor') => getSelectedNodeColorStyleValue(selectedNodes, defaultNodeStyle, currentNodeStyle, key)

  const [activeTab, setActiveTab] = useState<'nodes' | 'edges' | 'editor'>('nodes')
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (selectedNode) {
      setActiveTab('nodes')
      setExpandedBlocks(prev => ({ ...prev, ownNode: true, globalNode: false, defaultNode: false }))
    }
  }, [selectedNode?.id])

  useEffect(() => {
    if (selectedEdgeId) {
      setActiveTab('edges')
      setExpandedBlocks(prev => ({ ...prev, ownEdge: true, defaultEdge: false }))
    }
  }, [selectedEdgeId])

  const toggleBlock = useCallback((key: string) => {
    setExpandedBlocks(prev => {
      const isCurrentlyExpanded = prev[key] ?? (
        key === 'globalNode' || key === 'defaultNode' || key === 'defaultEdge' ? false : true
      )
      return {
        ...prev,
        [key]: !isCurrentlyExpanded
      }
    })
  }, [])

  const writeStyleConfig = useCallback((patch: Parameters<typeof storage.writeConfig>[0]) => {
    setSaveError('')
    void storage.writeConfig(patch).catch((e) => {
      setSaveError(e instanceof Error ? e.message : String(e))
    })
  }, [storage])

  const updateDefaultStyle = useCallback((patch: Partial<DefaultEdgeStyle>) => {
    const next = { ...defaultEdgeStyle, ...patch }
    setDefaultEdgeStyle(patch)
    writeStyleConfig({ defaultEdgeStyle: next })
  }, [defaultEdgeStyle, setDefaultEdgeStyle, writeStyleConfig])

  const updateDefaultNodeStyle = useCallback((patch: Partial<DefaultNodeStyle>) => {
    const next = { ...defaultNodeStyle, ...patch }
    setDefaultNodeStyle(patch)
    writeStyleConfig({ defaultNodeStyle: next })
  }, [defaultNodeStyle, setDefaultNodeStyle, writeStyleConfig])

  const updateDefaultNodeSize = useCallback((patch: Partial<DefaultNodeSize>) => {
    const next = {
      width: clampNumber(patch.width ?? defaultNodeSize.width, nodeSizeLimits.minWidth, nodeSizeLimits.maxWidth),
      height: clampNumber(patch.height ?? defaultNodeSize.height, nodeSizeLimits.minHeight, nodeSizeLimits.maxHeight),
    }
    setDefaultNodeSize(next)
    writeStyleConfig({ defaultNodeSize: next })
  }, [defaultNodeSize, nodeSizeLimits, setDefaultNodeSize, writeStyleConfig])

  const updateDefaultEditorStyle = useCallback((patch: Partial<DefaultEditorStyle>) => {
    const next = { ...defaultEditorStyle, ...patch }
    setDefaultEditorStyle(patch)
    writeStyleConfig({ defaultEditorStyle: next })
  }, [defaultEditorStyle, setDefaultEditorStyle, writeStyleConfig])

  const updateNodeSizeLimits = useCallback((key: NodeSizeLimitKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const next = { ...nodeSizeLimits, [key]: Math.max(1, nextValue) }
    if (next.maxWidth < next.minWidth) next.maxWidth = next.minWidth
    if (next.maxHeight < next.minHeight) next.maxHeight = next.minHeight
    setNodeSizeLimits(next)
    writeStyleConfig({ nodeSizeLimits: next })
  }, [nodeSizeLimits, setNodeSizeLimits, writeStyleConfig])

  const updateNodeBadgeSize = useCallback((value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const next = clampNumber(nextValue, NODE_BADGE_SIZE_LIMIT.min, NODE_BADGE_SIZE_LIMIT.max)
    setNodeBadgeSize(next)
    writeStyleConfig({ nodeBadgeSize: next })
  }, [setNodeBadgeSize, writeStyleConfig])

  const applyToSelectedEdge = useCallback((patch: Partial<DefaultEdgeStyle>) => {
    if (!selectedEdgeId) return
    void graph.updateEdgeStyle(selectedEdgeId, patch)
  }, [selectedEdgeId, graph])

  const applyToSelectedNode = useCallback((patch: KnowledgeNodeStyle) => {
    if (selectedNodes.length === 0) return
    const ids = selectedNodes.map(n => n.id)
    void graph.updateNodesStyle(ids, patch)
  }, [selectedNodes, graph])

  const resetDefaultNodeAppearance = useCallback(() => {
    const nextStyle = GRAPH_UI_INITIAL_STATE.defaultNodeStyle
    const nextSize = GRAPH_UI_INITIAL_STATE.defaultNodeSize
    setDefaultNodeStyle(nextStyle)
    setDefaultNodeSize(nextSize)
    writeStyleConfig({ defaultNodeStyle: nextStyle, defaultNodeSize: nextSize })
  }, [setDefaultNodeStyle, setDefaultNodeSize, writeStyleConfig])

  const applyNodePreset = useCallback((preset: typeof NODE_STYLE_PRESETS[number]) => {
    setDefaultNodeStyle(preset.style)
    setDefaultNodeSize(preset.size)
    writeStyleConfig({ defaultNodeStyle: preset.style, defaultNodeSize: preset.size })
  }, [setDefaultNodeStyle, setDefaultNodeSize, writeStyleConfig])

  const applyEdgePreset = useCallback((preset: typeof EDGE_STYLE_PRESETS[number]) => {
    setDefaultEdgeStyle(preset.style)
    writeStyleConfig({ defaultEdgeStyle: preset.style })
  }, [setDefaultEdgeStyle, writeStyleConfig])

  const applyEditorPreset = useCallback((preset: typeof EDITOR_STYLE_PRESETS[number]) => {
    setDefaultEditorStyle(preset.style)
    writeStyleConfig({ defaultEditorStyle: preset.style })
  }, [setDefaultEditorStyle, writeStyleConfig])

  const clearSelectedNodesStyle = useCallback(() => {
    if (selectedNodes.length === 0) return
    void graph.clearNodesStyle(selectedNodes.map(n => n.id))
  }, [selectedNodes, graph])

  const applyNumberToDefaultNode = useCallback((key: NodeStyleNumberKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const limits = NODE_STYLE_NUMBER_LIMITS[key]
    updateDefaultNodeStyle({ [key]: clampNumber(nextValue, limits.min, limits.max) })
  }, [updateDefaultNodeStyle])

  const applyNumberToSelectedNode = useCallback((key: NodeStyleNumberKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const limits = NODE_STYLE_NUMBER_LIMITS[key]
    applyToSelectedNode({ [key]: clampNumber(nextValue, limits.min, limits.max) })
  }, [applyToSelectedNode])

  const applySizeToSelectedNode = useCallback((key: keyof DefaultNodeSize, value: string) => {
    if (selectedNodes.length === 0) return
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    
    const changes = selectedNodes.map(node => {
      const nodeWidth = node.width ?? node.initialWidth ?? node.measured?.width ?? defaultNodeSize.width
      const nodeHeight = node.height ?? node.initialHeight ?? node.measured?.height ?? defaultNodeSize.height
      
      const nextWidth = key === 'width'
        ? clampNumber(nextValue, nodeSizeLimits.minWidth, nodeSizeLimits.maxWidth)
        : nodeWidth
      const nextHeight = key === 'height'
        ? clampNumber(nextValue, nodeSizeLimits.minHeight, nodeSizeLimits.maxHeight)
        : nodeHeight
        
      return {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: nextWidth, height: nextHeight },
        updateStyle: true,
        resizing: false,
      } as NodeDimensionChange
    })
    
    graph.onNodesChange(changes)
  }, [selectedNodes, defaultNodeSize, nodeSizeLimits, graph])

  return {
    state: {
      activeTab,
      expandedBlocks,
      saveError,
      selectedNode,
      selectedNodes,
      isMultiSelection,
      selectedEdge,
      defaultNodeStyle,
      defaultNodeSize,
      nodeSizeLimits,
      nodeBadgeSize,
      defaultEdgeStyle,
      defaultEditorStyle,
      currentNodeStyle,
      currentNodeWidth,
      currentNodeHeight,
      selectedNodeWidthValue,
      selectedNodeHeightValue,
      currentEdgeStyle,
    },
    actions: {
      setActiveTab,
      toggleBlock,
      updateDefaultStyle,
      updateDefaultNodeStyle,
      updateDefaultNodeSize,
      updateDefaultEditorStyle,
      updateNodeSizeLimits,
      updateNodeBadgeSize,
      applyToSelectedEdge,
      applyToSelectedNode,
      resetDefaultNodeAppearance,
      applyNodePreset,
      applyEdgePreset,
      applyEditorPreset,
      clearSelectedNodesStyle,
      applyNumberToDefaultNode,
      applyNumberToSelectedNode,
      applySizeToSelectedNode,
      selectedNodeNumberStyleValue,
      selectedNodeColorStyleValue,
    }
  }
}
