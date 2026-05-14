import { useCallback } from 'react'
import type { GraphSession } from '../../stores/tabStore'

interface UseGraphPersistenceOptions {
  getActiveGraphSession: () => GraphSession
  saveNow: (dirPath: string) => Promise<void>
}

export function useGraphPersistence({ getActiveGraphSession, saveNow }: UseGraphPersistenceOptions) {
  const flushCurrentRoomSave = useCallback(async () => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath || graphSession.kbPath || ''
    if (!dirPath) return
    await saveNow(dirPath)
  }, [getActiveGraphSession, saveNow])

  return { flushCurrentRoomSave }
}
