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
      gitStore.commitFiles = files
      return files
    } catch (e) {
      console.warn('[useGit] loadCommitFiles 失败:', e)
      gitStore.commitFiles = []
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
    gitStore.syncState = action === 'push' ? 'pushing' : 'pulling'
    gitStore.syncMessage = ''
    gitStore.syncCode = ''
    try {
      if (action === 'push') {
        const res = await GitBackend.push(kbPath)
        unwrapGitResult(res, { requireOk: true, errorMessage: '推送失败' })
        gitStore.syncMessage = res?.message || '推送成功'
      } else {
        const res = await GitBackend.pull(kbPath)
        unwrapGitResult(res, { requireOk: true, errorMessage: '拉取失败' })
        gitStore.syncMessage = res?.message || '拉取成功'
        // 拉取后检查冲突
        const conflictsRes = await GitBackend.conflictList(kbPath)
        gitStore.conflictFiles = unwrapGitResult(conflictsRes, { dataKey: 'files', fallback: [] })
      }
      gitStore.syncState = 'done'
    } catch (e) {
      gitStore.syncState = 'error'
      gitStore.syncCode = e?.code || ''
      gitStore.syncMessage = e.message || '操作失败'
    }
  }

  async function loadLog(kbPath) {
    try {
      const res = await GitBackend.log(kbPath, { limit: 50 })
      gitStore.logEntries = unwrapGitResult(res, { dataKey: 'commits', fallback: [] })
    } catch (e) {
      gitStore.logEntries = []
    }
  }

  async function loadRemote(kbPath) {
    try {
      const urlRes = await GitBackend.remoteGet(kbPath)
      gitStore.remoteUrl = urlRes?.url || ''
      const typeRes = await GitBackend.authGetType(kbPath)
      gitStore.authType = typeRes?.authType || 'token'
    } catch (e) { console.warn('[useGit] loadRemote 失败:', e) }
  }

  async function saveRemote(kbPath, url, token, authType) {
    unwrapGitResult(await GitBackend.remoteSet(kbPath, url), { requireOk: true, errorMessage: '保存远程地址失败' })
    unwrapGitResult(await GitBackend.authSetType(kbPath, authType), { requireOk: true, errorMessage: '保存认证方式失败' })
    if (authType === 'token' && token) {
      unwrapGitResult(await GitBackend.authSetToken(kbPath, token), { requireOk: true, errorMessage: '保存 Token 失败' })
    }
  }

  async function loadSSHKey() {
    try {
      const res = await GitBackend.authGetSSHKey()
      gitStore.sshPublicKey = res?.publicKey || ''
    } catch (e) { console.warn('[useGit] loadSSHKey 失败:', e) }
  }

  async function loadConflicts(kbPath) {
    try {
      const res = await GitBackend.conflictList(kbPath)
      gitStore.conflictFiles = unwrapGitResult(res, { dataKey: 'files', fallback: [] })
    } catch (e) {
      gitStore.conflictFiles = []
    }
  }

  async function showConflict(kbPath, file) {
    try {
      const res = await GitBackend.conflictShow(kbPath, file)
      gitStore.currentConflictFile = file
      gitStore.conflictContent = res?.current || ''
    } catch (e) { console.warn('[useGit] showConflict 失败:', e) }
  }

  async function resolveConflict(kbPath, file, resolution) {
    unwrapGitResult(await GitBackend.conflictResolve(kbPath, file, resolution), { requireOk: true, errorMessage: '冲突解决失败' })
    // 从列表中移除已解决的文件
    const idx = gitStore.conflictFiles.indexOf(file)
    if (idx !== -1) gitStore.conflictFiles.splice(idx, 1)
    if (gitStore.currentConflictFile === file) {
      gitStore.currentConflictFile = null
      gitStore.conflictContent = ''
    }
  }

  async function completeConflict(kbPath) {
    unwrapGitResult(await GitBackend.conflictComplete(kbPath), { requireOk: true, errorMessage: '完成冲突合并失败' })
    gitStore.conflictFiles = []
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
