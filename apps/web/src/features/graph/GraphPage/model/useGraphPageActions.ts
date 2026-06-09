import { useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useNodeActions } from './useNodeActions'
import { logAction } from '../../../../core/log-backend'
import type { ContextMenuState } from '../../../../types/uiStoreTypes'
import type { GraphContextValue } from '../../../../contexts/GraphContext'

interface UseGraphPageActionsOptions {
  graph: GraphContextValue
  readOnly?: boolean
  allowPaneCreateWhenReadOnly?: boolean
  allowNodeMenuWhenReadOnly?: boolean
  allowLayoutWhenReadOnly?: boolean
  allowEdgeWriteWhenReadOnly?: boolean
}

export function useGraphPageActions({
  graph,
  readOnly = false,
  allowPaneCreateWhenReadOnly = false,
  allowNodeMenuWhenReadOnly = false,
  allowLayoutWhenReadOnly = false,
  allowEdgeWriteWhenReadOnly = false,
}: UseGraphPageActionsOptions) {
  const { screenToFlowPosition } = useReactFlow()
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    type: null,
    targetId: null,
  })
  const {
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
  } = useNodeActions({ graph })

  const closeContextMenu = useCallback(() => {
    setContextMenu((current) => {
      if (!current.visible) return current
      logAction('右键菜单:关闭', 'GraphPage', {})
      return { ...current, visible: false }
    })
  }, [])

  const openNodeMenu = useCallback((nodeId: string, event: MouseEvent | React.MouseEvent) => {
    if (readOnly && !allowNodeMenuWhenReadOnly) {
      return
    }
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
  }, [allowNodeMenuWhenReadOnly, readOnly])

  const openEdgeMenu = useCallback((edgeId: string, event: MouseEvent | React.MouseEvent) => {
    if (readOnly && !allowEdgeWriteWhenReadOnly) {
      return
    }
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
  }, [allowEdgeWriteWhenReadOnly, readOnly])

  const openPaneMenu = useCallback((x: number, y: number) => {
    if (readOnly && !allowPaneCreateWhenReadOnly) {
      return
    }
    logAction('右键菜单:显示', 'GraphPage', { type: 'pane', x, y })
    setContextMenu({
      visible: true,
      x,
      y,
      type: 'pane',
      targetId: '__pane__',
    })
  }, [allowPaneCreateWhenReadOnly, readOnly])

  const handleContextMenuNewChild = useCallback((position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    handleNewChild(flowPosition)
  }, [handleNewChild, screenToFlowPosition])

  const handleCanvasEdgeContextMenu = useCallback((edgeId: string, event: React.MouseEvent) => {
    openEdgeMenu(edgeId, event)
  }, [openEdgeMenu])

  return {
    canvasProps: {
      onNodeContextMenu: readOnly && !allowNodeMenuWhenReadOnly ? undefined : openNodeMenu,
      onEdgeContextMenu: readOnly && !allowEdgeWriteWhenReadOnly ? undefined : handleCanvasEdgeContextMenu,
      onPaneContextMenu: readOnly && !allowPaneCreateWhenReadOnly ? undefined : openPaneMenu,
      onCloseContextMenu: closeContextMenu,
      readOnly,
      allowPaneCreateWhenReadOnly,
      allowNodeMenuWhenReadOnly,
      allowLayoutWhenReadOnly,
      allowEdgeWriteWhenReadOnly,
    },
    contextMenuProps: {
      visible:
        readOnly && !allowPaneCreateWhenReadOnly && !allowNodeMenuWhenReadOnly && !allowEdgeWriteWhenReadOnly
          ? false
          : contextMenu.visible,
      x: contextMenu.x,
      y: contextMenu.y,
      type: contextMenu.type,
      targetId: contextMenu.targetId,
      onNewChild: handleContextMenuNewChild,
      onEnterNode: handleEnterNode,
      onDelete: handleDelete,
      onRenameNode: handleRename,
      onNodeStyle: handleNodeStyle,
      onNodeClearStyle: handleNodeClearStyle,
      onEdgeDelete: handleEdgeDelete,
      onEdgeRelation: handleEdgeRelation,
      onEdgeClearStyle: handleEdgeClearStyle,
      onEdgeStyle: handleEdgeStyle,
      onClose: closeContextMenu,
    },
  }
}
