/**
 * useGit composable
 * 封装 Git 操作，连接 GitBackend IPC 与 useGitStore 状态
 */
import { useGitStore } from '@/stores/git'
import { GitBackend, GitCache } from '@/core/git-backend.js'

export function useGit() {
  const gitStore = useGitStore()

  async function loadStatus(kbPath) {
    try {
      const status = await GitBackend.status(kbPath)
      GitCache.setStatus(kbPath, status)
      gitStore.setDirtyCount(status.hasUncommitted ? (status.files?.length || 1) : 0)
      return status
    } catch (e) {
      console.warn('[useGit] loadStatus 失败:', e)
      return null
    }
  }

  async function loadCommitFiles(kbPath) {
    try {
      const files = await GitBackend.diffFiles(kbPath)
      gitStore.commitFiles = files || []
      return files
    } catch (e) {
      console.warn('[useGit] loadCommitFiles 失败:', e)
      gitStore.commitFiles = []
      return []
    }
  }

  async function doCommit(kbPath, msg) {
    await GitBackend.commit(kbPath, msg)
    GitCache.markClean(kbPath)
    gitStore.setDirtyCount(0)
    await loadStatus(kbPath)
  }

  async function doSync(kbPath, action) {
    gitStore.syncState = action === 'push' ? 'pushing' : 'pulling'
    gitStore.syncMessage = ''
    try {
      if (action === 'push') {
        const res = await GitBackend.push(kbPath)
        gitStore.syncMessage = res?.message || '推送成功'
      } else {
        const res = await GitBackend.pull(kbPath)
        gitStore.syncMessage = res?.message || '拉取成功'
        // 拉取后检查冲突
        const conflicts = await GitBackend.conflictList(kbPath)
        gitStore.conflictFiles = conflicts || []
      }
      gitStore.syncState = 'done'
    } catch (e) {
      gitStore.syncState = 'error'
      gitStore.syncMessage = e.message || '操作失败'
    }
  }

  async function loadLog(kbPath) {
    try {
      const log = await GitBackend.log(kbPath, { limit: 50 })
      gitStore.logEntries = log || []
    } catch (e) {
      gitStore.logEntries = []
    }
  }

  async function loadRemote(kbPath) {
    try {
      const url = await GitBackend.remoteGet(kbPath)
      gitStore.remoteUrl = url || ''
      const type = await GitBackend.authGetType(kbPath)
      gitStore.authType = type || 'token'
    } catch (e) {}
  }

  async function saveRemote(kbPath, url, token, authType) {
    await GitBackend.remoteSet(kbPath, url)
    await GitBackend.authSetType(kbPath, authType)
    if (authType === 'token' && token) {
      await GitBackend.authSetToken(kbPath, token)
    }
  }

  async function loadSSHKey() {
    try {
      const key = await GitBackend.authGetSSHKey()
      gitStore.sshPublicKey = key || ''
    } catch (e) {}
  }

  async function loadConflicts(kbPath) {
    try {
      const files = await GitBackend.conflictList(kbPath)
      gitStore.conflictFiles = files || []
    } catch (e) {
      gitStore.conflictFiles = []
    }
  }

  async function showConflict(kbPath, file) {
    try {
      const content = await GitBackend.conflictShow(kbPath, file)
      gitStore.currentConflictFile = file
      gitStore.conflictContent = content || ''
    } catch (e) {}
  }

  async function resolveConflict(kbPath, file, resolution) {
    await GitBackend.conflictResolve(kbPath, file, resolution)
    // 从列表中移除已解决的文件
    const idx = gitStore.conflictFiles.indexOf(file)
    if (idx !== -1) gitStore.conflictFiles.splice(idx, 1)
    if (gitStore.currentConflictFile === file) {
      gitStore.currentConflictFile = null
      gitStore.conflictContent = ''
    }
  }

  async function completeConflict(kbPath) {
    await GitBackend.conflictComplete(kbPath)
    gitStore.conflictFiles = []
    await loadStatus(kbPath)
  }

  // 批量获取多个知识库的 Git 状态（首页用）
  async function statusBatch(kbPaths) {
    try {
      return await GitBackend.statusBatch(kbPaths)
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
