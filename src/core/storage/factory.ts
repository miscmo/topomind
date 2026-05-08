import { fileStorageAdapter, type StorageAdapter } from './engines/file'

export type StorageEngine = 'fs'

export function createStorageAdapter(engine: StorageEngine = 'fs'): StorageAdapter {
  switch (engine) {
    case 'fs':
    default:
      return fileStorageAdapter
  }
}
