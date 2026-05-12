import { createContext, useContext, useMemo } from 'react'
import { createFileStorageBackend } from './file'
import { createStore, type Store as StoreType, type StorageBackend } from './service'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const StorageContext = createContext<StoreType | null>(null)

export interface StorageProviderProps {
  children: React.ReactNode
  backend?: StorageBackend
}

export function StorageProvider({ children, backend }: StorageProviderProps) {
  const store = useMemo(() => createStore(backend ?? createFileStorageBackend(() => useWorkspaceStore.getState().currentWorkDir)), [backend])
  return <StorageContext.Provider value={store}>{children}</StorageContext.Provider>
}

export function useStorage() {
  const store = useContext(StorageContext)
  if (!store) throw new Error('useStorage must be used within StorageProvider')
  return store
}