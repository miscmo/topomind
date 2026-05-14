import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useNodeActions } from '../../hooks/useNodeActions'
import { useGraphUiStore } from '../../stores/graphUiStore'
import { useRightPanelStore } from '../../stores/rightPanelStore'
import type { GraphContextValue } from '../../contexts/GraphContext'

interface UseGraphPageActionsOptions {
  tabId: string
  graph: GraphContextValue
}

export function useGraphPageActions({ tabId, graph }: UseGraphPageActionsOptions) {
  const { screenToFlowPosition } = useReactFlow()
  const setRightPanelTab = useRightPanelStore((s) => s.setRightPanelTab)
  const setSelectedEdgeId = useGraphUiStore((s) => s.setSelectedEdgeId)
  const { contextMenu, closeContextMenu } = useContextMenu()
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

  const handleContextMenuNewChild = useCallback((nodeId: string, position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    handleNewChild(nodeId, flowPosition)
  }, [handleNewChild, screenToFlowPosition])

  const openEdgeStylePanel = useCallback((edgeId: string) => {
    setRightPanelTab('style')
    setSelectedEdgeId(edgeId)
  }, [setRightPanelTab, setSelectedEdgeId])

  useKeyboard({
    tabId,
    onDelete: (nodeId: string) => {
      deleteSelectedNode(nodeId)
    },
    onAddChild: (parentId: string) => {
      addChildNode(parentId)
    },
  })

  return {
    canvasProps: {
      onEdgeContextMenu: openEdgeStylePanel,
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
