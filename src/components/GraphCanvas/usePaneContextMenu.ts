import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useDoubleClick } from '../../hooks/useDoubleClick'
import { logAction } from '../../core/log-backend'

const RIGHT_DRAG_THRESHOLD = 6

interface UsePaneContextMenuOptions {
  canvasRef: React.RefObject<HTMLDivElement>
}

export function usePaneContextMenu({ canvasRef }: UsePaneContextMenuOptions) {
  const showContextMenu = useAppStore((s) => s.showContextMenu)
  const { hideCM } = useContextMenu()
  const rightMouseDownRef = useRef<{ x: number; y: number } | null>(null)
  const suppressNextPaneContextMenuRef = useRef(false)

  const { handleClick: handlePaneClick } = useDoubleClick({
    onClick: () => hideCM(),
    onDoubleClick: () => useAppStore.getState().clearSelection(),
    onSingleClick: () => useAppStore.getState().clearSelection(),
  })

  const isPaneTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null
    if (!el) return false
    if (el.closest('.react-flow__node, .react-flow__edge, .react-flow__handle')) return false
    return !!canvasRef.current?.contains(el)
  }, [canvasRef])

  const openPaneContextMenu = useCallback((x: number, y: number) => {
    logAction('右键菜单:显示', 'GraphCanvas', { type: 'pane', x, y })
    showContextMenu(x, y, 'pane', '__pane__')
  }, [showContextMenu])

  useEffect(() => {
    const root = canvasRef.current
    if (!root) return

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || !isPaneTarget(e.target)) return
      rightMouseDownRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 2) return
      const start = rightMouseDownRef.current
      rightMouseDownRef.current = null
      if (!start) return

      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > RIGHT_DRAG_THRESHOLD) {
        suppressNextPaneContextMenuRef.current = true
        return
      }

      e.preventDefault()
      e.stopPropagation()
      suppressNextPaneContextMenuRef.current = true
      openPaneContextMenu(e.clientX, e.clientY)
    }

    const handleContextMenu = (e: MouseEvent) => {
      if (!isPaneTarget(e.target)) return

      e.preventDefault()
      e.stopPropagation()

      if (suppressNextPaneContextMenuRef.current) {
        suppressNextPaneContextMenuRef.current = false
        return
      }

      const start = rightMouseDownRef.current
      rightMouseDownRef.current = null
      if (!start) return

      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > RIGHT_DRAG_THRESHOLD) return

      openPaneContextMenu(e.clientX, e.clientY)
    }

    root.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    root.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      root.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      root.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [canvasRef, isPaneTarget, openPaneContextMenu])

  return { handlePaneClick }
}
