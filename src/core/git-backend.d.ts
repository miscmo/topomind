// GitBackend - Git IPC Wrapper
export interface GitBackend {
  checkAvailable: () => Promise<unknown>
  init: (kbPath: string) => Promise<unknown>
  status: (kbPath: string) => Promise<unknown>
  statusBatch: (kbPaths: string[]) => Promise<unknown>
  isDirty: (kbPath: string) => Promise<unknown>
  commit: (kbPath: string, msg: string) => Promise<unknown>
  diff: (kbPath: string, opts?: object) => Promise<unknown>
  diffFiles: (kbPath: string, opts?: object) => Promise<unknown>
  log: (kbPath: string, opts?: object) => Promise<unknown>
  commitDiffFiles: (kbPath: string, hash: string) => Promise<unknown>
  commitFileDiff: (kbPath: string, hash: string, fp: string) => Promise<unknown>
  remoteGet: (kbPath: string) => Promise<unknown>
  remoteSet: (kbPath: string, url: string) => Promise<unknown>
  fetch: (kbPath: string) => Promise<unknown>
  push: (kbPath: string) => Promise<unknown>
  pull: (kbPath: string) => Promise<unknown>
  conflictList: (kbPath: string) => Promise<unknown>
  conflictShow: (kbPath: string, fp: string) => Promise<unknown>
  conflictResolve: (kbPath: string, fp: string, content: string) => Promise<unknown>
  conflictComplete: (kbPath: string) => Promise<unknown>
  authSetToken: (kbPath: string, token: string) => Promise<unknown>
  authGetSSHKey: () => Promise<unknown>
  authSetType: (kbPath: string, type: string) => Promise<unknown>
  authGetType: (kbPath: string) => Promise<unknown>
}

// GitCache - In-memory status cache
export interface GitCacheStatus {
  state: string
  hasUncommitted: boolean
  [key: string]: unknown
}

export interface GitCache {
  markDirty: (kbPath: string) => void
  markClean: (kbPath: string) => void
  setStatus: (kbPath: string, status: GitCacheStatus) => void
  getStatus: (kbPath: string) => GitCacheStatus | null
  invalidate: (kbPath: string) => void
  isDirty: (kbPath: string) => boolean
  onStatusChange: (fn: (kbPath: string, status: GitCacheStatus | null) => void) => () => void
}

export const GitBackend: GitBackend
export const GitCache: GitCache
export function startGitCacheCleanup(): void
export function stopGitCacheCleanup(): void
