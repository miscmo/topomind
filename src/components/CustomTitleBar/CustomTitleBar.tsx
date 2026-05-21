import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { useThemeStore } from '../../stores/themeStore'
import { useRightPanelStore } from '../../stores/rightPanelStore'
import TabBar from '../TabBar/TabBar'
import type { WindowControlsState } from '../../types/electron-api'

type TitleBarMode = 'setup' | 'workspace'

type MenuKey = 'file' | 'view' | 'help'

type WindowCommandChannel = 'app:window:minimize' | 'app:window:toggleMaximize' | 'app:window:close'

interface CustomTitleBarProps {
  mode: TitleBarMode
}

interface MenuItem {
  label: string
  shortcut?: string
  disabled?: boolean
  action?: () => void
  submenu?: MenuItem[]
  checked?: boolean
}

const MENU_LABELS: Array<{ key: MenuKey; label: string }> = [
  { key: 'file', label: '文件' },
  { key: 'view', label: '视图' },
  { key: 'help', label: '帮助' },
]

function isWindowControlsState(value: unknown): value is WindowControlsState {
  return !!value && typeof value === 'object' && 'isMaximized' in value && 'isFocused' in value
}

export default memo(function CustomTitleBar({ mode }: CustomTitleBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null)
  const [windowState, setWindowState] = useState<WindowControlsState>({ isMaximized: false, isFocused: true })
  const openMonitorTab = useTabStore((s) => s.openMonitorTab)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  const rightPanelCollapsed = useRightPanelStore((s) => s.rightPanelCollapsed)
  const collapseRightPanel = useRightPanelStore((s) => s.collapseRightPanel)
  const expandRightPanel = useRightPanelStore((s) => s.expandRightPanel)
  const rightPanelTab = useRightPanelStore((s) => s.rightPanelTab)
  const setRightPanelTab = useRightPanelStore((s) => s.setRightPanelTab)

  const toggleRightPanel = useCallback(() => {
    if (rightPanelCollapsed) {
      expandRightPanel()
    } else {
      collapseRightPanel()
    }
  }, [rightPanelCollapsed, collapseRightPanel, expandRightPanel])

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    let disposed = false
    void api.invoke('app:window:getState').then((state) => {
      if (!disposed && isWindowControlsState(state)) setWindowState(state)
    })

    const handleWindowStateChange = (...args: unknown[]) => {
      const state = args[0]
      if (isWindowControlsState(state)) setWindowState(state)
    }

    api.on('app:window-state-change', handleWindowStateChange)
    return () => {
      disposed = true
      api.off('app:window-state-change', handleWindowStateChange)
    }
  }, [])

  useEffect(() => {
    if (!activeMenu) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeMenu])

  const invokeWindowCommand = useCallback((channel: WindowCommandChannel) => {
    const api = window.electronAPI
    if (!api) return

    void api.invoke(channel).then((state) => {
      if (isWindowControlsState(state)) setWindowState(state)
    })
  }, [])

  const menuItems = useMemo<Record<MenuKey, MenuItem[]>>(() => ({
    file: [
      { label: '切换工作目录', action: () => { void window.electronAPI?.invoke('app:switchWorkDir') } },
      { label: '退出 TopoMind', shortcut: 'Alt+F4', action: () => invokeWindowCommand('app:window:close') },
    ],
    view: [
      { 
        label: '主题', 
        submenu: [
          { label: '浅色', checked: theme === 'light', action: () => setTheme('light') },
          { label: '深色', checked: theme === 'dark', action: () => setTheme('dark') },
        ]
      },
      { label: '系统日志', action: () => openMonitorTab() },
      { label: '命令中心', shortcut: 'Ctrl+Shift+P', disabled: true },
      { label: '重置布局', disabled: true },
    ],
    help: [
      { label: '快捷键', disabled: true },
      { label: '开发者工具', shortcut: 'F12', action: () => { void window.electronAPI?.invoke('app:window:toggleDevTools') } },
      { label: '关于 TopoMind', disabled: true },
    ],
  }), [invokeWindowCommand, openMonitorTab, theme, setTheme])

  return (
    <div 
      ref={rootRef} 
      className={`flex items-center shrink-0 h-[32px] bg-[var(--titlebar-bg)] border-b border-[var(--color-border-subtle)] text-[var(--titlebar-text)] select-none [-webkit-app-region:drag] relative z-[3000] transition-colors ${!windowState.isFocused ? '[--titlebar-bg:var(--titlebar-bg-unfocused)] [--titlebar-text:var(--titlebar-text-unfocused)] [--titlebar-muted:var(--titlebar-muted-unfocused)]' : ''}`}
      onDoubleClick={(e) => {
        // Prevent double click on specific children from maximizing
        if (e.target instanceof Element && e.target.closest(`button, [role="tab"], .truncate`)) {
          return
        }
        invokeWindowCommand('app:window:toggleMaximize')
      }}
    >
      <div className="shrink-0 flex items-center pl-2 gap-2 h-full relative after:content-[''] after:absolute after:right-0 after:top-[20%] after:bottom-[20%] after:w-[1px] after:bg-[var(--color-border-subtle)] pr-2">
        <div className="inline-flex items-center h-6 gap-[6px] px-1.5 rounded-[6px] text-[var(--titlebar-text)]" title="TopoMind" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <img src="./icon.svg" alt="Logo" className="w-4 h-4 drop-shadow-sm" />
        </div>
        {mode === 'workspace' && (
          <nav className="hidden md:flex items-center gap-[1px] min-w-0" aria-label="应用菜单" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {MENU_LABELS.map((menu) => (
              <div key={menu.key} className="relative">
                <button
                  type="button"
                  className={`h-[24px] px-2 rounded-md bg-transparent text-[12px] font-medium cursor-default transition-colors hover:bg-[var(--titlebar-hover)] ${activeMenu === menu.key ? 'bg-[var(--titlebar-hover)] text-[var(--color-primary)]' : 'text-[var(--titlebar-text)]'}`}
                  onClick={() => setActiveMenu((current) => current === menu.key ? null : menu.key)}
                  onMouseEnter={() => { if (activeMenu) setActiveMenu(menu.key) }}
                  style={{ WebkitAppRegion: 'no-drag' } as any}
                >
                  {menu.label}
                </button>
                {activeMenu === menu.key && (
                  <div className="absolute top-[30px] left-0 min-w-[188px] p-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-[14px] z-[3001]" role="menu">
                    {menuItems[menu.key].map((item) => (
                      item.submenu ? (
                        <div key={item.label} className="relative group">
                          <button
                            type="button"
                            className="w-full h-[30px] flex items-center justify-between gap-4 px-[9px] rounded-[7px] bg-transparent text-[var(--color-text-primary)] text-xs text-left cursor-default hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)] peer"
                          >
                            <span>{item.label}</span>
                            <span className="text-[var(--color-text-muted)] text-[10px]">▶</span>
                          </button>
                          <div className="absolute top-0 left-[calc(100%+4px)] min-w-[140px] p-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-[14px] opacity-0 invisible hover:opacity-100 hover:visible peer-hover:opacity-100 peer-hover:visible transition-all duration-150 z-[3002]" role="menu">
                            {item.submenu.map(subItem => (
                              <button
                                key={subItem.label}
                                type="button"
                                className="w-full h-[30px] flex items-center justify-between gap-2 px-[9px] rounded-[7px] bg-transparent text-[var(--color-text-primary)] text-xs text-left cursor-default hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)] disabled:opacity-50"
                                 disabled={subItem.disabled}
                                 onClick={() => {
                                  if (subItem.disabled) return
                                  setActiveMenu(null)
                                  subItem.action?.()
                                }}
                              >
                                <span>{subItem.label}</span>
                                {subItem.checked && <span className="text-[var(--color-primary)]">✓</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <button
                          key={item.label}
                          type="button"
                          className="w-full h-[30px] flex items-center justify-between gap-4 px-[9px] rounded-[7px] bg-transparent text-[var(--color-text-primary)] text-xs text-left cursor-default hover:not(:disabled):bg-[var(--color-hover-bg)] hover:not(:disabled):text-[var(--color-primary)] disabled:text-[var(--color-text-muted)]"
                          disabled={item.disabled}
                          onClick={() => {
                            if (item.disabled) return
                            setActiveMenu(null)
                            item.action?.()
                          }}
                        >
                          <span>{item.label}</span>
                          {item.shortcut && <span className="text-[var(--color-text-muted)] text-[11px]">{item.shortcut}</span>}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="flex-1 min-w-0 flex items-end justify-start h-full mx-2.5 relative" style={{ WebkitAppRegion: 'drag' } as any}>
        {mode === 'workspace' && (
          <div className="h-full w-full max-w-[50%] flex items-end" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <TabBar />
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-end h-full">
        {mode === 'workspace' && (
          <>
            <button
              type="button"
              className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)] aria-pressed:text-[var(--color-accent)]"
              onClick={toggleRightPanel}
              title={rightPanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
              aria-label={rightPanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              {rightPanelCollapsed ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 2.5v11" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 2.5v11" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 2.5H13A1.5 1.5 0 0 1 14.5 4V12A1.5 1.5 0 0 1 13 13.5H10.5V2.5Z" fill="currentColor"/>
                </svg>
              )}
            </button>
            <div className="flex items-center h-[22px] bg-[var(--titlebar-bg-unfocused)] border border-[var(--color-border-subtle)] rounded-[6px] p-[2px] mx-1 mr-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <button
                type="button"
                className={`px-2.5 h-full rounded-[4px] text-[11px] font-medium transition-colors ${rightPanelTab === 'detail' ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]' : 'text-[var(--titlebar-muted)] hover:text-[var(--titlebar-text)]'}`}
                onClick={() => {
                  setRightPanelTab('detail')
                  if (rightPanelCollapsed) expandRightPanel()
                }}
              >
                详情
              </button>
              <button
                type="button"
                className={`px-2.5 h-full rounded-[4px] text-[11px] font-medium transition-colors ${rightPanelTab === 'style' ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]' : 'text-[var(--titlebar-muted)] hover:text-[var(--titlebar-text)]'}`}
                onClick={() => {
                  setRightPanelTab('style')
                  if (rightPanelCollapsed) expandRightPanel()
                }}
              >
                样式
              </button>
            </div>
            <div className="w-[1px] h-[16px] bg-[var(--color-border-subtle)] mx-1" />
          </>
        )}
        <div className="h-full inline-flex items-stretch">
          <button type="button" className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]" onClick={() => invokeWindowCommand('app:window:minimize')} aria-label="最小化窗口" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 5H10" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
          <button type="button" className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]" onClick={() => invokeWindowCommand('app:window:toggleMaximize')} aria-label={windowState.isMaximized ? '还原窗口' : '最大化窗口'} style={{ WebkitAppRegion: 'no-drag' } as any}>
            {windowState.isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1"/>
                <path d="M0.5 2.5V9.5H7.5" stroke="currentColor" strokeWidth="1"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/>
              </svg>
            )}
          </button>
          <button type="button" className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:!bg-[#e81123] hover:!text-white" onClick={() => invokeWindowCommand('app:window:close')} aria-label="关闭窗口" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
})
