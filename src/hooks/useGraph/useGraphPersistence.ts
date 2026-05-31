import { useCallback } from 'react'
import type { GraphSession } from '../../stores/tabs/tabStore'

interface UseGraphPersistenceOptions {
  getActiveGraphSession: () => GraphSession
  saveNow: (dirPath: string) => Promise<void>
}

export function useGraphPersistence(options: UseGraphPersistenceOptions) {
  const { getActiveGraphSession, saveNow } = options

  const flushCurrentRoomSave = useCallback(async () => {
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) {
      await saveNow(dirPath)
    }
  }, [getActiveGraphSession, saveNow])

  return { flushCurrentRoomSave }
}
