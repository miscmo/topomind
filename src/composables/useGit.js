/**
 * useGit composable
 * 封装 Git 操作，连接 GitBackend IPC 与 useGitStore 状态
 */
import { useGitStore } from '@/stores/git'
import { GitBackend, GitCache } from '@/core/git-backend.js'
import { unwrapGitResult } from '@/core/git-result.js'

export function useGit() {
  const gitStore = useGitStore()


  async function loadStatus(kbPath) {
    try {
      const statusRes = await GitBackend.status(kbPath)
      const status = unwrapGitResult(statusRes, { fallback: { state: 'uninit' } })
      const normalized = (status && typeof status === 'object') ? status : { state: 'uninit' }
      GitCache.setStatus(kbPath, normalized)
      gitStore.setDirtyCount(normalized.hasUncommitted ? (normalized.dirtyFiles || 1) : 0)
      return normalized
    } catch (e) {
      console.warn('[useGit] loadStatus 失败:', e)
      return null
    }
  }

  async function loadCommitFiles(kbPath) {
    try {
      const res = await GitBackend.diffFiles(kbPath)
      const files = unwrapGitResult(res, { dataKey: 'files', fallback: [] })
      gitStore.setCommitFiles(files)
      return files
    } catch (e) {
      console.warn('[useGit] loadCommitFiles 失败:', e)
      gitStore.setCommitFiles([])
      return []
    }
  }

  async function doCommit(kbPath, msg) {
    const res = await GitBackend.commit(kbPath, msg)
    unwrapGitResult(res, { requireOk: true, errorMessage: '提交失败' })
    GitCache.markClean(kbPath)
    gitStore.setDirtyCount(0)
    await loadStatus(kbPath)
  }

  async function doSync(kbPath, action) {
    gitStore.setSyncState(action === 'push' ? 'pushing' : 'pulling')
    try {
      if (action === 'push') {
        const res = await GitBackend.push(kbPath)
        unwrapGitResult(res, { requireOk: true, errorMessage: '推送失败' })
        gitStore.setSyncState('done', res?.message || '推送成功')
      } else {
        const res = await GitBackend.pull(kbPath)
        unwrapGitResult(res, { requireOk: true, errorMessage: '拉取失败' })
        gitStore.setSyncState('done', res?.message || '拉取成功')
        // 拉取后检查冲突
        const conflictsRes = await GitBackend.conflictList(kbPath)
        gitStore.setConflictFiles(unwrapGitResult(conflictsRes, { dataKey: 'files', fallback: [] }))
      }
    } catch (e) {
      gitStore.setSyncState('error', e.message || '操作失败', e?.code || '')
    }
  }

  async function loadLog(kbPath) {
    try {
      const res = await GitBackend.log(kbPath, { limit: 50 })
      gitStore.setLogEntries(unwrapGitResult(res, { dataKey: 'commits', fallback: [] }))
    } catch (e) {
      gitStore.setLogEntries([])
    }
  }

  async function loadRemote(kbPath) {
    try {
      const urlRes = await GitBackend.remoteGet(kbPath)
      const typeRes = await GitBackend.authGetType(kbPath)
      gitStore.setRemote(urlRes?.url || '', typeRes?.authType || 'token')
    } catch (e) { console.warn('[useGit] loadRemote 失败:', e) }
  }

  async function saveRemote(kbPath, url, token, authType) {
    try {
      unwrapGitResult(await GitBackend.remoteSet(kbPath, url), { requireOk: true, errorMessage: '保存远程地址失败' })
      unwrapGitResult(await GitBackend.authSetType(kbPath, authType), { requireOk: true, errorMessage: '保存认证方式失败' })
      if (authType === 'token' && token) {
        unwrapGitResult(await GitBackend.authSetToken(kbPath, token), { requireOk: true, errorMessage: '保存 Token 失败' })
      }
    } catch (e) {
      console.warn('[useGit] saveRemote 失败:', e)
    }
  }

  async function loadSSHKey() {
    try {
      const res = await GitBackend.authGetSSHKey()
      gitStore.setSSHKey(res?.publicKey || '')
    } catch (e) { console.warn('[useGit] loadSSHKey 失败:', e) }
  }

  async function loadConflicts(kbPath) {
    try {
      const res = await GitBackend.conflictList(kbPath)
      gitStore.setConflictFiles(unwrapGitResult(res, { dataKey: 'files', fallback: [] }))
    } catch (e) {
      gitStore.setConflictFiles([])
    }
  }

  async function showConflict(kbPath, file) {
    try {
      const res = await GitBackend.conflictShow(kbPath, file)
      gitStore.setConflictContent(file, res?.current || '')
    } catch (e) { console.warn('[useGit] showConflict 失败:', e) }
  }

  async function resolveConflict(kbPath, file, resolution) {
    try {
      unwrapGitResult(await GitBackend.conflictResolve(kbPath, file, resolution), { requireOk: true, errorMessage: '冲突解决失败' })
      // 从列表中移除已解决的文件
      gitStore.removeConflictFile(file)
    } catch (e) {
      console.warn('[useGit] resolveConflict 失败:', e)
    }
  }

  async function completeConflict(kbPath) {
    unwrapGitResult(await GitBackend.conflictComplete(kbPath), { requireOk: true, errorMessage: '完成冲突合并失败' })
    gitStore.setConflictFiles([])
    await loadStatus(kbPath)
  }

  // 批量获取多个知识库的 Git 状态（首页用）
  async function statusBatch(kbPaths) {
    try {
      const res = await GitBackend.statusBatch(kbPaths)
      return (res && typeof res === 'object') ? res : {}
    } catch (e) {
      return {}
    }
  }

  return {
    loadStatus,
    loadCommitFiles,
    doCommit,
    doSync,
    loadLog,
    loadRemote,
    saveRemote,
    loadSSHKey,
    loadConflicts,
    showConflict,
    resolveConflict,
    completeConflict,
    statusBatch,
  }
}
