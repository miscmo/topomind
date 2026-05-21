/**
 * 设置页面（工作目录选择）
 * 对应原 WorkDirPage.vue
 */
import { memo, useState } from 'react'
import { useStorage } from '../core/storage'
import { usePlatform } from '../hooks/usePlatform'
import { logAction } from '../core/log-backend'
import { enterHome } from '../core/app-flow'

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
    <div id="setup-page" className="absolute inset-0 w-full h-full min-h-0 bg-[var(--color-bg-app)] flex items-center justify-center overflow-hidden">
      <div className="relative bg-[var(--color-surface)] border-none rounded-none px-10 pt-7 pb-6 w-full h-full shadow-none flex flex-col justify-center gap-5">
        <div className="flex items-center gap-[14px]">
          <img src="./icon.svg" alt="Logo" className="w-10 h-10 drop-shadow-sm" />
          <div>
            <h1 className="text-[var(--color-primary)] text-[22px] font-bold m-0 mb-1 tracking-[-0.5px]">TopoMind</h1>
            <p className="text-[var(--color-text-muted)] text-[13px] m-0 leading-relaxed">先选择一个工作目录，再进入你的笔记本主页</p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <button className="h-10 px-5 border border-[var(--color-primary)] rounded-lg bg-[var(--color-primary)] cursor-pointer text-[13px] text-[var(--color-text-inverse)] transition-all duration-150 font-medium hover:bg-[var(--color-primary-hover)] hover:border-[var(--color-primary-hover)]" onClick={pickExisting}>
            打开已有工作目录
          </button>
          <button className="h-10 px-5 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] cursor-pointer text-[13px] text-[var(--color-text-secondary)] transition-all duration-150 font-medium hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)] hover:border-[var(--color-border-strong)]" onClick={createNew}>
            创建新的工作目录
          </button>
        </div>
        {message && <div className={`absolute left-10 right-10 bottom-3 text-[12px] text-center leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap ${isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>{message}</div>}
      </div>
    </div>
  )
})
