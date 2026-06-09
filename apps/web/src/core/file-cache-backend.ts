import type { FileCacheHealth } from '../types/debug-runtime'

export async function getFileCacheHealth(): Promise<FileCacheHealth> {
  return {
    ready: false,
    provider: 'browser',
    paths: {
      rootDir: 'browser://object-url-cache',
    },
    directories: [],
  }
}
