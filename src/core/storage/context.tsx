import { createContext, useContext, useMemo } from 'react'
import { createStorageAdapter, type StorageEngine } from './factory'
import { createStore, type Store as StoreType } from './service'
import type { StorageAdapterExtended } from './adapter'
import type { PlatformService } from '../platform'

const StorageContext = createContext<StoreType | null>(null)

export interface StorageProviderProps {
  children: React.ReactNode
  engine?: StorageEngine
  adapter?: StorageAdapterExtended
  platform?: PlatformService
}

export function StorageProvider({ children, engine = 'fs', adapter, platform }: StorageProviderProps) {
  const store = useMemo(() => createStore(adapter ?? createStorageAdapter(engine), platform), [adapter, engine, platform])
  return <StorageContext.Provider value={store}>{children}</StorageContext.Provider>
}

export function useStorage() {
  const store = useContext(StorageContext)
  if (!store) throw new Error('useStorage must be used within StorageProvider')
  return store
}