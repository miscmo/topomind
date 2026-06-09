import { useCallback } from 'react'
import type { GraphSession } from '../../stores/tabs/tabStore'

interface UseGraphPersistenceOptions {
  getActiveGraphSession: () => GraphSession
  hasPendingSave: (roomRef: string) => boolean
  saveNow: (roomRef: string) => Promise<void>
}

export function useGraphPersistence(options: UseGraphPersistenceOptions) {
  const { getActiveGraphSession, hasPendingSave, saveNow } = options

  const flushCurrentRoomSave = useCallback(async () => {
    const session = getActiveGraphSession()
    const roomRef = session.roomRef
    if (roomRef) {
      await saveNow(roomRef)
    }
  }, [getActiveGraphSession, saveNow])

  const hasPendingCurrentRoomSave = useCallback(() => {
    const session = getActiveGraphSession()
    const roomRef = session.roomRef
    if (!roomRef) {
      return false
    }
    return hasPendingSave(roomRef)
  }, [getActiveGraphSession, hasPendingSave])

  return { flushCurrentRoomSave, hasPendingCurrentRoomSave }
}
