/**
 * useResizePanel — Right panel drag-resize logic
 *
 * Responsibilities:
 * - Track mousedown on resize handle
 * - Update panel width via onWidthChange during drag
 * - Disable text selection + set col-resize cursor during drag
 * - Clean up on mouseup
 */
import { useState, useRef, useCallback, useEffect } from 'react'

export interface UseResizePanelOptions {
  /** Initial panel width (used as the starting drag width) */
  initialWidth: number
  /** Called with new width during drag */
  onWidthChange: (width: number) => void
  minWidth?: number
  maxWidth?: number
}

export function useResizePanel(options: UseResizePanelOptions) {
  const { initialWidth, onWidthChange, minWidth = 200, maxWidth = 800 } = options
  const [isResizing, setIsResizing] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = initialWidth
    setIsResizing(true)
  }, [initialWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    // 向左拖 → delta 负 → 面板变宽；向右拖 → delta 正 → 面板变窄
    const delta = e.clientX - dragStartXRef.current
    const newWidth = Math.max(minWidth, Math.min(maxWidth, dragStartWidthRef.current - delta))
    onWidthChange(newWidth)
  }, [isResizing, minWidth, maxWidth, onWidthChange])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (e: MouseEvent) => handleMouseMove(e)
    const onUp = () => handleMouseUp()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  return { isResizing, handleMouseDown }
}