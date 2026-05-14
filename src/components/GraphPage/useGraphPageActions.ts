import { useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useNodeActions } from '../../hooks/useNodeActions'
import { logAction } from '../../core/log-backend'
import { useGraphUiStore } from '../../stores/graphUiStore'
import { useRightPanelStore } from '../../stores/rightPanelStore'
import type { ContextMenuState } from '../../stores/uiStoreTypes'
import type { GraphContextValue } from '../../contexts/GraphContext'

interface UseGraphPageActionsOptions {
  tabId: string
  graph: GraphContextValue
}

export function useGraphPageActions({ tabId, graph }: UseGraphPageActionsOptions) {
  const { screenToFlowPosition } = useReactFlow()
  const setRightPanelTab = useRightPanelStore((s) => s.setRightPanelTab)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    type: null,
    targetId: null,
  })
  const {
    deleteSelectedNode,
    addChildNode,
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
    handleProperties,
  } = useNodeActions({ graph })

  const closeContextMenu = useCallback(() => {
    setContextMenu((current) => {
      if (!current.visible) return current
      logAction('右键菜单:关闭', 'GraphPage', {})
      return { ...current, visible: false }
    })
  }, [])

  const openNodeMenu = useCallback((nodeId: string, event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    logAction('右键菜单:显示', 'GraphPage', { type: 'node', nodeId, x: event.clientX, y: event.clientY })
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      type: 'node',
      targetId: nodeId,
    })
  }, [])

  const openEdgeMenu = useCallback((edgeId: string, event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    logAction('右键菜单:显示', 'GraphPage', { type: 'edge', edgeId, x: event.clientX, y: event.clientY })
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      type: 'edge',
      targetId: edgeId,
    })
  }, [])

  const openPaneMenu = useCallback((x: number, y: number) => {
    logAction('右键菜单:显示', 'GraphPage', { type: 'pane', x, y })
    setContextMenu({
      visible: true,
      x,
      y,
      type: 'pane',
      targetId: '__pane__',
    })
  }, [])

  const handleContextMenuNewChild = useCallback((nodeId: string, position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    handleNewChild(nodeId, flowPosition)
  }, [handleNewChild, screenToFlowPosition])

  const handleCanvasEdgeContextMenu = useCallback((edgeId: string, event: React.MouseEvent) => {
    openEdgeMenu(edgeId, event)
  }, [openEdgeMenu])

  useKeyboard({
    tabId,
    onDelete: (nodeId: string) => {
      deleteSelectedNode(nodeId)
    },
    onAddChild: (parentId: string) => {
      addChildNode(parentId)
    },
    onEscape: closeContextMenu,
  })

  return {
    canvasProps: {
      onNodeContextMenu: openNodeMenu,
      onEdgeContextMenu: handleCanvasEdgeContextMenu,
      onPaneContextMenu: openPaneMenu,
      onCloseContextMenu: closeContextMenu,
    },
    contextMenuProps: {
      visible: contextMenu.visible,
      x: contextMenu.x,
      y: contextMenu.y,
      type: contextMenu.type,
      targetId: contextMenu.targetId,
      onNewChild: handleContextMenuNewChild,
      onRename: handleRename,
      onDelete: handleDelete,
      onEdgeDelete: handleEdgeDelete,
      onEdgeStyle: handleEdgeStyle,
      onProperties: handleProperties,
      onClose: closeContextMenu,
    },
  }
}
