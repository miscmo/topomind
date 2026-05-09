import { createContext, useContext, useMemo } from 'react'
import { createStorageAdapter } from './factory'
import { createStore, type Store as StoreType } from './service'
import type { StorageAdapter } from './adapter'
import { useAppStore } from '../../stores/appStore'

const StorageContext = createContext<StoreType | null>(null)

export interface StorageProviderProps {
  children: React.ReactNode
  adapter?: StorageAdapter
}

export function StorageProvider({ children, adapter }: StorageProviderProps) {
  const store = useMemo(() => createStore(adapter ?? createStorageAdapter(() => useAppStore.getState().currentWorkDir)), [adapter])
  return <StorageContext.Provider value={store}>{children}</StorageContext.Provider>
}

export function useStorage() {
  const store = useContext(StorageContext)
  if (!store) throw new Error('useStorage must be used within StorageProvider')
  return store
}