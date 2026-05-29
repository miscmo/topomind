/**
 * 设置页面（工作目录选择）
 * 对应原 WorkDirPage.vue
 */
import { memo, useState, useEffect } from 'react'
import { useStorage } from '../../core/storage'
import { usePlatform } from '../../hooks/usePlatform'
import { logAction } from '../../core/log-backend'
import { enterHome } from '../../core/app-flow'
import { getRecentWorkspaces, getLastWorkspace, removeRecentWorkspace, RecentWorkspace } from '../../core/workspace-cache'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export default memo(function SetupPage() {
  const storage = useStorage()
  const platform = usePlatform()
  const skipAutoLoad = useWorkspaceStore((s) => s.skipAutoLoad)

  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [isAutoLoading, setIsAutoLoading] = useState(!skipAutoLoad)

  useEffect(() => {
    async function autoLoad() {
      if (skipAutoLoad) {
        setRecentWorkspaces(getRecentWorkspaces())
        setIsAutoLoading(false)
        return
      }
      
      const lastWorkspace = getLastWorkspace()
      if (lastWorkspace) {
        try {
          const res = await storage.isValidVault(lastWorkspace)
          if (res?.valid) {
            await enterHome(lastWorkspace)
            return // Successfully entered, component will unmount
          } else {
            removeRecentWorkspace(lastWorkspace)
          }
        } catch (e) {
          removeRecentWorkspace(lastWorkspace)
        }
      }
      setIsAutoLoading(false)
      setRecentWorkspaces(getRecentWorkspaces())
    }
    autoLoad()
  }, [storage])

  async function openWorkspace(path: string) {
    setMessage('')
    setIsError(false)
    try {
      const res = await storage.isValidVault(path)
      if (!res?.valid) {
        setIsError(true)
        setMessage(res?.error || '不是有效的工作目录')
        removeRecentWorkspace(path)
        setRecentWorkspaces(getRecentWorkspaces())
        return
      }
      await enterHome(path)
    } catch (e) {
      setIsError(true)
      setMessage((e as { message?: string })?.message || '打开工作目录失败')
      removeRecentWorkspace(path)
      setRecentWorkspaces(getRecentWorkspaces())
    }
  }

  async function pickExisting() {
    setMessage('')
    setIsError(false)
    try {
      const picked = await platform.selectDirectory()
      if (!picked?.valid) {
        logAction('工作目录选择对话框关闭', 'SetupPage', {
          result: 'cancelled',
          reason: picked?.error || '用户取消',
        })
        return
      }
      logAction('已选择工作目录', 'SetupPage', { selectedPath: picked.nodePath })
      await openWorkspace(picked.nodePath!)
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

  if (isAutoLoading) {
    return (
      <div id="setup-page" className="absolute inset-0 w-full h-full min-h-0 bg-[var(--color-bg-app)] flex items-center justify-center overflow-hidden">
        <div className="text-[var(--color-text-muted)] text-[13px]">正在加载工作区...</div>
      </div>
    )
  }

  return (
    <div id="setup-page" className="absolute inset-0 w-full h-full min-h-0 bg-[var(--color-bg-app)] flex items-center justify-center overflow-hidden">
      <div className="relative bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-2xl p-10 w-[640px] max-w-[90vw] shadow-[var(--shadow-lg)] flex flex-col gap-8 transition-all duration-300">
        
        {/* Header Section */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)] flex items-center justify-center shadow-sm">
            <img src="./icon.svg" alt="Logo" className="w-7 h-7 filter brightness-0 invert drop-shadow-sm" />
          </div>
          <div>
            <h1 className="text-[var(--color-text-primary)] text-[26px] font-bold m-0 mb-1 tracking-tight">TopoMind</h1>
            <p className="text-[var(--color-text-muted)] text-[14px] m-0 font-medium">选择或创建一个工作空间，开启你的知识图谱</p>
          </div>
        </div>
        
        {/* Content Section */}
        <div className="flex gap-8 h-[220px]">
          {/* 左侧：操作区 */}
          <div className="flex-[0.8] flex flex-col gap-4">
            <h2 className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider m-0 mb-1">快速开始</h2>
            <button 
              className="h-12 px-5 border border-transparent rounded-xl bg-[var(--color-primary)] cursor-pointer text-[14px] text-[var(--color-text-inverse)] transition-all duration-200 font-medium hover:bg-[var(--color-primary-hover)] hover:shadow-md flex items-center gap-3 group" 
              onClick={pickExisting}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-80 group-hover:opacity-100 transition-opacity">
                <path d="M4 4H10L12 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              打开现有空间
            </button>
            <button 
              className="h-12 px-5 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)] cursor-pointer text-[14px] text-[var(--color-text-secondary)] transition-all duration-200 font-medium hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)] hover:border-[var(--color-border-strong)] flex items-center gap-3 group" 
              onClick={createNew}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              创建新空间
            </button>
          </div>

          {/* 分割线 */}
          <div className="w-px bg-gradient-to-b from-transparent via-[var(--color-border-subtle)] to-transparent h-full"></div>

          {/* 右侧：最近使用 */}
          <div className="flex-[1.2] flex flex-col gap-3 h-full min-w-0">
            <h2 className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider m-0 mb-1">最近打开</h2>
            {recentWorkspaces.length > 0 ? (
              <div className="flex flex-col gap-2 overflow-y-auto pr-2 pb-2 h-full custom-scrollbar">
                {recentWorkspaces.map(ws => {
                  const parts = ws.path.split(/[/\\]/);
                  const folderName = parts.pop() || ws.path;
                  const parentPath = parts.join('/');
                  
                  return (
                    <button 
                      key={ws.path}
                      className="flex flex-col items-start px-4 py-3 rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface)] cursor-pointer transition-all duration-200 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:shadow-sm text-left group"
                      onClick={() => openWorkspace(ws.path)}
                      title={ws.path}
                    >
                      <div className="flex items-center gap-2.5 w-full">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors shrink-0">
                          <path d="M4 4H10L12 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[14px] text-[var(--color-text-primary)] font-semibold truncate">
                          {folderName}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--color-text-muted)] truncate mt-1 w-full pl-[26px] font-mono opacity-70">
                        {parentPath || '/'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)] opacity-60 border-2 border-dashed border-[var(--color-border-light)] rounded-xl bg-[var(--color-bg-muted)]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-2">
                  <path d="M12 8V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[13px] font-medium">暂无最近记录</span>
              </div>
            )}
          </div>
        </div>

        {message && (
          <div className={`absolute left-0 right-0 -bottom-8 text-[13px] font-medium text-center transition-all duration-300 ${isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  )
})
