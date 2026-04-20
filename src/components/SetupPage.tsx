/**
 * 设置页面（工作目录选择）
 * 对应原 WorkDirPage.vue
 */
import { memo, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { useStorage } from '../hooks/useStorage'
import styles from './SetupPage.module.css'

export default memo(function SetupPage() {
  const showHome = useAppStore((s) => s.showHome)
  const storage = useStorage()
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  async function pickExisting() {
    setMessage('')
    setIsError(false)
    try {
      const picked = await storage.selectWorkDirCandidate()
      if (!picked?.valid) return
      const res = await storage.setWorkDir(picked.nodePath!)
      if (!res?.valid) {
        setIsError(true)
        setMessage(res?.error || '不是有效的工作目录')
        return
      }
      showHome()
    } catch (e) {
      setIsError(true)
      setMessage((e as { message?: string })?.message || '打开工作目录失败')
    }
  }

  async function createNew() {
    setMessage('')
    try {
      const picked = await storage.selectWorkDirCandidate()
      if (!picked?.valid) {
        setIsError(true)
        setMessage(picked?.error || '请选择一个空目录作为新的工作目录')
        return
      }
      const res = await storage.createWorkDir(picked.nodePath!)
      if (!res?.valid) {
        setIsError(true)
        setMessage(res?.error || '创建工作目录失败')
        return
      }
      showHome()
    } catch (e) {
      setIsError(true)
      setMessage((e as { message?: string })?.message || '创建工作目录失败')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.logo}>🧠</div>
          <div>
            <h1>TopoMind</h1>
            <p>先选择一个工作目录，再进入你的笔记本主页</p>
          </div>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={pickExisting}>
            打开已有工作目录
          </button>
          <button className={styles.btn} onClick={createNew}>
            创建新的工作目录
          </button>
        </div>
        {message && <div className={`${styles.message} ${isError ? styles.error : ''}`}>{message}</div>}
      </div>
    </div>
  )
})
