import { createFileStorageAdapter } from './engines/file'
import type { StorageAdapter } from './adapter'

export function createStorageAdapter(getRootDir: () => string | null): StorageAdapter {
  return createFileStorageAdapter(getRootDir)
}
