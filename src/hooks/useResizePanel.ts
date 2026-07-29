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
  /** Called while drag updates */
  onResizeChange?: (result: { width: number; rawWidth: number }) => void
  /** Called when drag ends */
  onResizeEnd?: (result: { width: number; rawWidth: number }) => void
  minWidth?: number
  maxWidth?: number
  direction?: 'left' | 'right'
}

export function useResizePanel(options: UseResizePanelOptions) {
  const { initialWidth, onWidthChange, onResizeChange, onResizeEnd, minWidth = 200, maxWidth = 800, direction = 'right' } = options
  const [isResizing, setIsResizing] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const currentWidthRef = useRef(initialWidth)
  const currentRawWidthRef = useRef(initialWidth)
  const originalUserSelectRef = useRef('')
  const originalCursorRef = useRef('')

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = initialWidth
    currentWidthRef.current = initialWidth
    currentRawWidthRef.current = initialWidth
    setIsResizing(true)
  }, [initialWidth])

  const finishResize = useCallback(() => {
    if (!isResizing) return
    setIsResizing(false)
    onResizeEnd?.({
      width: currentWidthRef.current,
      rawWidth: currentRawWidthRef.current,
    })
  }, [isResizing, onResizeEnd])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const delta = e.clientX - dragStartXRef.current
    const rawWidth = direction === 'left'
      ? dragStartWidthRef.current + delta
      : dragStartWidthRef.current - delta
    const newWidth = Math.max(minWidth, Math.min(maxWidth, rawWidth))
    currentRawWidthRef.current = rawWidth
    currentWidthRef.current = newWidth
    onWidthChange(newWidth)
    onResizeChange?.({
      width: newWidth,
      rawWidth,
    })
  }, [direction, isResizing, minWidth, maxWidth, onWidthChange, onResizeChange])

  useEffect(() => {
    if (!isResizing) return
    originalUserSelectRef.current = document.body.style.userSelect
    originalCursorRef.current = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (e: MouseEvent) => handleMouseMove(e)
    const onUp = () => finishResize()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      document.body.style.userSelect = originalUserSelectRef.current
      document.body.style.cursor = originalCursorRef.current
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [isResizing, handleMouseMove, finishResize])

  return { isResizing, handleMouseDown }
}
