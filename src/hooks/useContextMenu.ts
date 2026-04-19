/**
 * useContextMenu — 右键菜单逻辑
 *
 * Returns:
 * - contextMenu: { visible, x, y, targetId } | null
 * - showCM(nodeId, e): 打开菜单
 * - hideCM(): 关闭菜单
 */
import { useCallback } from 'react'
import { useAppStore } from '../stores/appStore'

export function useContextMenu() {
  const contextMenu = useAppStore((s) => s.contextMenu)
  const showContextMenu = useAppStore((s) => s.showContextMenu)
  const hideContextMenu = useAppStore((s) => s.hideContextMenu)

  const showCM = useCallback(
    (nodeId: string, e: MouseEvent | React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      showContextMenu(e.clientX, e.clientY, 'node', nodeId)
    },
    [showContextMenu]
  )

  const hideCM = useCallback(() => {
    hideContextMenu()
  }, [hideContextMenu])

  return { contextMenu, showCM, hideCM }
}
