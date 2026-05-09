import { fileStorageAdapter } from './engines/file'
import type { StorageAdapter } from './adapter'

export type StorageEngine = 'fs'

export function createStorageAdapter(engine: StorageEngine = 'fs'): StorageAdapter {
  switch (engine) {
    case 'fs':
    default:
      return fileStorageAdapter
  }
}
