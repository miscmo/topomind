import { useCallback, useMemo } from 'react'
import type { Store, GraphMeta } from '../../core/storage'
import type { StorageApi } from './graphOperations'

export function useGraphStorageApi(storage: Store): StorageApi {
  const saveGraphDebounced = useCallback(
    async (dirPath: string, buildMeta: () => GraphMeta, onSaved: (() => void) | undefined) => {
      await storage.saveGraphDebounced(dirPath, buildMeta, onSaved)
    },
    [storage]
  )
  const hasPendingGraphSave = useCallback(
    (dirPath: string) => storage.hasPendingGraphSave(dirPath),
    [storage]
  )
  // label 会写进 .trash.json，供回收站显示原节点名；过去被这一层吞掉。
  const deleteCard = useCallback(
    async (cardPath: string, label?: string) => storage.deleteCard(cardPath, label),
    [storage],
  )
  const renameCard = useCallback(
    async (cardPath: string, newName: string) => storage.renameCard(cardPath, newName),
    [storage]
  )
  const flushGraphSave = useCallback(
    async (dirPath: string, buildMeta: () => GraphMeta, onFlush: (() => void) | undefined) => {
      await storage.flushGraphSave(dirPath, buildMeta, onFlush)
    },
    [storage]
  )
  const readLayout = useCallback(async (dirPath: string) => storage.readLayout(dirPath), [storage])
  const writeLayout = useCallback(
    async (dirPath: string, meta: GraphMeta) => storage.writeLayout(dirPath, meta),
    [storage]
  )

  return useMemo(
    () => ({
      saveGraphDebounced,
      hasPendingGraphSave,
      deleteCard,
      renameCard,
      flushGraphSave,
      readLayout,
      writeLayout,
    }),
    [saveGraphDebounced, hasPendingGraphSave, deleteCard, renameCard, flushGraphSave, readLayout, writeLayout]
  )
}
