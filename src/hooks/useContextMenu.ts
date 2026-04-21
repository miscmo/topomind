/**
 * useContextMenu — 右键菜单逻辑
 *
 * Returns:
 * - contextMenu: { visible, x, y, type, targetId } | null
 * - showCM(nodeId, e): 打开节点菜单
 * - showEdgeCM(edgeId, e): 打开连线菜单
 * - hideCM(): 关闭菜单
 */
import { useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { logAction } from '../core/log-backend'

export function useContextMenu() {
  const contextMenu = useAppStore((s) => s.contextMenu)
  const showContextMenu = useAppStore((s) => s.showContextMenu)
  const hideContextMenu = useAppStore((s) => s.hideContextMenu)

  const showCM = useCallback(
    (nodeId: string, e: MouseEvent | React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      logAction('右键菜单:显示', 'useContextMenu', { type: 'node', nodeId, x: e.clientX, y: e.clientY })
      showContextMenu(e.clientX, e.clientY, 'node', nodeId)
    },
    [showContextMenu]
  )

  const showEdgeCM = useCallback(
    (edgeId: string, e: MouseEvent | React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      logAction('右键菜单:显示', 'useContextMenu', { type: 'edge', edgeId, x: e.clientX, y: e.clientY })
      showContextMenu(e.clientX, e.clientY, 'edge', edgeId)
    },
    [showContextMenu]
  )

  const hideCM = useCallback(() => {
    logAction('右键菜单:关闭', 'useContextMenu', {})
    hideContextMenu()
  }, [hideContextMenu])

  return { contextMenu, showCM, showEdgeCM, hideCM }
}
