/**
 * Double-click detection hook
 * Detects double-click events on an element by tracking click timing and position.
 * Fires the onDoubleClick callback when two clicks occur within threshold.
 */
import { useRef } from 'react'

interface UseDoubleClickOptions {
  /** Time in ms between clicks to count as double-click (default: 400) */
  threshold?: number
  /** Max distance in px between clicks (default: 10) */
  distanceThreshold?: number
  /** Called for every click immediately (before double-click detection) */
  onClick?: (e: React.MouseEvent) => void
  /** Called when a double-click is detected */
  onDoubleClick: () => void
  /** Called for each single click (after threshold passes without double-click) */
  onSingleClick?: () => void
}

/**
 * Returns a ref to attach to the element and a click handler.
 * Usage:
 *   const { ref, handleClick } = useDoubleClick({ onDoubleClick: () => {}, onSingleClick: () => {} })
 *   <div ref={ref} onClick={handleClick}>...</div>
 */
export function useDoubleClick({
  threshold = 400,
  distanceThreshold = 10,
  onClick,
  onDoubleClick,
  onSingleClick,
}: UseDoubleClickOptions) {
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = (event: React.MouseEvent) => {
    onClick?.(event)

    const now = Date.now()
    const { clientX, clientY } = event

    if (lastClickRef.current) {
      const elapsed = now - lastClickRef.current.time
      const dx = Math.abs(clientX - lastClickRef.current.x)
      const dy = Math.abs(clientY - lastClickRef.current.y)

      if (elapsed < threshold && dx < distanceThreshold && dy < distanceThreshold) {
        // Double-click detected
        if (singleClickTimerRef.current) {
          clearTimeout(singleClickTimerRef.current)
          singleClickTimerRef.current = null
        }
        lastClickRef.current = null
        onDoubleClick()
        return
      }
    }

    // First click (or single click after threshold)
    lastClickRef.current = { time: now, x: clientX, y: clientY }

    if (onSingleClick) {
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current)
      }
      singleClickTimerRef.current = setTimeout(() => {
        lastClickRef.current = null
        onSingleClick()
      }, threshold)
    }
  }

  return { handleClick }
}
