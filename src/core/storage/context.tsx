import { createContext, useContext, useMemo } from 'react'
import { createStorageAdapter, type StorageEngine } from './factory'
import { createStore, type Store as StoreType } from './service'
import type { StorageAdapter } from './adapter'

const StorageContext = createContext<StoreType | null>(null)

export interface StorageProviderProps {
  children: React.ReactNode
  engine?: StorageEngine
  adapter?: StorageAdapter
}

export function StorageProvider({ children, engine = 'fs', adapter }: StorageProviderProps) {
  const store = useMemo(() => createStore(adapter ?? createStorageAdapter(engine)), [adapter, engine])
  return <StorageContext.Provider value={store}>{children}</StorageContext.Provider>
}

export function useStorage() {
  const store = useContext(StorageContext)
  if (!store) throw new Error('useStorage must be used within StorageProvider')
  return store
}
