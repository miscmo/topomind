import { useMemo } from 'react'
import type { Store } from '../../core/storage'
import type { StorageApi } from './graphOperations'

export function useGraphStorageApi(storage: Store) {
  return useMemo(() => ({
    createCard: storage.createCard.bind(storage),
    deleteCard: storage.deleteCard.bind(storage),
    renameCard: storage.renameCard.bind(storage),
    saveGraphDebounced: storage.saveGraphDebounced.bind(storage) as StorageApi['saveGraphDebounced'],
    flushGraphSave: storage.flushGraphSave.bind(storage) as StorageApi['flushGraphSave'],
    readLayout: storage.readLayout.bind(storage) as StorageApi['readLayout'],
    writeLayout: storage.writeLayout.bind(storage) as StorageApi['writeLayout'],
  }), [storage])
}
