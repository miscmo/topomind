import { useCallback } from 'react'
import type { NavState } from '../useNavContext'

interface UseGraphPersistenceOptions {
  getActiveNavState: () => NavState
  saveNow: (dirPath: string) => Promise<void>
}

export function useGraphPersistence({ getActiveNavState, saveNow }: UseGraphPersistenceOptions) {
  const flushCurrentRoomSave = useCallback(async () => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath || navState.kbPath || ''
    if (!dirPath) return
    await saveNow(dirPath)
  }, [getActiveNavState, saveNow])

  return { flushCurrentRoomSave }
}
