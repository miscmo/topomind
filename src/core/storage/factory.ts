import { fileStorageAdapter } from './engines/file'
import { remoteStorageAdapter } from './engines/remote'
import { sqliteStorageAdapter } from './engines/sqlite'
import type { StorageAdapter } from './adapter'

export type StorageEngine = 'fs' | 'sqlite' | 'remote'

export function createStorageAdapter(engine: StorageEngine = 'fs'): StorageAdapter {
  switch (engine) {
    case 'sqlite':
      return sqliteStorageAdapter
    case 'remote':
      return remoteStorageAdapter
    case 'fs':
    default:
      return fileStorageAdapter
  }
}
