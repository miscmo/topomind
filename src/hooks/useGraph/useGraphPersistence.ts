import { useCallback } from 'react'
import type { GraphSession } from '../../stores/tabs/tabStore'

interface UseGraphPersistenceOptions {
  getActiveGraphSession: () => GraphSession
  saveNow: (dirPath: string) => Promise<void>
  hasPendingSave: (dirPath: string) => boolean
}

export function useGraphPersistence(options: UseGraphPersistenceOptions) {
  const { getActiveGraphSession, saveNow, hasPendingSave } = options

  const flushCurrentRoomSave = useCallback(async () => {
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) {
      await saveNow(dirPath)
    }
  }, [getActiveGraphSession, saveNow])

  const hasPendingCurrentRoomSave = useCallback(() => {
    const dirPath = getActiveGraphSession().roomPath
    if (!dirPath) return false
    return hasPendingSave(dirPath)
  }, [getActiveGraphSession, hasPendingSave])

  return { flushCurrentRoomSave, hasPendingCurrentRoomSave }
}
