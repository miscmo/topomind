import { useCallback, useMemo } from 'react'
import type { GraphMeta } from '../../core/storage'
import type { StorageApi } from './graphOperations'

export interface GraphStorageAdapter {
  createCard: StorageApi['createCard']
  deleteCard: StorageApi['deleteCard']
  renameCard: StorageApi['renameCard']
  scheduleGraphSave: StorageApi['scheduleGraphSave']
  flushGraphSave: StorageApi['flushGraphSave']
  hasPendingGraphSave: StorageApi['hasPendingGraphSave']
  readLayout: StorageApi['readLayout']
  writeLayout: StorageApi['writeLayout']
}

export function useGraphStorageApi(storage: GraphStorageAdapter): StorageApi {
  const createCard = useCallback(
    async (parentRef: string, cardName: string, cardId?: string) =>
      storage.createCard(parentRef, cardName, cardId),
    [storage]
  )
  const deleteCard = useCallback(async (cardPath: string) => storage.deleteCard(cardPath), [storage])
  const renameCard = useCallback(
    async (cardPath: string, newName: string) => storage.renameCard(cardPath, newName),
    [storage]
  )
  const scheduleGraphSave = useCallback(
    async (roomRef: string, buildMeta: () => GraphMeta, onSaved: (() => void) | undefined) => {
      await storage.scheduleGraphSave(roomRef, buildMeta, onSaved)
    },
    [storage]
  )
  const flushGraphSave = useCallback(
    async (roomRef: string, buildMeta: () => GraphMeta, onFlush: (() => void) | undefined) => {
      await storage.flushGraphSave(roomRef, buildMeta, onFlush)
    },
    [storage]
  )
  const hasPendingGraphSave = useCallback(
    (roomRef: string) => storage.hasPendingGraphSave(roomRef),
    [storage]
  )
  const readLayout = useCallback(async (roomRef: string) => storage.readLayout(roomRef), [storage])
  const writeLayout = useCallback(
    async (roomRef: string, meta: GraphMeta) => storage.writeLayout(roomRef, meta),
    [storage]
  )

  return useMemo(
    () => ({
      createCard,
      deleteCard,
      renameCard,
      scheduleGraphSave,
      flushGraphSave,
      hasPendingGraphSave,
      readLayout,
      writeLayout,
    }),
    [createCard, deleteCard, renameCard, scheduleGraphSave, flushGraphSave, hasPendingGraphSave, readLayout, writeLayout]
  )
}
