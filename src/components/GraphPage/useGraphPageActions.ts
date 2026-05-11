import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useNodeActions } from '../../hooks/useNodeActions'
import { useRightPanelActions } from '../RightPanel/useRightPanelActions'
import type { GraphContextValue } from '../../contexts/GraphContext'

interface UseGraphPageActionsOptions {
  tabId: string
  graph: GraphContextValue
}

export function useGraphPageActions({ tabId, graph }: UseGraphPageActionsOptions) {
  const { screenToFlowPosition } = useReactFlow()
  const { openEdgeStylePanel } = useRightPanelActions()
  const { contextMenu, hideCM } = useContextMenu()
  const {
    deleteSelectedNode,
    addChildNode,
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
    handleFocus,
    handleProperties,
  } = useNodeActions({ graph })

  const handleContextMenuNewChild = useCallback((nodeId: string, position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    handleNewChild(nodeId, flowPosition)
  }, [handleNewChild, screenToFlowPosition])

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
      onFocus: handleFocus,
      onProperties: handleProperties,
      onClose: hideCM,
    },
  }
}
