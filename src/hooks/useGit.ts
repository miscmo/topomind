/**
 * useGit — React hook for Git operations
 */
import { useEffect, useMemo } from 'react'
import { GitBackend, GitCache, startGitCacheCleanup, stopGitCacheCleanup } from '../core/git-backend'

export type GitRepoStatus = 'clean' | 'dirty' | 'untracked' | 'error' | 'unknown'

let cleanupRefCount = 0

export function useGit() {
  // Use a ref counter instead of a boolean so that when multiple components
  // use useGit(), the cleanup timer is only stopped when ALL of them unmount.
  useEffect(() => {
    cleanupRefCount++
    if (cleanupRefCount === 1) {
      startGitCacheCleanup()
    }
    return () => {
      cleanupRefCount--
      if (cleanupRefCount === 0) {
        stopGitCacheCleanup()
      }
    }
  }, [])

  return useMemo(() => ({
    // Availability
    checkAvailable: () => GitBackend.checkAvailable(),

    // Repository
    init: (kbPath: string) => GitBackend.init(kbPath),
    status: (kbPath: string) => GitBackend.status(kbPath),
    statusBatch: (kbPaths: string[]) => GitBackend.statusBatch(kbPaths),
    isDirty: (kbPath: string) => GitBackend.isDirty(kbPath),
    commit: (kbPath: string, msg: string) => GitBackend.commit(kbPath, msg),

    // History
    diff: (kbPath: string, opts?: object) => GitBackend.diff(kbPath, opts),
    diffFiles: (kbPath: string, opts?: object) => GitBackend.diffFiles(kbPath, opts),
    log: (kbPath: string, opts?: object) => GitBackend.log(kbPath, opts),
    commitDiffFiles: (kbPath: string, hash: string) => GitBackend.commitDiffFiles(kbPath, hash),
    commitFileDiff: (kbPath: string, hash: string, fp: string) =>
      GitBackend.commitFileDiff(kbPath, hash, fp),

    // Remote
    remoteGet: (kbPath: string) => GitBackend.remoteGet(kbPath),
    remoteSet: (kbPath: string, url: string) => GitBackend.remoteSet(kbPath, url),
    fetch: (kbPath: string) => GitBackend.fetch(kbPath),
    push: (kbPath: string) => GitBackend.push(kbPath),
    pull: (kbPath: string) => GitBackend.pull(kbPath),

    // Conflicts
    conflictList: (kbPath: string) => GitBackend.conflictList(kbPath),
    conflictShow: (kbPath: string, fp: string) => GitBackend.conflictShow(kbPath, fp),
    conflictResolve: (kbPath: string, fp: string, content: string) =>
      GitBackend.conflictResolve(kbPath, fp, content),
    conflictComplete: (kbPath: string) => GitBackend.conflictComplete(kbPath),

    // Auth
    authSetToken: (kbPath: string, token: string) => GitBackend.authSetToken(kbPath, token),
    authGetSSHKey: () => GitBackend.authGetSSHKey(),
    authSetType: (kbPath: string, type: string) => GitBackend.authSetType(kbPath, type),
    authGetType: (kbPath: string) => GitBackend.authGetType(kbPath),

    // Cache helpers
    cacheMarkDirty: (kbPath: string) => GitCache.markDirty(kbPath),
    cacheMarkClean: (kbPath: string) => GitCache.markClean(kbPath),
    cacheGetStatus: (kbPath: string) => GitCache.getStatus(kbPath),
    cacheInvalidate: (kbPath: string) => GitCache.invalidate(kbPath),
    cacheIsDirty: (kbPath: string) => GitCache.isDirty(kbPath),
    onStatusChange: (fn: (kbPath: string, status: object | null) => void) =>
      GitCache.onStatusChange(fn),
  }), [])
}
