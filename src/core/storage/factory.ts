import { createFileStorageAdapter } from './engines/file'
import type { StorageAdapter } from './adapter'

export type StorageEngine = 'fs'

export function createStorageAdapter(engine: StorageEngine = 'fs', getRootDir: () => string | null = () => null): StorageAdapter {
  switch (engine) {
    case 'fs':
    default:
      return createFileStorageAdapter(getRootDir)
  }
}
