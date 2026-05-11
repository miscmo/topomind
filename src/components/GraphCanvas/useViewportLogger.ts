import { useCallback, useRef, useState } from 'react'
import { logAction } from '../../core/log-backend'

interface ViewportState {
  zoom: number
  x: number
  y: number
}

export function useViewportLogger() {
  const [zoomLevel, setZoomLevel] = useState(1)
  const lastLogTimeRef = useRef<number>(0)

  const handleViewportChange = useCallback((viewport: ViewportState) => {
    setZoomLevel(viewport.zoom)
    const now = Date.now()
    if (now - lastLogTimeRef.current > 2000) {
      lastLogTimeRef.current = now
      logAction('视图:移动', 'GraphCanvas', {
        zoom: viewport.zoom,
        x: Math.round(viewport.x),
        y: Math.round(viewport.y),
      })
    }
  }, [])

  return { zoomLevel, handleViewportChange }
}
