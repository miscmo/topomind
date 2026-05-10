import { createContext, useContext, useMemo } from 'react'
import { createFileStorageBackend } from './file'
import { createStore, type Store as StoreType } from './service'
import type { StorageBackend } from './types'
import { useAppStore } from '../../stores/appStore'

const StorageContext = createContext<StoreType | null>(null)

export interface StorageProviderProps {
  children: React.ReactNode
  backend?: StorageBackend
}

export function StorageProvider({ children, backend }: StorageProviderProps) {
  const store = useMemo(() => createStore(backend ?? createFileStorageBackend(() => useAppStore.getState().currentWorkDir)), [backend])
  return <StorageContext.Provider value={store}>{children}</StorageContext.Provider>
}

export function useStorage() {
  const store = useContext(StorageContext)
  if (!store) throw new Error('useStorage must be used within StorageProvider')
  return store
}