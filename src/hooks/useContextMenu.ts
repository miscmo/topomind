/**
 * useContextMenu — 右键菜单逻辑
 *
 * Returns:
 * - contextMenu: { visible, x, y, type, targetId } | null
 * - openNodeMenu(nodeId, e): 打开节点菜单
 * - openEdgeMenu(edgeId, e): 打开连线菜单
 * - openPaneMenu(x, y): 打开画布菜单
 * - closeContextMenu(): 关闭菜单
 */
import { useCallback } from 'react'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { logAction } from '../core/log-backend'

export function useContextMenu() {
  const contextMenu = useContextMenuStore((s) => s.contextMenu)
  const showContextMenu = useContextMenuStore((s) => s.showContextMenu)
  const hideContextMenu = useContextMenuStore((s) => s.hideContextMenu)

  const openNodeMenu = useCallback(
    (nodeId: string, e: MouseEvent | React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      logAction('右键菜单:显示', 'useContextMenu', { type: 'node', nodeId, x: e.clientX, y: e.clientY })
      showContextMenu(e.clientX, e.clientY, 'node', nodeId)
    },
    [showContextMenu]
  )

  const openEdgeMenu = useCallback(
    (edgeId: string, e: MouseEvent | React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      logAction('右键菜单:显示', 'useContextMenu', { type: 'edge', edgeId, x: e.clientX, y: e.clientY })
      showContextMenu(e.clientX, e.clientY, 'edge', edgeId)
    },
    [showContextMenu]
  )

  const openPaneMenu = useCallback((x: number, y: number) => {
    logAction('右键菜单:显示', 'useContextMenu', { type: 'pane', x, y })
    showContextMenu(x, y, 'pane', '__pane__')
  }, [showContextMenu])

  const closeContextMenu = useCallback(() => {
    logAction('右键菜单:关闭', 'useContextMenu', {})
    hideContextMenu()
  }, [hideContextMenu])

  return { contextMenu, openNodeMenu, openEdgeMenu, openPaneMenu, closeContextMenu }
}
