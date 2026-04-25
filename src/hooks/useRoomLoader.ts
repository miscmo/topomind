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

    queueMicrotask(() => {
      if (isCreatingRef.current) {
        isCreatingRef.current = false
        return
      }
      logAction('房间:加载触发', 'GraphPage', {
        loadPath,
        currentRoomPath: effectiveRoomPath || '',
        currentKBPath: effectiveKbPath || '',
        tabId: tabId || '',
      })
      loadRoomRef.current(loadPath)
    })
  }, [effectiveRoomPath, effectiveKbPath, tabId, isCreatingRef])
}