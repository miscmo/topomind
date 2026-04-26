import { useEffect, useRef } from 'react'
import { logAction } from '../core/log-backend'

export interface UseRoomLoaderOptions {
  effectiveRoomPath: string | null
  effectiveKbPath: string | null
  tabId?: string
  loadRoom: (path: string) => Promise<void>
  isCreatingRef: React.MutableRefObject<boolean>
}

/**
 * Hook that orchestrates room loading when the effective room path or KB path changes.
 * Uses `queueMicrotask` so that loading is deferred until after the current render
 * cycle — this prevents stale state in asynchronous callbacks that fire before
 * React Flow has finished processing the previous room.
 *
 * The `isCreatingRef` guard prevents a spurious load when the user creates a new
 * room and immediately enters it: the mount effect would otherwise fire once for
 * the KB path and once for the room path, causing a double-load.
 *
 * @param options.effectiveRoomPath - Path of the room to load, or null if at KB root
 * @param options.effectiveKbPath   - Path of the current KB root
 * @param options.tabId            - ID of the tab that triggered the load
 * @param options.loadRoom         - Async callback that performs the actual room load
 * @param options.isCreatingRef    - Ref set to true while a new room is being created
 */
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