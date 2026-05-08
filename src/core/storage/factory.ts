import { fileStorageAdapter } from './engines/file'
import type { StorageAdapterExtended } from './adapter'

export type StorageEngine = 'fs'

export function createStorageAdapter(engine: StorageEngine = 'fs'): StorageAdapterExtended {
  switch (engine) {
    case 'fs':
    default:
      return fileStorageAdapter
  }
}
