/**
 * 设置页面（工作目录选择）
 * 对应原 WorkDirPage.vue
 */
import { memo, useState } from 'react'
import { useStorage } from '../hooks/useStorage'
import { usePlatform } from '../hooks/usePlatform'
import { logAction } from '../core/log-backend'
import { enterHome } from '../core/app-flow'
import styles from './SetupPage.module.css'

export default memo(function SetupPage() {
  const storage = useStorage()
  const platform = usePlatform()

  // TODO：error和message是否可以合并？这俩应该都是同时变的，改成{isError, message}
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  async function pickExisting() {
    setMessage('')
    setIsError(false)
    try {
      // [step 1] 选择工作目录 —— 打开文件对话框确定目录路径
      const picked = await platform.selectDirectory()
      if (!picked?.valid) {
        // 用户取消或选择无效
        logAction('工作目录选择对话框关闭', 'SetupPage', {
          result: 'cancelled',
          reason: picked?.error || '用户取消',
        })
        return
      }
      logAction('已选择工作目录', 'SetupPage', { selectedPath: picked.nodePath })

      // [step 2] 校验工作目录格式是否为笔记本
      const res = await storage.isValidVault(picked.nodePath!)
      if (!res?.valid) {
        setIsError(true)
        setMessage(res?.error || '不是有效的工作目录')
        logAction('校验工作目录失败', 'SetupPage', {
          nodePath: picked.nodePath,
          error: res?.error || '不是有效的工作目录',
        })
        return
      }

      await enterHome(picked.nodePath!)
    } catch (e) {
      setIsError(true)
      setMessage((e as { message?: string })?.message || '打开工作目录失败')
      logAction('打开工作目录异常', 'SetupPage', { error: (e as Error)?.message || String(e) })
    }
  }

  async function createNew() {
    setMessage('')
    try {
      const picked = await platform.selectDirectory()
      if (!picked?.valid) {
        logAction('SetupPage:文件对话框关闭', 'SetupPage', {
          result: 'cancelled',
          reason: picked?.error || '用户取消',
        })
        setIsError(true)
        setMessage(picked?.error || '请选择一个空目录作为新的工作目录')
        return
      }
      logAction('SetupPage:选择工作目录', 'SetupPage', { selectedPath: picked.nodePath })
      const res = await storage.createWorkDir(picked.nodePath!)
      if (!res?.valid) {
        setIsError(true)
        setMessage(res?.error || '创建工作目录失败')
        logAction('SetupPage:创建工作目录失败', 'SetupPage', {
          nodePath: picked.nodePath,
          error: res?.error || '创建工作目录失败',
        })
        return
      }
      await enterHome(picked.nodePath!)
    } catch (e) {
      setIsError(true)
      setMessage((e as { message?: string })?.message || '创建工作目录失败')
      logAction('SetupPage:创建工作目录异常', 'SetupPage', { error: (e as Error)?.message || String(e) })
    }
  }

  return (
    <div id="setup-page" className={styles.page}>
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
