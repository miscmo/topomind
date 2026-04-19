/**
 * useGit composable
 * 封装 Git 操作，连接 GitBackend IPC 与 useGitStore 状态
 */
import { useGitStore } from '@/stores/git'
import { GitBackend, GitCache } from '@/core/git-backend.js'
import { unwrapGitResult } from '@/core/git-result.js'
import { logger } from '@/core/logger.js'

/**
 * 提供 Git 相关的统一操作入口，负责连接 `GitBackend` 与 `gitStore`。
 *
 * @returns {object} Git 操作方法集合
 */
export function useGit() {
  const gitStore = useGitStore()

  /**
   * 加载单个知识库的 Git 状态，并同步更新缓存与 store。
   *
   * @param {string} kbPath 知识库相对路径
   * @returns {Promise<object|null>} 标准化后的状态对象
   */
  async function loadStatus(kbPath) {
    try {
      const statusRes = await GitBackend.status(kbPath)
      const status = unwrapGitResult(statusRes, { fallback: { state: 'uninit' } })
      const normalized = (status && typeof status === 'object') ? status : { state: 'uninit' }
      GitCache.setStatus(kbPath, normalized)
      gitStore.setDirtyCount(normalized.hasUncommitted ? (normalized.dirtyFiles || 1) : 0)
      return normalized
    } catch (e) {
      logger.catch('useGit', 'loadStatus', e)
      return null
    }
  }

  /**
   * 加载当前工作区中待提交文件列表，并写入 store。
   *
   * @param {string} kbPath 知识库相对路径
   * @returns {Promise<Array<object>>} 待提交文件列表
   */
  async function loadCommitFiles(kbPath) {
    try {
      const res = await GitBackend.diffFiles(kbPath)
      const files = unwrapGitResult(res, { dataKey: 'files', fallback: [] })
      gitStore.setCommitFiles(files)
      return files
    } catch (e) {
      logger.catch('useGit', 'loadCommitFiles', e)
      gitStore.setCommitFiles([])
      return []
    }
  }

  /**
   * 提交当前知识库中的改动，并在完成后刷新状态。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {string} msg 提交信息
   * @returns {Promise<void>} 提交完成结果
   */
  async function doCommit(kbPath, msg) {
    try {
      const res = await GitBackend.commit(kbPath, msg)
      unwrapGitResult(res, { requireOk: true, errorMessage: '提交失败' })
      GitCache.markClean(kbPath)
      gitStore.setDirtyCount(0)
      await loadStatus(kbPath)
    } catch (e) {
      logger.catch('useGit', 'doCommit', e)
      throw e
    }
  }

  /**
   * 执行推送或拉取同步，并将结果同步到 store。
   * 拉取成功后会额外刷新冲突文件列表。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {'push'|'pull'} action 同步动作
   * @returns {Promise<void>} 同步结果
   */
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
      logger.catch('useGit', 'doSync', e)
    }
  }

  /**
   * 加载知识库提交历史并写入 store。
   *
   * @param {string} kbPath 知识库相对路径
   * @returns {Promise<void>} 加载结果
   */
  async function loadLog(kbPath) {
    try {
      const res = await GitBackend.log(kbPath, { limit: 50 })
      gitStore.setLogEntries(unwrapGitResult(res, { dataKey: 'commits', fallback: [] }))
    } catch (e) {
      gitStore.setLogEntries([])
      logger.catch('useGit', '加载提交日志', e)
    }
  }

  /**
   * 加载远程仓库地址和认证方式，并同步到 store。
   *
   * @param {string} kbPath 知识库相对路径
   * @returns {Promise<void>} 加载结果
   */
  async function loadRemote(kbPath) {
    try {
      const urlRes = await GitBackend.remoteGet(kbPath)
      const typeRes = await GitBackend.authGetType(kbPath)
      gitStore.setRemote(urlRes?.url || '', typeRes?.authType || 'token')
    } catch (e) { logger.catch('useGit', 'loadRemote 失败', e) }
  }

  /**
   * 校验 Git 远程仓库地址格式，支持 HTTPS 与 SSH 两种常见形式。
   *
   * @param {string} url 远程仓库地址
   * @returns {boolean} 地址是否合法
   */
  function isValidGitRemoteUrl(url) {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  // HTTPS URL
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    try {
      const parsed = new URL(trimmed)
      return parsed.hostname.length > 0 && parsed.pathname.length > 1
    } catch { return false }
  }
  // SSH URL: git@host:path
  if (/^git@[a-z0-9.-]+:.+$/i.test(trimmed)) return true
  // SSH 协议: ssh://host/path
  if (/^ssh:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      return parsed.hostname.length > 0
    } catch { return false }
  }
  return false
}

  /**
   * 保存远程仓库地址、认证方式以及可选的访问 Token。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {string} url 远程仓库地址
   * @param {string} token 访问 Token
   * @param {string} authType 认证方式
   * @returns {Promise<void>} 保存结果
   */
  async function saveRemote(kbPath, url, token, authType) {
    if (url && !isValidGitRemoteUrl(url)) {
      throw new Error('无效的远程仓库 URL，请输入 https://... 或 git@host:path 格式的地址')
    }
    try {
      unwrapGitResult(await GitBackend.remoteSet(kbPath, url), { requireOk: true, errorMessage: '保存远程地址失败' })
      unwrapGitResult(await GitBackend.authSetType(kbPath, authType), { requireOk: true, errorMessage: '保存认证方式失败' })
      if (authType === 'token' && token) {
        unwrapGitResult(await GitBackend.authSetToken(kbPath, token), { requireOk: true, errorMessage: '保存 Token 失败' })
      }
    } catch (e) {
      logger.catch('useGit', 'saveRemote 失败', e)
    }
  }

  /**
   * 加载当前应用维护的 SSH 公钥，并写入 store。
   *
   * @returns {Promise<void>} 加载结果
   */
  async function loadSSHKey() {
    try {
      const res = await GitBackend.authGetSSHKey()
      gitStore.setSSHKey(res?.publicKey || '')
    } catch (e) { logger.catch('useGit', 'loadSSHKey 失败', e) }
  }

  /**
   * 加载当前知识库的冲突文件列表。
   *
   * @param {string} kbPath 知识库相对路径
   * @returns {Promise<void>} 加载结果
   */
  async function loadConflicts(kbPath) {
    try {
      const res = await GitBackend.conflictList(kbPath)
      gitStore.setConflictFiles(unwrapGitResult(res, { dataKey: 'files', fallback: [] }))
    } catch (e) {
      gitStore.setConflictFiles([])
    }
  }

  /**
   * 加载指定冲突文件的当前内容，并写入 store 供界面展示。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {string} file 冲突文件路径
   * @returns {Promise<void>} 加载结果
   */
  async function showConflict(kbPath, file) {
    try {
      const res = await GitBackend.conflictShow(kbPath, file)
      gitStore.setConflictContent(file, res?.current || '')
    } catch (e) { logger.catch('useGit', 'showConflict 失败', e) }
  }

  /**
   * 提交某个冲突文件的解决结果，并从冲突列表中移除。
   *
   * @param {string} kbPath 知识库相对路径
   * @param {string} file 冲突文件路径
   * @param {string} resolution 解决后的内容
   * @returns {Promise<void>} 处理结果
   */
  async function resolveConflict(kbPath, file, resolution) {
    try {
      unwrapGitResult(await GitBackend.conflictResolve(kbPath, file, resolution), { requireOk: true, errorMessage: '冲突解决失败' })
      // 从列表中移除已解决的文件
      gitStore.removeConflictFile(file)
    } catch (e) {
      logger.catch('useGit', 'resolveConflict 失败', e)
    }
  }

  /**
   * 完成冲突合并流程，清空冲突列表并刷新仓库状态。
   *
   * @param {string} kbPath 知识库相对路径
   * @returns {Promise<void>} 处理结果
   */
  async function completeConflict(kbPath) {
    try {
      unwrapGitResult(await GitBackend.conflictComplete(kbPath), { requireOk: true, errorMessage: '完成冲突合并失败' })
      gitStore.setConflictFiles([])
      await loadStatus(kbPath)
    } catch (e) {
      logger.catch('useGit', 'completeConflict 失败', e)
    }
  }

  /**
   * 批量获取多个知识库的 Git 状态，主要用于首页列表展示。
   *
   * @param {string[]} kbPaths 知识库路径列表
   * @returns {Promise<Record<string, object>>} 状态映射表
   */
  async function statusBatch(kbPaths) {
    try {
      const res = await GitBackend.statusBatch(kbPaths)
      return (res && typeof res === 'object') ? res : {}
    } catch (e) {
      logger.catch('useGit', 'statusBatch 失败', e)
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
