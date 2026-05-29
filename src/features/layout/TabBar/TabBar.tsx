import { memo, useState, useRef, useEffect } from 'react'
import { useTabStore, type Tab } from '../../../stores/tabs/tabStore'
import { useShortcut } from '../../../hooks/useShortcut'
import { logAction } from '../../../core/log-backend'

export default memo(function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  useShortcut(['Escape'], () => {
    if (isOpen) setIsOpen(false)
  }, { scope: 'global', preventDefault: false })

  useEffect(() => {
    if (!isOpen) return
    
    // 创建一个全屏的透明遮罩层来拦截所有的点击事件
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '1' // 覆盖标题栏，但在当前组件（z-10）之下
    overlay.style.setProperty('-webkit-app-region', 'no-drag')
    
    const handleClose = () => setIsOpen(false)
    
    overlay.addEventListener('pointerdown', handleClose)
    if (rootRef.current) {
      rootRef.current.appendChild(overlay)
    } else {
      document.body.appendChild(overlay)
    }

    const handleWindowPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && rootRef.current?.contains(e.target)) {
        return
      }
      handleClose()
    }
    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true })

    return () => {
      overlay.removeEventListener('pointerdown', handleClose)
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay)
      }
      window.removeEventListener('pointerdown', handleWindowPointerDown, { capture: true })
    }
  }, [isOpen])

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    const tab = useTabStore.getState().closeTab(tabId)
    if (!tab) return
    logAction('Tab:关闭', 'TabBar', { tab })
  }

  const handleTabClick = (tab: Tab) => {
    if (tab.id !== activeTabId) {
      activateTab(tab.id)
      logAction('切换Tab', 'TabBar', { tabId: tab.id, tabLabel: tab.label })
    }
    setIsOpen(false)
  }

  if (tabs.length === 0) return null

  return (
    <div ref={rootRef} className="relative flex items-center h-full z-[3002]" style={{ WebkitAppRegion: 'no-drag' } as any}>
      {/* 触发按钮 */}
      <button
        type="button"
        aria-haspopup="true"
        className={`relative z-10 h-[24px] w-[140px] flex items-center px-2 rounded-[6px] bg-transparent text-[12px] font-medium cursor-default transition-colors ${isOpen ? 'bg-[var(--titlebar-hover)] text-[var(--titlebar-text)]' : 'text-[var(--titlebar-text)] hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]'}`}
        onClick={() => setIsOpen(!isOpen)}
        title={activeTab?.label}
      >
        <span className="flex-1 min-w-0 truncate text-center">{activeTab?.label || '无标签'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 ml-1.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <path d="M2.5 3.5L5 6L7.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 min-w-[220px] max-w-[320px] max-h-[60vh] overflow-y-auto overflow-x-hidden p-1.5 bg-white/90 dark:bg-[#1b2330]/90 border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 z-10" role="menu" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex items-center justify-between gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] ${tab.id === activeTabId ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
              onClick={() => handleTabClick(tab)}
              role="menuitem"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="shrink-0 w-[16px] flex items-center justify-center">
                  {tab.id === activeTabId && (
                    <span className="text-[var(--color-primary)] font-bold">✓</span>
                  )}
                </span>
                <span className="truncate" title={tab.label}>{tab.label}</span>
              </div>
              
              {tab.id !== 'home' && (
                <button
                  className="shrink-0 w-[20px] h-[20px] rounded-md border-none bg-transparent flex items-center justify-center text-[var(--color-text-muted)] p-0 leading-none opacity-0 group-hover:opacity-100 hover:!bg-[#e81123] hover:!text-white transition-all"
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  title={`关闭 ${tab.label}`}
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
