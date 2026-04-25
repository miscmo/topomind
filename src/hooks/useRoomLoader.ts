import { useEffect, useRef } from 'react'
import { logAction } from '../core/log-backend'

export interface UseRoomLoaderOptions {
  effectiveRoomPath: string | null
  effectiveKbPath: string | null
  tabId?: string
  loadRoom: (path: string) => Promise<void>
  isCreatingRef: React.MutableRefObject<boolean>
}

export function useRoomLoader(options: UseRoomLoaderOptions) {
  const { effectiveRoomPath, effectiveKbPath, tabId, loadRoom, isCreatingRef } = options

  const loadRoomRef = useRef(loadRoom)
  loadRoomRef.current = loadRoom

  useEffect(() => {
    const loadPath = effectiveRoomPath || effectiveKbPath || ''
    if (!loadPath) return

    // Capture values as parameters to the arrow function — avoids stale closure
    // when queueMicrotask fires after tabId or path has changed.
    const capturedRoomPath = effectiveRoomPath || ''
    const capturedKBPath = effectiveKbPath || ''
    const capturedTabId = tabId || ''

    queueMicrotask(() => {
      if (isCreatingRef.current) {
        isCreatingRef.current = false
        return
      }
      logAction('房间:加载触发', 'GraphPage', {
        loadPath,
        currentRoomPath: capturedRoomPath,
        currentKBPath: capturedKBPath,
        tabId: capturedTabId,
      })
      loadRoomRef.current(loadPath)
    })
  }, [effectiveRoomPath, effectiveKbPath, tabId, isCreatingRef])
}