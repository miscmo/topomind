/**
 * GitPanel — collapsible bottom panel for Git operations
 * Shows status, allows commit/push/pull, and displays remote info
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { useGitStore } from '../../stores/gitStore'
import { useRoomStore } from '../../stores/roomStore'
import { useAppStore } from '../../stores/appStore'
import { useGit } from '../../hooks/useGit'
import { logAction } from '../../core/log-backend'
import { logger } from '../../core/logger'
import styles from './GitPanel.module.css'

interface DiffStat {
  modified: number
  untracked: number
  deleted: number
  insertions: number
  deletions: number
}

interface DiffFile {
  file: string
  status: string
}

export default memo(function GitPanel() {
  const showGitPanel = useAppStore((s) => s.showGitPanel)
  const currentKBPath = useRoomStore((s) => s.currentKBPath)
  const git = useGit()

  const status = useGitStore((s) => s.status)
  const setStatus = useGitStore((s) => s.setStatus)

  const [commitMsg, setCommitMsg] = useState('')
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([])
  const [diffStat, setDiffStat] = useState<DiffStat | null>(null)
  const [loading, setLoading] = useState(false)
  const [commitLoading, setCommitLoading] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [showCommitBox, setShowCommitBox] = useState(false)

  // Load git status when panel opens
  useEffect(() => {
    if (!showGitPanel || !currentKBPath) return

    const loadStatus = async () => {
      try {
        const [statusResult, diffResult, remoteResult] = await Promise.all([
          git.status(currentKBPath),
          git.diffFiles(currentKBPath, {}),
          git.remoteGet(currentKBPath),
        ])

        // Parse status result
        const statusData = statusResult as Record<string, unknown>
        if (statusData) {
          setStatus({
            initialized: true,
            clean: !statusData.modified && !statusData.untracked,
            untrackedCount: (statusData.untracked as number[])?.length ?? 0,
            modifiedCount: (statusData.modified as string[])?.length ?? 0,
            hasRemote: !!(statusData.remote),
            remoteUrl: (statusData.remote as string) ?? '',
          })
          setRemoteUrl((statusData.remote as string) ?? '')
        }

        // Parse diff files
        const diffData = (diffResult as DiffFile[]) ?? []
        setDiffFiles(diffData)
        setDiffStat({
          modified: diffData.filter((f) => f.status === 'M' || f.status === 'D').length,
          untracked: diffData.filter((f) => f.status === 'U').length,
          deleted: diffData.filter((f) => f.status === 'D').length,
          insertions: 0,
          deletions: 0,
        })
      } catch (e) {
        logger.catch('GitPanel', 'load git status', e)
      }
    }

    loadStatus()
  }, [showGitPanel, currentKBPath, git])

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || !currentKBPath) return
    setCommitLoading(true)
    try {
      await git.commit(currentKBPath, commitMsg.trim())
      logAction('Git:提交', 'GitPanel', { kbPath: currentKBPath, message: commitMsg.trim() })
      setCommitMsg('')
      setShowCommitBox(false)
      // Reload status
      const newStatus = await git.status(currentKBPath)
      const statusData = newStatus as Record<string, unknown>
      if (statusData) {
        setStatus({
          initialized: true,
          clean: true,
          untrackedCount: 0,
          modifiedCount: 0,
        })
      }
    } catch (e) {
      logger.catch('GitPanel', 'commit', e)
    } finally {
      setCommitLoading(false)
    }
  }, [commitMsg, currentKBPath, git, setStatus])

  const handlePush = useCallback(async () => {
    if (!currentKBPath) return
    setLoading(true)
    try {
      await git.push(currentKBPath)
      logAction('Git:推送', 'GitPanel', { kbPath: currentKBPath })
    } catch (e) {
      logger.catch('GitPanel', 'push', e)
    } finally {
      setLoading(false)
    }
  }, [currentKBPath, git])

  const handlePull = useCallback(async () => {
    if (!currentKBPath) return
    setLoading(true)
    try {
      await git.pull(currentKBPath)
      logAction('Git:拉取', 'GitPanel', { kbPath: currentKBPath })
    } catch (e) {
      logger.catch('GitPanel', 'pull', e)
    } finally {
      setLoading(false)
    }
  }, [currentKBPath, git])

  const handleFetch = useCallback(async () => {
    if (!currentKBPath) return
    setLoading(true)
    try {
      await git.fetch(currentKBPath)
      logAction('Git:获取', 'GitPanel', { kbPath: currentKBPath })
    } catch (e) {
      logger.catch('GitPanel', 'fetch', e)
    } finally {
      setLoading(false)
    }
  }, [currentKBPath, git])

  if (!showGitPanel) return null

  const hasChanges = diffFiles.length > 0
  const isWorking = loading || commitLoading

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Git</span>
          {/* Status badges */}
          {diffStat && (
            <div className={styles.badges}>
              {diffStat.modified > 0 && (
                <span className={`${styles.badge} ${styles.badgeModified}`}>
                  {diffStat.modified} 修改
                </span>
              )}
              {diffStat.untracked > 0 && (
                <span className={`${styles.badge} ${styles.badgeUntracked}`}>
                  {diffStat.untracked} 未跟踪
                </span>
              )}
              {diffStat.deleted > 0 && (
                <span className={`${styles.badge} ${styles.badgeDeleted}`}>
                  {diffStat.deleted} 已删除
                </span>
              )}
              {hasChanges && (
                <span className={`${styles.badge} ${styles.badgeDirty}`}>●</span>
              )}
              {!hasChanges && (
                <span className={`${styles.badge} ${styles.badgeClean}`}>✓</span>
              )}
            </div>
          )}
        </div>
        <div className={styles.headerRight}>
          {/* Remote info */}
          {remoteUrl && (
            <span className={styles.remoteUrl} title={remoteUrl}>
              {remoteUrl.replace('https://', '').replace('git@', '')}
            </span>
          )}
          {/* Remote actions */}
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={handleFetch}
              disabled={isWorking || !remoteUrl}
              title="获取"
            >
              ↓ Fetch
            </button>
            <button
              className={styles.actionBtn}
              onClick={handlePull}
              disabled={isWorking || !remoteUrl}
              title="拉取"
            >
              ↓ Pull
            </button>
            <button
              className={styles.actionBtn}
              onClick={handlePush}
              disabled={isWorking || !remoteUrl}
              title="推送"
            >
              ↑ Push
            </button>
            <button
              className={`${styles.actionBtn} ${styles.commitBtn}`}
              onClick={() => setShowCommitBox((v) => !v)}
              disabled={isWorking || !hasChanges}
              title="提交"
            >
              ✓ Commit
            </button>
          </div>
        </div>
      </div>

      {/* Commit box */}
      {showCommitBox && (
        <div className={styles.commitBox}>
          <div className={styles.diffFiles}>
            {diffFiles.length > 0 ? (
              diffFiles.map((f) => (
                <span key={f.file} className={styles.diffFile}>
                  <span>{f.status}</span>
                  {f.file}
                </span>
              ))
            ) : (
              <span className={styles.noChanges}>无变更</span>
            )}
          </div>
          <textarea
            className={styles.commitInput}
            placeholder="提交信息..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            rows={3}
            disabled={commitLoading}
          />
          <div className={styles.commitActions}>
            <button
              className={styles.commitConfirm}
              onClick={handleCommit}
              disabled={!commitMsg.trim() || commitLoading}
            >
              {commitLoading ? '提交中...' : '确认提交'}
            </button>
            <button
              className={styles.commitCancel}
              onClick={() => {
                setShowCommitBox(false)
                setCommitMsg('')
              }}
              disabled={commitLoading}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
